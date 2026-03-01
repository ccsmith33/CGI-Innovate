# Big-Screen Command Center UX Patterns

**Research Date**: March 2026
**Researcher**: Demo-Polish Team
**Project Context**: CGI Project Sentinel command center display optimization

---

## Executive Summary

Big-screen command center displays are fundamentally different from operator workstations. They prioritize **information synthesis over information density**, emphasize **passive viewing over interaction**, and require design decisions around **text size, contrast, animation, and layout** that would be unthinkable on a desktop. This research identifies patterns from real-world command centers (NASA, military NOCs), modern TV UX standards, and digital signage best practices.

---

## 1. Big Screen vs. Operator Workstation: Key Differences

### Information Presentation

| Aspect | Operator Workstation | Big Screen TV Display |
|--------|---------------------|----------------------|
| **Audience** | Single seated operator | Multiple standing/seated viewers |
| **Viewing Distance** | 24-30 inches (0.6-0.75m) | 8-12 feet (2.4-3.7m) or more |
| **Primary Mode** | Active interaction (clicking, scrolling) | Passive observation (awareness display) |
| **Information Density** | High (6-8 screens per workstation) | Low (carefully curated KPIs) |
| **Data Updates** | On-demand, user-triggered | Continuous, live streaming |
| **UI Elements** | Buttons, inputs, menus | Large cards, minimal controls |
| **Real Estate Usage** | Every pixel counts | Generous spacing, breathing room |

### Real-World Example: NOC Video Walls

Network Operations Centers typically feature:
- **Primary wall**: Large (8-12 screen) video wall showing KPIs, alerts, and geographic data
- **Operator desks**: 6 screens per operator for detailed investigation
- **Wall content**: World maps, performance metrics, alarm status, social feeds
- **Desk content**: Granular logs, configuration tools, detailed metrics

**Key insight**: The wall shows *what needs attention*, the desk shows *how to fix it*. Operators rarely look at the wall for decision-making; they look for "is there anything I need to pay attention to?"

---

## 2. Information Architecture: What Belongs Where

### Big Screen Display Should Show:
1. **Critical KPIs** — immediate health status (DEFCON level, resource availability)
2. **Geographic visualization** — 2D map or 3D globe showing operational scope
3. **Trend indicators** — direction of change (improving/declining) without granular numbers
4. **Alerts/anomalies** — what's unusual or needs attention
5. **Status summary** — aggregate view, not detailed breakdowns

### Operator Workstation Should Show:
1. **Detailed metrics** — exact numbers, historical data, trend analysis
2. **Control interfaces** — buttons to adjust production, allocation, governor mode
3. **Diagnostic data** — logs, event traces, dependency relationships
4. **Configuration** — scenario setup, simulation parameters

