"""Governor API endpoints for ML control loop status, decisions, and overrides."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.control_action import ControlAction
from app.services.governor import governor_instance

router = APIRouter(tags=["governor"])


@router.get("/governor/status")
async def governor_status():
    """Current champion/challenger/backup model info, last decision, budget summary."""
    return governor_instance.get_status()


@router.get("/governor/decisions")
async def governor_decisions(
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Last N control actions with rationale."""
    result = await db.execute(
        select(ControlAction)
        .order_by(ControlAction.timestamp.desc())
        .limit(limit)
    )
    rows = result.scalars().all()
    return [
        {
            "id": row.id,
            "timestamp": row.timestamp.isoformat() if row.timestamp else None,
            "champion_confidence": row.champion_confidence,
            "backup_confidence": row.backup_confidence,
            "total_budget_used": row.total_budget_used,
            "allocations": row.allocations_json,
            "rationale": row.rationale,
            "sectors_adjusted": row.sectors_adjusted,
            "champion_data_points": row.champion_data_points,
        }
        for row in rows
    ]


@router.get("/governor/time-to-zero")
async def time_to_zero(db: AsyncSession = Depends(get_db)):
    """Simple consumption-based depletion estimate per sector."""
    results = await governor_instance.compute_time_to_zero(db)
    return list(results.values())


@router.post("/governor/snap")
async def trigger_snap(db: AsyncSession = Depends(get_db)):
    """Trigger a snap event via the feed service and refresh forecasts."""
    url = f"{settings.FEED_SERVICE_URL}/control/snap"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url)
            resp.raise_for_status()
            snap_result = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Feed service snap failed: {exc}")

    # Trigger a governor cycle to recompute allocations
    try:
        action = await governor_instance.run_cycle(db)
    except Exception:
        action = None

    return {
        "snap_result": snap_result,
        "governor_action_id": action.id if action else None,
    }


class OverrideRequest(BaseModel):
    sector_id: str
    resource_type: str
    units_per_cycle: float


@router.post("/governor/override")
async def governor_override(req: OverrideRequest):
    """Manually override governor allocation for a sector."""
    governor_instance.set_override(req.sector_id, req.resource_type, req.units_per_cycle)
    return {
        "status": "override_set",
        "sector_id": req.sector_id,
        "resource_type": req.resource_type,
        "units_per_cycle": req.units_per_cycle,
    }
