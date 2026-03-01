"""Governor API endpoints for ML control loop status, decisions, and overrides."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import app_state
from app.config import settings
from app.database import get_db, get_session_factory
from app.models.control_action import ControlAction
from app.services.event_bus import broadcast
from app.services.governor import governor_instance

logger = logging.getLogger(__name__)

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


async def _snap_followup_cycles(db_factory) -> None:
    """Run 3 extra governor cycles at 10/20/30s after a snap for rapid response."""
    for i in range(3):
        await asyncio.sleep(10)
        try:
            async with db_factory() as session:
                action = await governor_instance.run_cycle(session)
                if action:
                    await broadcast("governor_decision", {
                        "rationale": action.rationale,
                        "budget": action.total_budget_used,
                    })
        except Exception as exc:
            logger.warning("Snap follow-up cycle %d failed: %s", i + 1, exc)


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

    await broadcast("snap_alert", {
        "message": "Thanos-level event detected",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    app_state.snap_cycle_active = True

    # Trigger a governor cycle to recompute allocations
    try:
        action = await governor_instance.run_cycle(db)
    except Exception:
        action = None

    # Schedule 3 rapid follow-up governor cycles at 10s intervals
    asyncio.create_task(_snap_followup_cycles(get_session_factory()))

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
    # Cap at 30 units/cycle (≈ 3-4x baseline) to prevent runaway spikes
    units = max(0.0, min(req.units_per_cycle, 30.0))
    governor_instance.set_override(req.sector_id, req.resource_type, units)

    # Propagate override to feed service so the simulator uses the new rate
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{settings.FEED_SERVICE_URL}/control/production",
                json={
                    "sector_id": req.sector_id,
                    "resource_type": req.resource_type,
                    "units_per_cycle": units,
                },
            )
    except Exception as exc:
        logger.warning("Failed to propagate override to feed service: %s", exc)

    return {
        "status": "override_set",
        "sector_id": req.sector_id,
        "resource_type": req.resource_type,
        "units_per_cycle": units,
    }


# ── Scripted Crisis Scenarios ──

CYCLE_INTERVAL = 10.0  # seconds per simulation cycle

SCENARIOS: dict[str, dict[str, Any]] = {
    "thanos_incursion": {
        "name": "Thanos Incursion",
        "description": "Multi-sector cascade: Vibranium disruption triggers global shortage",
        "steps": [
            {"delay_cycles": 0, "sector": "New Asgard", "resource": "Vibranium (kg)", "delta": -200, "label": "Vibranium mines compromised"},
            {"delay_cycles": 1, "sector": "Wakanda", "resource": "Arc Reactor Cores", "delta": -150, "label": "Arc Reactor production degraded"},
            {"delay_cycles": 2, "sector": "Avengers Compound", "resource": "Medical Kits", "delta": -100, "label": "Medical supply chain disrupted"},
            {"delay_cycles": 2, "sector": "Sokovia", "resource": "Pym Particles", "delta": -80, "label": "Quantum lab under attack"},
            {"delay_cycles": 3, "sector": "Sanctum Sanctorum", "resource": "Clean Water (L)", "delta": -200, "label": "Infrastructure failure"},
            {"delay_cycles": 5, "action": "snap"},
        ],
    },
    "hydra_sabotage": {
        "name": "HYDRA Sabotage",
        "description": "Targeted strike on Wakanda Arc Reactor infrastructure",
        "steps": [
            {"delay_cycles": 0, "sector": "Wakanda", "resource": "Arc Reactor Cores", "delta": -300, "label": "HYDRA strike on Wakanda"},
            {"delay_cycles": 1, "sector": "Avengers Compound", "resource": "Medical Kits", "delta": -120, "label": "Cascade: Medical supply disrupted"},
            {"delay_cycles": 2, "sector": "Sokovia", "resource": "Pym Particles", "delta": -100, "label": "Cascade: Quantum lab offline"},
        ],
    },
    "pandemic_surge": {
        "name": "Pandemic Surge",
        "description": "Global health crisis spikes demand for Medical Kits and Clean Water",
        "steps": [
            {"delay_cycles": 0, "sector": "Avengers Compound", "resource": "Medical Kits", "delta": -250, "label": "Emergency medical demand surge"},
            {"delay_cycles": 0, "sector": "Sanctum Sanctorum", "resource": "Clean Water (L)", "delta": -200, "label": "Water infrastructure overloaded"},
            {"delay_cycles": 2, "sector": "Avengers Compound", "resource": "Medical Kits", "delta": -150, "label": "Continued surge, second wave"},
        ],
    },
}


async def _apply_scenario_step(step: dict[str, Any]) -> None:
    """Apply a single scenario step via the feed service."""
    if step.get("action") == "snap":
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(f"{settings.FEED_SERVICE_URL}/control/snap")
            await broadcast("snap_alert", {
                "message": "Scenario-triggered snap event",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            app_state.snap_cycle_active = True
        except Exception as exc:
            logger.warning("Scenario snap step failed: %s", exc)
        return

    sector = step["sector"]
    resource = step["resource"]
    delta = step["delta"]
    label = step.get("label", "Scenario event")

    # Apply delta via feed service state by posting a negative production override
    # We use a direct stock adjustment via the feed service
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Use the feed service's status to get current stock, then apply delta
            resp = await client.get(f"{settings.FEED_SERVICE_URL}/feed/status")
            resp.raise_for_status()
            status_data = resp.json()
            current_stock = None
            for s in status_data.get("sectors", []):
                if s["sector_id"] == sector and s["resource_type"] == resource:
                    current_stock = s["stock_level"]
                    break
            if current_stock is not None:
                new_stock = max(10.0, current_stock + delta)
                # Push a scenario event to the backend for ingestion
                event = {
                    "id": __import__("uuid").uuid4().hex,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "sector_id": sector,
                    "resource_type": resource,
                    "delta": delta,
                    "event_type": "scenario_event",
                    "label": label,
                    "stock_after": round(new_stock, 2),
                }
                await client.post(
                    f"{settings.FEED_SERVICE_URL.replace(':8001', ':8000')}/api/v1/feed/push",
                    json={"events": [event]},
                    timeout=10.0,
                )
    except Exception as exc:
        logger.warning("Scenario step failed (%s/%s): %s", sector, resource, exc)


async def _execute_scenario(scenario: dict[str, Any]) -> None:
    """Execute all steps of a scenario with appropriate delays."""
    steps = scenario["steps"]
    steps_by_cycle: dict[int, list[dict[str, Any]]] = {}
    for step in steps:
        cycle = step.get("delay_cycles", 0)
        steps_by_cycle.setdefault(cycle, []).append(step)

    for cycle in sorted(steps_by_cycle.keys()):
        if cycle > 0:
            await asyncio.sleep(cycle * CYCLE_INTERVAL)
        for step in steps_by_cycle[cycle]:
            await _apply_scenario_step(step)
            await broadcast("scenario_step", {
                "label": step.get("label", step.get("action", "unknown")),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })


@router.get("/governor/scenarios")
async def list_scenarios():
    """List available crisis scenarios."""
    return [
        {"id": k, "name": v["name"], "description": v["description"]}
        for k, v in SCENARIOS.items()
    ]


@router.post("/governor/scenario/{scenario_id}")
async def trigger_scenario(scenario_id: str):
    """Trigger a scripted crisis scenario."""
    scenario = SCENARIOS.get(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id}")
    asyncio.create_task(_execute_scenario(scenario))
    await broadcast("scenario_started", {
        "name": scenario["name"],
        "description": scenario["description"],
    })
    return {
        "message": f"Scenario '{scenario['name']}' initiated",
        "steps": len(scenario["steps"]),
    }
