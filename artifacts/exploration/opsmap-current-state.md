# Current Ops Map Page Analysis

**Date**: 2026-03-01
**Component**: `src/frontend/app/map/page.tsx` + `src/frontend/components/map/marvel-map.tsx`
**Status**: Fully documented

---

## 1. What Does the Current Ops Map Page Show?

The Ops Map is a **tactical overview of all 5 operational sectors** displayed in an SVG-based 2D hexagonal network map. Every element is interactive and real-time.

### Page Structure (`src/frontend/app/map/page.tsx`)

- **Data Fetching** (5-second refresh):
  - `fetchForecasts()` → array of 5 Forecast objects (one per sector|resource pair)
  - `fetchSummary()` → array of 5 SummaryItem objects (latest stock + usage rates)
  - `fetchTimeToZero()` → array of 5 TimeToZeroEntry objects (hours until exhaustion + current stock)
  - `fetchGovernorStatus()` → current allocations and confidence levels

- **Data Enrichment**: TTZ entries are enriched with:
  - `production_rate_hourly` (derived from governor allocations: `units_per_cycle × 1200`)
  - `target_stock` (from resource config)
  - `governor_status` (CUTTING | MAINTAINING | CRITICAL)

- **Layout**: Minimal wrapper — just `<MarvelMap>` component inside a `p-6` padded container

### Every Element on the Map

The map is a **fixed 800×500 SVG** showing:

1. **Title Area** (above map):
   - "Global Operations Theater" (bold, uppercase, centered)
   - Live badge with green pulsing dot + "LIVE" label
   - Subtitle: "Sentinel Tactical Overview"

2. **Background**:
   - Dark background (`#0a0a0f`)
   - Subtle hexagonal grid pattern overlaid (opacity 0.08)

3. **Connection Lines** (between all sector pairs):
   - Dashed gray lines connecting all 5 sectors
   - Very subtle (opacity 0.3, stroke 0.5px)
   - Implies network topology but not emphasized

4. **5 Sector Nodes** (hexagonal markers):
   - **Avengers Compound** (Medical Kits) — Shield icon, position (400, 250)
   - **Wakanda** (Arc Reactor Cores) — CPU icon, position (150, 150)
   - **New Asgard** (Vibranium) — Zap icon, position (650, 120)
   - **Sanctum Sanctorum** (Clean Water) — Eye icon, position (200, 380)
   - **Sokovia** (Pym Particles) — Activity icon, position (600, 370)

5. **Per-Sector Information**:
   - **Icon**: Lucide React icon (5 different icons for visual distinction)
   - **Sector name**: Text label below icon
   - **Resource type**: Smaller gray text below name
   - **Mini progress bar**: 60px wide, 4px tall, filled based on stock percentage
   - **Status text**: Hours remaining (e.g., "48h remaining") or EXHAUSTED
   - **Hex ring colors**: Based on NetStatus (see Status Colors below)
   - **Pulsing outer ring**: Only shows if status is DEPLETING, CRITICAL, or EXHAUSTED

6. **Tooltip** (on hover):
   - Appears above the sector being hovered
   - Shows: Sector name, resource type, stock level, usage rate, hours remaining, confidence
   - Positioned relative to SVG viewport coordinates

---

## 2. What Data Does MarvelMap Receive and How Are Sectors Displayed?

### Input Props (from `map/page.tsx`)

```typescript
interface MarvelMapProps {
  forecasts: Forecast[]          // 5 items: exhaustion predictions
  summary: SummaryItem[]         // 5 items: latest stocks + usage rates
  timeToZero?: TimeToZeroEntry[] // 5 items: hours until depletion + consumption
}
```

### Sector Rendering Pipeline

1. **Static Sector Config** (`SECTORS` constant):
   - 5 hardcoded sector definitions with x/y positions, icons, names, resources
   - **NOT loaded dynamically** — always the same 5 sectors

2. **Data Lookup Per Sector**:
   ```typescript
   getForecast(sectorName, resourceType) → Forecast | undefined
   getSummary(sectorName, resourceType) → SummaryItem | undefined
   getTTZ(sectorName, resourceType) → TimeToZeroEntry | undefined
   ```
   - Uses `find()` to match on `sector_id` and `resource_type`
   - Returns undefined if data missing (gracefully degrades)

3. **Status Computation**:
   ```typescript
   status = computeNetStatus(ttzEntry)
   ```
   - Uses `production_rate_hourly - consumption_rate` from API enrichment
   - Returns: STABLE | RECOVERING | DEPLETING | CRITICAL | EXHAUSTED | LOW
   - **Note**: Function is in `api.ts`, imported and reused

