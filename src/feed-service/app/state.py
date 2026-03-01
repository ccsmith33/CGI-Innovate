"""In-memory state for all 5 sector+resource pairs."""

from __future__ import annotations

import threading
from collections import deque
from typing import Any

INITIAL_STOCKS: dict[tuple[str, str], float] = {
    ("Avengers Compound", "Medical Kits"): 600.0,
    ("New Asgard", "Vibranium (kg)"): 300.0,
    ("Sanctum Sanctorum", "Clean Water (L)"): 750.0,
    ("Sokovia", "Pym Particles"): 420.0,
    ("Wakanda", "Arc Reactor Cores"): 180.0,
}

DEFAULT_PRODUCTION_RATES: dict[tuple[str, str], float] = {
    ("Avengers Compound", "Medical Kits"): 8.0,
    ("New Asgard", "Vibranium (kg)"): 3.0,
    ("Sanctum Sanctorum", "Clean Water (L)"): 10.0,
    ("Sokovia", "Pym Particles"): 5.0,
    ("Wakanda", "Arc Reactor Cores"): 4.0,
}

COST_PER_UNIT: dict[tuple[str, str], float] = {
    ("Avengers Compound", "Medical Kits"): 3500.0,
    ("New Asgard", "Vibranium (kg)"): 4000.0,
    ("Sanctum Sanctorum", "Clean Water (L)"): 1000.0,
    ("Sokovia", "Pym Particles"): 4500.0,
    ("Wakanda", "Arc Reactor Cores"): 5000.0,
}

TARGET_STOCKS: dict[tuple[str, str], float] = dict(INITIAL_STOCKS)

# Directed dependency graph: if upstream drops below threshold, downstream production degrades
# Format: (upstream_sector, upstream_resource): [(downstream_sector, downstream_resource, threshold_pct, penalty_pct)]
DEPENDENCY_GRAPH: dict[tuple[str, str], list[tuple[str, str, float, float]]] = {
    ("New Asgard", "Vibranium (kg)"): [
        ("Wakanda", "Arc Reactor Cores", 0.30, 0.50),  # below 30% target -> 50% Arc production penalty
    ],
    ("Wakanda", "Arc Reactor Cores"): [
        ("Avengers Compound", "Medical Kits", 0.30, 0.40),   # below 30% -> 40% Medical penalty
        ("Sokovia", "Pym Particles", 0.30, 0.40),             # below 30% -> 40% Pym penalty
    ],
    ("Sanctum Sanctorum", "Clean Water (L)"): [
        ("Avengers Compound", "Medical Kits", 0.25, 0.30),   # below 25% -> 30% Medical penalty
    ],
}

STOCK_FLOOR = 10.0
STOCK_CEILING = 1500.0

MAX_EVENTS = 500

DEFCON_LABELS = {5: "NORMAL", 4: "ELEVATED", 3: "GUARDED", 2: "CRITICAL", 1: "OMEGA"}
DEFCON_COLORS = {5: "green", 4: "yellow", 3: "orange", 2: "red", 1: "purple"}

_lock = threading.Lock()
_stocks: dict[tuple[str, str], float] = {}
_production_rates: dict[tuple[str, str], float] = {}
_events: deque[dict[str, Any]] = deque(maxlen=MAX_EVENTS)
_defcon_level: int = 5  # 5=NORMAL, 4=ELEVATED, 3=GUARDED, 2=CRITICAL, 1=OMEGA
_defcon_lock = threading.Lock()


def reset() -> None:
    """Initialize or reset stocks to their starting values."""
    global _stocks, _events, _production_rates, _defcon_level
    with _lock:
        _stocks = {k: v for k, v in INITIAL_STOCKS.items()}
        _production_rates = {k: v for k, v in DEFAULT_PRODUCTION_RATES.items()}
        _events = deque(maxlen=MAX_EVENTS)
    with _defcon_lock:
        _defcon_level = 5


def get_stocks() -> dict[tuple[str, str], float]:
    with _lock:
        return dict(_stocks)


