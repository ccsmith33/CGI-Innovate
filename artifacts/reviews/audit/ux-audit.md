# UX Audit: Project Sentinel

## Professionalism Score: 7.5/10

The frontend is well-structured for a hackathon project. It uses a consistent dark theme, professional component library (shadcn/ui), modern fonts (Geist), and Recharts for data visualization. The overall impression is "competent developer tool" rather than "class project." However, several gaps reduce it from a polished product to a clearly-hackathon-scope application.

---

## Presentation Checklist Coverage

### Pre-Demo Setup
| Item | Status | Notes |
|------|--------|-------|
| Database seeded with historical CSV | ✅ Covered | `src/backend/scripts/seed_db.py` exists |
| Server logs / "Debug View" for PII redaction | ❌ Missing | **No debug/log view in the frontend.** PII redaction proof must be shown via backend logs or Swagger UI. There is no in-app audit trail or log viewer. This is a gap for the 5-minute demo -- judges expect to SEE redaction happening. |
| Recorded video backup | N/A | Not a frontend concern |

### 5-Minute Pitch Requirements
| Item | Status | Notes |
|------|--------|-------|
| Stack overview visible in UI | ⚠️ Partial | "SENTINEL" branding with shield icon exists in the sidebar. No "About" page or visible tech stack summary. The metadata title says "Project Sentinel" and description mentions "Command & Control Dashboard." Judges would need a verbal explanation of the stack. |
| Submit new field report from UI | ✅ Covered | `report-form.tsx` provides a complete form with raw text, hero alias, secure contact, priority selector, and submit button. |
| Show "Pending" to "Processed" status change | ✅ Covered | `status-badge.tsx` renders pending (yellow), processing (blue + pulse animation), processed (green), and error (red). Intel table polls every 3s via SWR. |
| New data point appears in tables/charts | ✅ Covered | Intel table auto-refreshes at 3s interval. Dashboard charts refresh at 5s interval. New reports and their extracted entities will appear automatically. |
| ML Forecast trend graph visible | ✅ Covered | `resource-chart.tsx` renders stock_level over time as a line chart. `forecast-overlay.tsx` shows strategy, confidence, time-to-zero, and hours remaining. A red ReferenceLine marks the predicted exhaustion date on the chart. |
| PII Redaction proof visible in UI | ❌ Missing | **Critical gap.** There is no way to see the redacted vs. original text in the UI. The `IntelReport` type has a `redacted_text` field, but it is NOT displayed anywhere in the intel table or the expanded row view. The expanded row only shows `extracted_entities` JSON. Judges need to see "[REDACTED]" markers. |
| UI updates without full page refresh | ✅ Covered | SWR polling with `refreshInterval` on all data-fetching hooks (3s for reports, 5s for resources/summary, 30s for forecasts). |
| Admin/Analytics view differentiated from Input view | ✅ Covered | Two distinct pages: "Analytics" (dashboard with charts/filters) and "Field Intel" (report submission + intel table). Sidebar navigation clearly separates them. |
| Interactive graphs (hover, zoom, filters) | ✅ Covered | Charts have custom tooltips on hover, Brush component for zoom/pan on the resource chart, sector/resource filter dropdowns on the dashboard. |
| Backend queryable via curl/postman | ✅ Covered | FastAPI provides `/docs` (Swagger UI) automatically. API endpoints are RESTful. |

### Checklist Score: 8/10 items covered, 2 critical gaps

---

## Critical UX Issues (Must Fix Before Demo)

### C1. PII Redacted Text Not Displayed Anywhere
**Severity: CRITICAL -- directly impacts judging rubric (Security/PII component)**

The `IntelReport` type includes `redacted_text: string`, but the intel table and expanded row view never render it. The expanded row only shows `extracted_entities` JSON. During the demo, judges need to visually compare the original input with the redacted output to verify PII scrubbing.

**Fix:** Add the `redacted_text` to the expanded row view in `intel-table.tsx`, displayed in a styled code block with "[REDACTED]" markers visually highlighted (e.g., red background spans).

**Effort:** ~30 minutes.

### C2. No Audit/Log View for PII Redaction Proof
**Severity: HIGH -- affects Security/PII demo flow**

The presentation checklist requires showing that PII was redacted "before leaving your server." There is no frontend view of server logs, API request/response pairs, or an audit trail. The demo would need to switch to a terminal or Swagger UI to show this, which is clunky and eats into the 5-minute window.

**Fix:** Add a collapsible "Audit Log" section to the expanded report row, or a dedicated `/audit` page showing the redaction pipeline (original -> redacted -> sent to LLM -> response).

**Effort:** ~1-2 hours (depending on whether backend already exposes audit data).

### C3. No Root Landing Content
**Severity: MEDIUM -- affects first impression**

