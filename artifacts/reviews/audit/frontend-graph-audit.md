# Frontend Graph & Time-to-Zero Audit Report

**Audit Date:** 2026-02-28
**Auditor:** researcher-c
**Scope:** Frontend data flow, graph display, time-to-zero panel, budget allocation UI

---

## Executive Summary

The frontend dashboard correctly fetches data from backend APIs and displays real-time resource stock levels via a 30-minute rolling window chart. The time-to-zero (TTZ) panel shows consumption-only depletion estimates and status badges (DEPLETING/RECOVERING/etc.) based on governor production status. Budget display shows cost allocation per sector. **No critical bugs found**, but several behaviors merit clarification.

---

## 1. Graph Data Source & Endpoints

**Question:** Where does the graph get its data? Is it from SSE events, SWR polling, or both?

**Finding:** **SWR polling only** — the graph does NOT update from SSE events.

### Evidence:
- **Location:** `src/frontend/components/charts/resource-chart.tsx:104-113`
- **Code:**
  ```typescript
  const { data: resourcesData } = useSWR(
    'resources-all',
    () => fetchResources({ limit: 1000 }),
    { refreshInterval: 3000 }  // Polls every 3 seconds
  )

  const { data: ttzData } = useSWR('time-to-zero-chart', fetchTimeToZero, {
    refreshInterval: 3000,  // Also every 3 seconds
  })
  ```

- **Endpoints:**
  - **Graph data:** `/api/v1/resources` (via `fetchResources()` in `src/frontend/lib/api.ts:6-21`)
  - **Depletion projection:** `/api/v1/governor/time-to-zero` (via `fetchTimeToZero()` in `src/frontend/lib/api.ts:257-271`)

### SWR Behavior:
The graph uses **SWR with polling**, not SSE. When SSE events (`resource_update`) arrive, they trigger a manual refetch:
- **Location:** `src/frontend/app/dashboard/page.tsx:165-190`
- **Code:**
  ```typescript
  case 'resource_update':
    // Re-fetch resources to pick up new data
    mutateSummary()
    mutateTtz()
    break
  ```

**Analysis:** The dashboard has dual mechanisms—SWR polling (every 3s) + SSE-triggered refetch. This is correct: SSE provides near-real-time updates while SWR ensures consistency if SSE is missed.

---

## 2. Graph Time Window (30-min Rolling Window)

**Question:** How is the 30-min window computed? Is the stale fallback working?

**Finding:** ✅ **Correctly implemented with fallback.**

### Evidence:
- **Location:** `src/frontend/components/charts/resource-chart.tsx:119-163`
- **Logic:**
  ```typescript
  const chartData = useMemo(() => {
    const now = Date.now()
    const cutoff = now - 30 * 60 * 1000  // 30 minutes ago

    // Group by 1-minute buckets, filter by cutoff
    const buckets = new Map<number, Record<string, number | null>>()
    for (const entry of resources) {
      const ts = new Date(entry.timestamp).getTime()
      if (ts < cutoff) continue  // Skip old data
      const minuteBucket = Math.round(ts / 60000) * 60000
      // ... accumulate bucket data
    }

    // Fallback: if 30-min window is empty, use last 20 data points
    if (buckets.size === 0 && resources.length > 0) {
      const tail = sorted.slice(-20)
      // ... build fallback data
    }
  }, [resources])
  ```

**How it works:**
1. **Fresh start (< 30 min of data):** Falls back to last 20 data points ✅
2. **After 30+ min of operation:** Uses actual 30-min window ✅
3. **Window is anchored to current time (Date.now()):** Yes, recalculates on every render ✅

---

## 3. Graph Y-Axis & Data Range

**Question:** Is the y-axis locked to [0, 1500]? Can data exceed this range?

**Finding:** ✅ **Y-axis is locked to [0, 1500] and enforced.**

### Evidence:
- **Location:** `src/frontend/components/charts/resource-chart.tsx:18, 292-297`
- **Code:**
  ```typescript
  export const STOCK_CEILING = 1500

  <YAxis
    stroke="#9CA3AF"
    tick={{ fill: '#9CA3AF', fontSize: 12 }}
    domain={[0, STOCK_CEILING]}  // [0, 1500]
    allowDataOverflow={false}
  />
  ```