### What NOT to Put on Big Screen:
- Dense tables of numbers
- Detailed configuration panels
- Buttons requiring precision clicks (remotes aren't precise)
- Text smaller than 28px (at typical TV distances)
- Multiple nested menus or modals

---

## 3. Layout Patterns for Geographic + Resource Data

### Pattern 1: Dominant Globe with Sidebars (Recommended for "Wow Factor")

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│         Large 3D Globe (70% width)                  │
│                                                     │
│              ↑ Rotates/animates                     │
│              ↑ Shows regional hotspots              │
│                                                     │
└─────────────────────────────────────────────────────┘
│ Resource 1  │ Resource 2  │ Resource 3  │ DEFCON │
│ ▓▓▓▓▓▓▓    │ ▓▓▓▓▓▓     │ ▓▓▓▓▓      │  LEVEL │
│ 85% Health  │ 92% Health │ 78% Health │   5    │
└─────────────────────────────────────────────────────┘
```

**Advantages:**
- Globe is visually impressive, holds audience attention
- Sidebars provide quick status checks without reading numbers
- Scalable: can add/remove resource cards as needed
- Works well for demo/executive audiences

**Use case**: Demo environment, executive briefings, broad situational awareness

---

### Pattern 2: Split Screen (Geographic + Metrics)

```
┌──────────────────────┬──────────────────────┐
│                      │                      │
│    2D Map (50%)      │   Resource Grid      │
│                      │   (50%)              │
│  Shows locations     │                      │
│  and regional data   │  Medical:   ▓▓▓▓    │
│                      │  Vibranium: ▓▓▓▓    │
│                      │  Water:     ▓▓▓▓    │
│                      │  Arc:       ▓▓▓▓    │
│                      │  Pym:       ▓▓▓▓    │
└──────────────────────┴──────────────────────┘
│ Alerts & Status  (bottom bar, scrolling)    │
│ DEFCON 5 | Governor: MAINTAINING | Events  │
└──────────────────────────────────────────────┘
```

**Advantages:**
- Equal emphasis on geography and resources
- Good information density without feeling cluttered
- Easy for operators to correlate location-based events with resource impact

**Use case**: Real operational monitoring, NOC-style environments

---

### Pattern 3: Full-Screen Map/Globe with Overlay Panels

```
┌─────────────────────────────────────────────┐
│                                             │
│         3D Globe or 2D Map                  │
│         (full screen)                       │
│                                             │
│  ┌─ DEFCON 5 ─────────┐  ┌─ Alerts ──┐    │
│  │ Governor: STABLE   │  │ • Event 1 │    │
│  │ Resources: Healthy │  │ • Event 2 │    │
│  └────────────────────┘  └───────────┘    │
└─────────────────────────────────────────────┘
```

**Advantages:**
- Maximum visual impact from map/globe
- Floating panels can be moved/minimized
- Great for immersive visualization

**Disadvantages:**
- Hard to see details on mobile/smaller displays
- Overlays can obscure map data

**Use case**: Immersive demo, "situation room" aesthetic

---

## 4. Typography & Readability Standards

### Text Size Guidelines

**Rule of thumb**: 1 inch (25mm) of text height for every 15 feet (4.5m) of viewing distance.

**Practical measurements for 10-12 foot viewing distance:**
- **Headings/DEFCON badge**: 72-96px minimum (1.5-2 inches)
- **Primary metrics/status**: 48-64px (1-1.3 inches)
- **Secondary info**: 36-48px (0.75-1 inch)
- **Tertiary/labels**: 28-36px (0.6-0.75 inches)
- **Absolute minimum**: 28px (only for labels, not critical data)

**Browser zoom level**: 150-175% for big screen displays (rather than pixel-pushing the CSS)

### Contrast Requirements

- **Minimum WCAG AA**: 4.5:1 contrast ratio
- **Big screen standard**: Aim for 7:1 or higher for comfortable viewing from distance
- **Critical alerts**: Use bright, saturated colors with high contrast (e.g., bright red on dark background)
- **Background technique**: Add solid-color plates behind text to ensure readability regardless of map/graphic complexity

**Current Project Theme**:
- Dark mode (OKLCH: 0.145 background) provides good contrast base
- Status indicators use glow effects (red: 0-50-50 via box-shadow)
- Challenge: Chart background (white/transparent) may need adjustment for TV viewing

### Font Recommendations

- **Sans-serif preferred** (project uses Geist Sans — good choice)
- **Bold weight** for headlines/status (easier to read at distance)
- **Monospace for exact values** (time, precise numbers, DEFCON levels)
- Avoid thin/light weights; use regular (400) or bold (600+) minimum

---

## 5. Animation & Live Data Updates

### Animations That Work on Big Screens

**Effective:**
- **Slow, continuous animations** (4-8 second cycles) — scanline sweep, globe rotation, gradual progress fills
- **Pulsing status indicators** — brief opacity changes (0.6s-2s cycle) to draw attention without flashing
- **Entrance animations** — fade-in, slide-in for new alerts (200-400ms)
- **Smooth transitions** — data value changes over 2-3 seconds (easier to perceive than instant jumps)

**Project examples (from globals.css):**
- Scanline sweep: 8s linear (✓ good)
- Defcon pulse: 2s ease-in-out (✓ good)
- Blip pulse: 1.5s ease-in-out (✓ good)

**Problematic:**
- Fast flickering (can cause eye strain)
- Complex micro-interactions (users aren't hovering/interacting)
- Heavy 3D animation rendering (can cause performance stutter on TV hardware)
- Parallax effects (disorienting at distance)

### Live Data Update Strategies

1. **Bucketing/aggregation**: Smooth 1-minute windows rather than per-second updates (less visual noise)
2. **Trend indication**: Show direction of change (↑↓→) rather than absolute values
3. **Color coding**: Green (healthy) → Yellow (warning) → Red (critical)
4. **Event highlighting**: New alerts briefly highlight with entrance animation, then settle
5. **Passive updates**: Data refreshes silently on a schedule (3-5 second interval), no notification required

---

## 6. Color Scheme & Contrast for TV Viewing

### Project's Current Palette

**Dark Mode** (globals.css, lines 85-117):
- Background: `oklch(0.145 0 0)` — very dark gray (good for TV)
- Foreground: `oklch(0.985 0 0)` — near white (excellent contrast)
- Status indicators:
  - Critical: `rgba(255, 50, 50, 0.8)` — bright red ✓
  - Warning: `rgba(255, 165, 0, 0.8)` — bright orange ✓
  - Stable: `rgba(0, 255, 100, 0.6)` — bright green ✓

**Strengths:**
- Dark background reduces eye strain on TV screens
- Bright status colors provide high contrast
- Glow effects enhance readability from distance

**Opportunities:**
- Increase saturation on status colors (current RGB may be slightly desaturated)
- Ensure chart colors meet 7:1 contrast against dark background
- Add subtle drop shadows behind text for readability over complex graphics

### Color Strategy for Big Screens

- **Primary**: Use 2-3 colors maximum for status (good, warning, critical)
- **Secondary**: Accent colors for emphasis (project uses purple #9333ea for SNAP)
- **Backgrounds**: Very dark (project: oklch 0.145) or solid black
- **Text**: Very light (project: oklch 0.985) — avoid grays on dark background
- **Avoid**: Similar hues for different meanings (e.g., don't use red for both "critical" and "offline")

---

## 7. Real-World Command Center Patterns

### NASA Mission Control Model

- **Central screen**: Large wall-mounted map showing spacecraft position, radar coverage areas, recovery force locations
- **Surrounding consoles**: Specialists at desks with 6+ screens each
- **Information flow**: Wall shows "what's happening now", desks show "detailed status and decisions"
- **Update cadence**: Real-time data with 1-2 second latency

**Relevant to CGI Sentinel**:
- Globe/map should show resource hotspots and geographic scope
- Detailed metrics (production rates, drain calculations) belong on operator workstations
- Big screen shows aggregated status, not detailed logs

### Modern NOC Video Walls

- **Typically 8-12 monitors in grid** (e.g., 4x3 or 6x2 configuration)
- **Each screen displays different KPI**:
  - Network health (uptime, latency)
  - Alarm severity and count
  - Geographic heat map
  - Top-N services/regions by load
  - Social sentiment or related feeds
- **Update frequency**: 3-5 second refresh (live but not overwhelming)
- **Layout principle**: Critical info in center-top, reference data in corners

---

## 8. Design Recommendations for CGI Sentinel

### For Big Screen (War Room / Executive Display)

1. **Primary focus**: 3D globe or large 2D map showing resource distribution by region
   - Animate globe slowly (30-45 second rotation)
   - Color regions by resource health (green/yellow/red overlays)
   - Optional: Click zones/pins for major facilities

2. **Resource status sidebar** (right or bottom):
   - 5 large cards (Medical, Vibranium, Water, Arc, Pym)
   - Each shows: Health bar, percentage, trend indicator (↑/→/↓)
   - Color-coded background (green/yellow/red)
   - No detailed numbers

3. **Top banner**: DEFCON level, Governor mode, alert count
   - DEFCON badge: 72-96px monospace, pulsing glow
   - Governor status: "STABLE", "BOOSTING", "CRITICAL"
   - Alert banner: "3 resource concerns · 1 dependency cascade · 0 failures"

4. **Bottom alert ticker** (optional):
   - Scrolling or rotating alerts
   - Max 3-4 visible at a time
   - Color-coded (red/orange/yellow)
   - Auto-clears after 10 seconds (or on operator dismiss)

5. **Animations**:
   - Globe rotation: 45 second cycle
   - Status pulsing: 2-3 second cycle
   - Alert entrance: 300ms fade-in
   - Data transitions: 2 second smoothing

6. **Responsive zoom**: 150-175% browser zoom for 10-12 foot viewing distance

### Layout Recommendation: Dominant Globe Pattern

```
┌────────────────────────────────────────────────────────┐
│  DEFCON 5 | Governor: STABLE | 0 Alerts | ⚠️ Warning │
├────────────────────────────────────────────────────────┤
│                                 ┌─ Medical ──┐         │
│                                 │ ▓▓▓▓▓▓▓▓  │         │
│        Rotating 3D Globe        │ 85% │ ↑  │         │
│        (animates slowly)        ├────────────┤         │
│                                 │ Vibranium  │         │
│                                 │ ▓▓▓▓▓▓    │         │
│                                 │ 92% │ →  │         │
│                                 ├────────────┤         │
│                                 │ Water      │         │
│                                 │ ▓▓▓▓▓▓▓   │         │
│                                 │ 78% │ ↓  │         │
│                                 └────────────┘         │
└────────────────────────────────────────────────────────┘
│ • Production: +8 units/min | • Drain: -6 units/min   │
│ • Random event (Water +30) consumed by dependency    │
└────────────────────────────────────────────────────────┘
```

### For Operator Workstation

- Keep detailed charts, tables, control interfaces
- No changes needed to existing dashboard functionality
- These screens are for active decision-making, not passive observation

---

## 9. Testing & Validation Approach

### Test on Actual Display
- [ ] Borrow/find a 55"+ TV and test from 8-12 feet away
- [ ] Validate text readability without squinting
- [ ] Observe animations at distance (do pulsing effects work? is rotation smooth?)
- [ ] Check color contrast under various room lighting (bright office, dim war room)

### Metrics to Validate
- [ ] **Text legibility**: Can viewers read status without moving closer?
- [ ] **Animation smoothness**: Does globe rotation feel natural at distance?
- [ ] **Color distinction**: Can viewers tell green/yellow/red apart at 12 feet?
- [ ] **Update perception**: Do data changes feel smooth or jarring?
- [ ] **Attention flow**: Where do viewers' eyes go first? Is critical info prominent?

### Demo Feedback
- [ ] Non-technical observers (judges, executives)
- [ ] Technical operators (familiar with command center environments)
- [ ] Record feedback on: impressiveness, clarity, distraction level

---

## 10. Known Challenges & Mitigations

| Challenge | Root Cause | Mitigation |
|-----------|-----------|-----------|
| **Chart looks "flat"** | Fixed Y-axis with small data variance | Use dynamic axis, reduce time window, increase stroke width |
| **Small text unreadable** | Desktop-sized text (14-16px) | Use 48-72px minimum for big screen |
| **Data flickers** | Per-second updates, no smoothing | Aggregate to 1-minute buckets, use 2-3s transitions |
| **Status badge mismatches data** | Badge shows governor decision, not trend | Add trend arrows; separate badge from chart |
| **Too much detail** | Desktop design philosophy | Remove buttons, hide configuration, show only KPIs |
| **Performance stutter** | Heavy 3D rendering or frequent re-renders | Optimize globe library, use requestAnimationFrame, limit animation complexity |

---

## 11. Implementation Roadmap

### Phase 1: Layout & Typography (Low effort, high impact)
- [ ] Create "big screen" view component with 150% zoom
- [ ] Implement large text sizes (48-96px headings)
- [ ] Add DEFCON badge with pulsing animation
- [ ] Position resource status cards in sidebar

### Phase 2: Globe Integration (Medium effort, high impact)
- [ ] Select 3D globe library (Babylon.js, Three.js, or lightweight alternative)
- [ ] Implement slow rotation animation (45 second cycle)
- [ ] Color regions by resource health
- [ ] Add zoom/rotation controls for operators (optional on big screen)

### Phase 3: Live Data & Animations (Medium effort, ongoing)
- [ ] Implement 1-minute bucketing for smooth updates
- [ ] Add 2-3 second data transitions
- [ ] Implement alert entrance animations
- [ ] Test live SSE updates at distance

### Phase 4: Testing & Polish (Low-medium effort, critical)
- [ ] Test on actual TV from 8-12 feet
- [ ] Validate contrast and readability
- [ ] Gather demo feedback
- [ ] Optimize based on findings

---

## 12. References & Further Reading

### Design Standards
- [10-Foot User Interface (Wikipedia)](https://en.wikipedia.org/wiki/10-foot_user_interface)
- [UI/UX Design for Big Screens](https://medium.com/addweb-engineering/designing-for-the-big-screen-ui-ux-principles-behind-modern-tv-and-streaming-interfaces-ffae31ec3252)
- [UI/UX on TV Devices: Best Practices](https://promwad.com/news/ui-ux-tv-devices-best-practices)

### Command Center & NOC Design
- [Network Operations Center Design & Layout](https://www.extnoc.com/network-operations-center/noc-design-and-layout/)
- [NOC Video Wall Solutions](https://polywall.net/solutions/network-operation-center)
- [Extron: Font Size and Legibility for Videowall Content](https://www.extron.com/article/videowallfontsize)

### Typography & Readability
- [Text Size and Viewing Distance Calculator](https://digitalsignage.com/digital_signage/docs/guides/typography-viewing-distance/)
- [Solving Small Text and Contrast Issues](https://www.alicia.design/post/solving-small-text-and-contrast-issues-for-large-screen-readability)

### Geographic Visualization
- [Globe.GL - WebGL Globe Visualization](https://globe.gl/)
- [Kepler.gl - Large-scale Geospatial Data Visualization](https://kepler.gl/)
- [NASA WorldWind - 3D Virtual Globe](https://worldwind.arc.nasa.gov/)

### NASA Command Centers (Inspiration)
- [NASA Mission Control Center 360 Tour](https://www3.nasa.gov/specials/mcc360/)
- [NASA Consoles - Air and Space Museum](https://airandspace.si.edu/multimedia-gallery/nasa-consolesjpg)
- [NASA's Control Center Design and History](https://eandt.theiet.org/2013/12/16/nasas-control-centers-design-and-history/)

### Live Dashboard Practices
- [Geckoboard: Display Dashboards on TV](https://www.geckoboard.com/product/tv-dashboards/)
- [Klipfolio: Large Screen Dashboard Best Practices](https://support.klipfolio.com/hc/en-us/articles/216183517-Best-Practices-for-Large-Screen-Dashboard-Display)

---

## Project Context

**CGI Sentinel** is a command and control dashboard for Avengers resource management. Current implementation:
- **Theme**: Dark mode with HUD aesthetics (scanlines, corner brackets, glow effects)
- **Technology**: Next.js frontend, TypeScript, Recharts for visualization
- **Key assets**: 3D globe component (unused), resource charts, live SSE updates

**Opportunity**: The existing HUD aesthetic (globals.css, lines 128-232) is already optimized for big-screen viewing. The challenge is adapting information architecture and component layout for passive observation rather than active interaction.

---

**End of Research**

