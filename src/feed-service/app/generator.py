"""Event generation logic: cycle-based simulation with production, drain, and random events."""

from __future__ import annotations

import asyncio
import logging
import os
import random
import uuid
from datetime import datetime, timezone

import httpx

from app import state

logger = logging.getLogger(__name__)

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

# Per-resource base drain per cycle. Drain EXCEEDS base production so stocks
# decline without active governor intervention — creates a constant fight to
# maintain supply. Governor can boost to 2x production to recover.
# 1.5x drain rates: visible decline without governor, but 2x boost can recover.
BASE_DRAIN_RATES: dict[str, float] = {
    "Medical Kits": 12.75,       # prod: 8.0  → net -4.75/cycle at baseline; 2x boost: +3.25
    "Clean Water (L)": 15.75,    # prod: 10.0 → net -5.75/cycle at baseline; 2x boost: +4.25
    "Vibranium (kg)": 4.8,       # prod: 3.0  → net -1.8/cycle at baseline; 2x boost: +1.2
    "Pym Particles": 7.8,        # prod: 5.0  → net -2.8/cycle at baseline; 2x boost: +2.2
    "Arc Reactor Cores": 6.3,    # prod: 4.0  → net -2.3/cycle at baseline; 2x boost: +1.7
}
BASE_DRAIN_DEFAULT = 1.5  # fallback for unknown resource types
CYCLE_INTERVAL = 3.0  # 3 seconds real time = 1 simulation cycle
RANDOM_EVENTS_MIN = 2
RANDOM_EVENTS_MAX = 4
CONSUMPTION_PROB = 0.7
CONSUMPTION_DELTA_MIN = 5.0
CONSUMPTION_DELTA_MAX = 20.0
RESUPPLY_DELTA_MIN = 3.0
RESUPPLY_DELTA_MAX = 12.0

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

    # 1. Production: add production units to each sector (with dependency penalties)
    penalties = state.get_production_penalties()
    for sector_id, resource_type in sectors:
        rate = production_rates.get((sector_id, resource_type), 0.0)
        current = stocks.get((sector_id, resource_type), 0.0)
        target = state.TARGET_STOCKS.get((sector_id, resource_type), 0.0)
        # Cap production if stock is already 200% of target
        if current >= target * 2.0:
            rate = 0.0
        penalty = penalties.get((sector_id, resource_type), 0.0)
        effective_rate = rate * (1.0 - penalty)
        if effective_rate > 0:
            new_stock = state.apply_delta(sector_id, resource_type, effective_rate)
            label = "Scheduled production" if penalty == 0 else f"Production degraded ({int(penalty*100)}% penalty)"
            event = _make_event(
                sector_id, resource_type, round(effective_rate, 2), "production",
                label, new_stock,
            )
            events.append(event)
            state.append_event(event)

    # 2. Base drain: per-resource consumption per cycle (scaled by DEFCON)
    defcon = state.get_defcon()
    defcon_drain_multiplier = {5: 1.0, 4: 1.1, 3: 1.25, 2: 1.5, 1: 2.0}[defcon]
    for sector_id, resource_type in sectors:
        drain = BASE_DRAIN_RATES.get(resource_type, BASE_DRAIN_DEFAULT) * defcon_drain_multiplier
        new_stock = state.apply_delta(sector_id, resource_type, -drain)
        event = _make_event(
            sector_id, resource_type, round(-drain, 2), "consumption",
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

    # 4. Update DEFCON level based on current stock health
    state.update_defcon()

    return events


async def push_events(events: list[dict]) -> None:
    """POST events to the backend push endpoint. Failures are logged, not raised."""
    if not events:
        return
    url = f"{BACKEND_URL}/api/v1/feed/push"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={"events": events})
            resp.raise_for_status()
    except Exception as exc:
        logger.warning("Push to backend failed: %s", exc)


async def cycle_loop() -> None:
    """Main async loop: runs one cycle every CYCLE_INTERVAL seconds."""
    while True:
        await asyncio.sleep(CYCLE_INTERVAL)
        events = run_cycle()
        await push_events(events)
