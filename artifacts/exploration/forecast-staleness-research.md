# Forecast Staleness & Invisibility Research

## Current Forecast Data Flow

```
Feed Service (10s cycle)
    |
    v
POST /api/v1/feed/push  (feed.py:59-127)
    |
    +--> Ingest events to ResourceLog table (feed.py:72-92)
    +--> Recompute forecasts for affected pairs (feed.py:94-100)
    |        |
    |        +--> ForecastService.compute_forecast() (jarvis_forecast.py:23-70)
    |                 Deletes old Forecast rows, writes new one
    |                 with computed_at = now, hours_until_exhaustion = X
    |
    +--> broadcast("resource_update", ...) to SSE (feed.py:102-111)
    |
    +--> broadcast("defcon_update", ...) to SSE (feed.py:113-125)
    |
    [NOTE: NO "forecast_update" SSE event is broadcast]
```

```
Frontend Dashboard (dashboard/page.tsx)
    |
    +--> useSWR('forecasts', fetchForecasts)  (line 170-175)
    |        - revalidateOnFocus: true
    |        - NO refreshInterval
    |        - NO SSE-triggered revalidation
    |
    +--> useSWR('time-to-zero', fetchTimeToZero)  (line 177-182)
    |        - revalidateOnFocus: true
    |        - NO refreshInterval
    |        - SSE 'resource_update' triggers mutateTtz() (line 197)
    |
    +--> ResourceChart component (resource-chart.tsx:96)
              |
              +--> useSWR('time-to-zero-chart', fetchTimeToZero, refreshInterval: 3000)  (line 113-115)
              +--> projectionData built from timeToZero entries (line 176-231)
              +--> Projection lines: dashed lines from current stock toward depletion
              |
              [NOTE: buildForecastLine() is EXPORTED but NEVER CALLED in chart rendering]
              [NOTE: Chart does NOT fetch /api/v1/forecasts at all]
```

## Root Cause Analysis

There are **three distinct issues** causing forecast staleness and invisibility:

### Issue 1 (PRIMARY): `hours_until_exhaustion` is a snapshot, not dynamic

**File**: `src/backend/app/services/jarvis_forecast.py:57-66`
**File**: `src/backend/app/models/forecast.py:20-21`

When a forecast is computed, `hours_until_exhaustion` is calculated relative to the moment of computation and stored as a static float. For example, if computed at 10:00 with `hours_until_exhaustion = 2.5`, at 10:30 it should be 2.0 but still reads 2.5. The `computed_at` timestamp is stored alongside, but no consumer adjusts the value.

**Impact**: The dashboard's "Refresh Forecasts" button fetches the raw `hours_until_exhaustion` from the DB. Over time, this value becomes increasingly wrong because it does not decay as real time passes. The `predicted_exhaustion_date` is an absolute timestamp that stays valid, but `hours_until_exhaustion` — which is the primary value consumed by the time-to-zero display — becomes stale.

However, this is partially mitigated because the **chart projection lines** do NOT use the Forecast table at all. They use the `/governor/time-to-zero` endpoint, which recomputes from live data every call.

### Issue 2 (PRIMARY): Forecasts in dashboard SWR never auto-refresh

**File**: `src/frontend/app/dashboard/page.tsx:170-175`

```typescript
const {
  data: forecastsData,
  mutate: mutateForcasts,
} = useSWR('forecasts', fetchForecasts, {
  revalidateOnFocus: true,
})
```

This SWR call has **no `refreshInterval`**. Forecasts are fetched once on mount and then only when:
1. The user switches browser tabs (revalidateOnFocus)
2. The user clicks "Refresh Forecasts" button (line 260-263)

Compare with the ResourceChart component, which polls `time-to-zero` with `refreshInterval: 3000` (every 3 seconds). The forecast data powering the alert system (`useAlerts(forecasts)` at line 256) becomes stale immediately.

**File**: `src/frontend/app/dashboard/page.tsx:192-216` (SSE handler)

The SSE handler responds to `resource_update` by calling `mutateSummary()` and `mutateTtz()`, but **never calls `mutateForcasts()`**. So even though the backend recomputes forecasts on every push (feed.py:94-100), the frontend never learns about it until the user manually clicks refresh or refocuses the tab.

### Issue 3 (SECONDARY): `buildForecastLine` is dead code

**File**: `src/frontend/components/charts/resource-chart.tsx:68-93`

