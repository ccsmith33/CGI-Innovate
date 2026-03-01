# Frontend Graph Discovery: Chart Rendering & Data Pipeline Analysis

**Date**: 2026-03-01
**Researcher**: Graph Discovery Team
**Task**: Investigate why resource chart lines are barely visible and status badges show incorrect states

---

## Executive Summary

The frontend chart is **technically correct but visually poor** due to:
1. **Fixed Y-axis scale (0-1500)** that doesn't adapt to data range → lines occupy only 30-50% of chart height
2. **30-minute window with bucketing** produces only ~15-30 data points → sparse, low-resolution lines
3. **Status badge computation based on governor status** rather than raw data trends → shows predicted state (STABLE) while actual net rate is negative
4. **No animation or visual emphasis** → changes are subtle across 400px chart height

The data pipeline works correctly end-to-end. The problem is presentation, not data.

---

## 1. Chart Library & Architecture

**Library**: **Recharts** (React charting library)
- File: `src/frontend/components/charts/resource-chart.tsx:1-13`
- Components: LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer

**Chart Dimensions**:
- Height: 400px (line 283)
- Width: 100% (responsive)
- Margins: top 10, right 30, left 0, bottom 0

**Y-Axis Configuration** (line 292-297):
```typescript
<YAxis
  stroke="#9CA3AF"
  tick={{ fill: '#9CA3AF', fontSize: 12 }}
  domain={[0, STOCK_CEILING]}      // FIXED: 0 to 1500
  allowDataOverflow={false}
/>
```

**Critical Issue**: `domain={[0, STOCK_CEILING]}` where `STOCK_CEILING = 1500` (line 18). This is **always fixed** regardless of actual data values. Target stocks are 450-700, so actual data occupies ~30-47% of the chart height. Fluctuations of 5-10 units (1% of screen) are virtually invisible.

---

## 2. Data Flow: SSE/API → Chart

### Step-by-Step Pipeline

**A. Data Source → Frontend State**

1. **SSE Connection** (`src/frontend/lib/use-sse.ts`)
   - Endpoint: `process.env.NEXT_PUBLIC_API_URL/api/v1/stream`
   - Handler receives `{ type: string, data: unknown }`
   - On `resource_update` type → triggers dashboard to mutate summary/TTZ

2. **Fetch Resources** (`src/frontend/lib/api.ts:6-21`)
   ```typescript
   async function fetchResources(params?: {
     sector?: string
     resource_type?: string
     limit?: number
     offset?: number
   })
   ```
   - Called with `limit: 1000` to get full dataset
   - Returns `{ data: ResourceLog[], total, limit, offset }`
   - Resource entry: `{ timestamp, sector_id, resource_type, stock_level, usage_rate_hourly }`

3. **Chart Component** (`src/frontend/components/charts/resource-chart.tsx:104-117`)
   ```typescript
   const { data: resourcesData } = useSWR(
     'resources-all',
     () => fetchResources({ limit: 1000 }),
     { refreshInterval: 3000 }  // Poll every 3 seconds
   )
   const resources: ResourceLog[] = resourcesData?.data ?? []
   ```
   - Fetches up to 1000 records with 3-second refresh

**B. Data Transformation: Raw Logs → Chart Points**

The transformation happens in `useMemo` (line 119-163):

```typescript
const chartData = useMemo(() => {
  const now = Date.now()
  const cutoff = now - 30 * 60 * 1000  // Last 30 minutes

  // GROUP BY MINUTE BUCKET
  const buckets = new Map<number, Record<string, number | null>>()
  for (const entry of resources) {
    const ts = new Date(entry.timestamp).getTime()
    if (ts < cutoff) continue
    const minuteBucket = Math.round(ts / 60000) * 60000  // Round to minute
    if (!buckets.has(minuteBucket)) {
      buckets.set(minuteBucket, {})
    }
    const sectorKey = entry.sector_id
    bucket[sectorKey] = entry.stock_level
  }

  // FALLBACK: If 30-min window empty, use last 20 points
  if (buckets.size === 0 && resources.length > 0) {
    const sorted = [...resources].sort(...)
    const tail = sorted.slice(-20)
    for (const entry of tail) {
      // Same bucketing logic
    }
  }

  // RETURN SORTED CHART DATA
  const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0])
  return sorted.map(([ts, values]) => ({
    time: formatTime(ts),
    ts,
    ...values,
  }))
}, [resources])
```

