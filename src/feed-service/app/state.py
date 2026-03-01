"""In-memory state for all 5 sector+resource pairs."""

from __future__ import annotations

import threading
from collections import deque
from typing import Any

INITIAL_STOCKS: dict[tuple[str, str], float] = {
    ("Avengers Compound", "Medical Kits"): 600.0,
    ("New Asgard", "Vibranium (kg)"): 450.0,
    ("Sanctum Sanctorum", "Clean Water (L)"): 700.0,
    ("Sokovia", "Pym Particles"): 500.0,
    ("Wakanda", "Arc Reactor Cores"): 500.0,
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

STOCK_FLOOR = 10.0
STOCK_CEILING = 1500.0

MAX_EVENTS = 500

_lock = threading.Lock()
_stocks: dict[tuple[str, str], float] = {}
_production_rates: dict[tuple[str, str], float] = {}
_events: deque[dict[str, Any]] = deque(maxlen=MAX_EVENTS)


def reset() -> None:
    """Initialize or reset stocks to their starting values."""
    global _stocks, _events, _production_rates
    with _lock:
        _stocks = {k: v for k, v in INITIAL_STOCKS.items()}
        _production_rates = {k: v for k, v in DEFAULT_PRODUCTION_RATES.items()}
        _events = deque(maxlen=MAX_EVENTS)


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
