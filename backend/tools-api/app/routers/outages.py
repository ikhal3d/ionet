"""Australian outage feed — reads aggregated data file written by the
outage-aggregator container. Phase 2 step D."""

import json
import os
from fastapi import APIRouter, HTTPException

router = APIRouter()

DATA_PATH = os.environ.get("OUTAGE_DATA_PATH", "/var/data/outages.json")


@router.get("/outages")
async def outages():
    if not os.path.exists(DATA_PATH):
        raise HTTPException(503, "outage data not yet aggregated — try again shortly")
    try:
        with open(DATA_PATH) as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"outage data corrupt: {e}")
