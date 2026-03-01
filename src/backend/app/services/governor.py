"""Governor Service: ML feedback control loop with Champion/Challenger/Backup pattern."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.resource_config import RESOURCE_CONFIG, TOTAL_BUDGET
from app.models.control_action import ControlAction
from app.models.resource_log import ResourceLog
from app.services.strategies.trend_model import TrendModel, TrendResult

logger = logging.getLogger(__name__)

DATA_POINTS = 20  # last N entries per sector for training


@dataclass
class ModelSnapshot:
    trained_at: datetime
    data_points: int
    confidences: dict[str, float] = field(default_factory=dict)  # per sector key
    allocations: dict[str, float] = field(default_factory=dict)  # production units per sector key
    overall_confidence: float = 0.0


def _sector_key(sector_id: str, resource_type: str) -> str:
    return f"{sector_id}|{resource_type}"


def optimize_allocations(
    trends: dict[str, TrendResult],
    config: dict[tuple[str, str], dict],
) -> dict[str, float]:
    """Return production units per sector that stay within TOTAL_BUDGET.

    Algorithm:
    1. Start with base_production for all sectors (= ~$95K baseline)
    2. Compute urgency_score per sector
    3. Handle CRITICAL sectors (stock < 30% of target)
    4. Clamp: no sector below 80% of base_production
    5. Final budget check
    """
    # Build base allocations
    allocations: dict[str, float] = {}
    for (sector_id, resource_type), cfg in config.items():
        key = _sector_key(sector_id, resource_type)
        allocations[key] = cfg["base_production"]

    # Compute urgency scores
    urgency: dict[str, float] = {}
    critical_sectors: list[str] = []
    for (sector_id, resource_type), cfg in config.items():
        key = _sector_key(sector_id, resource_type)
        trend = trends.get(key)
        if trend is None:
            urgency[key] = 0.0
            continue

        deficit = max(0.0, cfg["target_stock"] - trend.current_stock)
        trend_penalty = max(0.0, -trend.slope) * 10
        urgency[key] = deficit * 0.6 + trend_penalty * 0.4

        # CRITICAL: stock < 30% of target
        if trend.current_stock < cfg["target_stock"] * 0.3:
            critical_sectors.append(key)

    # Sort by urgency descending
    sorted_keys = sorted(urgency, key=lambda k: urgency[k], reverse=True)

    # Handle critical sectors: boost their production
    if critical_sectors:
        for crit_key in critical_sectors:
            # Find the config for this key
            crit_cfg = None
            for (sid, rtype), cfg in config.items():
                if _sector_key(sid, rtype) == crit_key:
                    crit_cfg = cfg
                    break
            if crit_cfg is None:
                continue

            # Boost to max feasible (double base, capped by budget)
            max_units = TOTAL_BUDGET / crit_cfg["cost_per_unit"]
            allocations[crit_key] = min(crit_cfg["base_production"] * 2.0, max_units)

        # Reduce lower-urgency sectors proportionally to stay within budget
        _rebalance_budget(allocations, config)
    else:
        # Distribute flex budget ($5K) to highest-urgency sectors
        if sorted_keys and urgency[sorted_keys[0]] > 0:
            top_key = sorted_keys[0]
            for (sid, rtype), cfg in config.items():
                if _sector_key(sid, rtype) == top_key:
                    extra_units = 5000 / cfg["cost_per_unit"]
                    allocations[top_key] += extra_units
                    break

    # Clamp: no sector below 80% of base_production
    for (sector_id, resource_type), cfg in config.items():
        key = _sector_key(sector_id, resource_type)
        min_production = cfg["base_production"] * 0.8
        allocations[key] = max(allocations[key], min_production)

    # Final budget check and scale down if needed
    _rebalance_budget(allocations, config)

    return allocations


def _rebalance_budget(
    allocations: dict[str, float],
    config: dict[tuple[str, str], dict],
) -> None:
    """Scale allocations down proportionally so total cost <= TOTAL_BUDGET."""
    cost_lookup: dict[str, float] = {}
    min_production: dict[str, float] = {}
    for (sector_id, resource_type), cfg in config.items():
        key = _sector_key(sector_id, resource_type)
        cost_lookup[key] = cfg["cost_per_unit"]
        min_production[key] = cfg["base_production"] * 0.8

    total_cost = sum(allocations[k] * cost_lookup[k] for k in allocations if k in cost_lookup)
    if total_cost <= TOTAL_BUDGET:
        return

    # Scale down all allocations proportionally, respecting min
    scale = TOTAL_BUDGET / total_cost
    for key in allocations:
        if key in cost_lookup:
            allocations[key] = max(allocations[key] * scale, min_production.get(key, 0))

    # If still over after clamping, do a second pass cutting from highest cost
    total_cost = sum(allocations[k] * cost_lookup[k] for k in allocations if k in cost_lookup)
    if total_cost > TOTAL_BUDGET:
        overshoot = total_cost - TOTAL_BUDGET
        sorted_by_cost = sorted(
            [k for k in allocations if k in cost_lookup],
            key=lambda k: cost_lookup[k],
            reverse=True,
        )
        for key in sorted_by_cost:
            if overshoot <= 0:
                break
            reducible = (allocations[key] - min_production.get(key, 0)) * cost_lookup[key]
            cut = min(overshoot, reducible)
            allocations[key] -= cut / cost_lookup[key]
            overshoot -= cut


def _build_projection_curve(
    current_stock: float,
    consumption_rate: float,
    max_hours: float = 168.0,
    max_points: int = 50,
) -> list[dict]:
    """Return a projection curve of declining stock at a constant consumption rate.

    The curve runs from hours_from_now=0 until projected_stock reaches 0 or
    max_hours (168h / 7 days), whichever comes first.  At most max_points entries.
    """
    if consumption_rate <= 0 or current_stock <= 0:
        return [{"hours_from_now": 0, "projected_stock": round(current_stock, 1)}]

    hours_to_zero = current_stock / consumption_rate
    end_hours = min(hours_to_zero, max_hours)

    # Choose step so we get at most max_points
    if max_points <= 1:
        step = end_hours
    else:
        step = end_hours / (max_points - 1)
        step = max(step, 0.01)  # avoid degenerate tiny steps

    curve: list[dict] = []
    h = 0.0
    while h <= end_hours and len(curve) < max_points:
        projected = max(0.0, current_stock - consumption_rate * h)
        curve.append({
            "hours_from_now": round(h, 2),
            "projected_stock": round(projected, 1),
        })
        h += step

    # Ensure the final point is included (at depletion or max_hours)
    if curve and curve[-1]["hours_from_now"] < round(end_hours, 2) and len(curve) < max_points:
        projected = max(0.0, current_stock - consumption_rate * end_hours)
        curve.append({
            "hours_from_now": round(end_hours, 2),
            "projected_stock": round(projected, 1),
        })

    return curve


class Governor:
    def __init__(self) -> None:
        self.champion: ModelSnapshot | None = None
        self.challenger: ModelSnapshot | None = None
        self.backup: ModelSnapshot | None = None
        self._cycle_count: int = 0
        self._trend_model = TrendModel()
        self._override_allocations: dict[str, float] = {}

    def set_override(self, sector_id: str, resource_type: str, units_per_cycle: float) -> None:
        key = _sector_key(sector_id, resource_type)
        self._override_allocations[key] = units_per_cycle

    def clear_override(self, sector_id: str, resource_type: str) -> None:
        key = _sector_key(sector_id, resource_type)
        self._override_allocations.pop(key, None)

    async def run_cycle(self, db: AsyncSession) -> ControlAction | None:
        """Run one governor cycle. Training happens every 2 cycles."""
        self._cycle_count += 1
        should_train = self._cycle_count % 2 == 0 or self.champion is None

        if should_train:
            snapshot = await self._train(db)
            if snapshot is not None:
                self._promote(snapshot)

        if self.champion is None:
            return None

        # Apply overrides to champion allocations
        active_allocations = dict(self.champion.allocations)
        for key, units in self._override_allocations.items():
            active_allocations[key] = units

        # Log control action
        rationale = self._build_rationale(db, active_allocations)
        total_budget_used = self._compute_budget(active_allocations)
        sectors_adjusted = sum(
            1
            for key in active_allocations
            if key in self.champion.allocations
            and abs(active_allocations[key] - self._get_base_production(key)) > 0.01
        )

        action = ControlAction(
            timestamp=datetime.now(timezone.utc),
            champion_confidence=self.champion.overall_confidence,
            backup_confidence=self.backup.overall_confidence if self.backup else None,
            total_budget_used=total_budget_used,
            allocations_json={k: round(v, 2) for k, v in active_allocations.items()},
            rationale=rationale,
            sectors_adjusted=sectors_adjusted,
            champion_data_points=self.champion.data_points,
        )
        db.add(action)
        await db.commit()

        # Send production commands to feed service
        await self._send_production_commands(active_allocations)

        return action

    async def _train(self, db: AsyncSession) -> ModelSnapshot | None:
        """Fetch data, fit trend models, build a new ModelSnapshot."""
        trends: dict[str, TrendResult] = {}
        total_data_points = 0
        confidences: dict[str, float] = {}

        for (sector_id, resource_type) in RESOURCE_CONFIG:
            key = _sector_key(sector_id, resource_type)
            result = await db.execute(
                select(ResourceLog)
                .where(ResourceLog.sector_id == sector_id)
                .where(ResourceLog.resource_type == resource_type)
                .order_by(ResourceLog.timestamp.desc())
                .limit(DATA_POINTS)
            )
            rows = list(reversed(result.scalars().all()))

            if not rows:
                continue

            timestamps = [r.timestamp for r in rows]
            stock_levels = [r.stock_level for r in rows]
            total_data_points += len(rows)

            trend = self._trend_model.fit(timestamps, stock_levels)
            trends[key] = trend
            confidences[key] = trend.confidence

        if not trends:
            return None

        allocations = optimize_allocations(trends, RESOURCE_CONFIG)
        overall_confidence = sum(confidences.values()) / len(confidences) if confidences else 0.0

        return ModelSnapshot(
            trained_at=datetime.now(timezone.utc),
            data_points=total_data_points,
            confidences=confidences,
            allocations=allocations,
            overall_confidence=overall_confidence,
        )

    def _promote(self, snapshot: ModelSnapshot) -> None:
        """Champion/Challenger swap logic."""
        if self.champion is None:
            self.champion = snapshot
            return

        # snapshot is the challenger
        self.challenger = snapshot
        if self.challenger.overall_confidence >= self.champion.overall_confidence:
            # Challenger wins: champion -> backup, challenger -> champion
            self.backup = self.champion
            self.champion = self.challenger
            self.challenger = None
        else:
            # Champion wins: discard challenger
            self.challenger = None

    def _build_rationale(self, db: AsyncSession, allocations: dict[str, float]) -> str:
        parts: list[str] = []
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            alloc = allocations.get(key, cfg["base_production"])
            diff = alloc - cfg["base_production"]
            if abs(diff) > 0.01:
                pct = (diff / cfg["base_production"]) * 100
                direction = "boosted" if diff > 0 else "cut"
                cost_change = abs(diff) * cfg["cost_per_unit"]
                parts.append(
                    f"{resource_type} ({sector_id}) {direction} "
                    f"{abs(pct):.0f}% (${cost_change:,.0f})"
                )

        if not parts:
            return "All sectors at baseline production. No adjustments needed."
        return ". ".join(parts) + "."

    def _compute_budget(self, allocations: dict[str, float]) -> float:
        total = 0.0
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            total += allocations.get(key, 0) * cfg["cost_per_unit"]
        return total

    def _get_base_production(self, key: str) -> float:
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            if _sector_key(sector_id, resource_type) == key:
                return cfg["base_production"]
        return 0.0

    async def _send_production_commands(self, allocations: dict[str, float]) -> None:
        """Send production rate updates to the feed service."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for key, units in allocations.items():
                    parts = key.split("|", 1)
                    if len(parts) != 2:
                        continue
                    sector_id, resource_type = parts
                    url = f"{settings.FEED_SERVICE_URL}/control/production"
                    await client.post(
                        url,
                        json={
                            "sector_id": sector_id,
                            "resource_type": resource_type,
                            "units_per_cycle": units,
                        },
                    )
        except (httpx.HTTPError, Exception) as exc:
            logger.warning("Failed to send production commands: %s", exc)

    async def compute_time_to_zero(self, db: AsyncSession) -> dict[str, dict]:
        """Compute time-to-zero per sector using consumption-only math.

        Fetches a larger window of data points, sums only stock decreases
        (consumption events), and divides by the total elapsed time span to
        get a stable hourly consumption rate.  Returns projection_curve and
        per-sector snap_detected.
        """
        results: dict[str, dict] = {}
        now = datetime.now(timezone.utc)
        for (sector_id, resource_type) in RESOURCE_CONFIG:
            key = _sector_key(sector_id, resource_type)

            # Try progressively wider time windows: 2h, 4h, then unlimited
            rows: list[ResourceLog] = []
            for window_hours in (2, 4, None):
                query = (
                    select(ResourceLog)
                    .where(ResourceLog.sector_id == sector_id)
                    .where(ResourceLog.resource_type == resource_type)
                )
                if window_hours is not None:
                    cutoff = now - timedelta(hours=window_hours)
                    query = query.where(ResourceLog.timestamp >= cutoff)
                query = query.order_by(ResourceLog.timestamp.desc()).limit(50)
                result = await db.execute(query)
                rows = list(reversed(result.scalars().all()))
                if len(rows) >= 5:
                    break

            if len(rows) < 2:
                results[key] = {
                    "sector_id": sector_id,
                    "resource_type": resource_type,
                    "current_stock": rows[0].stock_level if rows else 0,
                    "hours_to_zero": None,
                    "consumption_rate_hourly": None,
                    "snap_detected": False,
                    "projection_curve": [],
                    "calculation_method": "time_to_zero_no_production",
                }
                continue

            # Per-sector snap detection: did any recent row flag a snap?
            snap_detected = any(r.snap_event_detected for r in rows)

            current_stock = rows[-1].stock_level

            # Sum only consumption (stock decreases) across consecutive rows
            total_consumed = 0.0
            for i in range(1, len(rows)):
                stock_diff = rows[i - 1].stock_level - rows[i].stock_level
                if stock_diff > 0:
                    total_consumed += stock_diff

            # Total elapsed time across the full window
            elapsed_hours = (
                (rows[-1].timestamp - rows[0].timestamp).total_seconds() / 3600
            )

            if elapsed_hours >= 0.01 and total_consumed > 0:
                consumption_rate = total_consumed / elapsed_hours
            else:
                consumption_rate = 0.0

            if consumption_rate > 0:
                hours_to_zero = current_stock / consumption_rate
            else:
                hours_to_zero = None

            # Guard: never report zero/negative hours unless stock is truly
            # at the floor (Bug 3 — EXHAUSTED false positive)
            if (
                hours_to_zero is not None
                and hours_to_zero <= 0
                and current_stock > 10
            ):
                hours_to_zero = None

            # Build projection_curve: declining stock at the computed rate
            projection_curve = _build_projection_curve(
                current_stock, consumption_rate
            )

            results[key] = {
                "sector_id": sector_id,
                "resource_type": resource_type,
                "current_stock": current_stock,
                "hours_to_zero": (
                    round(hours_to_zero, 1) if hours_to_zero is not None else None
                ),
                "consumption_rate_hourly": round(consumption_rate, 2),
                "snap_detected": snap_detected,
                "projection_curve": projection_curve,
                "calculation_method": "time_to_zero_no_production",
            }

        return results

    def get_status(self) -> dict:
        """Return current governor status for the API."""
        def _snapshot_dict(snap: ModelSnapshot | None) -> dict | None:
            if snap is None:
                return None
            return {
                "trained_at": snap.trained_at.isoformat(),
                "data_points": snap.data_points,
                "overall_confidence": round(snap.overall_confidence, 2),
                "confidences": {k: round(v, 2) for k, v in snap.confidences.items()},
                "allocations": {k: round(v, 2) for k, v in snap.allocations.items()},
            }

        budget_used = self._compute_budget(self.champion.allocations) if self.champion else 0
        return {
            "champion": _snapshot_dict(self.champion),
            "challenger": _snapshot_dict(self.challenger),
            "backup": _snapshot_dict(self.backup),
            "cycle_count": self._cycle_count,
            "budget_total": TOTAL_BUDGET,
            "budget_used": round(budget_used, 2),
            "overrides": dict(self._override_allocations),
        }


# Singleton instance used by the background loop and router
governor_instance = Governor()
