# Feed Service Simulation Analysis: Graph Discovery Issues

**Date**: 2026-03-01
**Investigator**: Claude Code (Graph Discovery Team)
**Status**: Complete

---

## Executive Summary

The feed service generates realistic production/drain cycles, but two fundamental issues create dashboard confusion:

1. **Status Label Mismatch (MEDICAL KITS "DEPLETING" WITH UPWARD TREND)**
   - The medical kit stock *is actually declining* at -0.5 units/cycle baseline (production 8.0 < drain 8.5)
   - BUT the **graph shows upward trends** because random positive events (resupply 3-12 units) occur frequently and dominate the small drain
   - The frontend's **status label is INCORRECT** because it uses historical consumption rate (backward-looking from past 24h data) instead of current production+drain
   - Result: Stock UP, Status DOWN = contradiction visible to user

2. **Graph Changes Too Small**
   - Each cycle changes stock by only 0.2-0.5 units for most resources (pure drain)
   - Random events add 3-20 units occasionally, making 0.5-unit drains invisible
   - At 10-second cycles, stock appears nearly flat on a dashboard chart

---

## Part 1: Production/Drain Rate Calculations

### Cycle Interval
**File**: `src/feed-service/app/generator.py:31`
```python
CYCLE_INTERVAL = 10.0  # 10 seconds real time = 1 simulation cycle
```
Meaning: One simulation cycle = 10 real-world seconds.

### Cycles Per Hour
**File**: `src/backend/app/resource_config.py:39`
```python
CYCLES_PER_HOUR: float = 360.0  # one cycle every 10 seconds = 360/hour
```
Meaning: 60 min/hr ÷ (10 sec/cycle ÷ 60 sec/min) = 60 ÷ 0.167 = 360 cycles/hour.

### Production Rates (per cycle, baseline)
**File**: `src/feed-service/app/state.py:17-23`
```python
DEFAULT_PRODUCTION_RATES: dict[tuple[str, str], float] = {
    ("Avengers Compound", "Medical Kits"): 8.0,
    ("New Asgard", "Vibranium (kg)"): 3.0,
    ("Sanctum Sanctorum", "Clean Water (L)"): 10.0,
    ("Sokovia", "Pym Particles"): 5.0,
    ("Wakanda", "Arc Reactor Cores"): 4.0,
}
```

### Base Drain Rates (per cycle, at DEFCON 5)
**File**: `src/feed-service/app/generator.py:23-29`
```python
BASE_DRAIN_RATES: dict[str, float] = {
    "Medical Kits": 8.5,       # prod: 8.0  → net -0.5/cycle at baseline
    "Clean Water (L)": 10.5,   # prod: 10.0 → net -0.5/cycle at baseline
    "Vibranium (kg)": 3.2,     # prod: 3.0  → net -0.2/cycle at baseline
    "Pym Particles": 5.2,      # prod: 5.0  → net -0.2/cycle at baseline
    "Arc Reactor Cores": 4.2,  # prod: 4.0  → net -0.2/cycle at baseline
}
```

### Net Changes Per Cycle (Baseline DEFCON 5)
| Resource | Production | Drain | Net/Cycle | Net/Hour (360 cycles) |
|----------|-----------|-------|-----------|----------------------|
| Medical Kits | 8.0 | 8.5 | **-0.5** | -180 units/hour |
| Clean Water (L) | 10.0 | 10.5 | **-0.5** | -180 units/hour |
| Vibranium (kg) | 3.0 | 3.2 | **-0.2** | -72 units/hour |
| Pym Particles | 5.0 | 5.2 | **-0.2** | -72 units/hour |
| Arc Reactor Cores | 4.0 | 4.2 | **-0.2** | -72 units/hour |

**Critical Finding**: All resources **DECLINE** at baseline (production < drain). The simulation creates constant pressure.

### Stock Update Logic (Per Cycle)
**File**: `src/feed-service/app/generator.py:81-147`

Each cycle applies three deltas in sequence:

1. **Production** (lines 88-107):
   - Get effective_rate = base_rate × (1.0 - penalty)
   - Apply delta to stock via `apply_delta(sector_id, resource_type, effective_rate)`
   - Cap at 200% of target (line 95-96)

2. **Base Drain** (lines 109-120):
   - Get drain = BASE_DRAIN_RATES[resource_type] × defcon_multiplier
   - Apply delta = -drain
   - defcon multiplier: {5: 1.0, 4: 1.1, 3: 1.25, 2: 1.5, 1: 2.0}

