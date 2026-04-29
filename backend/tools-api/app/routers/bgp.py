"""BGP route inspector — public BGP collector data via RIPEstat.

Honest framing: this is NOT a "BGP looking glass" in the strict sense
(read-only access to OUR routing table). We don't have BGP gear yet.
Instead, we proxy RIPEstat's looking-glass + network-info APIs, which
expose the routing tables of the RIPE NCC's RIS collectors — public,
reliable, and very close to what a real LG would show for any prefix.

Also enriches every AS in every path with its holder name so the
frontend can show "AS45763 OPTICOMM CO PTY LTD" instead of just
"AS45763". All holder lookups happen in parallel.
"""

import asyncio
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
    as_holders: dict[str, str] = {}   # ASN string -> holder name (every AS in any path)
    error: str | None = None


async def _fetch_holder(client: httpx.AsyncClient, asn: str) -> tuple[str, str]:
    """Look up the registered holder name for one ASN. Returns (asn, holder)
    where holder may be empty string if RIPEstat didn't know."""
    try:
        r = await client.get(f"{RIPESTAT}/as-overview/data.json",
                             params={"resource": f"AS{asn}"})
        if r.status_code == 200:
            return asn, ((r.json().get("data") or {}).get("holder") or "")
    except Exception:
        pass
    return asn, ""


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

            # ── Build the routes list ─────────────────────────────────────
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

            # ── Collect every distinct ASN that appears in any path,
            #    fetch all their holder names in parallel. We seed with
            #    the origin so it's always populated even on empty paths.
            unique_asns: set[str] = set()
            if asns:
                unique_asns.add(str(asns[0]))
            for r in routes:
                if not r.as_path:
                    continue
                for tok in r.as_path.split():
                    if tok.isdigit():
                        unique_asns.add(tok)

            as_holders: dict[str, str] = {}
            if unique_asns:
                pairs = await asyncio.gather(
                    *(_fetch_holder(client, a) for a in unique_asns),
                    return_exceptions=False,
                )
                for asn, h in pairs:
                    if h:
                        as_holders[asn] = h

    except Exception as e:
        return BgpRes(query=q, kind=kind, error=f"upstream fetch failed: {type(e).__name__}: {e}")

    return BgpRes(
        query=q,
        kind=kind,
        asn=asns[0] if asns else None,
        holder=holder,
        prefix=prefix,
        rpki=rpki,
        routes=routes,
        rrcs_seen=len(rrcs),
        as_holders=as_holders,
    )