def get_stock(sector_id: str, resource_type: str) -> float:
    with _lock:
        return _stocks.get((sector_id, resource_type), 0.0)


def apply_delta(sector_id: str, resource_type: str, delta: float) -> float:
    """Apply a delta to stock, clamped between floor and ceiling. Returns new stock level."""
    with _lock:
        key = (sector_id, resource_type)
        current = _stocks.get(key, 0.0)
        new_val = max(STOCK_FLOOR, min(STOCK_CEILING, current + delta))
        _stocks[key] = new_val
        return new_val


def set_stock(sector_id: str, resource_type: str, value: float) -> float:
    """Set stock to an absolute value, clamped between floor and ceiling."""
    with _lock:
        key = (sector_id, resource_type)
        new_val = max(STOCK_FLOOR, min(STOCK_CEILING, value))
        _stocks[key] = new_val
        return new_val


def get_production_rates() -> dict[tuple[str, str], float]:
    with _lock:
        return dict(_production_rates)


def get_production_rate(sector_id: str, resource_type: str) -> float:
    with _lock:
        return _production_rates.get((sector_id, resource_type), 0.0)


def set_production_rate(sector_id: str, resource_type: str, rate: float) -> None:
    with _lock:
        key = (sector_id, resource_type)
        if key in _production_rates:
            _production_rates[key] = rate


def append_event(event: dict[str, Any]) -> None:
    with _lock:
        _events.append(event)


def get_events_since(since_iso: str | None, limit: int = 100) -> list[dict[str, Any]]:
    """Return events after the given ISO timestamp, newest first."""
    with _lock:
        if since_iso is None:
            events = list(_events)
        else:
            events = [e for e in _events if e["timestamp"] > since_iso]
        events.sort(key=lambda e: e["timestamp"], reverse=True)
        return events[:limit]


def get_production_penalties() -> dict[tuple[str, str], float]:
    """Return production rate multipliers (0.0-1.0) based on upstream dependency health."""
    stocks = get_stocks()
    penalties: dict[tuple[str, str], float] = {}
    for upstream_key, dependents in DEPENDENCY_GRAPH.items():
        upstream_stock = stocks.get(upstream_key, 0.0)
        upstream_target = TARGET_STOCKS.get(upstream_key, 1.0)
        for (d_sector, d_resource, threshold_pct, penalty_pct) in dependents:
            if upstream_stock < upstream_target * threshold_pct:
                key = (d_sector, d_resource)
                # Accumulate worst penalty (can be stacked from multiple upstreams)
                existing = penalties.get(key, 0.0)
                penalties[key] = max(existing, penalty_pct)
    return penalties


def compute_defcon() -> int:
    """Compute DEFCON level from aggregate stock health. Lower = worse."""
    stocks = get_stocks()
    targets = TARGET_STOCKS
    if not targets:
        return 5
    health_scores = []
    for key, target in targets.items():
        stock = stocks.get(key, 0.0)
        health_scores.append(min(1.0, stock / max(target, 1.0)))
    avg_health = sum(health_scores) / len(health_scores)
    critical_count = sum(1 for s in health_scores if s < 0.25)

    if avg_health >= 0.80 and critical_count == 0:
        return 5
    elif avg_health >= 0.60 and critical_count <= 1:
        return 4
    elif avg_health >= 0.40 and critical_count <= 2:
        return 3
    elif avg_health >= 0.20 or critical_count <= 3:
        return 2
    else:
        return 1


def get_defcon() -> int:
    with _defcon_lock:
        return _defcon_level


def update_defcon() -> int:
    """Recompute and update DEFCON level with hysteresis (fast escalation, slow de-escalation)."""
    global _defcon_level
    new_level = compute_defcon()
    with _defcon_lock:
        if new_level < _defcon_level:  # Escalation: immediate
            _defcon_level = new_level
        elif new_level > _defcon_level:  # De-escalation: only move 1 step at a time
            _defcon_level = min(_defcon_level + 1, 5)
        return _defcon_level
