# TV Ops Screen: Data Widgets & Live Feed Research

## Executive Summary

A "big TV" ops screen should display 6-8 major widgets positioned around dual interactive maps (Marvel Map + Threat Radar). The system provides a rich set of real-time SSE feeds, resource metrics, governor decisions, and status indicators that can be rendered in large, high-contrast formats visible from across a room.

---

## Question 1: Existing TV-Ready Components

### Components That Scale Well to Large Screens

| Component | File | Purpose | TV Readiness |
|-----------|------|---------|--------------|
| **DefconBadge** | `src/frontend/components/hud/defcon-badge.tsx` | Displays DEFCON level (1-5) with color coding | ✓ Already scalable text + large border |
| **VitalsBar** | `src/frontend/components/vitals/vitals-bar.tsx` | Connection status, heartbeat, event throughput, cycle countdown | ✓ Fixed bottom bar; good for status line |
| **ThreatRadar** | `src/frontend/components/radar/threat-radar.tsx` | 5-sector SVG radar with health blips (red=critical) | ✓ Fully scalable SVG, 200x200 baseline |
| **SnapSequence** | `src/frontend/components/snap/snap-sequence.tsx` | Full-screen purple blast + JARVIS voice alert on snap | ✓ Dramatic visual event for TV |
| **ModelArena** | `src/frontend/components/forecast/model-arena.tsx` | Leaderboard of forecast models with accuracy bars | ~ Compact text; needs larger typography |
| **ResourceChart** | `src/frontend/components/charts/resource-chart.tsx` | 5-resource line chart with projections + targets | ✓ ResponsiveContainer; 400px baseline |
| **CommandCenter** | `src/frontend/components/command-center/command-center.tsx` | Master control panel (budget, production, decisions, SNAP) | ~ Designed for desktop; dense for TV |

### Key Insight
Most components are already **React + CSS-based** and scale via Tailwind/flexbox. The VitalsBar is permanently fixed at the bottom and works well. ThreatRadar and ResourceChart are SVG/canvas-based and scale cleanly. **DefconBadge needs to grow 3-5x larger with proportional font sizes for TV visibility.**

---

## Question 2: SSE Real-Time Data Available for Live Feed

### SSE Event Types (from `use-sse.ts` + backend)

The frontend connects to `/api/v1/stream` (EventSource) and receives JSON events. Expected SSE event types:

```javascript
// Example SSE message structure:
{ "type": "resource_update", "data": { sector_id, resource_type, stock_level, timestamp } }
{ "type": "governor_decision", "data": { timestamp, rationale, sectors_adjusted, confidence } }
{ "type": "snap_event", "data": { trigger_reason, recovery_time } }
{ "type": "defcon_change", "data": { level, label, color } }
```

### Live Feed Candidates

| SSE Event Type | Use Case | TV Widget |
|----------------|----------|-----------|
| `resource_update` | Real-time stock changes in each sector | **Resource Stock Ticker** (scrolling list of sector|resource latest levels) |
| `governor_decision` | Every JARVIS budget reallocation | **Decision Ticker** (compact log, auto-scrolling, color-coded by severity) |
| `defcon_change` | Threat level escalation/de-escalation | **DEFCON Alert** (flash animation when level changes) |
| `snap_event` | When anomaly/snap is triggered | **Snap Flash** (SnapSequence already does this) |
| Throughput metric | System health pulse | **Live Throughput Counter** (EVT/MIN visible on vitals bar) |

### Live Feed Data Sources

1. **VitalsBar** already displays:
   - SSE connection status (green dot)
   - Heartbeat (flashing dot every message)
   - Events/minute throughput
   - Governor cycle countdown (30s between decisions)
   - UTC clock + cycle number

2. **ResourceChart** polls every 3s:
   - All sector resource stocks
   - Time-to-zero projections
   - Depletion forecast lines

3. **CommandCenter** polls every 5s:
   - Governor status (budget, allocations by sector)
   - Latest 10 decisions (timestamp, rationale, confidence, sectors affected)

---

## Question 3: Recommended 6-8 Data Widgets for TV Screen