The root page (`/`) just redirects to `/dashboard`. If the dashboard has no seeded data, judges see an empty state. The empty state text ("No resource data available for the selected filters") is plain gray text -- not inspiring for a first look.

**Fix:** Either ensure pre-demo seeding is reliable, or add a brief welcome/overview card that shows even when data is empty, describing what the system does and its key metrics.

**Effort:** ~20 minutes.

---

## Polish Issues (Nice to Fix)

### P1. Missing React Key Warning
In `intel-table.tsx` lines 98-169, the `<>` fragment wrapping each report row and its expansion row does not have a `key` prop. The `key` is on the inner `<TableRow>`, but React will warn about missing keys on list-rendered fragments. Should use `<Fragment key={report.report_id}>` instead of `<>`.

### P2. Select Dropdown Styling Inconsistency
The dashboard filter selects use `bg-gray-900 border-gray-700`, while the report form's priority select uses `bg-gray-800 border-gray-700`. This is a subtle inconsistency. The form fields all use `bg-gray-800` which is correct for an inset card context, but the slight difference could catch a sharp-eyed judge.

### P3. Sidebar Has No Footer
The sidebar is just logo + two nav items with empty space below. Adding a subtle footer with version info, a "System Status" indicator, or the team name would fill the visual gap and look more complete.

### P4. No Page Transitions
Navigating between Analytics and Field Intel is an instant swap. A subtle fade or slide transition would feel more polished.

### P5. Forecast Overlay Only Shows When Both Filters Selected
The `ForecastOverlay` component renders `null` unless both a specific sector AND a specific resource type are selected (because `matchingForecast` requires both). On first load, the forecast information is invisible. This means the ML forecasting feature -- a major rubric item -- is hidden until the presenter knows to select both filters.

**Fix:** Show a summary of ALL forecasts (or the most critical one) by default, with a prompt like "Select a sector and resource to view detailed forecast."

### P6. Chart Empty State Could Be More Informative
The resource chart empty state says "No resource data available for the selected filters." This is technically correct but could suggest "Select a sector and resource type, or seed the database" to guide the user.

---

## Chart Assessment

### Resource Chart (`resource-chart.tsx`) -- 8/10
**Strengths:**
- Clean line chart with stock_level (solid blue) and usage_rate (dashed purple) dual-axis display
- Custom dark-themed tooltip with number formatting
- Brush component for time-range zoom
- Red ReferenceLine for predicted exhaustion date with clear label
- Empty state handling
- Responsive container

**Weaknesses:**
- No legend component -- users must infer what blue vs. purple lines mean from tooltip
- YAxis is shared for both stock_level and usage_rate, which likely have very different scales. This could make one line appear flat. A dual Y-axis would be more accurate.
- XAxis labels may overlap on small screens since `interval="preserveStartEnd"` only guarantees the first and last labels

### Forecast Overlay (`forecast-overlay.tsx`) -- 7/10
**Strengths:**
- Shows strategy, confidence %, time-to-zero date, hours remaining
- Color-coded: red for exhaustion date, orange for hours, green for "no depletion"
- "SNAP DETECTED" badge is a nice thematic touch with red background
- Compact horizontal layout

**Weaknesses:**
- Only visible when both sector AND resource filters are active (see P5 above)
- No visual hierarchy -- all metrics are same-sized inline text. The time-to-zero (the most important metric) doesn't stand out enough.

### Sector Summary (`sector-summary.tsx`) -- 8/10
**Strengths:**
- Green/yellow/red color coding based on stock ratio (>50% green, >20% yellow, <20% red)
- Clean bar chart with rounded corners
- Custom dark-themed tooltip
- Filters by selected resource type
- Good empty state

**Weaknesses:**
- No click interaction -- clicking a sector bar could filter the resource chart to that sector
- Aggregation logic takes the max stock level per sector, not the latest -- could be misleading if a sector has multiple resources at different levels

---

## Report Flow Assessment

### Form (`report-form.tsx`) -- 8/10
**Strengths:**
- Clear field labels with "(will be redacted)" hints on Hero Alias and Secure Contact -- this is excellent for the demo because the presenter can point to it
- Submit button is properly disabled during loading AND when text is empty (prevents double-submit and empty submissions)
- Loading state shows spinner with "Submitting..." text
- Success state shows the `report_id` in monospace font with a "processing" status badge
- Error state is clearly styled with red border and text
- Form clears on successful submission
- Priority selector with thematic options (Routine, High, Avengers Level Threat)

**Weaknesses:**
- No character count or limit indication on the textarea
- After submission, the success message persists until the next submission. There is no dismiss/close action.
- The "processing" badge shown after submission is hardcoded -- it doesn't live-update to "processed" (would need to poll for that specific report)

