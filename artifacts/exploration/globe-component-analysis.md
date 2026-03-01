# TacticalGlobe Component Deep Dive Analysis

**Date**: March 1, 2026
**Researcher**: Demo-Polish Team
**Component**: `src/frontend/components/globe/tactical-globe.tsx`

---

## Executive Summary

The TacticalGlobe component is a **globe.gl-based 3D visualization** that displays 5 Marvel-themed sectors as color-coded markers on an interactive Earth with supply chain dependency arcs connecting them. It's fully responsive, auto-rotating, and provides click-based stock level tooltips. The component uses **react-globe.gl** (a React wrapper around **Three.js** via **globe.gl**) and is currently configured to fit a standard card layout (~800×500px). To make it "fill a large portion of a screen impressively," significant enhancements are needed around dimensioning, visual effects, and data richness.

---

## 1. Library Stack

**Primary Libraries:**
- **react-globe.gl** (v2.37.0) — React wrapper for globe.gl
- **globe.gl** — Higher-level wrapper over Three.js that provides Earth texture and interactive 3D globe primitives
- **Three.js** — Underlying WebGL renderer and 3D engine (imported by globe.gl)

**Why This Stack:**
- Globe.gl abstracts away raw Three.js complexity while exposing enough control for customization
- React integration via dynamic import (line 11: `dynamic(() => import('react-globe.gl')...`) avoids SSR issues since Three.js requires `window` object
- Three.js under the hood provides CPU-efficient WebGL rendering and full shader support

**Not Using:**
- D3.js (too low-level for globe, would need custom projection logic)
- Chart.js (not designed for 3D rendering)
- CSS 3D transforms (too limited for interactive 3D rotation and depth effects)
- babylon.js (overkill, globe.gl/Three.js is already lean)

---

## 2. Props & Data Flow

**Component Props** (line 44-47):
```typescript
interface TacticalGlobeProps {
  sectors: SummaryItem[]        // Resource summary data
  snapActive?: boolean          // Activates snap mode (changes marker color to purple)
}
```

**Data Usage:**

### 2a. Sector Locations (Static)
Lines 15-21 define 5 Marvel-themed sectors with hardcoded lat/lng coordinates:
- **Avengers Compound** (NY, 41.05°N, -73.52°W) → Medical Kits (green: `#00ff88`)
- **New Asgard** (Norway, 59.33°N, 18.07°E) → Vibranium (light blue: `#a0d8ef`)
- **Sanctum Sanctorum** (NYC, 40.73°N, -74.0°W) → Clean Water (cyan: `#00bfff`)
- **Sokovia** (Central EU, 49.75°N, 13.38°E) → Pym Particles (orange: `#ffa500`)
- **Wakanda** (East Africa, 9.02°N, 38.74°E) → Arc Reactor Cores (gold: `#e0b840`)

### 2b. Stock Health → Color Mapping
Function `getStockHealth()` (lines 31-42) enriches points with dynamic colors based on current inventory levels:
- **≥70% of target**: Green (`#22c55e`) — healthy
- **30-70% of target**: Yellow (`#eab308`) — warning
- **<30% of target**: Red (`#ef4444`) — critical

Falls back to gray (`#888888`) if sector data not found. **Snap mode override**: All markers turn purple (`#a855f7`) when `snapActive=true`.

### 2c. Supply Chain Arcs (Static)
Lines 24-29 define 4 directional arcs representing supply dependencies:
- New Asgard → Wakanda (Vibranium supply)
- Wakanda → Avengers Compound (Arc Reactors → Medical support)
- Avengers Compound → Sanctum Sanctorum (Medical → Water)
- Sokovia → Avengers Compound (Pym Particles → Medical)

Colors match the source sector.

### 2d. Tooltip on Click
Lines 112-122: Clicking a marker displays a tooltip with sector name, resource type, and current stock level in bottom-left corner (dismissible).

---

## 3. Current Rendering & Visual Design

**What It Renders:**

1. **Earth Globe**
   - Earth night texture from CDN (line 128): `//unpkg.com/three-globe/example/img/earth-night.jpg`
   - Atmosphere layer (line 129): `#1a3a5c` (dark blue, opacity controlled by `atmosphereAltitude=0.2`)
   - Transparent background (line 131): allows card background to show through
   - Fully interactive: orbit with mouse, zoom with scroll

2. **Sector Markers** (Points)
   - **Count**: 5 fixed sectors
   - **Size**: `pointRadius=0.5` (fixed size, not data-driven)
   - **Color**: Dynamic (health-based or snap-mode purple)
   - **Label**: Sector name on hover
   - **Altitude**: `pointAltitude=0.06` (slight elevation above surface)
   - **Click handler**: Pops tooltip with stock info