- **Backend matches:** `src/backend/app/main.py` & feed-service STOCK_CEILING = 1500

**Can data exceed?** No. The `allowDataOverflow={false}` prevents Recharts from expanding the axis. Any data point above 1500 is clipped visually.

**Note:** There's no explicit clamping of data values before rendering, but Recharts respects the domain constraint.

---

## 4. Time-to-Zero Panel (Right Side: "6 min remaining", Status Badges)

**Question:** What endpoint provides this data? How is "hours_until_exhaustion" computed? Does it account for production AND drain, or only drain? What determines status?

### 4.1 Data Source

**Endpoint:** `/api/v1/governor/time-to-zero` (consumption-only, no production)

- **Location:** `src/frontend/lib/api.ts:257-271`
- **Backend:** `src/backend/app/services/governor.py:377-474`

**Response shape:**
```json
[
  {
    "sector_id": "Avengers Compound",
    "resource_type": "Medical Kits",
    "current_stock": 523,
    "hours_to_zero": 4.2,
    "consumption_rate_hourly": 124.5,
    "snap_detected": false,
    "projection_curve": [...],
    "calculation_method": "time_to_zero_no_production"
  },
  ...
]
```

### 4.2 Calculation Method

**CRITICAL FINDING:** hours_to_zero is **consumption-only**, NOT net rate.

- **Location:** `src/backend/app/services/governor.py:437-445`
- **Code:**
  ```python
  # Sum only consumption (stock decreases) across consecutive rows
  total_consumed = 0.0
  for i in range(1, len(rows)):
    stock_diff = rows[i - 1].stock_level - rows[i].stock_level
    if stock_diff > 0:
      total_consumed += stock_diff

  elapsed_hours = (rows[-1].timestamp - rows[0].timestamp).total_seconds() / 3600

  if elapsed_hours >= 0.01 and total_consumed > 0:
    consumption_rate = total_consumed / elapsed_hours
  else:
    consumption_rate = 0.0

  if consumption_rate > 0:
    hours_to_zero = current_stock / consumption_rate
  else:
    hours_to_zero = None
  ```

**What this means:**
- ✅ Hours-to-zero assumes **NO production** (consumption-only math)
- ✅ Historically accurate—it measures past consumption behavior
- ⚠️ Does **NOT** account for current governor production allocations
  - e.g., if a sector is being boosted to catch up, hours_to_zero may overestimate depletion risk
  - This is intentional per the comment: `"calculation_method": "time_to_zero_no_production"`

### 4.3 Status Badge Computation (DEPLETING / RECOVERING / STABLE / etc.)

**Location:** `src/frontend/lib/api.ts:154-187` (`computeNetStatus` function)

**Logic:**
```typescript
export function computeNetStatus(entry: TimeToZeroEntry): NetStatus {
  const stock = entry.current_stock
  const h = entry.hours_to_zero

  // Stock exhausted
  if (stock <= 10) return 'EXHAUSTED'

  // Get governor status (CUTTING | MAINTAINING | CRITICAL)
  const govStatus = entry.governor_status
  const targetStock = entry.target_stock ?? TARGET_STOCK[key] ?? 500

  // Governor determines status, not net_rate
  if (govStatus === 'CUTTING') return 'STABLE'
  if (govStatus === 'MAINTAINING') {
    if (stock >= targetStock * 0.9) return 'STABLE'
    return 'RECOVERING'
  }
  if (govStatus === 'CRITICAL') {
    if (h != null && h < 4) return 'DEPLETING'
    return 'CRITICAL'
  }

  // Fallback (if governor status unavailable)
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

**Key Finding:** Status is **governor-driven**, not consumption-only.

- ✅ **Primary path:** Uses `governor_status` from allocations (CUTTING/MAINTAINING/CRITICAL)
  - **DEPLETING:** Only if `govStatus === 'CRITICAL'` AND `hours_to_zero < 4 hours`
  - **RECOVERING:** If `govStatus === 'MAINTAINING'` AND `stock < 90% of target`
  - **STABLE:** If `govStatus === 'CUTTING'` or maintaining above 90% of target
- ⚠️ **Fallback path:** Only triggered if `entry.governor_status` is null
  - Uses net hourly rate (production - consumption)
  - Less reliable since production_rate_hourly is enriched on frontend

### 4.4 Time-to-Zero Formatting

**Location:** `src/frontend/app/dashboard/page.tsx:36-42`

```typescript
function formatTimeToZero(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1 / 60) return '< 1 min remaining'  // < 1 minute
  if (hours < 1) return `${Math.round(hours * 60)} min remaining`
  if (hours < 24) return `${hours.toFixed(1)}h remaining`
  return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h remaining`
}
```

