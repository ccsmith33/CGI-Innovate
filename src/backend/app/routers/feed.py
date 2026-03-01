"""Proxy endpoint for the Feed microservice status, plus push ingest endpoint."""

from __future__ import annotations

import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app import app_state
from app.config import settings
from app.database import get_session_factory
from app.models.resource_log import ResourceLog
from app.resource_config import BASE_DRAIN_RATES, CYCLES_PER_HOUR
from app.services.event_bus import broadcast
from app.services.jarvis_forecast import ForecastService

logger = logging.getLogger(__name__)

router = APIRouter()


class PushPayload(BaseModel):
    events: list[dict]


@router.get("/feed/status")
async def feed_status():
    """Proxy the feed service's /feed/status endpoint."""
    url = f"{settings.FEED_SERVICE_URL}/feed/status"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"Feed service unavailable: {exc}"
        )


@router.get("/feed/defcon")
async def get_defcon_status():
    """Proxy to feed service DEFCON status."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.FEED_SERVICE_URL}/feed/defcon")
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"Feed service unavailable: {exc}"
        )


@router.post("/feed/push")
async def feed_push(payload: PushPayload):
    """Receive pushed events from the feed service and ingest into the database."""
    events = payload.events
    if not events:
        return {"ingested": 0}

    affected_pairs: set[tuple[str, str]] = set()

    is_snap = app_state.snap_cycle_active
    if is_snap:
        app_state.snap_cycle_active = False

    async with get_session_factory()() as db:
        for event in events:
            sector_id = event["sector_id"]
            resource_type = event["resource_type"]
            stock_level = event.get("stock_after", 0.0)

            drain_per_cycle = BASE_DRAIN_RATES.get(resource_type, 1.0)
            usage_rate_hourly = round(drain_per_cycle * CYCLES_PER_HOUR, 2)

            row = ResourceLog(
                sector_id=sector_id,
                resource_type=resource_type,
                stock_level=stock_level,
                usage_rate_hourly=usage_rate_hourly,
                snap_event_detected=is_snap,
                timestamp=datetime.fromisoformat(event["timestamp"]),
            )
            db.add(row)
            affected_pairs.add((sector_id, resource_type))

        await db.commit()

        # Recompute forecasts for affected sector+resource pairs
        try:
            forecast_service = ForecastService(db)
            for sector_id, resource_type in affected_pairs:
                await forecast_service.compute_forecast(sector_id, resource_type)
        except Exception as exc:
            logger.warning("Forecast recompute after push ingest failed: %s", exc)

    # Broadcast resource_update to SSE clients
    # Build sector_stocks from the last stock_after per sector+resource in the batch
    sector_stocks: dict[str, float] = {}
    for event in events:
        key = f"{event['sector_id']}|{event['resource_type']}"
        sector_stocks[key] = event.get("stock_after", 0.0)
    await broadcast("resource_update", {
        "events": events,
        "sector_stocks": sector_stocks,
    })

    # Broadcast DEFCON update
    try:
        async with httpx.AsyncClient(timeout=5.0) as http_client:
            resp = await http_client.get(f"{settings.FEED_SERVICE_URL}/feed/defcon")
            resp.raise_for_status()
            defcon_data = resp.json()
            await broadcast("defcon_update", {
                "level": defcon_data["level"],
                "label": defcon_data["label"],
                "color": defcon_data["color"],
            })
    except Exception as exc:
        logger.warning("DEFCON broadcast failed: %s", exc)

    return {"ingested": len(events)}
