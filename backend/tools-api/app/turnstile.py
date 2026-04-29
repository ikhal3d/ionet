"""Cloudflare Turnstile verification helper.

If REQUIRE_TURNSTILE=false (default while developing), tokens are
accepted unverified. Once a Turnstile site/secret pair is wired and
the frontend is sending tokens, set REQUIRE_TURNSTILE=true.
"""

import os
import httpx

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
SECRET = os.environ.get("TURNSTILE_SECRET", "")
REQUIRED = os.environ.get("REQUIRE_TURNSTILE", "false").lower() == "true"


async def verify(token: str | None, remote_ip: str | None = None) -> bool:
    if not REQUIRED:
        return True
    if not token or not SECRET:
        return False
    data = {"secret": SECRET, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.post(VERIFY_URL, data=data)
        if r.status_code != 200:
            return False
        body = r.json()
        return bool(body.get("success"))