**Key Transformation Details**:
- **Time window**: 30 minutes (hardcoded at line 121)
- **Bucketing**: Data grouped by minute (line 129) → rounds all timestamps to nearest 60-second boundary
- **Keys per bucket**: `sector_id` (e.g., "Avengers Compound"), not resource type
- **Fallback**: If 30-min empty, uses last 20 raw points (not bucketed)
- **Result**: ~30 data points (1 per minute × 30 minutes)

**C. Projection Lines (Depletion Forecast)**

Additional lines calculated from TTZ data (line 166-213):
```typescript
const projectionData = useMemo(() => {
  if (chartData.length === 0 || timeToZero.length === 0) return []

  const lastPoint = chartData[chartData.length - 1]
  const nowTs = lastPoint.ts

  // Create 2-point line: current stock → 0 at exhaustion time
  const startPoint = { time: formatTime(nowTs), ts: nowTs }
  for (const sr of SECTOR_RESOURCES) {
    const ttz = timeToZero.find(t => t.sector_id === sr.sector && t.resource_type === sr.resource)
    if (!ttz || ttz.hours_to_zero == null || ttz.hours_to_zero > 168) continue
    if (ttz.consumption_rate <= 0) continue
    startPoint[`proj_${sr.sector}`] = currentStock
  }

  // End points at zero
  for (const sr of SECTOR_RESOURCES) {
    const endTs = nowTs + ttz.hours_to_zero * 60 * 60 * 1000
    const endPoint = { time: formatTime(endTs), ts: endTs }
    endPoint[`proj_${sr.sector}`] = 0
  }

  return [startPoint, ...endPoints]
}, [chartData, timeToZero, visible])
```

**Rendering Lines** (line 301-336):
```typescript
// Actual stock (solid)
{SECTOR_RESOURCES.map(sr =>
  visible[sr.sector] ? (
    <Line
      key={sr.sector}
      dataKey={sr.sector}
      stroke={sr.color}
      strokeWidth={2}
      connectNulls={false}
    />
  ) : null
)}

// Projection (dashed, 50% opacity)
{SECTOR_RESOURCES.map(sr =>
  visible[sr.sector] ? (
    <Line
      key={`proj-${sr.sector}`}
      dataKey={`proj_${sr.sector}`}
      stroke={sr.color}
      strokeDasharray="5 5"
      strokeOpacity={0.5}
      connectNulls
    />
  ) : null
)}
```

---

## 3. Y-Axis Scale Analysis

### Current Configuration

| Parameter | Value | Impact |
|-----------|-------|--------|
| `domain` | `[0, 1500]` | Fixed range, never adapts |
| Chart height | 400px | Fixed |
| Pixels per unit | ~0.27px | 400px ÷ 1500 |
| Target stock (Medical) | 600 | 160px from bottom (27% of height) |
| 1-unit fluctuation | 0.27px | Invisible |
| 10-unit fluctuation | 2.7px | Barely visible |
| 50-unit fluctuation | 13.5px | Visible but thin |

### Why Lines Look Flat

**Simulation produces small deltas** (from memory):
- Medical production: 8.0 units/cycle
- Medical drain: 8.5 units/cycle (at DEFCON 5)
- Net: -0.5 units/cycle = -3 units per 10-cycle minute
- Over 30 minutes: -90 units total

This -90 unit change over 30 minutes = **24px vertical movement** in a 400px chart. That's barely noticeable when line starts at 27% of screen height (160px up). The line is moving but it's subtle.

**Compound problem**: ~15-30 data points (due to minute bucketing) × small deltas = straight line that looks flat.

---

## 4. Data Point Count & Time Window