### Layout Concept: Dual Maps + Surrounding Widgets

```
┌─────────────────────────────────────────────────────────────┐
│  [BIG DEFCON]  [RESOURCE TICKER]  [THREAT COUNT]  [CLOCK]  │
├──────────────────┬──────────────────┬──────────────────────┤
│                  │                  │                      │
│  MARVEL MAP      │  THREAT RADAR    │  RESOURCE BARS       │
│  (Sectors)       │  (Health Blips)  │  (5 sectors,        │
│                  │                  │   % of target)       │
├──────────────────┼──────────────────┼──────────────────────┤
│  DECISION LOG    │  BUDGET METER    │  TIME-TO-EXHAUSTION  │
│  (scrolling)     │  (stacked bar)   │  Ticker              │
└──────────────────┴──────────────────┴──────────────────────┘
  VitalsBar (bottom): Connection | Heartbeat | EVT/MIN | Gov Cycle | UTC | Cycle#
```

### The 8 Priority Widgets

#### 1. **DEFCON Banner** (Top-left, massive)
- **Component**: DefconBadge (modified for TV)
- **Size**: 200-300px height, 60pt font
- **Content**: `DEFCON {level} - {label}` with animated color glow
- **Refresh**: 5 seconds
- **Why TV**: Instantly answers "what threat level are we at?" Visible from across room.
- **Implementation**: Enlarge DefconBadge, add drop-shadow, possibly pulse on level change.

#### 2. **Live Resource Ticker** (Top-center-right)
- **Component**: New mini component using SSE + resource_update events
- **Size**: 400x80px, 18-24pt monospace
- **Content**: Scrolling list of latest stock changes
  ```
  → Medical Kits:     612 (↑ +2)  | last: 2 sec ago
  → Vibranium (kg):   284 (↓ -3)  | last: 5 sec ago
  → Clean Water (L):  698 (↑ +5)  | last: 1 sec ago
  ```
- **Why TV**: Real-time pulse of system vitality. Dramatic when values drop (red text).
- **Data Source**: SSE resource_update events, track per-sector latest stock + delta + time-since-update.

#### 3. **Active Threat Count** (Top-right)
- **Component**: Counter derived from ThreatRadar critical blips + TTZ data
- **Size**: 180x180px, 72pt font
- **Content**: Large number (0-5) of **CRITICAL sectors** + small list of which ones
  ```
  ⚠ CRITICAL
  3 Sectors

  · Wakanda (Arc)
  · Sokovia (Pym)
  ```
- **Refresh**: Real-time from SSE + 3s polls
- **Why TV**: Answer "how many emergencies right now?" in one glance.

#### 4. **Resource Health Bars** (Middle-right, 3 rows)
- **Component**: New bar chart using latest ResourceLog summary data
- **Size**: 5 horizontal bars, 150-200px width each, 30px height
- **Content**: Each sector as a bar (color-coded)
  ```
  Medical Kits      612/600  ████████░  102% [G]
  Vibranium (kg)    284/300  ███░░░░░░   95% [Y]
  Clean Water       698/750  █████████░  93% [Y]
  Pym Particles     510/420  ███████░░░ 121% [G]
  Arc Reactors      150/180  █████░░░░░  83% [Y]
  ```
- **Colors**: Green (>80%), Yellow (50-80%), Red (<50%)
- **Why TV**: At a glance, which resources are healthy vs. at risk.

#### 5. **Live Decision Ticker** (Bottom-left, scrolling)
- **Component**: New scrolling decision log using SSE + governor_decision polling
- **Size**: ~400x300px, 14-16pt monospace
- **Content**: Auto-scrolling log (FIFO, newest at top)
  ```
  [14:32:15] CRITICAL confidence=92%
  Wakanda Arc production cut 50% → emergency boost

  [14:31:45] MAINTAINING confidence=78%
  Sanctum Water boosted 15% to recover stock

  [14:30:20] RECOVERING confidence=84%
  All sectors stable; baseline sustained
  ```
- **Color coding**: Green border (>80%), Yellow (60-80%), Red (<60%)
- **Why TV**: Real-time window into JARVIS's reasoning. Dramatic when decisions are critical.

