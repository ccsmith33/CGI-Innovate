"""Polls the Feed microservice and ingests events into ResourceLog."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.resource_log import ResourceLog
from app.services.jarvis_forecast import ForecastService

logger = logging.getLogger(__name__)


class FeedIngester:
    def __init__(self) -> None:
        self._last_polled: str = datetime.now(timezone.utc).isoformat()

    async def poll_and_ingest(self, db: AsyncSession) -> int:
        """Poll feed service for new events and insert ResourceLog rows.

        Returns the number of events ingested.
        """
        events_url = (
            f"{settings.FEED_SERVICE_URL}/feed/events"
            f"?since={self._last_polled}&limit=100"
        )
        status_url = f"{settings.FEED_SERVICE_URL}/feed/status"

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                events_resp = await client.get(events_url)
                events_resp.raise_for_status()
                events_data = events_resp.json()

                status_resp = await client.get(status_url)
                status_resp.raise_for_status()
                status_data = status_resp.json()
        except (httpx.HTTPError, Exception) as exc:
            logger.warning("Feed poll failed: %s", exc)
            return 0

        # Build a lookup of current stock levels from status
        stock_lookup: dict[tuple[str, str], float] = {}
        for sector in status_data.get("sectors", []):
            key = (sector["sector_id"], sector["resource_type"])
            stock_lookup[key] = sector["stock_level"]

        events = events_data.get("events", [])
        if not events:
            return 0

        affected_pairs: set[tuple[str, str]] = set()

        for event in events:
            sector_id = event["sector_id"]
            resource_type = event["resource_type"]
            stock_level = event.get(
                "stock_after",
                stock_lookup.get((sector_id, resource_type), 0.0),
            )

            row = ResourceLog(
                sector_id=sector_id,
                resource_type=resource_type,
                stock_level=stock_level,
                usage_rate_hourly=7.0,
                snap_event_detected=False,
                timestamp=datetime.fromisoformat(event["timestamp"]),
            )
            db.add(row)
            affected_pairs.add((sector_id, resource_type))

        await db.commit()

        # Update last polled to the newest event timestamp
        newest = max(e["timestamp"] for e in events)
        self._last_polled = newest

        # Recompute forecasts for affected sector+resource pairs
        try:
            forecast_service = ForecastService(db)
            for sector_id, resource_type in affected_pairs:
                await forecast_service.compute_forecast(sector_id, resource_type)
        except Exception as exc:
            logger.warning("Forecast recompute after feed ingest failed: %s", exc)

        return len(events)