4. **Visual Rendering**:
   - **Color lookup**: `STATUS_COLORS[status]` → hex color (#22C55E for STABLE, #EF4444 for CRITICAL, etc.)
   - **Stock percentage**: Calculated as `(current_stock / estimated_initial) × 100`
     - **Uses hardcoded estimates**, not actual target stock:
       ```typescript
       'Medical Kits': 500, 'Vibranium (kg)': 300, 'Clean Water (L)': 10000, ...
       ```
     - These are DIFFERENT from actual target stocks in resource config
     - **BUG**: Icon label says "Medical Kits" but chart estimates 500 vs actual target 600

   - **Hours remaining text**:
     - If `hours_to_zero > 0`: `"${Math.round(ttzEntry.hours_to_zero)}h remaining"`
     - If exhausted: `"EXHAUSTED"`
     - Otherwise: status name

5. **Interactivity**:
   - Click sector → navigate to `/dashboard?sector=SectorName`
   - Hover → show rich tooltip with stock, usage, confidence, etc.

---

## 3. What Visual Information is Shown Per Sector?

Each sector hexagon displays **8 layers of information**:

| Layer | Element | Data Source | Visual |
|-------|---------|-------------|--------|
| **Outer** | Pulse ring | status | Animated, color-coded, only if DEPLETING/CRITICAL/EXHAUSTED |
| **1** | Hex border | status | 1.5px stroke, color-coded (5 colors) |
| **2** | Hex fill | status | 10% opacity fill matching color |
| **3** | Icon | sector config | Lucide React SVG icon |
| **4** | Sector name | sector config | Gray text, 11px, bold |
| **5** | Resource type | sector config | Gray text, 9px, lighter |
| **6** | Mini progress bar | stock % | 60px width, colored fill bar |
| **7** | Status text | hours_to_zero or status | 9px, bold, color-coded |
| **8** | Tooltip (hover) | all data | Rich info: stock, usage, confidence, exhaustion date |

### Color Mapping (NetStatus → Hex)

```typescript
STABLE: '#22C55E'     (green)
RECOVERING: '#F97316' (orange)
LOW: '#F97316'        (orange)
CRITICAL: '#EF4444'   (red)
DEPLETING: '#EF4444'  (red)
EXHAUSTED: '#7F1D1D'  (dark red)
```

---

## 4. What is NOT Shown (Gaps for "Big TV" Display)

### Critical Missing Information

1. **No Historical Trend**:
   - Only shows current snapshot, no 30-min/1-hr graph overlay
   - No "rising" vs "falling" visual indicator
   - Graph page exists but not integrated into map

2. **No Governor Activity**:
   - Allocations (production boost/cut) not visualized
   - Only "current_stock" shown, not "target_stock" comparison
   - Budget usage (% of total) not displayed
   - Models' confidence not shown (though exists in forecast)

3. **No SNAP Events**:
   - `snap_detected` field exists but not rendered
   - No visual alert for recent SNAP events

4. **No Resource Dependencies**:
   - Dependency penalties (Vibranium → Arc Reactor) not shown
   - Resource criticality (which one would fail first) unclear

5. **No Timeline**:
   - "48h remaining" is point-in-time, doesn't account for governor interventions
   - Forecast exhaustion date is shown only in tooltip, not on map

6. **No Sector Severity Hierarchy**:
   - All sectors appear equally important
   - No visual weighting for which sector is "most critical"

7. **No Event Stream**:
   - Production/consumption events not shown
   - Random events (resupply, emergency) not visualized

8. **No Connectivity Visualization**:
   - Connection lines are aesthetic, don't show actual dependencies
   - No data about resource flow between sectors

### Quantitative Information NOT Displayed

- Actual production rate per sector (units/cycle)
- Actual consumption rate per sector
- Governor confidence level per sector
- Snap event count/timing
- Budget remaining (vs total budget)
- Which forecasting strategy is active (moving average vs Bayesian)

---

## 5. Layout Structure — Room for a Globe?

### Current Layout Analysis

- **SVG viewBox**: Fixed `"0 0 800 500"` (800px wide, 500px tall)
- **CSS**: `className="w-full h-auto"` (responsive width, maintains aspect ratio)
- **Responsive**: Scales to fit container, always 800:500 ratio
- **Title**: 1 line title + 1 line subtitle above map
- **Padding**: `p-6` on parent container

### Space Availability

**Vertical**:
- Title area: ~60px
- Map: ~500px (responsive)
- **Total**: ~560px minimum
- **Assessment**: NOT much vertical room for additional content below

**Horizontal**:
- Map: 800px (fills width)
- **Assessment**: Could tile horizontally BUT would require redesign

### Options for Globe Alongside Map

1. **Side-by-side layout** (if viewport > 1400px):
   ```
   | Map (50%) | Globe (50%) |
   ```
   - Would need to reduce map to ~400-600px wide
   - SVG viewBox stays 800, but displayed smaller
   - Globe would need ~400-600px width
   - **Feasible for desktop/presentation**

2. **Stacked layout** (vertical):
   ```
   [ Title ]
   [ Map    ]
   [ Globe  ]
   ```
   - Requires scrolling on smaller screens
   - Good for mobile/tablet view
   - **Feasible but less ideal for TV display**

3. **Picture-in-Picture**:
   - Overlay small globe in corner of map
   - **Loses TV readability**

4. **Grid Layout** (e.g., CSS Grid):
   - Change from simple `<div className="p-6">` wrapper
   - Define 2-column grid
   - Adjust map SVG size dynamically
   - **Most professional approach**

### Current Markup Weakness

```jsx
<div className="p-6">
  <MarvelMap ... />
</div>
```

- **No layout structure** beyond padding
- **No grid/flex system** to support multiple components
- **Fixed SVG aspect ratio** limits flexible tiling
- **Would require parent redesign** to accommodate globe

---

## 6. Current Weaknesses of 2D Map for Presentation Setting

### Visual Clarity Issues

1. **Small nodes on large screens**:
   - Hex nodes are ~100px wide (at SVG scale 800px)
   - On a 55" TV at 10ft, very small
   - Text (9-11px font) barely readable from distance

2. **Color contrast**:
   - Status colors (green/orange/red) good, but subtle fill opacity (0.1) makes it hard to see
   - Gray connection lines (opacity 0.3) are nearly invisible

3. **Information density**:
   - Tooltip-only details (stock level, usage) invisible until hover
   - No static labels → presenters must explain each field
   - Audience can't see real-time details without pointing

### Data Fidelity Issues

4. **Stock percentage calculation broken**:
   - Uses hardcoded estimates (e.g., Medical Kits = 500 as "initial")
   - Should use actual `target_stock` from resource config
   - Result: progress bar may show 150% full or 30% full (inaccurate)

5. **Status badge vs trend mismatch** (from prior memory):
   - `computeNetStatus()` uses `production_rate_hourly - consumption_rate`
   - But production rate is governor's *allocation*, not actual production
   - Actual production depends on dependencies (Vibranium penalty, etc.)
   - Example: Icon shows STABLE but stock is actually DEPLETING due to unmet dependencies

6. **No governor context**:
   - Doesn't show if governor is CUTTING, MAINTAINING, or CRITICAL for each sector
   - Doesn't show budget remaining
   - Doesn't show which model (champion/challenger/backup) is active

### Presentation Weaknesses

7. **No narrative flow**:
   - Map shows 5 disconnected nodes
   - No visual priority (which sector to fix first?)
   - No story about interdependencies (Arc Reactor powers Medical, etc.)

8. **No engagement**:
   - Static hexagons with bars
   - Pulse animation only on CRITICAL (too late)
   - No gradient/trend indication
   - No "what if" scenarios visible

9. **No historical context**:
   - "48h remaining" is a snapshot
   - What was the trend 30 min ago? Up or down?
   - No confidence trends shown

10. **No contingency visualization**:
    - Governor actions not shown
    - No visual of "how much production boost would save sector X"
    - No alternative scenarios

---

## Data Flow Summary

```
Page Load (map/page.tsx)
    ├─ fetchForecasts() → 5 Forecast objects
    ├─ fetchSummary() → 5 SummaryItem objects
    ├─ fetchTimeToZero() → 5 TimeToZeroEntry objects (raw)
    ├─ fetchGovernorStatus() → GovernorStatus (allocations + confidence)
    └─ Enrich TTZ with:
        ├─ production_rate_hourly (from allocations)
        ├─ target_stock (from resource config)
        └─ governor_status (from allocations)

MarvelMap (marvel-map.tsx)
    ├─ Static SECTORS config (5 sectors, hardcoded positions)
    ├─ For each sector:
    │   ├─ getForecast() → exhaustion prediction
    │   ├─ getSummary() → latest stock + usage
    │   ├─ getTTZ() → hours_to_zero + current_stock
    │   ├─ computeNetStatus() → determine color
    │   └─ Render hex with icon, labels, progress, tooltip
    └─ Click → navigate to /dashboard?sector=SectorName
```

---

## Key File Locations

- **Page**: `/src/frontend/app/map/page.tsx:1-63`
- **Component**: `/src/frontend/components/map/marvel-map.tsx:1-402`
- **Types**: `/src/frontend/lib/types.ts:119-132` (TimeToZeroEntry)
- **API**: `/src/frontend/lib/api.ts:139-254` (TARGET_STOCK, computeNetStatus, fetch functions)
- **Status Colors**: `/src/frontend/components/map/marvel-map.tsx:15-22`
- **Sector Config**: `/src/frontend/components/map/marvel-map.tsx:32-38`

---

## Recommendations for Big TV Presentation

1. **Increase node size**: Scale SVG to fill more vertical/horizontal space
2. **Remove hardcoded stock estimates**: Use actual `target_stock` from API enrichment
3. **Add context legend**: Show color meanings + governor status legend
4. **Add globe component**: Side-by-side with map (requires layout restructure)
5. **Show governor allocations**: Visual indicator of CUTTING/MAINTAINING/CRITICAL per sector
6. **Highlight critical path**: Emphasize dependencies (Vibranium → Arc Reactor)
7. **Add trend arrow**: Show if stock is rising or falling (not just current state)
8. **Increase contrast**: Boost opacity of fills and darken background
9. **Add event indicators**: Show recent SNAP events or production surges
10. **Make text readable from 10ft**: Increase font sizes, consider SVG scaling

