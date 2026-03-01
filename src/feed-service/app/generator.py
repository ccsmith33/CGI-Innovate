"""Event generation logic: cycle-based simulation with production, drain, and random events."""

from __future__ import annotations

import asyncio
import random
import uuid
from datetime import datetime, timezone

from app import state

BASE_DRAIN = 2.0
CYCLE_INTERVAL = 30.0  # 30 seconds real time = 1 simulation cycle
RANDOM_EVENTS_MIN = 1
RANDOM_EVENTS_MAX = 2
CONSUMPTION_PROB = 0.7
CONSUMPTION_DELTA_MIN = 1.0
CONSUMPTION_DELTA_MAX = 4.0
RESUPPLY_DELTA_MIN = 3.0
RESUPPLY_DELTA_MAX = 8.0

CONSUMPTION_LABELS = [
    "Combat patrol",
    "Medical emergency",
    "Equipment failure",
    "Field operation",
    "Sector incident",
]

RESUPPLY_LABELS = [
    "Supply convoy",
    "Air drop",
    "Emergency resupply",
    "Field delivery",
    "Cache replenishment",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_event(
    sector_id: str,
    resource_type: str,
    delta: float,
    event_type: str,
    label: str,
    stock_after: float,
) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "timestamp": _now_iso(),
        "sector_id": sector_id,
        "resource_type": resource_type,
        "delta": round(delta, 2),
        "event_type": event_type,
        "label": label,
        "stock_after": round(stock_after, 2),
    }


def run_cycle() -> list[dict]:
    """Execute one simulation cycle synchronously. Returns list of events generated."""
    events: list[dict] = []
    sectors = list(state.INITIAL_STOCKS.keys())
    production_rates = state.get_production_rates()
    stocks = state.get_stocks()

    # 1. Production: add production units to each sector
    for sector_id, resource_type in sectors:
        rate = production_rates.get((sector_id, resource_type), 0.0)
        current = stocks.get((sector_id, resource_type), 0.0)
        target = state.TARGET_STOCKS.get((sector_id, resource_type), 0.0)
        # Cap production if stock is already 200% of target
        if current >= target * 2.0:
            rate = 0.0
        if rate > 0:
            new_stock = state.apply_delta(sector_id, resource_type, rate)
            event = _make_event(
                sector_id, resource_type, rate, "production",
                "Scheduled production", new_stock,
            )
            events.append(event)
            state.append_event(event)

    # 2. Base drain: -2 units per sector per cycle
    for sector_id, resource_type in sectors:
        new_stock = state.apply_delta(sector_id, resource_type, -BASE_DRAIN)
        event = _make_event(
            sector_id, resource_type, -BASE_DRAIN, "consumption",
            "Base consumption", new_stock,
        )
        events.append(event)
        state.append_event(event)

    # 3. Random events: 3-4 random sectors
    num_random = random.randint(RANDOM_EVENTS_MIN, RANDOM_EVENTS_MAX)
    chosen = random.sample(sectors, min(num_random, len(sectors)))

    for sector_id, resource_type in chosen:
        is_consumption = random.random() < CONSUMPTION_PROB
        if is_consumption:
            delta = -random.uniform(CONSUMPTION_DELTA_MIN, CONSUMPTION_DELTA_MAX)
            label = random.choice(CONSUMPTION_LABELS)
            event_type = "random_event"
        else:
            delta = random.uniform(RESUPPLY_DELTA_MIN, RESUPPLY_DELTA_MAX)
            label = random.choice(RESUPPLY_LABELS)
            event_type = "random_event"

        new_stock = state.apply_delta(sector_id, resource_type, delta)
        event = _make_event(
            sector_id, resource_type, delta, event_type, label, new_stock,
        )
        events.append(event)
        state.append_event(event)

    return events


async def cycle_loop() -> None:
    """Main async loop: runs one cycle every CYCLE_INTERVAL seconds."""
    while True:
        await asyncio.sleep(CYCLE_INTERVAL)
        run_cycle()
