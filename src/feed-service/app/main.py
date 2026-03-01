"""Feed microservice: simulates live field operations with production, consumption, and random events."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Query
from pydantic import BaseModel

from app import state
from app.generator import cycle_loop

_start_time: datetime | None = None


class ProductionUpdate(BaseModel):
    sector_id: str
    resource_type: str
    units_per_cycle: float


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _start_time
    state.reset()
    _start_time = datetime.now(timezone.utc)
    asyncio.create_task(cycle_loop())
    yield


app = FastAPI(title="Field Operations Feed", version="2.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/feed/status")
async def feed_status():
    stocks = state.get_stocks()
    production_rates = state.get_production_rates()
    uptime = (datetime.now(timezone.utc) - _start_time).total_seconds() if _start_time else 0
    return {
        "sectors": [
            {
                "sector_id": sector_id,
                "resource_type": resource_type,
                "stock_level": round(level, 2),
                "production_rate": production_rates.get((sector_id, resource_type), 0.0),
                "target_stock": state.TARGET_STOCKS.get((sector_id, resource_type), 0.0),
                "cost_per_unit": state.COST_PER_UNIT.get((sector_id, resource_type), 0.0),
            }
            for (sector_id, resource_type), level in stocks.items()
        ],
        "uptime_seconds": round(uptime, 1),
    }


@app.get("/feed/events")
async def feed_events(
    since: str | None = Query(None, description="ISO timestamp filter"),
    limit: int = Query(100, ge=1, le=500),
):
    events = state.get_events_since(since, limit)
    return {"events": events, "count": len(events)}


@app.post("/control/production")
async def update_production(body: ProductionUpdate):
    key = (body.sector_id, body.resource_type)
    if key not in state.INITIAL_STOCKS:
        return {"error": f"Unknown sector/resource: {body.sector_id}/{body.resource_type}"}, 400
    state.set_production_rate(body.sector_id, body.resource_type, body.units_per_cycle)
    return {
        "sector_id": body.sector_id,
        "resource_type": body.resource_type,
        "units_per_cycle": body.units_per_cycle,
        "status": "updated",
    }


@app.post("/control/snap")
async def snap():
    stocks = state.get_stocks()
    results = []
    for (sector_id, resource_type), level in stocks.items():
        new_level = state.set_stock(sector_id, resource_type, level / 2.0)
        event = {
            "id": __import__("uuid").uuid4().hex,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sector_id": sector_id,
            "resource_type": resource_type,
            "delta": round(-level / 2.0, 2),
            "event_type": "snap_event",
            "label": "Snap: stocks halved",
            "stock_after": round(new_level, 2),
        }
        state.append_event(event)
        results.append({
            "sector_id": sector_id,
            "resource_type": resource_type,
            "stock_before": round(level, 2),
            "stock_after": round(new_level, 2),
        })
    return {"snap": "executed", "sectors": results}
