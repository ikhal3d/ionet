"""TCP port reachability check.

Probes one host on **up to 10 user-specified ports** in parallel.
Still narrow enough that this isn't a scanner — nmap scans 65k ports
across thousands of hosts; we cap one host × ten ports per request.

Guards:
  * Resolves the target once and connects by IP — defeats DNS rebinding.
  * Refuses RFC1918 / loopback / link-local / multicast / reserved IPs.
  * Per-probe timeout 5s; total request budget ~6s for 10 parallel probes.
  * Cloudflare Turnstile gate (REQUIRE_TURNSTILE=true) for abuse control.
  * Cloudflare WAF rate limits hit before we ever see the request.
"""

import asyncio
import ipaddress
import socket
import time
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..turnstile import verify as verify_turnstile

router = APIRouter()

MAX_PORTS_PER_REQUEST = 10
TIMEOUT_SECONDS = 5.0


class PortReq(BaseModel):
    host: str = Field(..., min_length=1, max_length=253)
    # Accept either a single port (legacy) or a list (new, preferred)
    port: int | None = Field(None, ge=1, le=65535)
    ports: list[int] | None = Field(None)
    turnstile_token: str | None = None


class PortProbe(BaseModel):
    port: int
    open: bool
    ms: float | None = None
    error: str | None = None


class PortRes(BaseModel):
    host: str
    resolved_ip: str | None = None
    probes: list[PortProbe] = []
    open_count: int = 0
    total_count: int = 0
    summary: str | None = None
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


async def _probe_one(ip: str, port: int) -> PortProbe:
    start = time.monotonic()
    try:
        fut = asyncio.open_connection(ip, port)
        reader, writer = await asyncio.wait_for(fut, timeout=TIMEOUT_SECONDS)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return PortProbe(port=port, open=True, ms=round((time.monotonic() - start) * 1000, 2))
    except asyncio.TimeoutError:
        return PortProbe(port=port, open=False, error="timeout")
    except (OSError, ConnectionError) as e:
        return PortProbe(port=port, open=False, error=str(e))


@router.post("/port", response_model=PortRes)
async def port_check(req: PortReq, request: Request):
    # Reconcile single vs list, dedupe, sort
    ports: list[int] = []
    if req.ports:
        ports.extend(req.ports)
    if req.port is not None:
        ports.append(req.port)
    ports = sorted({p for p in ports if 1 <= p <= 65535})
    if not ports:
        raise HTTPException(400, "provide 'ports' (list, up to 10) or 'port' (single int)")
    if len(ports) > MAX_PORTS_PER_REQUEST:
        raise HTTPException(400, f"max {MAX_PORTS_PER_REQUEST} distinct ports per request — got {len(ports)}")

    if not await verify_turnstile(req.turnstile_token, request.client.host if request.client else None):
        raise HTTPException(403, "turnstile verification failed")

    # Resolve once, refuse private destinations
    try:
        infos = socket.getaddrinfo(req.host, ports[0], type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        return PortRes(host=req.host, error=f"DNS: {e}", total_count=len(ports))
    if not infos:
        return PortRes(host=req.host, error="DNS: no records", total_count=len(ports))

    ip = infos[0][4][0]
    if _is_private_or_reserved(ip):
        raise HTTPException(400, f"target resolves to a private / reserved address ({ip})")

    # Probe all ports in parallel — bounded by TIMEOUT_SECONDS for the whole request
    probes = await asyncio.gather(*(_probe_one(ip, p) for p in ports))
    probes_list = list(probes)
    open_count = sum(1 for p in probes_list if p.open)
    total = len(probes_list)
    summary = (
        f"{open_count} / {total} open" if total > 1
        else ("open" if open_count == 1 else "closed")
    )

    return PortRes(
        host=req.host,
        resolved_ip=ip,
        probes=probes_list,
        open_count=open_count,
        total_count=total,
        summary=summary,
    )
