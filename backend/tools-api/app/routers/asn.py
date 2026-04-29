"""ASN / prefix lookup.

Two queries handled:
  • ASN (e.g. AS13335 or 13335)         → name, country, prefixes announced
  • Prefix or IP (e.g. 1.1.1.1, 8.8.8.0/24) → origin ASN, AS-path overview

Backed by RIPEstat's free API (no auth, generous fair-use), which itself
draws on RIS, RIRs, and BGP route collectors.
"""

import re
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

RIPESTAT_AS_OVERVIEW   = "https://stat.ripe.net/data/as-overview/data.json"
RIPESTAT_AS_ANNOUNCED  = "https://stat.ripe.net/data/announced-prefixes/data.json"
RIPESTAT_NETWORK_INFO  = "https://stat.ripe.net/data/network-info/data.json"
RIPESTAT_PREFIX_OVER   = "https://stat.ripe.net/data/prefix-overview/data.json"
TIMEOUT = 8.0


class AsnReq(BaseModel):
    query: str = Field(..., min_length=1, max_length=64)


class AsnRes(BaseModel):
    query: str
    kind: str        # "asn" | "prefix" | "ip"
    asn: int | None = None
    holder: str | None = None
    country: str | None = None
    prefixes: list[str] = []
    origin_asns: list[int] = []
    error: str | None = None


def _classify(q: str) -> str:
    if re.match(r"^(?:AS)?\d+$", q, re.I):
        return "asn"
    if "/" in q:
        return "prefix"
    if re.match(r"^[0-9a-fA-F:.]+$", q):
        return "ip"
    return "unknown"


@router.post("/asn", response_model=AsnRes)
async def asn_lookup(req: AsnReq):
    q = req.query.strip()
    kind = _classify(q)
    if kind == "unknown":
        raise HTTPException(400, "query must be an ASN (e.g. 13335 or AS13335), an IP, or a CIDR prefix")

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        if kind == "asn":
            num = int(re.sub(r"^AS", "", q, flags=re.I))
            try:
                r1 = await client.get(RIPESTAT_AS_OVERVIEW, params={"resource": f"AS{num}"})
                r2 = await client.get(RIPESTAT_AS_ANNOUNCED, params={"resource": f"AS{num}"})
            except Exception as e:
                return AsnRes(query=q, kind=kind, error=f"upstream fetch failed: {e}")
            d1 = r1.json().get("data", {})
            d2 = r2.json().get("data", {})
            holder = d1.get("holder")
            announced = [p["prefix"] for p in d2.get("prefixes", [])][:200]
            return AsnRes(query=q, kind=kind, asn=num, holder=holder, prefixes=announced)

        # IP or prefix → which AS announces it?
        try:
            target = q if kind == "prefix" else q
            r = await client.get(RIPESTAT_NETWORK_INFO, params={"resource": target})
        except Exception as e:
            return AsnRes(query=q, kind=kind, error=f"upstream fetch failed: {e}")
        ni = r.json().get("data", {})
        asns = [int(a) for a in ni.get("asns", [])]
        prefix = ni.get("prefix")
        holder = None
        if asns:
            try:
                ro = await client.get(RIPESTAT_AS_OVERVIEW, params={"resource": f"AS{asns[0]}"})
                holder = ro.json().get("data", {}).get("holder")
            except Exception:
                pass
        return AsnRes(
            query=q,
            kind=kind,
            asn=asns[0] if asns else None,
            holder=holder,
            origin_asns=asns,
            prefixes=[prefix] if prefix else [],
        )