3. **Random Events** (lines 122-142):
   - 2-4 random sectors chosen per cycle
   - 70% consumption (delta: -5 to -20 units), 30% resupply (delta: +3 to +12 units)

### Stock Clamping
**File**: `src/feed-service/app/state.py:87-94`
```python
def apply_delta(sector_id: str, resource_type: str, delta: float) -> float:
    with _lock:
        key = (sector_id, resource_type)
        current = _stocks.get(key, 0.0)
        new_val = max(STOCK_FLOOR, min(STOCK_CEILING, current + delta))
        _stocks[key] = new_val
        return new_val
```
Bounds: **10.0 ≤ stock ≤ 1500.0** (clamped after every delta).

---

## Part 2: Stock Level Updates Per Cycle

### Medical Kits Example (Avengers Compound)
**Initial state**: stock = 600, production_rate = 8.0, defcon = 5

**Cycle sequence** (one 10-second cycle):
1. **Production phase**: +8.0 units (no penalties) → stock = 608.0
2. **Base drain phase**: -8.5 units → stock = 599.5
3. **Random event phase** (probabilistic):
   - If chosen AND is_consumption (70% chance): -5 to -20 units
   - If chosen AND is_resupply (30% chance): +3 to +12 units
   - If not chosen: no change

**Net per cycle (without random)**:
- +8.0 (production) -8.5 (drain) = **-0.5 units/cycle**

**Net per cycle (with random events)**:
- If resupply chosen (30% of 2-4 events): +3 to +12 units added → temporary net positive
- If consumption chosen (70% of 2-4 events): -5 to -20 units → strong negative
- Average: 3.5 events × (0.7 × -12.5 avg + 0.3 × +7.5 avg) = 3.5 × (-8.75 + 2.25) = 3.5 × -6.5 ≈ **-22.75 units per cycle on average**

So over many cycles, Medical Kits **decline rapidly when random events are included** (-22.75/cycle average).

---

## Part 3: Events and Data Structures

### Event Structure
**File**: `src/feed-service/app/generator.py:61-78`
```python
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
```

### Event Types Generated
1. **production** — when production_rate > 0 and stock < 200% target
2. **consumption** — base drain every cycle
3. **random_event** — random sector/resource consumption or resupply
4. **snap_event** — halved all stocks (governance endpoint)

### Event Flow
**File**: `src/feed-service/app/generator.py:163-169` (cycle loop)
```python
async def cycle_loop() -> None:
    while True:
        await asyncio.sleep(CYCLE_INTERVAL)  # 10 seconds
        events = run_cycle()
        await push_events(events)  # POST to backend /api/v1/feed/push
```

Events are stored **locally in feed service** (`state._events`, max 500), then pushed to backend immediately after each cycle.

---

## Part 4: Status Label Calculation

### Frontend Status Decision
**File**: `src/frontend/lib/api.ts:154-187`
```typescript
export function computeNetStatus(entry: TimeToZeroEntry): NetStatus {
  const stock = entry.current_stock
  const h = entry.hours_to_zero

  if (stock <= 10) return 'EXHAUSTED'

  const govStatus = entry.governor_status
  const targetStock = entry.target_stock ?? TARGET_STOCK[key] ?? 500

  // If governor says "CUTTING" (production reduced), always STABLE
  if (govStatus === 'CUTTING') return 'STABLE'

  // If governor says "MAINTAINING" (normal production)
  if (govStatus === 'MAINTAINING') {
    if (stock >= targetStock * 0.9) return 'STABLE'
    return 'RECOVERING'
  }

  // If governor says "CRITICAL" (production boosted)
  if (govStatus === 'CRITICAL') {
    if (h != null && h < 4) return 'DEPLETING'
    return 'CRITICAL'
  }

  // Fallback: use net_hourly logic when governor status is unavailable
  const productionRate = entry.production_rate_hourly ?? 0
  const consumptionRate = entry.consumption_rate
  const netHourly = productionRate - consumptionRate

  if (netHourly >= 0) {
    if (stock >= targetStock * 0.9) return 'STABLE'
    return 'RECOVERING'
  }

  if (h != null && h < 4) return 'DEPLETING'
  if (h != null && h >= 4 && h <= 24) return 'CRITICAL'
  return 'LOW'
}
```

