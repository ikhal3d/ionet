"""DNS query endpoint — Phase 2 implementation lands in step D."""

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/dns")
async def dns_lookup():
    raise HTTPException(501, "dns endpoint not yet implemented (Phase 2 step D)")
