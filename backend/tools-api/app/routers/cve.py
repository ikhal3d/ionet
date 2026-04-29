"""NIST NVD CVE search proxy.

Hits the NVD REST API 2.0 — no auth required for low-volume queries.
Optionally uses an NVD_API_KEY env var for higher rate limits (50
requests / 30s instead of 5 / 30s).
"""

import os
import re
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
NVD_KEY = os.environ.get("NVD_API_KEY", "")
TIMEOUT = 18.0


class CveReq(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)
    limit: int = Field(20, ge=1, le=100)


class CveItem(BaseModel):
    id: str
    published: str | None = None
    last_modified: str | None = None
    description: str
    score: float | None = None
    severity: str | None = None
    vector: str | None = None
    url: str


class CveRes(BaseModel):
    query: str
    total: int = 0
    items: list[CveItem] = []
    error: str | None = None


CVE_ID = re.compile(r"^CVE-\d{4}-\d+$", re.I)


@router.post("/cve", response_model=CveRes)
async def cve_search(req: CveReq):
    q = req.query.strip()
    params: dict = {"resultsPerPage": req.limit}
    if CVE_ID.match(q):
        params["cveId"] = q.upper()
    else:
        params["keywordSearch"] = q

    headers = {"Accept": "application/json"}
    if NVD_KEY:
        headers["apiKey"] = NVD_KEY

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(NVD_URL, params=params, headers=headers)
    except Exception as e:
        return CveRes(query=q, error=f"NVD fetch failed: {type(e).__name__}: {e}")

    if r.status_code == 404:
        return CveRes(query=q, total=0, items=[])
    if r.status_code != 200:
        return CveRes(query=q, error=f"NVD HTTP {r.status_code} — try again, or set NVD_API_KEY for higher rate limits")

    try:
        d = r.json()
    except Exception as e:
        return CveRes(query=q, error=f"NVD returned non-JSON: {e}")

    items: list[CveItem] = []
    for v in d.get("vulnerabilities", []):
        cve = v.get("cve", {})
        descs = cve.get("descriptions") or []
        desc_en = next((x.get("value", "") for x in descs if x.get("lang") == "en"), "")

        # Pick the best CVSS metric available (v3.1 > v3.0 > v2)
        metrics = cve.get("metrics") or {}
        score = severity = vector = None
        for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
            arr = metrics.get(key) or []
            if arr:
                data = arr[0].get("cvssData", {})
                score = data.get("baseScore")
                severity = data.get("baseSeverity") or arr[0].get("baseSeverity")
                vector = data.get("vectorString")
                break

        items.append(CveItem(
            id=cve.get("id", ""),
            published=cve.get("published"),
            last_modified=cve.get("lastModified"),
            description=(desc_en or "")[:400],
            score=score,
            severity=severity,
            vector=vector,
            url=f"https://nvd.nist.gov/vuln/detail/{cve.get('id', '')}",
        ))

    return CveRes(query=q, total=int(d.get("totalResults", 0)), items=items)
