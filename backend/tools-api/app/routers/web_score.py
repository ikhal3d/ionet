"""Composite Website Security Score.

Chains:
  1. Our own header grader (always runs, fast)
  2. Mozilla HTTP Observatory cached scan (fast — no scan kicked off)

Returns a combined verdict. Frontend renders the bigger picture, with
the per-source breakdowns visible.

Mozilla Observatory (https://observatory.mozilla.org) requires no API
key. We use the cached `/api/v1/analyze` endpoint with `?host=…` —
this returns the latest scan result if one was run in the last day,
or null if not. We don't kick off a fresh scan (would block 30-90s).
"""

from urllib.parse import urlparse
import asyncio
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .headers import headers_grade, HeadersReq

router = APIRouter()

OBSERVATORY = "https://http-observatory.security.mozilla.org/api/v1/analyze"
TIMEOUT = 12.0


class WebScoreReq(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)


class WebScoreRes(BaseModel):
    url: str
    composite_grade: str
    composite_score: int
    headers: dict | None = None
    observatory: dict | None = None
    error: str | None = None


async def _observatory(host: str) -> dict:
    """Fetch the cached Mozilla Observatory grade for a host."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.post(OBSERVATORY, params={"host": host, "rescan": "false"})
    except Exception as e:
        return {"responding": False, "error": f"{type(e).__name__}: {e}"}
    if r.status_code != 200:
        return {"responding": False, "error": f"HTTP {r.status_code}"}
    d = r.json()
    if d.get("error"):
        return {"responding": False, "error": d["error"]}
    return {
        "responding": True,
        "grade": d.get("grade"),
        "score": d.get("score"),
        "tests_passed": d.get("tests_passed"),
        "tests_failed": d.get("tests_failed"),
        "scan_id": d.get("scan_id"),
        "state": d.get("state"),
        "report_url": f"https://observatory.mozilla.org/analyze/{host}",
    }


def _grade_from_score(score: int) -> str:
    return ("A+" if score >= 90 else "A"  if score >= 80 else "B"  if score >= 65 else
            "C"  if score >= 50 else "D"  if score >= 30 else "F")


@router.post("/web-score", response_model=WebScoreRes)
async def web_score(req: WebScoreReq):
    url = req.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "url must start with http:// or https://")
    host = urlparse(url).netloc

    # Run our headers check + fetch Observatory in parallel
    h_task = headers_grade(HeadersReq(url=url))
    obs_task = _observatory(host)
    h_res, obs_res = await asyncio.gather(h_task, obs_task)

    h_data = {
        "url": h_res.url,
        "grade": h_res.grade,
        "score": h_res.score,
        "checks": [c.model_dump() for c in h_res.checks],
        "status": h_res.status,
        "error": h_res.error,
    }

    # Composite: average our score and Observatory's if both available.
    # If only ours, use ours. If both fail, return -1 / F.
    if obs_res.get("responding") and isinstance(obs_res.get("score"), (int, float)):
        composite_score = round((h_res.score + max(0, obs_res["score"])) / 2)
    else:
        composite_score = h_res.score

    return WebScoreRes(
        url=url,
        composite_grade=_grade_from_score(composite_score),
        composite_score=composite_score,
        headers=h_data,
        observatory=obs_res,
    )
