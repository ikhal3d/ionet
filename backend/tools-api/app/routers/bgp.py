"""BGP route inspector — public BGP collector data via RIPEstat.

Honest framing: this is NOT a "BGP looking glass" in the strict sense
(read-only access to OUR routing table). We don't have BGP gear yet.
Instead, we proxy RIPEstat's looking-glass + network-info APIs, which
expose the routing tables of the RIPE NCC's RIS collectors — public,
reliable, and very close to what a real LG would show for any prefix.
"""

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()

RIPESTAT = "https://stat.ripe.net/data"
TIMEOUT = 12.0


class BgpReq(BaseModel):
    query: str = Field(..., min_length=1, max_length=64)


class BgpRoute(BaseModel):
    rrc: str | None = None
    rrc_location: str | None = None
    peer: str | None = None
    as_path: str | None = None
    next_hop: str | None = None
    community: str | None = None


class BgpRes(BaseModel):
    query: str
    kind: str
    asn: int | None = None
    holder: str | None = None
    prefix: str | None = None
    rpki: list[dict] = []
    routes: list[BgpRoute] = []
    rrcs_seen: int = 0
    error: str | None = None


@router.post("/bgp", response_model=BgpRes)
async def bgp_query(req: BgpReq):
    q = req.query.strip()
    kind = "asn" if q.upper().startswith("AS") and q[2:].isdigit() else (
        "asn" if q.isdigit() else "prefix"
    )

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            ni_r = await client.get(f"{RIPESTAT}/network-info/data.json", params={"resource": q})
            lg_r = await client.get(f"{RIPESTAT}/looking-glass/data.json", params={"resource": q})
            ni = ni_r.json().get("data", {}) if ni_r.status_code == 200 else {}
            lg = lg_r.json().get("data", {}) if lg_r.status_code == 200 else {}
            asns = ni.get("asns") or []
            prefix = ni.get("prefix")

            holder = None
            if asns:
                ho_r = await client.get(f"{RIPESTAT}/as-overview/data.json", params={"resource": f"AS{asns[0]}"})
                if ho_r.status_code == 200:
                    holder = (ho_r.json().get("data") or {}).get("holder")

            rpki = []
            if prefix and asns:
                rp_r = await client.get(f"{RIPESTAT}/rpki-validation/data.json",
                                        params={"resource": f"AS{asns[0]}", "prefix": prefix})
                if rp_r.status_code == 200:
                    rd = (rp_r.json().get("data") or {})
                    rpki = [{
                        "status": rd.get("status"),
                        "validating_roas": rd.get("validating_roas") or [],
                    }]
    except Exception as e:
        return BgpRes(query=q, kind=kind, error=f"upstream fetch failed: {type(e).__name__}: {e}")

    routes: list[BgpRoute] = []
    rrcs = lg.get("rrcs") or []
    for rrc in rrcs[:8]:
        peers = rrc.get("peers") or []
        for peer in peers[:3]:
            routes.append(BgpRoute(
                rrc=rrc.get("rrc"),
                rrc_location=rrc.get("location"),
                peer=str(peer.get("peer") or ""),
                as_path=peer.get("as_path"),
                next_hop=peer.get("next_hop"),
                community=peer.get("community") or None,
            ))

    return BgpRes(
        query=q,
        kind=kind,
        asn=asns[0] if asns else None,
        holder=holder,
        prefix=prefix,
        rpki=rpki,
        routes=routes,
        rrcs_seen=len(rrcs),
    )
