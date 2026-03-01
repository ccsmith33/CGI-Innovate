# Feature Ideas: Project Sentinel -- Ideation Session

> Generated: 2026-02-28 | Ideator Agent
> Context: UA Innovate CGI FullStack -- Command & Control dashboard for resource depletion monitoring with ML forecasting, PII-redacted intelligence processing, and simulation.

---

## 1. Data & Live Feeds

### 1.1 Field Operations Live Feed API (External Data Source)

**The Seed Idea.** Build a completely separate FastAPI microservice (`field-ops-api`) that runs independently and continuously generates realistic supply consumption events -- medical kits used at Avengers Compound, vibranium shipments arriving at Wakanda, Pym Particles consumed in Sokovia. This service has its own database and its own rate of "spending" resources. The main Project Sentinel backend polls it on a configurable interval (e.g., every 10-30 seconds via an async background task), ingests the new consumption records, writes them to `resource_logs`, and triggers an ML forecast recomputation. The dashboard, already polling via SWR at 5s intervals, picks up the changes automatically.

**Why it matters:** This transforms the demo from "here's static historical data" into "watch resources deplete in real-time right before your eyes." Judges can literally see stock levels dropping and forecasts updating. It also demonstrates microservice architecture, async data ingestion, and event-driven ML -- all impressive in a 5-minute demo.

**Implementation approach:**
- New `src/field-ops-api/` directory with its own FastAPI app, Dockerfile, and simple SQLite/in-memory store
- Endpoints: `GET /events?since={timestamp}` returns new consumption events; `GET /status` returns current emission rate
- Add a new Docker Compose service for it
- Add a `BackgroundTask` or `asyncio.create_task` poller in the main backend that calls the feed every N seconds
- New resource_log rows get inserted with `created_at = now()`, triggering the existing SWR polling to pick them up
- A small "Live Feed" indicator badge on the dashboard showing connection status and event rate

### 1.2 Real-Time WebSocket Push (Replace SWR Polling)

Currently the dashboard uses SWR polling at 5s/30s intervals. Replace this with a WebSocket connection from FastAPI that pushes updates to the frontend whenever new resource data is ingested or a forecast is recomputed. This would make the dashboard feel truly real-time rather than "near real-time with polling lag."

**Why it matters:** WebSocket push eliminates the 5-second delay, provides a visibly smoother experience during live demos, and demonstrates a more sophisticated architecture pattern. Combined with the live feed (idea 1.1), this creates a "data flows in from the field -> backend processes it -> dashboard updates instantly" pipeline that is very demo-impressive.

**Implementation approach:**
- Add `WebSocket /ws/dashboard` endpoint in FastAPI
- Use an in-process pub/sub (or Redis if available) to broadcast events
- Frontend: replace SWR `refreshInterval` with a `useWebSocket` hook that calls `mutate()` on new messages
- Graceful fallback to SWR polling if WebSocket disconnects

### 1.3 Anomaly Injection API (Chaos Engineering Lite)

Add a `POST /api/v1/admin/inject-anomaly` endpoint that lets a presenter inject anomalous events in real-time during a demo: a sudden snap event, a supply convoy arrival (stock spike), a contamination event (stock halved), or a demand surge. Each injection writes directly to `resource_logs` and triggers forecast recomputation.

**Why it matters:** This is a demo power move. The presenter says "Watch what happens when Thanos snaps" and clicks a button -- the dashboard updates, forecasts shift, alerts fire. It tells a story and makes the demo interactive and memorable.

**Implementation approach:**
- New endpoint accepting `{sector_id, anomaly_type, magnitude}`
- Anomaly types: `snap` (halve stock), `resupply` (add stock), `demand_surge` (increase usage_rate), `contamination` (reduce stock by percentage)
- Writes a new `resource_log` entry with the modified values
- Triggers `ForecastService.compute_forecast()` for the affected sector
- Frontend: small "Inject Anomaly" panel in the admin/simulation area

---

## 2. AI/ML Enhancements

### 2.1 Multi-Model Forecast Ensemble with Confidence Visualization

The current ML system uses linear regression (with a snap-aware variant). Extend the strategy pattern to include additional models: exponential decay, ARIMA/simple time series, and a moving average baseline. Then create an **ensemble view** that overlays all model predictions on the chart simultaneously, with each model's confidence interval shown as a shaded band.

