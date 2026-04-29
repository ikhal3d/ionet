"""WHOIS / RDAP endpoint — Phase 2 implementation lands in step D."""

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/whois")
async def whois_lookup():
    raise HTTPException(501, "whois endpoint not yet implemented (Phase 2 step D)")