3. **Supply Arcs**
   - **Count**: 4 supply dependency paths
   - **Style**: Dashed arcs (`arcDashLength=0.4`, `arcDashGap=0.2`)
   - **Animation**: Arc dashes animate over 1500ms (`arcDashAnimateTime=1500`)
   - **Stroke**: `arcStroke=0.5` (fairly thin)
   - **Color**: Matches source sector marker color
   - **Hidden in snap mode**: `arcsData` returns empty array when `snapActive=true`

4. **Auto-Rotation**
   - Lines 71-77: On mount, enables auto-rotate at speed 0.3 (slow, deliberate)
   - Can be interrupted by user mouse/touch interaction

**Visual Effects Currently Implemented:**
- ✓ Atmosphere glow (subtle, `#1a3a5c`)
- ✓ Dashed arc animation (1.5s loop)
- ✓ Auto-rotation on load
- ✓ Color-coded health status
- ✓ Interactive hover/click feedback

**Visual Effects NOT Implemented:**
- ✗ Point glow/halo effects
- ✗ Pulsing/breathing animations on critical resources
- ✗ Arc flow animation (currently just dashes, no directional flow)
- ✗ Ambient light effects or bloom
- ✗ Sector/region highlighting on hover
- ✗ Depth-based sorting or z-layering effects
- ✗ Trails or particle effects for incoming supply

---

## 4. Current Size & Dimensions

**Container Styling** (lines 205-209 in `globals.css`):
```css
.globe-container {
  width: 100%;
  min-height: 400px;
  aspect-ratio: 6/5;  /* Forces 6:5 aspect (wider) */
}
```

**Component Logic** (lines 53-68 in tactical-globe.tsx):
- **Default dimensions**: 800×500 (line 53)
- **Responsive via ResizeObserver**: Dynamically measures container width and sets height as `width × 0.55` (line 59)
  - **Example**: 1000px wide → 550px tall
- **Aspect ratio**: Maintained at ~6:5 (1.2:1) — landscape orientation

**Current Usage Context** (dashboard page.tsx line 353-362):
- Wrapped in a `<Card>` with standard padding
- Full-width card, inherits page margins (p-6 on page level)
- Sits between Command Center and Sector Summary cards
- On desktop: ~60% of viewport width

**Problem**: For "filling a large portion of a screen impressively," the current aspect ratio is too constrained. Viewport-filling globe visualizations typically use square (1:1) or taller aspects (5:6) to maximize visual impact.

---

## 5. Visual Effects & Aesthetics

**Current Effects:**
1. **Atmosphere**: Subtle blue rim light (` atmosphereColor="#1a3a5c"`, `atmosphereAltitude=0.2`)
   - Provides minimal depth cue
   - Could be enhanced with stronger color or higher altitude value

2. **Dashed Arc Animation**:
   - `arcDashLength=0.4` (40% of arc is visible dash)
   - `arcDashGap=0.2` (20% gap between dashes)
   - `arcDashAnimateTime=1500` (1.5s loop duration)
   - Creates sense of continuous supply flow but is subtle

3. **Auto-Rotation**:
   - `autoRotateSpeed=0.3` (very slow, ~2.3 deg/sec)
   - Prevents "stale" feeling when globe isn't being interacted with
   - Can feel sluggish on larger screens where more detail is visible

4. **Responsive Sizing**:
   - Uses ResizeObserver to maintain aspect ratio on window resize
   - Good for responsive design but limiting for full-screen impact

**Missing Effects (Opportunities for Enhancement):**

| Effect | Impact | Complexity |
|--------|--------|-----------|
| Point glow/aura | Highlights critical sectors, draws eye | Low (add `pointMaterial` with emissive color) |
| Pulsing critical markers | Indicates urgency without scrolling | Low (CSS animation or Three.js loop) |
| Arc flow animation | Shows supply direction visually | Medium (custom shader or vertex animation) |
| Sector region coloring | Heat map of overall sector health | Medium (texture-based or mesh coloring) |
| Ambient light variation | More realistic 3D perception | Medium (add Three.js lights) |
| Bloom/Glow post-processing | Sci-fi aesthetic enhancement | High (needs post-processing pipeline) |
| Particle trails | Visual emphasis on supply flow | High (particle system management) |
| Click-ripple effect | Tactile feedback on interaction | Medium (expanding circle animation) |

---

## 6. Screen-Filling Enhancements

**Current state**: Compact card in dashboard layout (400-600px tall)

**To Fill a Large Portion of Screen Impressively:**