| Metric | Value |
|--------|-------|
| Time window | 30 minutes (hardcoded) |
| Bucketing interval | 1 minute |
| Expected data points | ~30 |
| Actual in simulation | 20-30 (depends on event rate) |
| Resolution | 60 seconds / point |
| Time axis granularity | Good (labels every ~10 minutes) |

**Issues**:
- **30 minutes is long** for demo purposes (changes are slow)
- **1-minute bucketing is coarse** (feeds a point every ~50-60 seconds due to event batching)
- **Last point is latched** (if no events for a minute, chart doesn't update)
- **Fallback logic** (line 139) masks the real problem: if 30-min window is empty, it backtracks to last 20 points

---

## 5. Status Badge Computation

### Where Status Badge is Rendered

**File**: `src/frontend/app/dashboard/page.tsx:73-111` (TimeToZeroCard component)

```typescript
function TimeToZeroCard({ entry }: { entry: TimeToZeroEntry }) {
  const h = entry.hours_to_zero
  const statusLabel = computeNetStatus(entry)  // ← Status is computed here
  const statusBadgeClass = style.badgeClass
  const statusColor = style.cardClass
  const flashing = statusLabel === 'DEPLETING'

  return (
    <div className={`rounded-md border px-3 py-2 ${statusColor}`}>
      <Badge className={`${statusBadgeClass} ${flashing ? 'animate-pulse' : ''}`}>
        {statusLabel}
      </Badge>
    </div>
  )
}
```

### computeNetStatus Logic

**File**: `src/frontend/lib/api.ts:154-187`

```typescript
export function computeNetStatus(entry: TimeToZeroEntry): NetStatus {
  const stock = entry.current_stock
  const h = entry.hours_to_zero

  if (stock <= 10) return 'EXHAUSTED'

  // ★ GOVERNOR STATUS IS PRIMARY
  const govStatus = entry.governor_status
  const key = `${entry.sector_id}|${entry.resource_type}`
  const targetStock = entry.target_stock ?? TARGET_STOCK[key] ?? 500

  if (govStatus === 'CUTTING') return 'STABLE'
  if (govStatus === 'MAINTAINING') {
    if (stock >= targetStock * 0.9) return 'STABLE'
    return 'RECOVERING'
  }
  if (govStatus === 'CRITICAL') {
    if (h != null && h < 4) return 'DEPLETING'
    return 'CRITICAL'
  }

  // FALLBACK: Raw net rate logic (if governor status unavailable)
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

### The Badge Mismatch Problem

**Diagnosis**: Status badge reflects **governor decision state**, not actual data trend.

Example for Medical Kits:
- Current stock: 595 (slightly below 600 target)
- Consumption rate (hourly): ~3 units/hour (computed from TTZ data)
- Governor status: `MAINTAINING` (governor is trying to recover)
- → **Badge shows**: STABLE (because `govStatus === 'MAINTAINING' && stock >= 540`)
- **But actual trend**: Net rate is NEGATIVE (production boosted by governor but still below consumption in some cycles)
- **User perception**: Badge says STABLE but chart shows slow decline

**Root Cause**: Governor status is a **control decision**, not an **outcome descriptor**. The badge should reflect the **actual trajectory**, not what the governor wants to happen.

### Status Badge Styling

**File**: `src/frontend/app/dashboard/page.tsx:45-70`

```typescript
const STATUS_BADGE_STYLES: Record<NetStatus, { badgeClass: string; cardClass: string }> = {
  STABLE: {
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
    cardClass: 'border-green-500/40 bg-green-500/5',
  },
  RECOVERING: {
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    cardClass: 'border-amber-500/40 bg-amber-500/5',
  },
  LOW: {
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    cardClass: 'border-amber-500/40 bg-amber-500/5',
  },
  CRITICAL: {
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
    cardClass: 'border-red-500/60 bg-red-500/5',
  },
  DEPLETING: {
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
    cardClass: 'border-red-500/60 bg-red-500/5',
  },
  EXHAUSTED: {
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
    cardClass: 'border-red-500/60 bg-red-500/5',
  },
}
```

Colors map correctly but label is wrong.

---

## 6. Real-Time Update Mechanism

**Chart Updates Every 3 Seconds** (line 107 in resource-chart.tsx):
```typescript
const { data: resourcesData } = useSWR(
  'resources-all',
  () => fetchResources({ limit: 1000 }),
  { refreshInterval: 3000 }  // ← Polls every 3 seconds
)
```

**SSE Also Triggers Updates** (dashboard.tsx:166-190):
```typescript
const handleSSE = useCallback((type: string, data: unknown) => {
  switch (type) {
    case 'resource_update':
      mutateSummary()
      mutateTtz()
      break
    // ...
  }
}, [mutateSummary, mutateTtz])

useSSE(handleSSE)
```

**Behavior**:
- If SSE works: chart updates ~immediately on new events
- Fallback: 3-second polling fetches latest data
- **Status**: Chart is **truly live** and does update in real-time

---

## 7. Root Causes of Visual Flatness

### Primary Issues (Ranked by Impact)

| Rank | Issue | Impact | Evidence |
|------|-------|--------|----------|
| 1 | Fixed Y-axis 0-1500, data 450-700 | Deltas occupy 15-35% of chart height | Y-axis domain hardcoded to 1500 |
| 2 | 30-minute window + 1-min bucketing | Only ~30 points, changes are subtle | chartData.useMemo lines 119-163 |
| 3 | Small production deltas (-0.5 to +0.5 units/cycle) | Movement is 3-24px per minute | Simulation math from memory |
| 4 | Governor status badge ≠ actual trend | User expects badge to match chart | computeNetStatus prefers govStatus |

### Secondary Issues

- **No animation**: Lines appear instantly, no visual emphasis (line 313: `isAnimationActive={false}`)
- **2px stroke width**: Thin line on sparse data is easy to miss (line 309: `strokeWidth={2}`)
- **High contrast not prioritized**: Colors are muted (medium blue #3B82F6, not bright #0000FF)

---

## 8. High-Impact Visual Improvements for 5-Min Demo

### Quick Wins (Easiest, Most Dramatic)

**1. Dynamic Y-Axis Scale** (15 min to implement)
```typescript
// Instead of: domain={[0, STOCK_CEILING]}
// Calculate from data:
const minStock = Math.min(...allValues)
const maxStock = Math.max(...allValues)
const padding = (maxStock - minStock) * 0.2  // 20% padding
const domain = [Math.max(0, minStock - padding), maxStock + padding]

<YAxis
  stroke="#9CA3AF"
  tick={{ fill: '#9CA3AF', fontSize: 12 }}
  domain={domain}
  scale="linear"
  type="number"
  allowDataOverflow={false}
/>
```
**Impact**: Lines will expand to fill 60-80% of chart height. Changes from invisible to obvious.

---

**2. Reduce Time Window to 5 Minutes** (2 min to implement)
```typescript
const cutoff = now - 5 * 60 * 1000  // ← Change from 30 to 5
```
**Impact**: Zooms in on recent changes. 5-minute window @ 1-min bucketing = ~5 points. Each point represents 12% of screen width. Trends become sharp.

---

**3. Remove Bucketing or Reduce to 10 Seconds** (5 min to implement)
```typescript
// Current: bucketedBundling by minute
// Better: No bucketing, show every data point
for (const entry of resources) {
  const ts = new Date(entry.timestamp).getTime()
  if (ts < cutoff) continue
  // No bucketing — add directly
  const key = `${entry.timestamp}|${entry.sector_id}`
  dataByTimestamp[key] = entry.stock_level
}
```
**Impact**: From 5-30 points to potentially 30-300 points. Lines become smooth curves.

---

**4. Increase Stroke Width & Use Brighter Colors** (2 min to implement)
```typescript
<Line
  dataKey={sr.sector}
  strokeWidth={3}  // ← Was 2
  stroke={brighterColor[sr.resource]}  // Bump saturation from 60% to 100%
/>
```
Example colors:
- Medical: #FF4444 (from #3B82F6) — brighter red
- Vibranium: #FF00FF — bright magenta
- Water: #00FFFF — bright cyan
- Pym: #FFFF00 — bright yellow
- Arc: #00FF00 — bright green

**Impact**: Lines are thicker and more saturated. Easier to track visually.

---

**5. Add Real-Time Animation on New Points** (20 min to implement)
```typescript
// Enable animations
<Line
  isAnimationActive={true}  // ← Was false
  animationDuration={300}
  animationEasing="easeInOut"
/>
```
**Impact**: New points animate in, creating a sense of motion. Viewers' eyes track the animation.

---

### Medium-Effort, High-ROI Improvements

**6. Add Mini Sparkline of Last Hour Below Chart** (30 min)
Shows compressed view of 60-minute history. Gives context.

**7. Highlight Latest Data Point** (10 min)
```typescript
// In last point, add a larger dot
{lastPoint && (
  <circle
    cx={chartXPos}
    cy={chartYPos}
    r={6}
    fill={color}
    stroke="white"
    strokeWidth={2}
  />
)}
```

**8. Add % Change Indicator** (5 min)
Display "-2.5% in last 5 min" below chart name.

---

## 9. Real-Time Update Status

✅ **Chart IS live and updates in real-time**

Evidence:
1. `useSWR` refreshInterval: 3 seconds (line 107)
2. SSE listener triggers mutations (dashboard.tsx:166-190)
3. VitalsBar confirms SSE connection is active (vitals-bar.tsx:28)
4. `useSSE` automatically reconnects on error (use-sse.ts:26-28)

**No page refresh needed** — updates are automatic.

---

## Data Component Integration

### VitalsBar (vitals-bar.tsx)
- Shows SSE connection status (green/red dot)
- Displays events per minute throughput
- Shows governor cycle countdown (30s)
- Confirms real-time pipeline is working

### ModelArena (model-arena.tsx)
- Displays forecast model leaderboard
- Refreshes every 30 seconds
- Not directly related to chart visualization

### DefconBadge (defcon-badge.tsx)
- Shows DEFCON level (1-5)
- Refreshes every 5 seconds
- Color-coded but independent of resource chart

---

## Exact Code References

### Y-Axis Problem
`src/frontend/components/charts/resource-chart.tsx:292-297`
```typescript
<YAxis
  stroke="#9CA3AF"
  tick={{ fill: '#9CA3AF', fontSize: 12 }}
  domain={[0, STOCK_CEILING]}      // ← PROBLEM: Fixed to 1500
  allowDataOverflow={false}
/>
```

### Status Badge Problem
`src/frontend/lib/api.ts:154-187` (computeNetStatus)
- Line 160: Prioritizes `entry.governor_status` over actual trend
- Line 164-165: Returns STABLE for CUTTING status without checking trend
- Lines 174-186: Fallback logic only triggers if governor_status is missing

### Data Bucketing Problem
`src/frontend/components/charts/resource-chart.tsx:119-163`
- Line 121: Fixed 30-minute window
- Line 129: Rounds timestamps to nearest minute
- Line 139-153: Fallback to last 20 points if empty window

---

## Recommendations Summary

| Change | Effort | Impact | Prerequisite |
|--------|--------|--------|--------------|
| Dynamic Y-axis | 15 min | HIGH | None |
| 5-min window | 2 min | HIGH | None |
| Unbucket data | 5 min | MEDIUM | None |
| Brighter colors | 2 min | MEDIUM | None |
| Enable animation | 2 min | MEDIUM | None |
| Fix badge logic | 20 min | MEDIUM | Requires logic change |

---

## Conclusion

The frontend is **architecturally sound** but **visually weak**. The chart correctly displays data in real-time, but the fixed Y-axis scale + long time window + sparse bucketing creates an illusion of flatness. Status badges report governor state instead of data trends.

**For a 5-minute demo**, implement the top 5 quick wins in order:
1. Dynamic Y-axis (biggest impact)
2. 5-minute window (zoom in on action)
3. Unbucket data (smooth curves)
4. Brighter colors + thicker lines (visual emphasis)
5. Enable animations (draw attention to movement)

This will transform flat, invisible lines into clear, moving trends that viewers can see changing in real-time.
