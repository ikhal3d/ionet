"""TLS certificate inspector — Phase 2 implementation lands in step D."""

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/tls")
async def tls_inspect():
    raise HTTPException(501, "tls endpoint not yet implemented (Phase 2 step D)")
