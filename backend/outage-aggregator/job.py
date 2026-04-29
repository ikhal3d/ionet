"""Australian outage aggregator.

Polls **Cloudflare Radar** for AU + Oceania internet outages every
REFRESH_INTERVAL seconds and writes a unified JSON snapshot. The
FastAPI /api/outages endpoint serves the file directly — no DB.

Why Cloudflare Radar:
  * The major AU telcos (NBN, Telstra, Optus, TPG) used to publish
    machine-readable RSS / JSON status feeds. As of mid-2026 every
    one of those URLs returns 404 or 403 (or has been replaced by
    JS-rendered status pages with no public API).
  * Cloudflare Radar exposes a public outages API
    (api.cloudflare.com/.../radar/annotations/outages) that
    aggregates BGP-detected outages globally with location +
    duration + ASN data, refreshed continuously.
  * AU specifically tends to have very few entries — Australian
    internet is stable. We surface that fact ("0 outages in last
    90 days") rather than show false negatives.

Each telco's "no machine-readable feed" status is recorded explicitly
so the frontend can show what we tried and why.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any

import httpx

REFRESH = int(os.environ.get("REFRESH_INTERVAL", "300"))
OUT = os.environ.get("OUTPUT_PATH", "/var/data/outages.json")
TIMEOUT = 15.0
USER_AGENT = "ionet-outage-aggregator/0.2 (+https://ionet.com.au)"

# Radar endpoints — Cloudflare-side aggregated outage data.
RADAR_OUTAGES = "https://api.cloudflare.com/client/v4/radar/annotations/outages"
CF_TOKEN = os.environ.get("CF_RADAR_TOKEN") or os.environ.get("CF_API_TOKEN", "")


@dataclass
class FeedResult:
    source: str
    implemented: bool
    responding: bool = False
    fetched_at: str | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None


def _radar_headers() -> dict:
    return {
        "Authorization": f"Bearer {CF_TOKEN}",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }


async def pull_radar(client: httpx.AsyncClient, source_name: str, params: dict) -> FeedResult:
    res = FeedResult(source=source_name, implemented=True)
    res.fetched_at = datetime.now(timezone.utc).isoformat()
    if not CF_TOKEN:
        res.error = "CF_RADAR_TOKEN not set in backend/.env"
        return res
    try:
        r = await client.get(RADAR_OUTAGES, params=params, headers=_radar_headers(), timeout=TIMEOUT)
    except Exception as e:
        res.error = f"upstream fetch failed: {type(e).__name__}: {e}"
        return res
    if r.status_code != 200:
        res.error = f"HTTP {r.status_code}"
        return res
    try:
        data = r.json()
    except Exception as e:
        res.error = f"invalid JSON: {e}"
        return res
    if not data.get("success"):
        res.error = "Cloudflare API returned success=false"
        return res
    annotations = data.get("result", {}).get("annotations", []) or []
    for a in annotations:
        loc = (a.get("locationsDetails") or [{}])[0]
        asn = (a.get("asnsDetails") or [{}])[0]
        res.events.append({
            "source": source_name,
            "location": loc.get("name") or "",
            "asn": asn.get("name") or "",
            "asn_id": asn.get("asn") or "",
            "title": a.get("description") or a.get("eventType") or "Outage",
            "started": a.get("startDate") or "",
            "ended":   a.get("endDate") or "",
            "outage_type": a.get("outageType") or "",
            "scope":  a.get("scope") or "",
            "link":   a.get("linkedUrl") or "",
        })
    res.responding = True
    return res


def _stub_no_feed(source: str, note: str) -> FeedResult:
    return FeedResult(
        source=source,
        implemented=False,
        responding=False,
        fetched_at=datetime.now(timezone.utc).isoformat(),
        events=[],
        error=note,
    )


async def collect() -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        # AU outages — last 90 days, capped at 100 entries
        au = await pull_radar(client, "cloudflare-radar-au", {"location": "AU", "dateRange": "90d", "limit": 100})
        # Bonus context: global outages last 7 days (small list, lots of signal)
        glb = await pull_radar(client, "cloudflare-radar-global", {"dateRange": "7d", "limit": 25})

    feeds: dict[str, Any] = {
        "cloudflare-radar-au":     asdict(au),
        "cloudflare-radar-global": asdict(glb),
        # AU telco feeds — every URL we previously knew has gone 404 / 403.
        # Recorded here so the UI can show what we tried + why.
        "nbn":     asdict(_stub_no_feed("nbn",     "no machine-readable feed available — NBN moved status to a JS-rendered page")),
        "telstra": asdict(_stub_no_feed("telstra", "no machine-readable feed available — old RSS endpoint returns 404 since 2025")),
        "optus":   asdict(_stub_no_feed("optus",   "no machine-readable feed available — old status RSS endpoint returns 404")),
        "tpg":     asdict(_stub_no_feed("tpg",     "no machine-readable feed available — TPG status page is JS-rendered with no public API")),
    }

    total_events = sum(len(f["events"]) for f in feeds.values())
    feeds_responding = sum(1 for f in feeds.values() if f["responding"])
    feeds_implemented = sum(1 for f in feeds.values() if f["implemented"])

    return {
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        "feeds": feeds,
        "totals": {
            "active_incidents": total_events,
            "feeds_responding": feeds_responding,
            "feeds_implemented": feeds_implemented,
        },
    }


async def main() -> None:
    while True:
        try:
            payload = await collect()
        except Exception as e:
            payload = {
                "refreshed_at": datetime.now(timezone.utc).isoformat(),
                "error": f"aggregator pass failed: {type(e).__name__}: {e}",
            }
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        tmp = OUT + ".tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f, indent=2)
        os.replace(tmp, OUT)
        print(f"[outage-aggregator] wrote snapshot at {payload.get('refreshed_at')}", flush=True)
        await asyncio.sleep(REFRESH)


if __name__ == "__main__":
    asyncio.run(main())