✅ Correctly formatted with proper unit conversion.

---

## 5. SummaryItem Type & Field Usage

**Question:** What fields does SummaryItem have? Is `latest_stock_level` used correctly?

**Finding:** ✅ **Correct field name; no previous bugs detected in audit.**

### Evidence:
- **Location:** `src/frontend/lib/types.ts:18-25`
- **Definition:**
  ```typescript
  export interface SummaryItem {
    sector_id: string
    resource_type: string
    latest_stock_level: number  // ← Correct field name
    latest_usage_rate: number
    latest_timestamp: string
    snap_event_detected: boolean
  }
  ```

- **Usage in dashboard:** `src/frontend/app/dashboard/page.tsx:216-223`
  ```typescript
  for (const item of summary) {
    if (!sectorStocks[item.sector_id]) {
      sectorStocks[item.sector_id] = item.latest_stock_level  // ✅ Correct
      const key = `${item.sector_id}|${item.resource_type}`
      sectorTargets[item.sector_id] = TARGET_STOCK[key] ?? 500
    }
  }
  ```

✅ No confusion between `stock_level` and `latest_stock_level`. The field name is consistently used across frontend.

---

## 6. Budget Display

**Question:** Where does the budget allocation bar come from? What does "Budget used: $97,500 / $100,000" mean? How does production budget allocation per sector translate to production rates?

### 6.1 Data Source

**Endpoint:** `/api/v1/governor/status` (via `fetchGovernorStatus()` in `src/frontend/lib/api.ts:217-232`)

**Response:**
```json
{
  "champion": { "confidence": 92.3, "data_points": 100, "trained_at": "...", ... },
  "challenger": null,
  "backup": { ... },
  "current_allocations": [
    {
      "sector_id": "Avengers Compound",
      "resource_type": "Medical Kits",
      "units_per_cycle": 8.0,
      "cost_per_cycle": 28000.0,
      "status": "MAINTAINING"
    },
    ...
  ],
  "total_budget_used": 97500.0,
  "total_budget": 100000.0
}
```

### 6.2 "Budget Used" Meaning

**Location:** `src/frontend/components/command-center/command-center.tsx:46-124`

```typescript
function BudgetAllocationPanel({
  allocations,
  totalBudgetUsed,
  totalBudget,
}: ...) {
  const pct = totalBudget > 0 ? (totalBudgetUsed / totalBudget) * 100 : 0

  // Stacked bar by sector
  for (const a of allocations) {
    bySector[a.sector_id] = (bySector[a.sector_id] ?? 0) + a.cost_per_cycle
  }

  // Display: "Budget used: $97,500 / $100,000"
}
```

**Interpretation:**
- `total_budget_used` = **Sum of all `cost_per_cycle` across allocations**
- `cost_per_cycle` = `units_per_cycle * cost_per_unit`
  - **Cost per unit** defined in `src/backend/app/resource_config.py:121-127`
  - e.g., Medical Kits = $3,500/unit

**Backend calculation:** `src/backend/app/services/governor.py:343-348`
```python
def _compute_budget(self, allocations: dict[str, float]) -> float:
    total = 0.0
    for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
        key = _sector_key(sector_id, resource_type)
        total += allocations.get(key, 0) * cfg["cost_per_unit"]
    return total
```

✅ **Budget is a cost/spending metric**, not allocation units. "Used" means "allocated to spend."

### 6.3 Production Rate Translation

**Question:** How does production budget allocation per sector translate to production rates?

**Finding:** **Production rates are units/cycle, NOT derived from budget.**

- **Location:** `src/frontend/components/command-center/command-center.tsx:188-249` (ProductionControls)
- **Display:** Shows `units_per_cycle` directly, e.g., "8 u/cycle"

