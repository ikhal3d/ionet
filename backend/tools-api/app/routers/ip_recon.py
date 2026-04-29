"""IP reputation aggregator.

Combines multiple public/free intelligence sources into a single
0-100 risk score:

  * GreyNoise Community  — no auth required, classifies IPs as
    benign/malicious/suspicious/unknown based on internet-wide scan
    activity.
  * AbuseIPDB             — optional API key (ABUSEIPDB_API_KEY env);
    abuse confidence score 0-100 + recent reports.

Other sources (Shodan, VirusTotal) can be plumbed in later — they
all need API keys and quotas. For now the two above give a usable
baseline at zero / minimal cost.
"""

import asyncio
import ipaddress
import os
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

GREYNOISE_URL  = "https://api.greynoise.io/v3/community/{ip}"
ABUSEIPDB_URL  = "https://api.abuseipdb.com/api/v2/check"
ABUSEIPDB_KEY  = os.environ.get("ABUSEIPDB_API_KEY", "")
TIMEOUT = 8.0


class IpReconReq(BaseModel):
    ip: str = Field(..., min_length=7, max_length=45)


class IpReconRes(BaseModel):
    ip: str
    risk_score: int | None = None
    risk_label: str | None = None
    sources: dict = {}
    error: str | None = None


async def _greynoise(client: httpx.AsyncClient, ip: str) -> dict:
    try:
        r = await client.get(GREYNOISE_URL.format(ip=ip), timeout=TIMEOUT,
                             headers={"Accept": "application/json"})
    except Exception as e:
        return {"responding": False, "error": f"{type(e).__name__}: {e}"}
    if r.status_code == 200:
        d = r.json()
        return {
            "responding": True,
            "classification": d.get("classification"),
            "name": d.get("name"),
            "noise": d.get("noise"),
            "riot": d.get("riot"),
            "last_seen": d.get("last_seen"),
            "link": d.get("link"),
        }
    if r.status_code == 404:
        return {"responding": True, "classification": "unseen",
                "note": "GreyNoise has not observed this IP scanning the internet"}
    return {"responding": False, "error": f"HTTP {r.status_code}"}


async def _abuseipdb(client: httpx.AsyncClient, ip: str) -> dict:
    if not ABUSEIPDB_KEY:
        return {"responding": False, "implemented": False,
                "error": "ABUSEIPDB_API_KEY not set on backend — free key from abuseipdb.com"}
    try:
        r = await client.get(ABUSEIPDB_URL, timeout=TIMEOUT,
                             headers={"Key": ABUSEIPDB_KEY, "Accept": "application/json"},
                             params={"ipAddress": ip, "maxAgeInDays": 90})
    except Exception as e:
        return {"responding": False, "implemented": True, "error": f"{type(e).__name__}: {e}"}
    if r.status_code == 200:
        d = r.json().get("data", {})
        return {
            "responding": True,
            "implemented": True,
            "abuse_confidence_score": d.get("abuseConfidenceScore"),
            "country_code": d.get("countryCode"),
            "isp": d.get("isp"),
            "domain": d.get("domain"),
            "total_reports": d.get("totalReports"),
            "num_distinct_users": d.get("numDistinctUsers"),
            "last_reported_at": d.get("lastReportedAt"),
            "is_tor": d.get("isTor"),
            "usage_type": d.get("usageType"),
        }
    return {"responding": False, "implemented": True, "error": f"HTTP {r.status_code}"}


def _label(score: int | None) -> str | None:
    if score is None: return None
    if score >= 75: return "high"
    if score >= 40: return "medium"
    if score >= 10: return "low"
    return "minimal"


@router.post("/ip-recon", response_model=IpReconRes)
async def ip_recon(req: IpReconReq):
    try:
        ip = ipaddress.ip_address(req.ip.strip())
    except ValueError:
        raise HTTPException(400, "not a valid IP address")
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
        raise HTTPException(400, "private / reserved IPs cannot be looked up")

    async with httpx.AsyncClient() as client:
        gn, ab = await asyncio.gather(
            _greynoise(client, str(ip)),
            _abuseipdb(client, str(ip)),
        )

    # Composite score — prefer AbuseIPDB's 0-100 confidence if available,
    # fall back to GreyNoise classification mapping.
    score: int | None = None
    if ab.get("responding") and isinstance(ab.get("abuse_confidence_score"), int):
        score = ab["abuse_confidence_score"]
    elif gn.get("responding") and gn.get("classification"):
        score = {"malicious": 80, "suspicious": 50, "benign": 5, "unseen": 0}.get(
            gn["classification"], None
        )

    return IpReconRes(
        ip=str(ip),
        risk_score=score,
        risk_label=_label(score),
        sources={"greynoise": gn, "abuseipdb": ab},
    )