**Why it matters:** Judges will notice if you only have linear regression. Showing multiple models with confidence intervals demonstrates ML depth and gives the product genuine analytical value. The strategy pattern is already in place (`strategies/base.py`), making this architecturally clean to add.

**Implementation approach:**
- Add `ExponentialDecayStrategy` and `MovingAverageStrategy` in `services/strategies/`
- Modify `compute_all_forecasts` to optionally run all strategies and store results
- Add a `GET /api/v1/forecasts/compare/{sector}/{resource}` endpoint returning all strategy results
- Frontend: toggle to show/hide individual model predictions on the resource chart
- Shaded confidence bands using Recharts `Area` component

### 2.2 AI-Powered Threat Assessment & Prioritization

Currently the LLM extracts entities (sector, resource, severity, summary, confidence) from intel reports. Extend this to generate a **threat assessment score** that cross-references the extracted intelligence with current resource levels. If an intel report mentions "Vibranium shortage in Wakanda" and the ML forecast already predicts Wakanda Vibranium exhaustion in <48 hours, the AI should flag this as a **corroborated high-priority threat** and surface it with a special alert.

**Why it matters:** This creates a feedback loop between the two AI systems (ML forecasting + LLM intelligence). Rather than operating independently, they inform each other. This is genuinely sophisticated and tells a compelling story about AI-augmented decision making.

**Implementation approach:**
- After LLM extraction, look up the matching forecast for the sector/resource
- Compute a `corroboration_score` = (LLM confidence * forecast criticality)
- Add `corroboration_score` and `corroborated_forecast_id` fields to `extracted_entities`
- Frontend: show a special "AI Corroborated" badge on intel reports that match critical forecasts
- Optional: toast notification when a new corroborated threat is detected

### 2.3 Natural Language Query Interface (Ask Jarvis)

Add a chat-style input on the dashboard where users can type natural language questions like "Which sector will run out of resources first?" or "Show me all critical intel reports from the last 24 hours." The backend sends the question to the LLM along with a summary of current resource state and forecast data, and returns a natural language answer.

**Why it matters:** This is the most demo-impressive single feature you could add. A judge types a question, and the system answers intelligently using real data. It showcases LLM integration beyond simple entity extraction and makes the system feel like an actual AI command center.

**Implementation approach:**
- New `POST /api/v1/jarvis/ask` endpoint
- System prompt includes current summary data (5 sectors, stock levels, forecasts, recent intel)
- User question passed as user message; LLM returns natural language response
- Frontend: sliding panel or modal with a chat interface
- Rate-limit to prevent demo abuse
- Cache recent answers for common questions

---

## 3. UX / Visualization

### 3.1 Interactive World Map with Sector Geolocation

Replace or augment the sector summary bar chart with an interactive map showing the 5 sectors as pins/regions on a stylized world map. Each pin shows a color-coded status (green/yellow/red based on forecast), and clicking a pin drills into that sector's resource chart. Sectors with active intel reports could pulse or show an alert icon.

**Why it matters:** A world map is the single most visually impactful addition for a C2 dashboard. Judges expect to see geographic visualization in a "global operations" context. It transforms the UI from "data tables and charts" into "command center." Without a map, the "global sectors" concept feels abstract.

**Implementation approach:**
- Use a lightweight mapping library compatible with Next.js (e.g., `react-simple-maps` for SVG or `leaflet` for tiles)
- Hardcode lat/lng for the 5 Marvel locations (Wakanda -> East Africa, New Asgard -> Norway, etc.)
- Each marker renders a mini status card with sector name, resource, stock level, and forecast status
- Clicking navigates to the dashboard with that sector pre-filtered
- Animate markers with pulse effects for critical status

### 3.2 Real-Time Alert Timeline / Activity Feed

Add a vertical timeline or "activity feed" component to the dashboard sidebar that shows recent events in chronological order: new resource readings, forecast changes, intel reports processed, anomaly injections, snap events. Each event is a small card with an icon, timestamp, and one-line description. Critical events pulse red.

**Why it matters:** This gives the dashboard a "living, breathing" feel. Instead of staring at a chart waiting for it to change, the user sees a stream of events. It also ties together the three subsystems (resources, forecasts, intel) into a unified narrative. During a live demo with the feed API running, this timeline would be actively scrolling -- very impressive.

**Implementation approach:**
- New `GET /api/v1/events/timeline` endpoint that unions recent resource_logs, forecasts, and intel_reports into a single sorted list
- Frontend: `<ActivityTimeline>` component with auto-scroll and SWR polling
- Event types with distinct icons: resource update, forecast recomputed, intel processed, snap detected, threshold crossed
- Optional WebSocket push for instant updates