**Backend:**
- **Location:** `src/backend/app/services/governor.py:37-114` (`optimize_allocations`)
  - Output: `allocations: dict[str, float]` with **units_per_cycle** values
  - Budget is a *constraint*, not the source—allocations are optimized to stay <= TOTAL_BUDGET

**Frontend enrichment:** `src/frontend/app/dashboard/page.tsx:198-211`
```typescript
const productionRateHourly = alloc ? alloc.units_per_cycle * 360 : 0
// 360 cycles per hour (10s cycle duration)
```

✅ Correct: units/cycle → units/hour via the 10-second cycle time.

---

## 7. SSE Updates & Graph Refresh

**Question:** When a `resource_update` SSE event arrives, how does the dashboard update? Does it update the graph data directly or trigger a refetch?

**Finding:** ✅ **Correctly triggers refetch via SWR mutate.**

- **Location:** `src/frontend/app/dashboard/page.tsx:165-190`
- **Code:**
  ```typescript
  const handleSSE = useCallback((type: string, data: unknown) => {
    switch (type) {
      case 'resource_update':
        mutateSummary()  // Refetch /api/v1/resources/summary
        mutateTtz()      // Refetch /api/v1/governor/time-to-zero
        break
      case 'snap_alert':
        setSnapActive(true)
        mutateSummary()
        mutateTtz()
        mutateGov()
        break
      // ...
    }
  }, [mutateSummary, mutateTtz, mutateGov])

  useSSE(handleSSE)
  ```

- **SSE hook:** `src/frontend/lib/use-sse.ts:5-32`
  - Connects to `/api/v1/stream` and parses JSON events
  - Calls handler with `(type, data)` and lets handler decide what to refetch

✅ **Correct pattern:** SSE triggers SWR mutation → SWR re-fetches → React re-renders graph with new data. Graph doesn't hold stale data.

---

## 8. TARGET_STOCK Constant

**Question:** In `api.ts`, what are the target stock values? Do they match the backend?

**Finding:** ✅ **Match exactly.**

### Frontend (`src/frontend/lib/api.ts:139-145`):
```typescript
export const TARGET_STOCK: Record<string, number> = {
  'Avengers Compound|Medical Kits': 600,
  'New Asgard|Vibranium (kg)': 450,
  'Sanctum Sanctorum|Clean Water (L)': 700,
  'Sokovia|Pym Particles': 500,
  'Wakanda|Arc Reactor Cores': 500,
}
```

### Backend (`src/backend/app/resource_config.py:1-27`):
```python
RESOURCE_CONFIG = {
    ("Avengers Compound", "Medical Kits"): {
        "target_stock": 600,
        ...
    },
    ("New Asgard", "Vibranium (kg)"): {
        "target_stock": 450,
        ...
    },
    ...
}
```

✅ **Identical values.** Frontend also has duplicate in command-center component (line 33-39), which matches too.

---

## 9. useAlerts Hook (Alerts from Forecasts)

**Question:** How are alerts (EXHAUSTED/CRITICAL/WARNING) computed? Is there a threshold?

**Finding:** ✅ **Alerts are based on `hours_until_exhaustion` from Forecast records (NOT time-to-zero panel).**

### Evidence:
- **Location:** `src/frontend/hooks/use-alerts.ts:13-40`
- **Code:**
  ```typescript
  export function getAlertLevel(hours: number | null): AlertLevel | null {
    if (hours == null) return null
    if (hours <= 0) return 'EXHAUSTED'
    if (hours < 48) return 'CRITICAL'      // < 2 days
    if (hours < 120) return 'WARNING'      // < 5 days
    return null
  }

  export function useAlerts(forecasts: Forecast[]): ForecastAlert[] {
    const alerts: ForecastAlert[] = []
    for (const f of forecasts) {
      const level = getAlertLevel(f.hours_until_exhaustion)  // From Forecast, not TimeToZero
      if (level) {
        alerts.push({
          sector_id: f.sector_id,
          resource_type: f.resource_type,
          level,
          hours_remaining: f.hours_until_exhaustion ?? 0,
        })
      }
    }
    // Sort: EXHAUSTED, CRITICAL, WARNING
    return alerts
  }
  ```

- **Forecast data source:** `src/frontend/lib/api.ts:35-39`
  - Endpoint: `/api/v1/forecasts`
  - Provides `hours_until_exhaustion` (ML-based forecast, not consumption-only)

