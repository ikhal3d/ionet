"""Australian outage aggregator.

Polls public status endpoints and writes a unified JSON snapshot every
REFRESH_INTERVAL seconds. The FastAPI /api/outages endpoint serves the
file directly — no DB, no migrations, no fuss.

Sources (all public, no auth required):
  • NBN Co network events  — JSON
  • Telstra service status   — RSS feed
  • Optus service status     — RSS feed
  • TPG / iiNet status       — HTML scrape (best-effort heuristic)
  • Aussie Outages community — RSS feed (DownDetector-style)

Each source can fail independently; the snapshot records which feeds
responded and which didn't. Endpoint URLs may shift over time — they
live in CONFIG below so they're easy to update.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any

import httpx
import feedparser

REFRESH = int(os.environ.get("REFRESH_INTERVAL", "300"))
OUT = os.environ.get("OUTPUT_PATH", "/var/data/outages.json")
TIMEOUT = 15.0
USER_AGENT = "ionet-outage-aggregator/0.1 (+https://ionet.com.au)"


@dataclass
class FeedResult:
    source: str
    implemented: bool
    responding: bool = False
    fetched_at: str | None = None
    events: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None


CONFIG = {
    "nbn":     "https://www.nbnco.com.au/api/network-events?limit=20",
    "telstra": "https://www.telstra.com.au/personal/feeds/networkstatusrss.xml",
    "optus":   "https://www.optus.com.au/about/network/service-status/rss",
    "tpg":     "https://www.tpg.com.au/about/network",
    "aussie":  "https://aussieoutages.com/rss",
}


async def _fetch(client: httpx.AsyncClient, url: str) -> tuple[int, bytes | None, str | None]:
    try:
        r = await client.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
        return r.status_code, r.content, None
    except Exception as e:
        return 0, None, str(e)


def _normalise_rss(content: bytes, source: str) -> list[dict[str, Any]]:
    parsed = feedparser.parse(content)
    out = []
    for e in parsed.entries[:25]:
        out.append({
            "source": source,
            "title": getattr(e, "title", "")[:240],
            "link":  getattr(e, "link", ""),
            "published": getattr(e, "published", "") or getattr(e, "updated", ""),
            "summary": getattr(e, "summary", "")[:500],
        })
    return out


async def pull_nbn(client) -> FeedResult:
    res = FeedResult(source="nbn", implemented=True)
    code, body, err = await _fetch(client, CONFIG["nbn"])
    res.fetched_at = datetime.now(timezone.utc).isoformat()
    if err:
        res.error = err
        return res
    if code != 200 or not body:
        res.error = f"HTTP {code}"
        return res
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        res.error = f"invalid JSON: {e}"
        return res
    # NBN's response shape varies — keep a defensive walk.
    items = data.get("data") or data.get("events") or data if isinstance(data, list) else []
    for it in items[:25]:
        if not isinstance(it, dict):
            continue
        res.events.append({
            "source": "nbn",
            "title": str(it.get("title") or it.get("eventType") or "NBN event")[:240],
            "link": "https://www.nbnco.com.au/support/network-status",
            "published": str(it.get("startTime") or it.get("publishedDate") or ""),
            "summary": str(it.get("description") or it.get("summary") or "")[:500],
            "raw": {k: v for k, v in it.items() if k in ("severity", "state", "region", "postcode")},
        })
    res.responding = True
    return res


async def pull_rss(client, source: str) -> FeedResult:
    res = FeedResult(source=source, implemented=True)
    code, body, err = await _fetch(client, CONFIG[source])
    res.fetched_at = datetime.now(timezone.utc).isoformat()
    if err:
        res.error = err
        return res
    if code != 200 or not body:
        res.error = f"HTTP {code}"
        return res
    res.events = _normalise_rss(body, source)
    res.responding = True
    return res


async def collect() -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            pull_nbn(client),
            pull_rss(client, "telstra"),
            pull_rss(client, "optus"),
            pull_rss(client, "aussie"),
            return_exceptions=False,
        )

    feeds = {r.source: asdict(r) for r in results}
    feeds["tpg"] = asdict(FeedResult(
        source="tpg",
        implemented=False,
        error="HTML scrape pending — TPG / iiNet have no machine-readable status feed",
    ))

    total_events = sum(len(f["events"]) for f in feeds.values())
    feeds_responding = sum(1 for f in feeds.values() if f["responding"])

    return {
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        "feeds": feeds,
        "totals": {
            "active_incidents": total_events,
            "feeds_responding": feeds_responding,
            "feeds_implemented": sum(1 for f in feeds.values() if f["implemented"]),
        },
    }


async def main() -> None:
    while True:
        try:
            payload = await collect()
        except Exception as e:
            payload = {
                "refreshed_at": datetime.now(timezone.utc).isoformat(),
                "error": f"aggregator pass failed: {e}",
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
