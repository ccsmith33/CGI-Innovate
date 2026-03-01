"""Plan-and-hold controller for resource allocation.

Uses a "recover in N cycles" formula, but the Governor commits to each plan
for PLAN_HOLD_CYCLES before reassessing.  This prevents the oscillation that
occurs when the controller replans every single cycle and chases its own
Holt-slope noise.

  - Below target: u = drain + (target - projected) / RECOVERY_CYCLES
  - Above target: u = max(0, drain - (projected - target) / SURPLUS_CYCLES)
  - Near target (dead zone): u = drain
  - All values capped at MAX_BOOST * drain to prevent insane spikes.

The Governor (governor.py) holds each plan for ~3 cycles so the correction
actually takes effect before the next replan sees the results.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

RECOVERY_CYCLES = 5    # plan to close the gap in 5 governor cycles
SURPLUS_CYCLES = 10    # bleed off surplus over 10 cycles
DEAD_ZONE_PCT = 0.02   # within 2% of target → just match drain (no micro-oscillation)
MAX_BOOST = 2.0        # normal cap: 2x drain prevents overshoot
CRISIS_BOOST = 5.0     # crisis cap: 5x drain to overcome dependency penalties
CRISIS_THRESHOLD = 0.2 # below 20% of target = crisis mode


def solve_simple(
    trends: dict,
    config: dict,
    drain_rates: dict,
    total_budget: float,
    horizon: int = 10,  # unused, kept for API compat
) -> dict[str, float]:
    """Compute production rates for each sector.

    Guardrails:
    - Dead zone near target prevents micro-oscillation
    - Normal cap (2x drain) prevents overshoot during steady-state
    - Crisis cap (5x drain) kicks in below 20% of target to overcome
      dependency penalties that would otherwise cause a death spiral
    - Step-change (snap) detection ignores poisoned Holt slope
    """
    from app.resource_config import BASE_DRAIN_RATES

    result: dict[str, float] = {}

    for (sid, rt), cfg in config.items():
        key = f"{sid}|{rt}"
        drain = BASE_DRAIN_RATES.get(rt, cfg["base_production"])
        target = cfg["target_stock"]

        trend = trends.get(key)
        current = float(trend.current_stock) if trend else target
        slope = float(trend.slope) if trend else 0.0
        step_change = trend.step_change_detected if trend else False

        # After a snap/step-change the Holt slope is poisoned by crash data.
        # Ignore it — just use current stock so the recovery formula sees
        # the real gap instead of a wildly negative projection.
        if step_change:
            projected = current
        else:
            projected = max(0.0, current + slope)

        error = target - projected

        # Dead zone: near target, just match drain — no correction needed
        if abs(error) <= target * DEAD_ZONE_PCT:
            result[key] = drain
            continue

        if error > 0:
            # Below target: close gap in RECOVERY_CYCLES
            recovery_needed = error / RECOVERY_CYCLES
            u = drain + recovery_needed
        else:
            # Above target: bleed off surplus
            bleed_off = abs(error) / SURPLUS_CYCLES
            u = max(0.0, drain - bleed_off)

        # Crisis mode: stock dangerously low, need higher cap to overcome
        # dependency penalties (e.g. Vibranium crash → Arc -50% → Medical -40%)
        if current < target * CRISIS_THRESHOLD:
            max_prod = drain * CRISIS_BOOST
        else:
            max_prod = drain * MAX_BOOST

        result[key] = min(max(0.0, u), max_prod)

    return result


# Backward-compatible alias
solve_mpc = solve_simple