The `buildForecastLine()` function is exported and tested but **never called** within the `ResourceChart` component. The chart instead uses `projectionData` (lines 176-231), which derives its projection from `timeToZero` (the governor's consumption-based computation), not from the ML forecast.

This means the "ML forecast lines" that were originally designed to appear on the chart (as `forecast_level` data points) are completely absent. The dashed lines visible on the chart are **depletion projections** based on consumption rate, not ML model predictions.

### Issue 4 (SECONDARY): No `forecast_update` SSE event exists

**File**: `src/backend/app/routers/feed.py:94-100`

The backend recomputes forecasts inside `feed_push()` after ingesting new data (line 94-100), but it does not broadcast a `forecast_update` event to SSE. The only events broadcast are `resource_update` (line 108) and `defcon_update` (line 119).

**File**: `src/backend/app/main.py:26-37` (`_startup_background`)

Forecasts are also computed once at startup (line 34), but there is **no periodic background task** that recomputes forecasts. They are only recomputed when:
1. New data is pushed via `/feed/push` (feed.py:94-100)
2. User manually calls `POST /forecasts/refresh` (forecasts.py:70-76)

### Issue 5 (MINOR): Projection line time window is extremely narrow

**File**: `src/frontend/components/charts/resource-chart.tsx:181`

```typescript
const PROJ_HORIZON_MS = 90 * 1000 // 90 seconds visible future
```

Projection lines are capped at 90 seconds into the future. If `hours_to_zero` is large (e.g., 50+ hours), the projected decline over 90 seconds is visually imperceptible (a fraction of a pixel). The line appears but is nearly horizontal and invisible at scale.

**File**: `src/frontend/components/charts/resource-chart.tsx:195`

```typescript
if (!ttz || ttz.hours_to_zero == null || ttz.hours_to_zero > 168) continue
```

Any resource with `hours_to_zero > 168` (7 days) gets no projection line at all.

## Summary of Why Forecasts Disappear

1. **The chart never shows ML forecast lines** -- `buildForecastLine()` is dead code. The chart only shows consumption-based depletion projections from the governor's `time-to-zero` endpoint.

2. **The forecast SWR has no auto-refresh** -- fetched once on mount, never polled, never triggered by SSE. The `forecasts` data used by the alert system goes stale within seconds of simulation start.

3. **No SSE event for forecast updates** -- even though the backend recomputes forecasts on every push, no SSE event notifies the frontend.

4. **Projection lines are nearly invisible when depletion is slow** -- 90-second projection horizon makes gradual declines invisible.

## Recommended Fixes

### Fix 1: Add `refreshInterval` to forecast SWR (frontend, 1 line)

**File**: `src/frontend/app/dashboard/page.tsx:173`

Add `refreshInterval: 10000` (10 seconds) to the forecasts SWR config. This ensures the alert system stays current.

```typescript
useSWR('forecasts', fetchForecasts, {
  revalidateOnFocus: true,
  refreshInterval: 10000,
})
```

### Fix 2: Trigger `mutateForcasts()` on SSE resource_update (frontend, 1 line)

**File**: `src/frontend/app/dashboard/page.tsx:196-198`

Add `mutateForcasts()` to the `resource_update` SSE handler so forecasts refresh when new data arrives:

```typescript
case 'resource_update':
  mutateSummary()
  mutateTtz()
  mutateForcasts()  // <-- add this
  break
```

### Fix 3: Integrate ML forecast lines into the chart (frontend, moderate)

**File**: `src/frontend/components/charts/resource-chart.tsx`

Either:
- (a) Call `buildForecastLine()` with forecast data and render as a separate Line element, OR
- (b) Fetch forecasts inside `ResourceChart` and build a proper ML projection overlay alongside the consumption-based projection

### Fix 4 (Optional): Broadcast `forecast_update` via SSE (backend, 3 lines)

**File**: `src/backend/app/routers/feed.py:99` (after forecast recompute succeeds)

```python
await broadcast("forecast_update", {"pairs": [
    {"sector_id": s, "resource_type": r} for s, r in affected_pairs
]})
```

Then handle this event in the frontend SSE handler to call `mutateForcasts()`.

### Fix 5 (Optional): Adjust `hours_until_exhaustion` on read

**File**: `src/backend/app/routers/forecasts.py:24-47` or frontend

When returning forecasts, subtract `(now - computed_at)` from `hours_until_exhaustion` so the value reflects current reality rather than the moment of computation.

## Priority

| Fix | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Fix 1 | Keeps forecast alerts fresh | 1 line | **P0** |
| Fix 2 | Real-time forecast refresh via SSE | 1 line | **P0** |
| Fix 3 | Shows ML predictions on chart | Medium | **P1** |
| Fix 4 | Clean SSE-driven architecture | 3 lines | **P2** |
| Fix 5 | Accurate hours display | Small | **P2** |
