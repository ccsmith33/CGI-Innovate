# Map Combination Patterns: 2D Marvel Map + 3D Tactical Globe

## Overview

The CGI project has two complementary geographic visualization components that are currently displayed separately:
1. **MarvelMap** (`src/frontend/components/map/marvel-map.tsx`) - 2D SVG-based tactical map with hexagonal sector nodes
2. **TacticalGlobe** (`src/frontend/components/globe/tactical-globe.tsx`) - 3D Three.js rotating globe with supply chain arcs

This document explores effective layout patterns to combine these on one screen for a cohesive, demo-ready ops interface.

---

## 1. Layout Patterns Analysis

### Pattern 1: Sidebar Layout (70% Globe + 30% Map Sidebar)
**Pros:**
- Maximizes screen real estate for 3D globe (primary attention)
- 2D map as "at-a-glance" reference on side (complements globe rotation)
- Responsive: sidebar stacks below on mobile/tablet
- Scrollable sidebar reduces layout pressure
- Works well with theater-style widescreen presentations

**Cons:**
- Sidebar tooltips may overlap main globe
- Sector labels small on sidebar version
- Two datasets competing for attention

**Implementation:**
```tsx
<div className="flex gap-6">
  {/* Main globe: 70% width */}
  <div className="flex-[0.7]">
    <TacticalGlobe sectors={summary} />
  </div>

  {/* Sidebar: 30% width, scrollable */}
  <div className="flex-[0.3] max-h-[calc(100vh-200px)] overflow-y-auto">
    <div className="space-y-4">
      <MarvelMap forecasts={forecasts} summary={summary} />
      {/* Additional sidebar cards: Quick stats, alerts, legend */}
    </div>
  </div>
</div>
```

**Demo Value:** Very high. Visually striking 3D globe with supporting tactical data.

---

### Pattern 2: Split 50/50 Side-by-Side
**Pros:**
- Equal visual hierarchy for both views
- Neither view dominates
- Both interactive at full resolution
- Clearly communicates "dual perspective"

**Cons:**
- Wastes vertical space on widescreen (both 50% height max)
- Globe may feel cramped at 50% width
- Requires minimum ~1400px width to be useful

**Implementation:**
```tsx
<div className="grid grid-cols-2 gap-6 h-[600px]">
  <Card><TacticalGlobe sectors={summary} /></Card>
  <Card><MarvelMap forecasts={forecasts} summary={summary} /></Card>
</div>
```

**Demo Value:** Medium. Clear but neither view gets optimal real estate.

---

### Pattern 3: 2D Dominant with 3D Inset/Picture-in-Picture
**Pros:**
- 2D map as primary analytical interface (larger, easier to read details)
- Globe as supplementary "situational awareness" widget
- Inset globe rotates continuously, adding visual movement
- Tooltip interaction on map can highlight corresponding globe point

**Cons:**
- Globe corners may contain important data (supply arcs)
- Inset size limits 3D detail visibility

**Implementation:**
```tsx
<div className="relative w-full h-[600px]">
  {/* Background: full 2D map */}
  <MarvelMap forecasts={forecasts} summary={summary} />

  {/* Floating inset: 3D globe, 25% of container */}
  <div className="absolute bottom-4 right-4 w-[300px] h-[300px] rounded-lg border border-gray-700 overflow-hidden shadow-xl">
    <TacticalGlobe sectors={summary} />
  </div>
</div>
```

**Demo Value:** Medium-high. 2D map clarity with dynamic 3D accent.

---

### Pattern 4: Tab-Based Switching
**Pros:**
- Full screen for each view
- No visual compromise
- Clean, uncluttered interface
- Common pattern (maps apps, GIS tools)

**Cons:**
- Lost "dual perspective" immersion
- Switching breaks flow during demo
- Less theatrical

**Implementation:**
```tsx
<div className="space-y-4">
  <Tabs defaultValue="globe">
    <TabsList>
      <TabsTrigger value="globe">Tactical Globe</TabsTrigger>
      <TabsTrigger value="map">Ops Map</TabsTrigger>
    </TabsList>
    <TabsContent value="globe">
      <TacticalGlobe sectors={summary} />
    </TabsContent>
    <TabsContent value="map">
      <MarvelMap forecasts={forecasts} summary={summary} />
    </TabsContent>
  </Tabs>
</div>
```

**Demo Value:** Low. Tabs are functional but break the "all-seeing ops center" narrative.

---

### Pattern 5: Floating Overlay (Globe as Canvas Background with 2D Map Overlay)
**Pros:**
- Layered depth: globe context with map interactivity
- Visually impressive (3D background with UI overlay)
- Unique presentation
- Can use semi-transparent map to see globe through it

