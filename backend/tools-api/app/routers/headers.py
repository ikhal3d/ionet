"""HTTP security-headers grader.

Fetches a URL and grades the response headers against the same checklist
that Mozilla Observatory and securityheaders.com use. Read-only, no
follow-redirects to a different host (so we score the URL the user gave
us, not whatever it bounced to).
"""

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()
TIMEOUT = 8.0


class HeadersReq(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)


class HeaderCheck(BaseModel):
    name: str
    present: bool
    value: str | None = None
    score: int       # negative = penalty; positive = bonus
    note: str


class HeadersRes(BaseModel):
    url: str
    final_url: str
    status: int
    grade: str
    score: int
    checks: list[HeaderCheck] = []
    error: str | None = None


# Each rule: (header_name, points_if_present, points_if_missing, validator)
# Validator returns (ok: bool, note: str). If ok==True we award present-points;
# otherwise we still record the header but apply missing-points.
def _check_hsts(v: str) -> tuple[bool, str]:
    if "max-age=" not in v: return False, "missing max-age"
    try:
        ma = int(v.split("max-age=")[1].split(";")[0].split(",")[0].strip())
    except ValueError:
        return False, "max-age not a number"
    if ma < 15552000: return False, f"max-age={ma} below 6 months recommended"
    return True, f"max-age={ma}" + (" + includeSubDomains" if "includesubdomains" in v.lower() else "")


def _check_csp(v: str) -> tuple[bool, str]:
    bad = []
    if "unsafe-inline" in v: bad.append("'unsafe-inline'")
    if "unsafe-eval"   in v: bad.append("'unsafe-eval'")
    if not bad: return True, "no unsafe-* directives"
    return False, "contains " + ", ".join(bad)


def _check_xfo(v: str) -> tuple[bool, str]:
    if v.upper() in ("DENY", "SAMEORIGIN"): return True, v.upper()
    return False, f"unexpected value '{v}'"


def _check_xcto(v: str) -> tuple[bool, str]:
    return (v.lower() == "nosniff", "must be 'nosniff'")


def _check_referrer(v: str) -> tuple[bool, str]:
    safe = {"no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"}
    return (v.lower() in safe, "")


CHECKS = [
    ("Strict-Transport-Security", 25, -25, _check_hsts),
    ("Content-Security-Policy",   25, -25, _check_csp),
    ("X-Frame-Options",           10, -10, _check_xfo),
    ("X-Content-Type-Options",    10, -10, _check_xcto),
    ("Referrer-Policy",           10, -10, _check_referrer),
    ("Permissions-Policy",         5,  -5, lambda v: (True, "present")),
]


def _grade(score: int) -> str:
    return ("A+" if score >= 90 else "A"  if score >= 80 else "B"  if score >= 65 else
            "C"  if score >= 50 else "D"  if score >= 30 else "F")


@router.post("/headers", response_model=HeadersRes)
async def headers_grade(req: HeadersReq):
    url = req.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "url must start with http:// or https://")

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as client:
            r = await client.get(url, headers={"User-Agent": "ionet-headers-grader/0.1"})
    except Exception as e:
        return HeadersRes(url=url, final_url=url, status=0, grade="F", score=0, error=str(e))

    score = 0
    checks: list[HeaderCheck] = []
    for name, plus, minus, validator in CHECKS:
        v = r.headers.get(name)
        if v is None:
            checks.append(HeaderCheck(name=name, present=False, score=minus, note="header missing"))
            score += minus
        else:
            ok, note = validator(v)
            checks.append(HeaderCheck(
                name=name, present=True, value=v[:200],
                score=plus if ok else minus, note=note or ("ok" if ok else "fails policy"),
            ))
            score += plus if ok else minus

    score = max(0, min(100, 50 + score))   # clamp to [0,100], anchor mid-scale at 50

    return HeadersRes(
        url=url,
        final_url=str(r.url),
        status=r.status_code,
        grade=_grade(score),
        score=score,
        checks=checks,
    )