### 6a. Dimensional Changes
- **Change aspect ratio** from 6:5 to 1:1 (square) or 5:6 (taller)
  - Edit `globals.css` `.globe-container` aspect-ratio
  - Or make globe full-viewport on dedicated page

- **Increase default size** from 800×500 to 1200×1200 (or full viewport)
  - Current ResizeObserver logic can scale to any size
  - No code changes needed, just CSS

- **Create full-screen variant** for dedicated "tactical view" page
  - Could launch from Command Center button
  - Use `vw`/`vh` units instead of card constraints

### 6b. Visual Polish
1. **Stronger atmosphere** (`atmosphereAltitude=0.4` instead of 0.2)
   - More depth perception at large scale

2. **Larger point radius** (scale with screen size, e.g., `pointRadius=0.8-1.0`)
   - Currently invisible from distance; need to grow for full-screen

3. **Thicker arc strokes** (`arcStroke=1.5-2.0` instead of 0.5)
   - Dashes are too fine at large scale

4. **Faster auto-rotation** (`autoRotateSpeed=0.8-1.2`)
   - Current 0.3 feels too sluggish on large display

5. **Point glow effect**:
   ```typescript
   // Add to Globe props:
   pointAltitude={0.08}
   pointMaterial={() => new THREE.MeshPhongMaterial({
     emissive: '#00ff88',  // matches point color
     emissiveIntensity: 0.5
   })}
   ```

6. **Critical point pulsing** (CSS or Three.js update loop):
   ```css
   @keyframes pulse-critical {
     0%, 100% { opacity: 1; }
     50% { opacity: 0.5; }
   }
   ```

### 6c. Layout Changes
- **Remove card wrapper**, use full-screen container
- **Make globe interactive toolbar** (zoom controls, legend, rotation speed slider)
- **Add sector info sidebar** that updates on marker hover
- **Show real-time stock graphs** for selected sector

---

## 7. Additional Data Currently Not Shown

**What the Globe Could Display:**

### 7a. Resource Flow Arcs (Enhanced)
Currently shows **supply dependency only** (4 static arcs).

**Enhancements:**
- **Color arcs by flow health**: Green (adequate supply), yellow (warning), red (critical shortage)
  - Requires computing each resource's flow rate
  - Update arc color reactively based on `sectors` prop

- **Pulsing width animation**: Arc thickness pulses with supply rate
  - Makes high-throughput routes visually prominent

- **Flow direction visualization**: Add arrow heads or animated particles flowing along arcs
  - Directional cues help understand supply chains

### 7b. Alert Pulses
- **Critical resources**: Animated expanding rings around sectors with <30% stock
  - Draw concentric circles that expand and fade
  - Color matches health status (red/yellow)

### 7c. Sector Health Heatmap
- **Regional coloring**: Overlay sectors' health as a heatmap on globe surface
  - Sector A has low Medical → tint region around Compound with red
  - Requires texture blending or custom mesh materials

- **Per-sector glow intensity**: Brighter glow when sector is in critical state
  - Already color-coded by health; could add intensity scaling

### 7d. DEFCON Status
- **Ring around Earth**: Animated ring intensifies with DEFCON level
  - DEFCON 5 (normal): thin, slow rotation
  - DEFCON 1 (imminent): thick, fast, pulsing ring

### 7e. Snap Detection
- **Currently**: All markers turn purple when snap active
- **Enhancement**: Add expanding blast wave effect radiating from affected sector
  - Matches the "snap" event cascade concept
  - Visual feedback that snap has cosmic impact

### 7f. Resource Icons at Markers
- **Instead of flat circles**: 3D models or emoji badges representing resource type
  - Medical Kits: 🏥 or medical cross icon
  - Vibranium: ⚛️ or crystalline shape
  - Requires loading glTF/GLB models or rendering custom geometries

### 7g. Timeline Slider
- **Historical playback**: Drag timeline slider to see how sectors' health has changed
  - Requires fetching historical ResourceLog data
  - Animate markers changing color as timeline scrubs

---

## 8. Data Properties Currently Unused

**From `SummaryItem` passed in `sectors` prop:**
- ✓ `sector_id`, `resource_type` — used for lookup
- ✓ `latest_stock_level` — used for health color
- ✗ `latest_usage_rate` — NOT USED (could scale arc thickness or pulsing speed)
- ✗ `latest_timestamp` — NOT USED (could show "last updated" tooltip)
- ✗ `snap_event_detected` — PARTIALLY USED (only for global snap mode, not per-resource)