**Cons:**
- Complex interaction management (globe + map both listening to clicks)
- Risk of visual confusion (too many elements competing)
- Sector positions on 2D map must align with 3D globe coordinates
- Difficult to implement reliably across browsers

**Implementation:**
```tsx
<div className="relative w-full h-[600px]">
  {/* Background: rotating 3D globe */}
  <div className="absolute inset-0">
    <TacticalGlobe sectors={summary} />
  </div>

  {/* Overlay: semi-transparent 2D map */}
  <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/60">
    <MarvelMap forecasts={forecasts} summary={summary} />
  </div>
</div>
```

**Demo Value:** Very high visually, but risky technically.

---

## 2. Complementary Value: What Each Map Brings

### TacticalGlobe Strengths
- **Global context**: Shows real Earth geography (lat/lng coordinates are realistic)
- **Supply chain visualization**: Animated arcs between sectors show dependencies
- **Spatial relationships**: Distance and distribution across globe
- **Auto-rotation**: Passive monitoring without interaction
- **3D immersion**: Theater-friendly, impactful on large screens

### MarvelMap Strengths
- **Detailed metrics**: Stock levels, consumption rates, hours-to-zero displayed per sector
- **Status at-a-glance**: Hexagon colors + pulse animations for DEPLETING/CRITICAL
- **Interactivity**: Click to navigate to dashboard, hover for full tooltips
- **Information density**: Multiple data layers (stock bars, status badges, labels)
- **Tactical clarity**: Custom coordinate space optimized for layout, not geography

### Proposed Complementary Workflow
1. **Globe first** — Watch auto-rotating globe to understand supply dependencies globally
2. **Map second** — Check 2D map for critical metrics and drill down via click
3. **Cross-reference** — Sector highlighted on globe also highlights on map

---

## 3. Geographic Positioning: Sector Coordinates

### Current Positions

**Tactical Globe** (`tactical-globe.tsx:15-21`):
- Avengers Compound: 41.05°N, -73.52°W (Connecticut, USA — accurate)
- New Asgard: 59.33°N, 18.07°E (Stockholm, Sweden area — reasonable)
- Sanctum Sanctorum: 40.73°N, -74.0°W (New York City, USA — accurate)
- Sokovia: 49.75°N, 13.38°E (Czech Republic area — reasonable)
- Wakanda: 9.02°N, 38.74°E (Ethiopia area — fictional, but positioned in Africa as intended)

**MarvelMap** (`marvel-map.tsx:32-38`):
- Avengers Compound: x=400, y=250 (center-right)
- Wakanda: x=150, y=150 (upper-left)
- New Asgard: x=650, y=120 (upper-right)
- Sanctum Sanctorum: x=200, y=380 (lower-left)
- Sokovia: x=600, y=370 (lower-right)

### Analysis: Geographic Alignment Issue

**Problem**: The 2D map uses **arbitrary tactical coordinates**, not geographic projections. Sectors are positioned for visual balance, not geographic accuracy.

**Supply Chain on Globe** (tactical-globe.tsx:24-29):
```
New Asgard (N. Europe) → Wakanda (Africa)
Wakanda → Avengers Compound (USA)
Avengers Compound → Sanctum Sanctorum (NYC)
Sokovia (Czech Republic) → Avengers Compound (USA)
```

**Supply Chain on 2D Map** (visual inspection):
```
Position-wise: Upper-right (New Asgard) → Upper-left (Wakanda)
Then: Upper-left → Center-right
etc.
```

The **2D map's layout does NOT reflect geographic positions** — it's optimized for visual clarity, not geographic accuracy. This is actually fine for a tactical ops map but will be confusing if the two views show different sector arrangements.

**Recommendation**: When combining maps, add a **legend or label** explaining that the 2D map is a "tactical layout" with positions optimized for command clarity, while the globe shows true geographic distribution.

---

## 4. Recommended Layout for Demo: Sidebar Pattern (Pattern 1)

Based on analysis, **Pattern 1 (Sidebar)** is recommended for the CGI demo:

**Why:**
1. ✅ Maximizes visual impact of rotating 3D globe (primary focal point)
2. ✅ 2D map provides supporting tactical detail without visual conflict
3. ✅ Scrollable sidebar: room for additional alert cards, legend, quick stats
4. ✅ Responsive: stacks gracefully on smaller screens
5. ✅ Theater-mode friendly: full globe dominates widescreen presentations
6. ✅ Complements existing CommandCenter + AgentFeed layout pattern

