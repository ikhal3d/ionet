"""TCP port reachability check.

Deliberately narrow: a single host + a single port from a small allowlist.
Not a port scanner. Rejects RFC1918, loopback, link-local, and multicast.
"""

import asyncio
import ipaddress
import socket
import time
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..turnstile import verify as verify_turnstile

router = APIRouter()

# Common service ports — keep the surface small.
ALLOWED_PORTS = {
    22, 25, 53, 80, 443, 465, 587, 853, 993, 995,
    3306, 5432, 6379, 8080, 8443, 9200,
}
TIMEOUT_SECONDS = 5.0


class PortReq(BaseModel):
    host: str = Field(..., min_length=1, max_length=253)
    port: int = Field(..., ge=1, le=65535)
    turnstile_token: str | None = None


class PortRes(BaseModel):
    host: str
    port: int
    open: bool
    ms: float | None = None
    resolved_ip: str | None = None
    error: str | None = None


def _is_private_or_reserved(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return (
        ip.is_private or ip.is_loopback or ip.is_link_local
        or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    )


@router.post("/port", response_model=PortRes)
async def port_check(req: PortReq, request: Request):
    if req.port not in ALLOWED_PORTS:
        raise HTTPException(
            400,
            f"port {req.port} not in allow-list. Supported: {sorted(ALLOWED_PORTS)}",
        )

    if not await verify_turnstile(req.turnstile_token, request.client.host if request.client else None):
        raise HTTPException(403, "turnstile verification failed")

    # Resolve to confirm the target isn't private. We resolve once and
    # connect by IP so DNS rebinding can't slip in a private address
    # between the check and the connect.
    try:
        infos = socket.getaddrinfo(req.host, req.port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        return PortRes(host=req.host, port=req.port, open=False, error=f"DNS: {e}")

    if not infos:
        return PortRes(host=req.host, port=req.port, open=False, error="DNS: no records")

    family, _, _, _, sockaddr = infos[0]
    ip = sockaddr[0]
    if _is_private_or_reserved(ip):
        raise HTTPException(400, f"target resolves to a private / reserved address ({ip})")

    start = time.monotonic()
    try:
        fut = asyncio.open_connection(ip, req.port)
        reader, writer = await asyncio.wait_for(fut, timeout=TIMEOUT_SECONDS)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        ms = (time.monotonic() - start) * 1000
        return PortRes(host=req.host, port=req.port, open=True, ms=round(ms, 2), resolved_ip=ip)
    except asyncio.TimeoutError:
        return PortRes(host=req.host, port=req.port, open=False, resolved_ip=ip, error="timeout")
    except (OSError, ConnectionError) as e:
        return PortRes(host=req.host, port=req.port, open=False, resolved_ip=ip, error=str(e))
