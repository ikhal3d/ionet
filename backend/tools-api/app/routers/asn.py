"""ASN / prefix lookup — Phase 2 implementation lands in step D."""

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/asn")
async def asn_lookup():
    raise HTTPException(501, "asn endpoint not yet implemented (Phase 2 step D)")