**Mockup Structure:**
```
┌─────────────────────────────────────────┐
│         Analytics Dashboard             │
├──────────────────────────┬──────────────┤
│                          │  Quick Stats │
│    TacticalGlobe         ├──────────────┤
│   (auto-rotating)        │ MarvelMap    │
│                          │ (compact)    │
│  (70% width)             │              │
│                          ├──────────────┤
│                          │  Alerts      │
│                          │  Legend      │
│                          │  (scrollable)│
└──────────────────────────┴──────────────┘
```

**Implementation Sketch:**
```tsx
export default function MapPage() {
  return (
    <div className="flex gap-6 h-screen p-6">
      {/* Main globe section */}
      <div className="flex-[0.7]">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Tactical Globe</CardTitle>
          </CardHeader>
          <CardContent className="h-[calc(100%-60px)]">
            <TacticalGlobe sectors={summary} snapActive={snapActive} />
          </CardContent>
        </Card>
      </div>

      {/* Sidebar with map + supporting info */}
      <div className="flex-[0.3] max-h-screen overflow-y-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ops Map</CardTitle>
          </CardHeader>
          <CardContent>
            <MarvelMap forecasts={forecasts} summary={summary} />
          </CardContent>
        </Card>

        {/* Supporting cards */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Supply Chain</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            {/* Legend showing dependencies */}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Critical Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Sorted TTZ cards */}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

---

## 5. Cross-View Interactions

For an integrated experience, implement these interactions:

### 5.1 Click-to-Highlight
- **Interaction**: Click sector on either map → highlight on both
- **Implementation**: Shared state (e.g., `selectedSector`) passed to both components
- **Visual feedback**: Brighten selected sector, dim others

```tsx
const [selectedSector, setSelectedSector] = useState<string | null>(null)

<TacticalGlobe
  sectors={summary}
  selectedSector={selectedSector}
  onSectorClick={setSelectedSector}
/>
<MarvelMap
  forecasts={forecasts}
  summary={summary}
  selectedSector={selectedSector}
  onSectorClick={setSelectedSector}
/>
```

### 5.2 Hover-to-Sync Tooltips
- **Interaction**: Hover on one map → show same tooltip on both
- **Challenge**: Tooltip positioning differs between SVG (absolute coords) and 3D (camera-dependent)
- **Solution**: Show simplified tooltip below map when either is hovered

### 5.3 Status Propagation
- **Globe**: Points color-coded by health (green/yellow/red)
- **Map**: Hexagons color-coded by status, pulse animation for critical
- **Sync**: Both use `computeNetStatus()` from `api.ts` for consistency

---

## 6. Demo Narrative

**Recommended demo flow with combined layout:**

1. **"Let's look at global resource distribution"** → Camera pans over auto-rotating globe
2. **"Here's our supply chain"** → Animated arcs show dependencies (Vibranium → Arc Reactor → Medical)
3. **"But the real power is the tactical detail"** → Point to 2D map sidebar
4. **"Each sector's current state, consumption rates, and time-to-zero"** → Hover/click sectors
5. **"When a resource hits critical"** → Show DEPLETING status with pulse animation on both maps
6. **"The governor can reallocate production"** → Live update as governor adjusts rates

---

## 7. Technical Considerations

### Responsive Design
- **Desktop (>1200px)**: Sidebar layout (70/30 split)
- **Tablet (768-1200px)**: Stack vertically (100% each), globe on top
- **Mobile (<768px)**: Tabs (globe / map) or accordion

### Performance
- Globe: Dynamically loaded with `next/dynamic` (SSR disabled)
- Both components poll same data endpoints (summary, forecasts, TTZ)
- ResizeObserver on both for responsive sizing
- Consider debouncing tooltip updates if interaction lags

### Testing
- Verify both components receive updated sector data (via SWR)
- Test cross-component click handlers in `marvel-map.test.tsx` and `tactical-globe.test.tsx`
- Validate responsive breakpoints

---

## 8. Conclusion & Recommendation

**Best Layout: Sidebar Pattern (70% Globe + 30% Map)**

This pattern maximizes the visual impact of the 3D globe while providing tactical detail in a scrollable sidebar. It supports the demo narrative of "global context → tactical detail" and aligns with existing dashboard patterns.

**Next Steps:**
1. Create new `OpsCombinedPage` component that implements sidebar layout
2. Add click-to-highlight interaction between maps
3. Extract shared sector legend/supply-chain info to sidebar
4. Test responsive breakpoints and touch interactions on tablet
5. Run demo on large screen to validate theater impact

---

**Research Completion Date:** 2026-03-01
**Status:** Ready for implementation planning