#### 6. **Production Budget Meter** (Bottom-center)
- **Component**: Stacked bar from CommandCenter.BudgetAllocationPanel
- **Size**: 400x60px bar + legend
- **Content**: Budget used by sector as % of total
  ```
  Budget: $127,450 / $150,000 (84.9%)

  ████████████████████░
  [Blue Compound] [Purple Asgard] [Cyan Sanctum] [Orange Sokovia] [Green Wakanda]
  ```
- **Why TV**: Shows "how much production cost are we running?" Helps identify over-allocation.

#### 7. **Time-to-Exhaustion Countdown** (Bottom-right)
- **Component**: New widget from `fetchTimeToZero()` API
- **Size**: 200x150px, large numeric display
- **Content**: Minimum hours-to-zero across all resources + which one is at risk
  ```
  ⏱ MINIMUM TTZ

  4.2 hours

  (Arc Reactors critical)
  ```
- **Refresh**: 3s polls (via TimeToZero endpoint)
- **Why TV**: Dramatic countdown effect. "How long until we're in trouble?" Visible escalation.

#### 8. **VitalsBar** (Bottom, always visible)
- **Component**: Existing VitalsBar component
- **Size**: Fixed 100% width, 40px height
- **Content**: Connection | Heartbeat | EVT/MIN | GOV CYCLE | UTC | CYCLE#
- **Why TV**: System health dashboard. Connection status, event throughput, governor pulse.

---

## Question 4: Current DEFCON Display

### Status
**DEFCON indicator exists but is tiny (inline text component).**

- **File**: `src/frontend/components/hud/defcon-badge.tsx`
- **Current rendering**: Inline `<span>` with 12-14px text, styled with Tailwind
- **Color mapping**: Green (1-2) → Yellow (3) → Orange (3) → Red (4-5) → Purple (anomaly)
- **Refresh**: 5-second poll via useSWR

### Problem
The DefconBadge is designed for a **dashboard sidebar**, not a **big TV screen**. At typical viewing distances (8-12 feet), the text would be illegible.

### TV-Ready Redesign Required
1. **Grow to 200-300px height** (from 40px)
2. **Increase font to 60pt bold** (from 14pt)
3. **Add animated glow** on the border (matches color, pulse effect when level changes)
4. **Make it a CSS-Grid item** occupying a dedicated corner (top-left or center)
5. **Keep color transitions smooth** (GSAP or CSS @keyframes)
6. **Add subtle background gradient** (darker shade of the color) for contrast against white walls

---

## Question 5: TV Screen First 30 Seconds Experience

### What a Viewer Sees (no training, first glance)

**0-3 seconds:**
- **GIANT RED NUMBER "5"** in top-left → "Oh, the threat level is high" / "This is concerning"
- **Large bars on the right, mostly green/yellow** → "Resources are mostly okay"
- **Flashing heartbeat at bottom** → "System is alive, responding in real-time"

**3-10 seconds:**
- **Scrolling text in bottom-left ticker** → "Decisions are being made automatically"
- **Radar with red blips** → "Multiple sectors have problems"
- **Time-to-exhaustion number: 4.2 hours** → "We have a few hours before crisis"

**10-30 seconds:**
- **Maps show sector geography** (comic book locations: Wakanda, Asgard, Sanctum)
- **Resource ticker at top scrolls** (Medical Kits up, Arc Reactors down)
- **Budget meter shows allocation** (most budget going to critical sectors)
- **Overall narrative**: *"This is a control center managing 5 Marvel locations' supplies under AI supervision. Right now, threat level is high, multiple resources are strained, but the AI is making real-time decisions to keep everything running. The arc reactors are the biggest concern (2 hours), but if decisions keep executing, we stay ahead."*

**Conclusion**: A **non-technical visitor** would walk away understanding:
- ✓ There are 5 sectors / locations being monitored
- ✓ Each has 5 types of resources
- ✓ An AI (JARVIS) is actively managing production
- ✓ The current threat level (DEFCON)
- ✓ Which resources are struggling
- ✓ That the system is live and updating in real-time