### 3.3 Dark Mode Command Center UI Polish

The current UI uses dark gray backgrounds but lacks the full "military/C2 command center" aesthetic. Add subtle UI touches: a top status bar showing system-wide health (total resources tracked, active threats, system uptime), pulsing status indicators for each subsystem (Shield: online, Jarvis ML: online, Jarvis LLM: online), and a "DEFCON" style global threat level derived from the forecast data.

**Why it matters:** For a demo competition, first impressions are everything. A polished C2 aesthetic with system health indicators makes the product look production-grade. The "threat level" indicator (derived from aggregated forecast data) tells a story at a glance.

**Implementation approach:**
- Top nav bar component with: Project Sentinel logo, global threat level badge, subsystem status indicators
- Threat level computed from: count of CRITICAL/EXHAUSTED forecasts, recent high-priority intel, active snap events
- Levels: NORMAL (green) -> ELEVATED (yellow) -> HIGH (orange) -> CRITICAL (red) -> OMEGA (purple, all sectors critical)
- Subtle CSS animations: breathing glow on status indicators, scanline overlay on cards (optional, toggle-able)

---

## 4. Operational Features

### 4.1 Resource Resupply Recommendation Engine

When a sector's forecast predicts exhaustion, automatically generate resupply recommendations: how many units are needed, from which other sectors resources could be redirected, and the optimal timing. Display this as an actionable card attached to each CRITICAL forecast.

**Why it matters:** This shifts the system from "passive monitoring" to "active decision support." It answers the natural follow-up question: "OK, Wakanda is running low -- now what?" This makes the product feel like a real operational tool rather than just a dashboard.

**Implementation approach:**
- New `services/resupply_engine.py` that takes current stock levels + forecast data and computes optimal transfers
- Simple algorithm: find sectors with surplus (no exhaustion predicted or >100 hours remaining), compute transferable amount
- New `GET /api/v1/recommendations/{sector}/{resource}` endpoint
- Frontend: "Recommended Action" card below each CRITICAL forecast card
- Shows: source sector, transfer amount, estimated new exhaustion date after transfer

### 4.2 Report Submission Form with Real-Time PII Preview

The current system processes reports through an API but lacks a user-facing submission form. Add a page where a user can type or paste a field intelligence report, see PII being redacted in real-time as they type (a side-by-side view: raw text on the left, redacted preview on the right), and submit it. This makes the PII redaction feature visible and interactive.

**Why it matters:** The PII redaction is one of the most security-relevant features, but right now it's invisible -- it happens during seeding. A live demo where a judge types "Tony Stark called from 555-HERO" and watches it become "[REDACTED-NAME] called from [REDACTED-PHONE]" is immediately compelling and demonstrates the security layer viscerally.

**Implementation approach:**
- New `POST /api/v1/reports/preview-redaction` endpoint that takes raw text and returns redacted text (without saving)
- Frontend: new page or modal with split pane -- textarea on left, redacted preview on right
- Debounced API calls as user types (300ms debounce)
- Highlight redacted sections in red in the preview
- Submit button that calls the existing `POST /submit` endpoint
- Auto-fill hero_alias and secure_contact metadata fields

### 4.3 Exportable Briefing Document Generator

Add a "Generate Briefing" button that compiles the current system state into a downloadable PDF or formatted report: current resource levels, forecast summaries, recent intelligence, threat assessment. This is the kind of feature a real C2 system would have.

**Why it matters:** It shows the system has practical utility beyond the dashboard view. A judge can click "Generate Briefing" and see a professional document summarizing the operational picture. This also exercises the LLM integration in a new way -- use it to generate the narrative summary portion of the briefing.

**Implementation approach:**
- New `GET /api/v1/briefing/generate` endpoint that collects all current state data
- Use the LLM to generate a 2-paragraph executive summary from the data
- Return as structured JSON; frontend renders as a formatted, printable page
- Include: sector-by-sector resource status, top threats, forecast summaries, recent intel highlights
- Print-optimized CSS for clean PDF output via browser print

---

## 5. Security & Compliance

### 5.1 PII Redaction Audit Dashboard

The `redaction_log` table is populated but has no way to view it (the admin endpoint is missing per the audit). Build a full admin page that shows the redaction audit trail: which reports were redacted, what patterns were matched, and a side-by-side view of original hash vs. redacted text. Add aggregate statistics: total redactions, most common patterns, redaction rate over time.

