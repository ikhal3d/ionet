"""ionet tools API — FastAPI application entrypoint.

Exposes the Phase-2 server-side network & security tools at /api/*.
CORS is enforced by Caddy upstream; the middleware here is a belt-and-
suspenders fallback for local development.
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import health, port, dns, whois, asn, tls, headers, outages
from .routers import bgp, trace, ip_recon, web_score, cve

app = FastAPI(
    title="ionet tools API",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

allowed_origin = os.environ.get("ALLOWED_ORIGIN", "https://ionet.com.au")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[allowed_origin, "http://localhost:8000"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Turnstile-Token"],
    max_age=86400,
)

# /healthz lives at root, all functional endpoints under /api
app.include_router(health.router)
app.include_router(port.router,      prefix="/api", tags=["port"])
app.include_router(dns.router,       prefix="/api", tags=["dns"])
app.include_router(whois.router,     prefix="/api", tags=["whois"])
app.include_router(asn.router,       prefix="/api", tags=["asn"])
app.include_router(tls.router,       prefix="/api", tags=["tls"])
app.include_router(headers.router,   prefix="/api", tags=["headers"])
app.include_router(outages.router,   prefix="/api", tags=["outages"])
# Phase 2.5
app.include_router(bgp.router,       prefix="/api", tags=["bgp"])
app.include_router(trace.router,     prefix="/api", tags=["trace"])
# Phase 3
app.include_router(ip_recon.router,  prefix="/api", tags=["ip-recon"])
app.include_router(web_score.router, prefix="/api", tags=["web-score"])
app.include_router(cve.router,       prefix="/api", tags=["cve"])