### Intel Table (`intel-table.tsx`) -- 7/10
**Strengths:**
- Clean table layout with appropriate columns (Time, Sector, Resource, Severity, Summary, Priority, Status)
- Priority badges are color-coded (gray=Routine, orange=High, red=Avengers Level Threat)
- Status badges animate (blue pulse for processing)
- Row expansion with chevron toggle reveals extracted entities JSON
- Auto-polls every 3 seconds
- Loading spinner and error state handling
- Empty state message

**Weaknesses:**
- **redacted_text is not displayed** (Critical issue C1)
- Expanded row only shows raw JSON in a `<pre>` block -- this is functional but not visually impressive
- No pagination -- if there are many reports, the table grows unbounded
- Summary column is truncated with `max-w-xs truncate` which could hide important information
- No sorting capability on any column
- Row key fragment issue (P1)

---

## Navigation & Layout Assessment

### Sidebar -- 7/10
- Two-item navigation is clear: "Analytics" (BarChart3 icon) and "Field Intel" (Radio icon)
- Active route is highlighted with blue background (`bg-blue-600`)
- SENTINEL branding with Shield icon is clean and professional
- Hover states work well (gray background transition)
- Fixed width (w-56) is appropriate for a dashboard sidebar

**Weaknesses:**
- Only 2 nav items makes the sidebar feel sparse
- No visual grouping or section headers
- No footer/status area
- No collapse/expand functionality (not critical for a demo)

### Layout -- 8/10
- Clean flex layout with sidebar + main content area
- `overflow-auto` on main content prevents layout breaking
- Geist font family gives a modern, developer-tool feel
- Dark theme is consistent across all components (bg-gray-950 body, bg-gray-900 cards, bg-gray-800 inputs)
- `min-h-screen` ensures no awkward white space

**Weaknesses:**
- No breadcrumb or page title in the header area (each page has its own h1, but there is no persistent header bar)
- No responsive breakpoints for the sidebar -- on very narrow screens the sidebar will compress the main content

---

## Missing "Wow Factor" Suggestions

### W1. Real-Time Backend Status Indicator (~30 min)
Add a small status dot in the sidebar footer that shows green when the backend API is reachable, red when it is not. This proves the system is "live" and gives judges confidence in the real-time architecture. Could also show "Last sync: 3s ago."

### W2. Critical Alert Banner for Depleted Resources (~45 min)
When any forecast shows hours_until_exhaustion < 24, display a persistent alert banner at the top of the dashboard: "WARNING: Vibranium in Sector-7G predicted to deplete in 18.3 hours." This is dramatic, thematic, and demonstrates that the ML forecasting is actionable, not just decorative.

### W3. Redacted Text Diff View (~1 hour)
In the intel table expanded row, show the `redacted_text` with "[REDACTED]" tokens highlighted in red. This is the single most impactful addition for the Security rubric component. If the backend also stores the original text, show a side-by-side or inline diff.

### W4. Reports Processed Counter / KPI Cards (~45 min)
Add a row of KPI cards at the top of the dashboard: "Total Reports: 47 | Processed Today: 12 | Critical Alerts: 3 | Sectors Monitored: 6." These give an instant impression of system activity and data scale. Simple to implement with existing API data.

### W5. Animated Status Transition (~30 min)
When a report transitions from "processing" to "processed" in the intel table, add a brief green flash or slide animation. This makes the real-time polling visually obvious to judges watching the demo. Currently the badge just changes color silently on the next 3s poll.

---

## Overall Assessment

**What a judge would think seeing this for the first time:**

The application looks like a legitimate operational dashboard. The dark theme, Geist typography, and consistent card-based layout convey "serious tool" rather than "student project." The charting is solid -- interactive tooltips, zoom brushes, and color-coded severity bars show competence with data visualization. The report submission flow is complete and well-designed, with the "(will be redacted)" labels being a subtle but effective touch for the Security component of the rubric.

**The two biggest risks for the demo are:**
1. **PII redaction is invisible in the UI.** The `redacted_text` field exists in the data model but is never displayed. A judge evaluating the Security/PII component would need to see redaction proof outside the app (terminal, Swagger), which breaks the flow of a smooth 5-minute demo.
2. **ML forecasting is hidden behind double-filter selection.** On first load, there is zero indication that the system does ML forecasting. The presenter must know to select both a sector AND a resource type to reveal the forecast overlay. A first-time viewer would miss this entirely.

**Bottom line:** With the two critical fixes (show redacted_text, surface forecasts by default) and one wow-factor addition (KPI cards or alert banner), this would score an **8.5-9/10** on UI & Professionalism. Without those fixes, it sits at **7-7.5/10** -- competent but missing opportunities to showcase the system's most impressive capabilities directly in the UI.