**Governor Status (available from dashboard context, not passed to globe):**
- ✗ `current_allocations` — could show production rates per sector
- ✗ `champion_confidence` — could color arcs by prediction confidence

**Time-to-Zero Data (available on dashboard, not passed to globe):**
- ✗ `hours_to_zero` — could size markers by urgency (larger = more critical)
- ✗ `consumption_rate` — could animate arc flow speed

---

## 9. Architecture & Code Quality Notes

**Strengths:**
- Clean separation of concerns: static locations vs. dynamic stock data
- Responsive design via ResizeObserver (modern, no hacky resize listeners)
- Dynamic import prevents SSR issues
- Tooltip positioned outside globe container (good UX, no overlap)
- Color constants match Marvel theme and resource types

**Potential Improvements (Not in Scope for This Analysis):**
- `getStockHealth()` function is pure and testable (no tests exist)
- Arc building logic could be extracted to helper for better reusability
- Point/Arc data memoized with `useMemo` to prevent unnecessary rerenders
- `handlePointClick` accepts generic object type, could be stricter with TypeScript

**Testing Gaps:**
- No unit tests for `getStockHealth()` color logic
- No integration tests for globe rendering or interaction
- No snapshot tests for data transformation (pointsData, arcsData)
- No e2e tests for click tooltips

---

## 10. Recommendations for Demo Polish

**Priority 1 (Quick Wins, <30 min each):**
1. Increase `pointRadius` from 0.5 to 0.8 for better visibility
2. Increase `arcStroke` from 0.5 to 1.5 for better definition
3. Increase `atmosphereAltitude` from 0.2 to 0.4 for deeper effect
4. Change aspect ratio from 6:5 to 1:1 (square) for more balanced display
5. Increase `autoRotateSpeed` from 0.3 to 0.8 for snappier rotation

**Priority 2 (Medium Effort, 1-2 hours each):**
1. Add point glow using `pointMaterial` with emissive color
2. Implement critical-state pulsing animation on markers with <30% stock
3. Color arcs dynamically based on supply health (not just source sector)
4. Add expanding ring animation for critical sectors
5. Create dedicated full-screen globe view as separate route

**Priority 3 (High Effort, 3+ hours each):**
1. Implement resource flow animation along arcs (particles or vertex animation)
2. Add sector health heatmap as texture overlay on globe surface
3. Build interactive legend showing resource types and health thresholds
4. Add historical timeline scrubber for time-series visualization
5. Implement resource icons at marker positions using 3D models

---

## 11. Testing Opportunities

**Unit Tests to Add:**
- `getStockHealth()` with various stock/target ratios
- `pointsData` derivation from sectors (ensure colors match health)
- `arcsData` filtering (ensure snap mode hides arcs)

**Integration Tests to Add:**
- Globe renders with sample sector data
- Clicking marker shows tooltip with correct stock
- Auto-rotation starts on mount
- ResizeObserver updates dimensions on container resize
- Snap mode changes all markers to purple

**E2E Tests to Add:**
- Navigate to dashboard, locate globe, verify it's interactive
- Click a sector marker, verify tooltip appears and dismisses

---

## 12. Dependencies & Browser Compatibility

**Package Versions:**
- `react-globe.gl@^2.37.0` — Latest stable, supports React 17+
- Depends on `globe.gl` (automatic)
- Depends on `three` (automatic)

**Browser Requirements:**
- WebGL 1.0+ (supported in all modern browsers since ~2015)
- ES2015+ (transpiled by Next.js build)
- No IE11 support (globe.gl is modern)

**Performance Notes:**
- WebGL rendering is GPU-accelerated (efficient)
- Three.js handles frustum culling (only visible objects rendered)
- ResizeObserver has ~98% browser support; fallback not needed
- Dynamic import ensures globe code only loads when needed (CSR only)

---

## Conclusion

**TacticalGlobe** is a well-architected, responsive 3D component built on solid libraries (globe.gl/Three.js). It effectively visualizes 5 sectors and their supply relationships. To make it "fill a large portion of a screen impressively," the primary needs are:

1. **Larger dimensions**: Move from card (600px) to full-screen (1200+px)
2. **Enhanced visuals**: Stronger atmosphere, larger markers, faster rotation, glow effects
3. **Richer data**: Display supply flow intensity, alert pulses, health heatmaps
4. **Interaction**: Full-screen view with interactive legend and real-time updates

The component is production-ready for current use case. Enhancements are fully feasible within globe.gl's API and Three.js capabilities.

---

**Artifact Created**: `artifacts/exploration/globe-component-analysis.md`
**Ready for**: Architecture & Design phase (Priority: Medium for full-screen enhanced view feature)
