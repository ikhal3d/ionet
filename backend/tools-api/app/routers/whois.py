"""WHOIS / RDAP endpoint.

RDAP-first (modern, structured JSON) with python-whois fallback for
gTLDs and ccTLDs that haven't migrated. IP queries hit the RIRs
(ARIN, RIPE, APNIC, LACNIC, AFRINIC) via the bootstrap registry.
"""

import ipaddress
import re
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

RDAP_BOOTSTRAP_DOMAIN = "https://rdap.org/domain/{q}"
RDAP_BOOTSTRAP_IP     = "https://rdap.org/ip/{q}"
TIMEOUT = 8.0


class WhoisReq(BaseModel):
    query: str = Field(..., min_length=1, max_length=253)


class WhoisRes(BaseModel):
    query: str
    kind: str           # "domain" | "ipv4" | "ipv6"
    rdap: dict | None = None
    whois: str | None = None
    error: str | None = None


def _classify(q: str) -> str:
    try:
        ip = ipaddress.ip_address(q)
        return "ipv4" if isinstance(ip, ipaddress.IPv4Address) else "ipv6"
    except ValueError:
        if re.match(r"^[a-zA-Z0-9][a-zA-Z0-9\-\.]{0,251}[a-zA-Z0-9]$", q):
            return "domain"
        return "unknown"


@router.post("/whois", response_model=WhoisRes)
async def whois_lookup(req: WhoisReq):
    q = req.query.strip().lower()
    kind = _classify(q)
    if kind == "unknown":
        raise HTTPException(400, "query must be a domain or IPv4/IPv6 address")

    url = RDAP_BOOTSTRAP_IP.format(q=q) if kind.startswith("ipv") else RDAP_BOOTSTRAP_DOMAIN.format(q=q)

    rdap_data = None
    rdap_err = None
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=TIMEOUT) as client:
            r = await client.get(url, headers={"Accept": "application/rdap+json"})
            if r.status_code == 200:
                rdap_data = r.json()
            else:
                rdap_err = f"RDAP HTTP {r.status_code}"
    except Exception as e:
        rdap_err = f"RDAP fetch failed: {e}"

    # WHOIS fallback for domains only (RDAP usually has IP answers)
    whois_text = None
    if rdap_data is None and kind == "domain":
        try:
            import whois  # python-whois (sync)
            w = whois.whois(q)
            whois_text = str(w) if w else None
        except Exception as e:
            return WhoisRes(query=q, kind=kind, error=f"both RDAP and WHOIS failed: {rdap_err}; {e}")

    if rdap_data is None and whois_text is None:
        return WhoisRes(query=q, kind=kind, error=rdap_err or "no data")

    return WhoisRes(query=q, kind=kind, rdap=rdap_data, whois=whois_text)
