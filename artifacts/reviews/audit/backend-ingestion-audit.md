# Backend Data Ingestion Pipeline Audit

**Date**: 2026-02-28
**Auditor**: researcher-b
**Focus**: Event ingestion, usage_rate_hourly calculation, ResourceLog model, governor budget system

---

## Executive Summary

The backend ingestion pipeline has **multiple critical issues**:

1. **BUG 1 (CRITICAL)**: `usage_rate_hourly` is hardcoded to `7.0` in both ingestion paths (feed_ingester.py:70, feed.py:76) instead of being computed from actual event data or drain rates.

2. **BUG 2 (CRITICAL)**: Time-to-zero calculation (governor.py:443) ignores production entirely and uses only consumption rate, making the depletion estimate **artificially pessimistic** (ignores the governor's production commands).

3. **BUG 3 (ARCHITECTURAL)**: The backend maintains a polling loop (`_FeedIngester.poll_and_ingest`) in main.py:38-91 even though the feed service pushes events via POST `/api/v1/feed/push`. This dual-path ingestion risks duplicate/conflicting data.

4. **DATA INCONSISTENCY**: The frontend's `hours_to_zero` metric represents "consumption-only depletion" and does not account for active production, creating a misleading urgency signal.

---

## Question-by-Question Analysis

### 1. Usage_rate_hourly Calculation

**FINDING**: `usage_rate_hourly` is **hardcoded to 7.0** in both ingestion paths.

**Evidence**:
- **feed_ingester.py:70**: `usage_rate_hourly=7.0,` (hardcoded in polling ingest)
- **feed.py:76**: `usage_rate_hourly=7.0,` (hardcoded in push ingest)

**Expected Behavior**: This field should represent the actual hourly drain rate for a resource type, computed from:
- Feed service's base drain rates (generator.py:23-29): Medical Kits=7.5, Clean Water=9.5, Vibranium=2.2, Pym Particles=4.2, Arc Reactor=3.2
- DEFCON multiplier (generator.py:111): scales drain by {5: 1.0, 4: 1.1, 3: 1.25, 2: 1.5, 1: 2.0}
- Currently expected for Medical Kits: 7.5 * DEFCON_multiplier (could be 7.5-15.0 depending on threat level)

**Issue**: The hardcoded 7.0 does not match any documented drain rate. It's a placeholder that was never replaced with real computation.

**Impact**: Any calculation downstream that uses `usage_rate_hourly` (like time-to-zero) will be inaccurate.

---

### 2. Feed Push Endpoint

**Endpoint**: `POST /api/v1/feed/push`
**Location**: feed.py:57-118

**Behavior**:
1. Accepts `PushPayload` with list of events (feed.py:24-25)
2. For each event:
   - Extracts: `sector_id`, `resource_type`, `stock_after` (line 68-70)
   - Creates ResourceLog row with hardcoded `usage_rate_hourly=7.0` (line 76)
   - Writes to database (line 80-83)
3. Recomputes forecasts for affected sector+resource pairs (line 85-91)
4. Broadcasts `resource_update` with events and sector_stocks (line 99-102)
5. Broadcasts `defcon_update` fetched from feed service (line 105-116)

**Database Write**: Clean. Uses `db.add()` and `await db.commit()`.

**Filtering/Transformation**: None. Events are written as-is (except for the hardcoded `usage_rate_hourly` and `snap_event_detected=False`).

**Missing Data**: The `snap_event_detected` field is hardcoded to `False` (feed.py:77). Snap events from the feed service are never marked as such in ResourceLog.

---

### 3. Governor Budget System

**Budget Configuration** (resource_config.py:1-29):
```
TOTAL_BUDGET = 100,000  (per cycle)
MAINTENANCE_BUDGET = 95,000  (baseline, leaving $5K flex)
```

**Cost per unit** (resource_config.py):
- Medical Kits: $3,500/unit
- Vibranium (kg): $4,000/unit
- Clean Water (L): $1,000/unit
- Pym Particles: $4,500/unit
- Arc Reactor Cores: $5,000/unit

**Base Production** (resource_config.py):
- Medical Kits: 8.0 units/cycle
- Vibranium: 3.0 units/cycle
- Clean Water: 10.0 units/cycle
- Pym Particles: 5.0 units/cycle
- Arc Reactor: 4.0 units/cycle

**Budget Allocation Model** (governor.py:37-114):

1. **Baseline Cost**:
   - Medical: 8.0 × $3,500 = $28,000
   - Vibranium: 3.0 × $4,000 = $12,000
   - Clean Water: 10.0 × $1,000 = $10,000
   - Pym Particles: 5.0 × $4,500 = $22,500
   - Arc Reactor: 4.0 × $5,000 = $20,000
   - **Total baseline ≈ $92,500** (fits within $95K maintenance budget)

2. **Critical Handling** (governor.py:70-94):
   - If any sector stock < 30% of target_stock: boost production to min(2×base, max_feasible)
   - Rebalance other sectors downward to stay within TOTAL_BUDGET

3. **Flex Budget** (governor.py:96-103):
   - If no critical sectors: distribute $5,000 flex budget to highest-urgency sector
   - Example: $5K / $1,000/unit = 5 extra Clean Water units

4. **Clamping** (governor.py:105-109):
   - No sector below 80% of base_production (floor protection)

5. **Final Rebalancing** (governor.py:111-155):
   - If allocations exceed $100K total cost, scale down proportionally
   - If still over after clamping to 80% floor, cut from highest-cost resources first

**Budget Semantics**: The $100K is a **production COST cap per cycle**, not a spending budget that "runs out."
- The system allocates (via `optimize_allocations`) production rates that stay ≤ $100K cost
- When a sector is critical, the governor increases its production rate (costs more)
- When no critical sectors, the governor stays at baseline + $5K flex

**Production Rate Commands** (governor.py:356-375):
- Governor sends POST to `{FEED_SERVICE_URL}/control/production` with:
  - `sector_id`, `resource_type`, `units_per_cycle`
- Feed service receives and applies this rate (state.py manages production_rates dict)

---

### 4. Production Rate Override

**Governor Override Endpoint**: `POST /api/v1/governor/override`
**Location**: governor.py:103-112

**Behavior**:
1. Accepts `OverrideRequest` with `sector_id`, `resource_type`, `units_per_cycle`
2. Stores override in `governor_instance._override_allocations` dict (line 106)
3. Overrides are applied in `run_cycle` (line 233-235): merged into active_allocations

**Production Rate Sending**:
- During governor cycle (line 261), calls `_send_production_commands(active_allocations)`
- Makes HTTP POST to `{FEED_SERVICE_URL}/control/production` for each sector
- **Feed service is called directly** (not through backend state; no intermediary)

**Flow**:
```
POST /api/v1/governor/override
  → governor.set_override(sector_id, resource_type, units)
  → stored in _override_allocations

Next run_cycle() (every 30 sec):
  → champion.allocations merged with _override_allocations
  → _send_production_commands() POSTs to feed service
  → Feed service updates its production_rates state
```

---

### 5. Time-to-Zero Calculation (Frontend Hours Remaining)

**Backend Computation** (governor.py:377-474):

The `compute_time_to_zero()` method:
1. Fetches ResourceLog rows for each sector+resource (line 391-405)
2. **Sums only stock decreases** (consumption events, line 425-430):
   ```python
   for i in range(1, len(rows)):
       stock_diff = rows[i - 1].stock_level - rows[i].stock_level
       if stock_diff > 0:
           total_consumed += stock_diff
   ```
3. Computes elapsed time across the window (line 433-435)
4. **Consumption rate = total_consumed / elapsed_hours** (line 438)
5. **Time-to-zero = current_stock / consumption_rate** (line 443)
6. Returns `projection_curve` showing declining stock at that consumption rate (line 457)

**Critical Issue**: This calculation **ignores all production entirely**.
- It only measures the net consumption observed in the data
- If the governor is actively producing units, those production events ADD to stock
- But the time-to-zero only divides by the raw drain rate
- **Result**: The metric shows "hours until depletion if we do nothing" — which is misleading because the governor IS actively producing

**Example**:
- Medical Kits: current_stock = 100, observed consumption_rate = 5 u/h
- Projected hours_to_zero = 100 / 5 = 20 hours
- **But the governor is producing 8.0 u/cycle** (in feed_ingester, cycle = 10 sec = 0.1 min = 0.00278 h)
  - So net rate ≈ 8.0/0.00278 ≈ 2880 u/h production
  - Actual net depletion ≈ 5 - 2880 = -2875 u/h (accumulating!)
- The display shows "20 hours remaining" when actually stock is growing

**Consequence**: The frontend's "X hours remaining" metric (marvel-map.tsx:237-238, dashboard.tsx:74) is **fundamentally broken**. It represents consumption-only depletion, not the actual resource state.

**Workaround Observed** (governor.py:449-454):
```python
if (hours_to_zero is not None
    and hours_to_zero <= 0
    and current_stock > 10):
    hours_to_zero = None
```
This masks false positives ("stock is 100 but hours_to_zero says -5") but only when stock > 10. Stocks below 10 could still trigger false exhaustion alerts.

---

### 6. Resource Configuration

**resource_config.py**:

```python
RESOURCE_CONFIG = {
    ("Avengers Compound", "Medical Kits"): {
        "cost_per_unit": 3500,
        "target_stock": 600,
        "base_production": 8.0,
    },
    ("New Asgard", "Vibranium (kg)"): {
        "cost_per_unit": 4000,
        "target_stock": 450,
        "base_production": 3.0,
    },
    ("Sanctum Sanctorum", "Clean Water (L)"): {
        "cost_per_unit": 1000,
        "target_stock": 700,
        "base_production": 10.0,
    },
    ("Sokovia", "Pym Particles"): {
        "cost_per_unit": 4500,
        "target_stock": 500,
        "base_production": 5.0,
    },
    ("Wakanda", "Arc Reactor Cores"): {
        "cost_per_unit": 5000,
        "target_stock": 500,
        "base_production": 4.0,
    },
}
TOTAL_BUDGET = 100_000  # per cycle
MAINTENANCE_BUDGET = 95_000  # baseline, leaving $5K flex
```

**Target stocks**: The emergency thresholds that trigger critical handling (30% = "critical").

**Initial stocks**: Not stored here; initialized in feed service state.py based on target_stock values.

---

### 7. SSE Broadcast on Feed Push

**Location**: feed.py:93-116

**resource_update Broadcast** (line 99-102):
```json
{
    "events": [events from push],
    "sector_stocks": {
        "sector_id|resource_type": stock_after,
        ...
    }
}
```

**defcon_update Broadcast** (line 110-114):
- Fetches DEFCON from feed service `/feed/defcon` (line 107)
- Broadcasts:
  ```json
  {
      "level": integer (1-5),
      "label": string,
      "color": string
  }
  ```

**Correctness**: Both broadcasts are correct in structure. However:
- `defcon_update` is fetched from feed service (correct source of truth)
- `resource_update` events include the raw event data (correct for frontend display)

---

### 8. Backend Polling Loop

**Location**: main.py:38-91 (commented as `_startup_background` context)

Actually, reviewing main.py, there is **NO explicit polling loop for feed ingestion** in the current code.

**Background Tasks in Lifespan** (main.py:79-86):
1. `_startup_background()` — computes forecasts on startup (line 83)
2. `_governor_loop()` — runs governor cycle every 30 sec (line 84)
3. `_agent_loop()` — runs JARVIS agent every 60 sec (line 85)

**Feed Ingestion**: Relies entirely on `POST /api/v1/feed/push` from feed service.

**However**: feed_ingester.py:18-91 defines a `FeedIngester` class with `poll_and_ingest()` method that is **not called** anywhere in the current codebase. It's **dead code** that should be removed.

---

## Confirmed Bugs

### Bug 1: Hardcoded usage_rate_hourly
- **Files**: feed_ingester.py:70, feed.py:76
- **Severity**: HIGH
- **Fix**: Replace hardcoded 7.0 with actual computed drain rate from event data or feed service status

### Bug 2: Time-to-Zero Ignores Production
- **File**: governor.py:443
- **Severity**: CRITICAL
- **Impact**: Frontend displays misleading depletion times (ignores active governor production)
- **Fix**: Either (a) include net production in calculation, or (b) change metric name to "consumption_only_time_to_zero" and document that it excludes production

### Bug 3: snap_event_detected Hardcoded to False
- **Files**: feed_ingester.py:71, feed.py:77
- **Severity**: MEDIUM
- **Impact**: Snap events from feed service are never recorded; forecast snap detection may miss events
- **Fix**: Pass `snap_event_detected` from event payload instead of hardcoding

### Bug 4: Dead Code — FeedIngester Polling Class
- **File**: feed_ingester.py
- **Severity**: LOW (code smell)
- **Impact**: Confusion about data flow; duplication if accidentally called
- **Fix**: Delete the entire feed_ingester.py file; push-based ingestion is the only active path

---

## Architectural Issues

### Issue A: Dual Ingestion Paths
Although currently only push ingestion is active, having two separate ingestion implementations (polling and push) increases maintenance burden and risk of divergence.

### Issue B: Time-to-Zero Semantic Confusion
The term "time-to-zero" suggests "when will we run out?" but the calculation ignores production. This creates a false urgency signal on the frontend. The metric should either:
1. Include net production (requires fetching current production rates), or
2. Be renamed to "consumption_only_depletion_time" with clear documentation

### Issue C: snap_event_detected Never Set
Snap events are a critical feature (10× consumption multiplier) but are never marked in the database, making them invisible to forecasts and analytics.

---

## Data Flow Summary

```
Feed Service (cycle_loop, every 10 sec)
  ↓ (POST /api/v1/feed/push)
Backend POST /api/v1/feed/push
  ↓
Create ResourceLog rows (with hardcoded usage_rate_hourly=7.0)
  ↓
Recompute Forecast (snap_aware_linear_regression strategy)
  ↓
Broadcast resource_update + defcon_update (SSE)
  ↓
Frontend fetches:
  - /api/v1/forecasts (hours_until_exhaustion from Forecast table)
  - /api/v1/governor/time-to-zero (consumption-only depletion times)
  ↓
Display on Dashboard/Map (merger of Forecast + time-to-zero metrics)

Governor Loop (every 30 sec)
  ↓
Fetch ResourceLog rows for last 20 entries
  ↓
Fit trend models → compute confidence
  ↓
Optimize allocations (respecting $100K budget)
  ↓
POST /control/production to feed service
  ↓
Feed service updates production rates
  ↓
Next cycle: production + drain + random events
  ↓
POST /api/v1/feed/push → loop back
```

---

## Recommendations

1. **Fix Bug 1**: Compute `usage_rate_hourly` from actual drain rates (per resource type + DEFCON multiplier)
2. **Fix Bug 2**: Clarify whether time-to-zero should include production; update calculation and frontend label accordingly
3. **Fix Bug 3**: Extract `snap_event_detected` from event payload or set it based on DEFCON level
4. **Fix Bug 4**: Delete feed_ingester.py (dead code)
5. **Document**: Add a clear specification of what "hours_to_zero" means and how it differs from "hours_until_exhaustion" (Forecast model)

---

## Questions for Team Lead

1. **Usage Rate Expectation**: Should `usage_rate_hourly` in ResourceLog represent base drain, DEFCON-adjusted drain, or net (production - drain)?
2. **Time-to-Zero Semantics**: Should this metric include active production from the governor, or intentionally show "worst case if nothing was produced"?
3. **Snap Event Tracking**: Should snap events be marked in ResourceLog, or is the current DEFCON-level tracking sufficient?