### The Core Problem

The status label depends on `entry.consumption_rate`, which is calculated from **historical 24-hour data** in the backend. Here's how:

**File**: `src/backend/app/routers/feed.py:78-79`
```python
drain_per_cycle = BASE_DRAIN_RATES.get(resource_type, 1.0)
usage_rate_hourly = round(drain_per_cycle * CYCLES_PER_HOUR, 2)
```

This **always uses drain-only** (no production offset), so:
- Medical Kits: usage_rate_hourly = 8.5 × 360 = **3060 units/hour** (drain only)

But the actual **consumption_rate** in the TimeToZeroEntry is calculated from historical regression:
- Taken from past 24 hours of stock changes
- If random events dominate, the regression sees net **positive** change
- Thus consumption_rate becomes **negative** (meaning net recovery)

**Result**:
- `netHourly = production_rate_hourly - consumption_rate`
- If consumption_rate is negative (net recovery from random events), netHourly is positive
- Status becomes "STABLE" or "RECOVERING"
- BUT the actual stock is **still declining** from drains

**The graph trends UP because**:
- Random resupply events (+3 to +12 units) occur frequently (2-4 per cycle)
- They're visible on the chart and dominate the tiny -0.5 drain
- Regression sees net positive → consumption_rate becomes negative → status says "RECOVERING"
- User sees upward trend but reads label "DEPLETING" (if governor is in CRITICAL mode)

---

## Part 5: Diagnosis

### Why Medical Kits Show "DEPLETING" While Graph Trends Upward

**Root Cause Chain**:

1. **Governor Set to CRITICAL**: Frontend receives `governor_status: 'CRITICAL'`
2. **Computeion in computeNetStatus (line 170)**:
   ```typescript
   if (govStatus === 'CRITICAL') {
     if (h != null && h < 4) return 'DEPLETING'  // ← This triggers
     return 'CRITICAL'
   }
   ```
3. **h = hours_to_zero** comes from forecast service, which extrapolates from consumption_rate
4. **consumption_rate is based on 24-hour historical data** that sees random resupply events
5. **Random events dominate the math**:
   - 3.5 random events/cycle average
   - 70% are consumption (-5 to -20), 30% are resupply (+3 to +12)
   - Net = 3.5 × (0.7 × -12.5 + 0.3 × +7.5) = -22.75 units/cycle
   - BUT individual resupply events are +3 to +12, clearly visible on chart
6. **Result**: Graph shows upward steps (resupply events), but if hours_to_zero < 4, status shows "DEPLETING"

**The real issue**: The **governor_status = 'CRITICAL'** is being set by the Governor, but it doesn't reflect actual net production. The Governor sets production high to fight drains, but the status label reflects the Governor's action (CRITICAL = "we're boosting") rather than actual resource health.

---

### Why Graph Changes Are Invisible

**Per-Cycle Changes**:
- Production: +8.0 to +10.0 units/cycle
- Drain: -8.5 to -10.5 units/cycle
- Net before random: **-0.2 to -0.5 units/cycle** (essentially flat)
- Random events: ±3 to ±20 units (rare, only 2-4 per cycle)

**On a dashboard chart covering hours or days**:
- 0.5 units/cycle × 360 cycles/hour = 180 units/hour
- Over 24 hours = 4,320 units
- **BUT**: Initial stock only 600-700 units (Medical, Water)
- A -180 units/hour drain would exhaust Medical Kits (600 units) in **3.3 hours**

**Why it looks flat**:
- Chart y-axis is wide (0-1500 or 0-600 depending on resource)
- 10-second cycles show 0.5-unit changes = 0.08% of the axis
- Visual resolution is **sub-pixel** on most screens
- Random events (±3 to ±20) are 6-40x larger and make tiny drains invisible in noise

---

## Part 6: Recommendations for Demo-Ready Simulation

### Option A: Increase Drain Rates (Faster Time Pressure)
**Change**: Multiply all drain rates by 10x.

Current (Medical):
- Production: 8.0/cycle → 2880/hour
- Drain: 8.5/cycle → 3060/hour
- Net: -0.5/cycle, -180/hour

Proposed (10x drain):
- Production: 8.0/cycle → 2880/hour
- Drain: 85/cycle → 30,600/hour (clearly unsustainable)
- Net: -77/cycle visible immediately

**Impact**:
- Resources exhausted in minutes, not hours
- Stock changes become instantly visible
- Status labels align with actual depletion
- Defcon escalates visibly