---

## Implementation Priorities

### MVP (Week 1)
1. **Enlarge DefconBadge** for TV (200px height)
2. **Add live Resource Ticker** (SSE-driven, 5 rows)
3. **Add Time-to-Exhaustion Countdown** (4-digit display)
4. **Deploy VitalsBar** at bottom (already exists)

### Phase 2 (Week 2)
5. **Add Active Threat Counter** (derived from ThreatRadar blips)
6. **Redesign Decision Ticker** for scrolling readability
7. **Scale all charts** (ResourceChart + ThreatRadar) to larger canvases
8. **Add Budget Meter** from CommandCenter

### Polish (Week 3)
- Animate DEFCON changes (slide transition + glow)
- Add sound effects to critical alerts (speaker integration)
- Landscape-only fullscreen mode
- Disable mouse/keyboard interactions (or gesture-only)
- Dark mode theme (already applied via Tailwind)

---

## Data Flow Diagram

```
┌──────────────────┐
│  SSE Stream      │
│ /api/v1/stream   │
└────────┬─────────┘
         │
         ├─→ useSSE hook (use-sse.ts)
         │   ├─→ resource_update events
         │   ├─→ governor_decision events
         │   ├─→ snap_event events
         │   └─→ defcon_change events
         │
         └─→ SWR Polls (3-5s interval)
             ├─→ fetchResources() → ResourceChart + Ticker
             ├─→ fetchTimeToZero() → Countdown widget
             ├─→ fetchGovernorStatus() → Budget meter
             ├─→ fetchGovernorDecisions() → Decision ticker
             └─→ fetchDefcon() → DEFCON badge
```

---

## Technical Notes

### Frontend Data Types (from `lib/types.ts`)

- **ResourceLog**: `{ sector_id, resource_type, stock_level, usage_rate_hourly, snap_event_detected }`
- **TimeToZeroEntry**: `{ sector_id, resource_type, hours_to_zero, current_stock, consumption_rate }`
- **GovernorDecision**: `{ timestamp, rationale, sectors_adjusted, champion_confidence, total_budget_used }`
- **DefconStatus**: `{ level, label, color }`

### API Endpoints Used

- `GET /api/v1/resources` → latest stocks (poll every 3s)
- `GET /api/v1/governor/time-to-zero` → depletion ETAs (poll every 3s)
- `GET /api/v1/governor/status` → budget + allocations (poll every 5s)
- `GET /api/v1/governor/decisions` → decision log (poll every 5s)
- `GET /api/v1/feed/defcon` → threat level (poll every 5s)
- `EventSource /api/v1/stream` → real-time push (always open)

---

## Questions for Stakeholders

1. **Audio cues?** Should critical alerts have sound effects (beep/alarm)?
2. **Interactive?** Should the TV screen respond to clicks/gestures, or display-only?
3. **Video wall?** Is this a single 4K TV, or a multi-screen video wall?
4. **Viewing distance?** Estimated distance from viewer (8ft? 15ft? 30ft)?
5. **Branding?** Should logos/colors reflect Marvel IP, or generic blue/gray?
6. **Recording/screenshots?** Should ops team be able to capture screen for reports?

---

## Files to Create/Modify

- [ ] `src/frontend/components/hud/defcon-badge.tsx` — Enlarge and animate
- [ ] `src/frontend/components/widgets/resource-ticker.tsx` — NEW (SSE-driven scrolling)
- [ ] `src/frontend/components/widgets/threat-counter.tsx` — NEW (count critical sectors)
- [ ] `src/frontend/components/widgets/exhaustion-countdown.tsx` — NEW (min TTZ display)
- [ ] `src/frontend/components/widgets/decision-ticker.tsx` — NEW (scrolling log)
- [ ] `src/frontend/app/tv-screen/page.tsx` — NEW (TV-optimized layout)
- [ ] `src/frontend/styles/tv-screen.css` — NEW (large fonts, high contrast)

---

**Research completed by**: Claude (Researcher)
**Date**: 2026-03-01
**Status**: Ready for design phase