**Why it matters:** This is both a missing-feature fix (the admin endpoint is flagged as CRITICAL in the audit) and a demo differentiator. Showing an audit trail of PII redactions demonstrates compliance awareness and security maturity. Judges evaluating a security-adjacent project will look for this.

**Implementation approach:**
- Implement the missing `GET /api/v1/admin/redaction-log` endpoint (the frontend `fetchRedactionLog` function already exists in `api.ts`)
- New `/admin` page with: redaction log table, pattern frequency chart, timeline of redactions
- Each row expandable to show patterns matched and redacted text
- Aggregate stats cards: total reports redacted, unique patterns found, most-targeted hero name

### 5.2 Role-Based Access Control (RBAC) Simulation

Add a simulated authentication layer with three roles: Analyst (read-only dashboard), Commander (can submit reports and trigger forecasts), and Director (full admin access including redaction logs and anomaly injection). Display the current role in the header and disable/hide features based on role. No actual auth backend needed -- a role selector dropdown suffices for demo purposes.

**Why it matters:** Every production system needs access control. Even a simulated version shows the team has thought about security beyond PII redaction. It's also a natural way to organize the growing feature set and demonstrate different user experiences during the demo.

**Implementation approach:**
- React context provider with `currentRole` state
- Role selector in the nav bar (dropdown: Analyst / Commander / Director)
- Conditional rendering: hide admin pages for Analyst, hide anomaly injection for non-Directors
- Backend: optional `X-Role` header that the API checks (advisory, not enforced)
- Show a "Access Denied" card with explanation when a user in a restricted role navigates to a gated page

---

## 6. Demo Impact / Wow Factor

### 6.1 "Scenario Mode" -- Guided Demo Walkthrough

Add a "Scenario Mode" button that launches a guided, scripted walkthrough of the system's capabilities. It auto-navigates between pages, highlights features with tooltips, and injects events at the right moments (snap event during the forecast view, new intel report during the reports view). Think of it as a self-running demo mode.

**Why it matters:** In a 5-minute presentation, time management is everything. A guided scenario ensures every feature gets demonstrated in the right order, with the right data appearing at the right time. It also works as a "leave-behind" -- judges can re-run the scenario after the presentation.

**Implementation approach:**
- Scenario definition as a JSON array of steps: `{page, action, delay, highlight, narration}`
- Frontend: `<ScenarioOverlay>` component that renders step-by-step instructions with Next/Skip buttons
- Each step can trigger API calls (inject anomaly, submit report, refresh forecasts)
- Narration text appears as a floating card explaining what's happening
- Auto-advance with configurable timing or manual stepping

### 6.2 Split-Screen Before/After Snap Comparison

Add a "Compare" view that shows two charts side by side: resource levels before and after the Thanos Snap event. The snap event is already in the data (it halves resources). This view highlights the snap_aware ML model's ability to handle the discontinuity versus naive linear regression.

**Why it matters:** The "Thanos Snap" is the most interesting part of the dataset and the most compelling story to tell. A before/after comparison makes the snap-aware ML strategy's value immediately visible. It's also a natural way to demonstrate the strategy pattern architecture.

**Implementation approach:**
- New component that queries resources for a specific sector and splits at the snap timestamp
- Side-by-side Recharts: left chart shows pre-snap trend with naive linear regression extrapolation; right chart shows post-snap with snap-aware forecast
- Annotation showing where naive model would predict exhaustion (wrong) vs. snap-aware (correct)
- Toggle between sectors to see the effect across all 5

---

## Priority Ranking (Top 5 for Maximum Demo Impact)

1. **Field Operations Live Feed API (1.1)** -- The seed idea, and by far the highest impact. Transforms static data into a living system.
2. **Natural Language Query Interface (2.3)** -- "Ask Jarvis" is the single most demo-impressive AI feature.
3. **Interactive World Map (3.1)** -- Visual impact is unmatched; makes the C2 concept tangible.
4. **Report Submission with Live PII Preview (4.2)** -- Makes the security feature interactive and visible during demo.
5. **PII Redaction Audit Dashboard (5.1)** -- Fixes a critical audit gap while adding demo value.

**Honorable mentions:** Anomaly Injection API (1.3) for demo interactivity, AI Threat Corroboration (2.2) for AI depth, Activity Timeline (3.2) for "living system" feel.