### Option B: Increase Production Rates (Clearer Control Margin)
**Change**: Multiply base production by 2x, reduce drains by 50%.

Current (Medical):
- Net: -0.5/cycle

Proposed:
- Production: 16.0/cycle (2x)
- Drain: 4.25/cycle (50% reduction)
- Net: +11.75/cycle (clear recovery)

**Impact**:
- Resources recover visibly
- Governor intervention has obvious effect
- Graph changes easily visible
- Defcon stabilizes clearly

### Option C: Increase Cycle Frequency (Compress Time)
**Change**: Reduce CYCLE_INTERVAL from 10 seconds to 2 seconds (5x faster).

Current:
- One cycle per 10 seconds
- 360 cycles/hour
- Stock change per second: -0.05 units

Proposed (2-second cycles):
- One cycle per 2 seconds
- 1,800 cycles/hour
- Stock change per second: -0.25 units (5x more visible)

**Impact**:
- Same underlying math, but 5x visual acceleration
- Demo completes in 1/5 the time
- Changes become visible without changing numbers

### **Recommendation**: Hybrid Approach
Combine A + C:
1. **Increase drains by 3x** (not 10x, to avoid hyperrealism):
   - Medical: 8.5 → 25.5/cycle (9,180 units/hour)
2. **Reduce cycle interval to 3 seconds** (12 cycles/hour instead of 360):
   - One cycle every 3 seconds
   - 20 cycles per minute
   - Stock changes by 3-10 units per 3 seconds (clearly visible)
3. **Result**: Medical Kits (600) exhausted in ~2 minutes without governor intervention
   - Demo-ready pacing
   - Status labels align with reality
   - Graph changes obvious at all zoom levels

### Files to Change
1. `src/feed-service/app/generator.py:31` — CYCLE_INTERVAL = 3.0
2. `src/feed-service/app/generator.py:23-29` — BASE_DRAIN_RATES × 3
3. `src/backend/app/resource_config.py:39` — CYCLES_PER_HOUR = 1200.0 (3600 sec/hr ÷ 3 sec/cycle)
4. `src/backend/app/resource_config.py:32-38` — BASE_DRAIN_RATES × 3 (keep in sync)

---

## Part 7: Summary Table

| Question | Answer |
|----------|--------|
| **Production/drain math** | Production 3-10/cycle, Drain 3.2-10.5/cycle. Net baseline = -0.2 to -0.5/cycle (all negative). |
| **Stock update per cycle** | Production → Base Drain → Random Events. Net change ranges -0.5 (Medical) to -0.2 (Vibranium) before random. Random events add ±3 to ±20 units, dominating small drains. |
| **Events emitted** | Each cycle generates production, consumption, and random events. JSON structure: {id, timestamp, sector_id, resource_type, delta, event_type, label, stock_after}. |
| **Status label source** | Frontend computeNetStatus() uses governor_status, then falls back to consumption_rate (24-hour historical). Decided in frontend, not feed service. |
| **Medical net rate** | -0.5 units/cycle = -180 units/hour at baseline. With random events averaging -22.75/cycle, stock declines rapidly. |
| **Why "DEPLETING" + upward graph** | Governor set to CRITICAL (status label), but graph sees frequent resupply events (+3 to +12 units) dominating the tiny drain, creating visible upward steps. The status reflects Governor action, not net production. |
| **Per-cycle visibility** | 0.5-unit changes are 0.08% of typical y-axis range. Random events (±3 to ±20) are visible but make the baseline drain (±0.5) invisible. |
| **Demo improvement** | 3x drain + 3-second cycles: Medical exhausted in ~2 minutes, changes visible per-cycle, status labels align with reality. |

---

## Conclusion

The feed service simulation is **mathematically correct but visually imperceptible**. The contradiction between status labels and graph trends arises because:

1. The **baseline production < baseline drain** at all times (by design — creates strategic tension)
2. **Random events dominate visual feedback** (resupply +3 to +12 is 6-40x the drain)
3. **Status labels reflect Governor state** (CRITICAL = "we're intervening") rather than actual resource health

To create a demo-ready simulation:
- **Accelerate the timeline** (shorter cycles, 3x drains)
- **Make changes visible** per-cycle without changing core gameplay
- **Align status labels** with actual production dynamics

This preserves the original design intent while making the system observable.
