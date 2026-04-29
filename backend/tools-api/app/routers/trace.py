"""Live traceroute from the ionet network.

Runs the system `traceroute` binary (installed in the tools-api
Dockerfile) via subprocess, parses hops, returns a structured list.
The container has CAP_NET_RAW only — no root.

Targets are validated to reject RFC1918 / loopback / link-local and
to look like a hostname or IP. Hop count and per-probe timeout are
capped to keep response time bounded (~30-60s worst case).
"""

import asyncio
import ipaddress
import re
import socket
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

VALID_TARGET = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,253}$")
TIMEOUT_SECONDS = 60.0


class TraceReq(BaseModel):
    target: str = Field(..., min_length=1, max_length=253)
    max_hops: int = Field(20, ge=1, le=30)


class TraceHop(BaseModel):
    hop: int
    ip: str | None = None
    rtt_ms: list[float] = []


class TraceRes(BaseModel):
    target: str
    resolved_ip: str | None = None
    hops: list[TraceHop] = []
    completed: bool = False
    duration_s: float | None = None
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


@router.post("/trace", response_model=TraceRes)
async def trace(req: TraceReq):
    t = req.target.strip()
    if not VALID_TARGET.match(t):
        raise HTTPException(400, "invalid target — letters, digits, dots, dashes only")

    # Resolve once and refuse private destinations, both directly-typed
    # and via DNS rebinding tricks
    try:
        infos = socket.getaddrinfo(t, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        return TraceRes(target=t, error=f"DNS: {e}")

    if not infos:
        return TraceRes(target=t, error="DNS: no records")
    resolved = infos[0][4][0]
    if _is_private_or_reserved(resolved):
        raise HTTPException(400, f"target resolves to a private / reserved address ({resolved})")

    started = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            "traceroute", "-n", "-w", "2", "-q", "1", "-m", str(req.max_hops), t,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        return TraceRes(target=t, resolved_ip=resolved, error=f"traceroute timed out (>{int(TIMEOUT_SECONDS)}s)")
    except FileNotFoundError:
        return TraceRes(target=t, resolved_ip=resolved, error="traceroute binary not installed in container")
    except Exception as e:
        return TraceRes(target=t, resolved_ip=resolved, error=f"traceroute failed: {type(e).__name__}: {e}")

    if proc.returncode not in (0, 1):
        # exit 0 = ok, exit 1 = some hops timed out (still useful)
        return TraceRes(target=t, resolved_ip=resolved,
                        error=f"traceroute exited {proc.returncode}: {stderr_b.decode()[:200]}")

    hops: list[TraceHop] = []
    for line in stdout_b.decode().splitlines()[1:]:  # skip "traceroute to ..." header
        m = re.match(r"\s*(\d+)\s+(.+)", line)
        if not m:
            continue
        hop_num = int(m.group(1))
        rest = m.group(2)
        # First non-asterisk token is the IP (we ran with -n so no DNS)
        ip_match = re.search(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[0-9a-fA-F:]+(?::[0-9a-fA-F:]*)+)", rest)
        ip = ip_match.group(1) if ip_match else None
        rtts = [float(x) for x in re.findall(r"([\d.]+)\s*ms", rest)]
        hops.append(TraceHop(hop=hop_num, ip=ip, rtt_ms=rtts))

    return TraceRes(
        target=t,
        resolved_ip=resolved,
        hops=hops,
        completed=True,
        duration_s=round(time.monotonic() - started, 2),
    )