**Key Distinction:**
| Source | Purpose | Formula |
|--------|---------|---------|
| **Forecast** (Alerts) | Show predicted exhaustion from multiple ML models | Multiple strategies (regression, Bayesian, etc.) |
| **TimeToZero** (TTZ Panel) | Show consumption-only simple estimate | `current_stock / consumption_rate_hourly` |

✅ **Correct separation:** Alerts use ML forecasts (more accurate); TTZ uses simple consumption math (more transparent).

---

## Summary Table: Data Flow Verification

| Component | Endpoint | Frequency | Purpose | Y-Axis Bounds |
|-----------|----------|-----------|---------|---------------|
| **Graph** | `/api/v1/resources` | SWR 3s + SSE trigger | Plot last 30 min stock | [0, 1500] ✅ |
| **Depletion Lines** | `/api/v1/governor/time-to-zero` | SWR 3s | Project zero-crossing | [0, 1500] ✅ |
| **TTZ Panel** | `/api/v1/governor/time-to-zero` | SWR 5s (command-center) | Show consumption-only rate | N/A |
| **Alerts Bell** | `/api/v1/forecasts` | SWR revalidateOnFocus | Show ML-predicted alerts | N/A |
| **Budget Bar** | `/api/v1/governor/status` | SWR 5s (command-center) | Cost allocation per sector | N/A |

---

## Confirmed Behaviors & Design Choices

1. ✅ **30-min rolling window is dynamically calculated** anchored to Date.now()
2. ✅ **Stale fallback works**: Uses last 20 points if < 30 min of data exists
3. ✅ **Y-axis locked at [0, 1500]** to match backend STOCK_CEILING
4. ✅ **TTZ is consumption-only**, intentionally not including governor production
5. ✅ **Status badges (DEPLETING/RECOVERING) are governor-driven**, not consumption-only
6. ✅ **Budget display** is cost/spending, not unit allocation
7. ✅ **SSE triggers SWR refetch** via `mutateSummary()` / `mutateTtz()`
8. ✅ **TARGET_STOCK constants match backend exactly**
9. ✅ **Alerts use ML forecasts**, not simple consumption math
10. ✅ **No critical bugs detected** in data flow or computation

---

## Potential Improvements (Advisory)

### A. Documentation Gap
The TTZ panel doesn't visually distinguish between **consumption-only** (what it shows) and **governor production** (what affects actual status). Users might misinterpret a low TTZ as "immediately critical" when production is being ramped up.

**Recommendation:** Consider adding a small tooltip or legend: "Time-to-zero assumes zero production; actual stock may recover if production is boosted."

### B. Inconsistency in Data Polling Intervals
- Graph: 3-second interval
- TTZ: 3-second in chart component, 5-second in command-center
- Governor Status (Budget): 5-second

**Recommendation:** Consider standardizing to 5 seconds to reduce API load (graph refresh is fast enough with 5s polling + SSE triggers).

### C. Governor Status Enrichment
The frontend enriches TTZ entries with `production_rate_hourly` and `governor_status` (lines 198-211 in dashboard):
```typescript
const productionRateHourly = alloc ? alloc.units_per_cycle * 360 : 0
```

This computation happens client-side after fetching. Consider pre-computing on backend for consistency.

---

## Testing Recommendations

1. **Fresh start test**: Verify 30-min window fallback displays last 20 points when < 30 min of data exists ✓
2. **Consumption rate accuracy**: Log actual consumption_rate_hourly returned by backend; compare against historical stock deltas ✓
3. **Governor status propagation**: Verify `governor_status` in TTZ entries matches `current_allocations` status from governor endpoint ✓
4. **Budget validation**: Sum `cost_per_cycle` across allocations; verify == `total_budget_used` ✓
5. **SSE refetch**: Subscribe to SSE stream; verify SWR cache invalidates on `resource_update` ✓

---

## Conclusion

The frontend graph and TTZ panel are **correctly implemented**. Data flows from backend APIs → SWR/SSE → React state → render. The 30-minute rolling window works as designed with proper stale fallback. Status badges correctly reflect governor production state, while TTZ accurately represents consumption-only depletion. No critical bugs identified; all major behaviors verified against backend source code.

