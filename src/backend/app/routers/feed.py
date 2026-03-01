"""Proxy endpoint for the Feed microservice status."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException

from app.config import settings

router = APIRouter()


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
