"""Outage aggregator — Phase 2 step D will fill in real feed pulls.

Step C (this file): writes a placeholder JSON every REFRESH_INTERVAL
seconds so the FastAPI /api/outages endpoint always has something to
serve once the stack is up.
"""

import asyncio
import json
import os
from datetime import datetime, timezone

REFRESH = int(os.environ.get("REFRESH_INTERVAL", "300"))
OUT = os.environ.get("OUTPUT_PATH", "/var/data/outages.json")


async def main() -> None:
    while True:
        payload = {
            "refreshed_at": datetime.now(timezone.utc).isoformat(),
            "status": "scaffold — feed pulls land in Phase 2 step D",
            "feeds": {
                "nbn": {"events": [], "source": "https://www.nbnco.com.au/", "implemented": False},
                "telstra": {"events": [], "source": "https://www.telstra.com.au/network-outage-status", "implemented": False},
                "optus": {"events": [], "source": "https://www.optus.com.au/support/network", "implemented": False},
                "tpg": {"events": [], "source": "https://www.tpg.com.au/about/network", "implemented": False},
            },
            "totals": {"active_incidents": 0, "feeds_responding": 0},
        }
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        tmp = OUT + ".tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f, indent=2)
        os.replace(tmp, OUT)
        await asyncio.sleep(REFRESH)


if __name__ == "__main__":
    asyncio.run(main())
