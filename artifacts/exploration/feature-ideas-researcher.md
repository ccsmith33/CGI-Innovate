# Feature Ideas -- Researcher Findings

> Compiled from full codebase gap analysis, domain research, and technology opportunity scan.

---

## Gap: No Real-Time Push -- Polling-Only Architecture

**What's missing:** The entire frontend relies on SWR polling at fixed intervals (3-5s for resources/reports, 30s for forecasts). There is no server-push mechanism. Every tab open in a browser hammers the API with repeated requests even when nothing has changed.

**Why it matters:** Real supply chain C2 dashboards use WebSockets or Server-Sent Events (SSE) for instant updates. Polling creates unnecessary load, introduces latency (up to 5s stale window), and does not scale. For a hackathon demo, showing a WebSocket-powered live feed that updates the instant data changes would be dramatically more impressive than polling.

**Technical approach:** FastAPI has first-class WebSocket support (`fastapi.websockets`). The backend can broadcast resource-level changes and new forecast computations over a WebSocket channel. On the frontend, a `useWebSocket` hook in React replaces SWR polling for the live data feeds. SSE is a lighter alternative if bidirectional communication is not needed. The current SWR fetchers could serve as fallback for initial page load while WebSocket handles live updates.

---

## Gap: No Anomaly Detection -- Only Linear Regression Forecasting

**What's missing:** The ML pipeline uses only `LinearRegression` from scikit-learn (with a snap-aware variant). There is no anomaly detection -- the system cannot flag unusual consumption spikes, unexpected stock jumps, or suspicious patterns beyond the crude snap-event boolean flag already in the data.

**Why it matters:** Anomaly detection is a core feature of modern supply chain dashboards. Research shows Isolation Forest, LSTM Autoencoders, and ARIMA residual analysis are standard techniques for detecting supply chain disruptions. Scikit-learn already ships `IsolationForest`, `LocalOutlierFactor`, and `EllipticEnvelope` -- all installable with zero new dependencies since scikit-learn is already in pyproject.toml.

**Technical approach:** Add an `AnomalyDetectionStrategy` to the existing strategy pattern in `src/backend/app/services/strategies/`. Use `sklearn.ensemble.IsolationForest` on the `(stock_level, usage_rate_hourly)` feature space per sector. Flag anomalous data points in the API response. On the frontend, render anomaly markers on the resource chart (red dots or highlighted regions). This is a high-impact, low-effort addition that reuses the existing strategy infrastructure.

---

## Gap: No Conversational AI / Chat Interface

**What's missing:** The OpenAI integration is limited to a one-shot `extract_intel()` call that parses field reports into structured JSON. There is no conversational interface where a user can ask natural language questions about the data (e.g., "Which sector is closest to running out?" or "Summarize all critical reports from the last 24 hours").

**Why it matters:** An AI chat panel would be the most visually impressive feature for a hackathon demo. Judges see hundreds of CRUD dashboards; a working natural language query interface over live data is a differentiator. OpenAI's function calling / structured outputs feature (already supported in the installed `openai>=1.30` package) enables the LLM to call backend APIs dynamically to answer questions.

**Technical approach:** Add a `/api/v1/chat` endpoint that accepts a user message, wraps it with system context (current summary data, recent forecasts), and calls OpenAI with function definitions for `get_summary`, `get_forecasts`, `get_reports`. The LLM decides which functions to call, the backend executes them, and the LLM synthesizes a natural language answer. On the frontend, add a slide-out chat panel accessible from any page. This leverages OpenAI function calling -- the LLM becomes a natural language interface to the existing API.

---

## Gap: No Alert / Notification System

**What's missing:** When a resource crosses a critical threshold (e.g., <48h until exhaustion), nothing happens. There are no alerts, no notifications, no visual indicators beyond the static color-coding on forecast cards. The dashboard shows status but does not proactively warn.

**Why it matters:** Real C2 systems have tiered alert systems -- visual toast notifications, sound cues, priority escalation. An alert that appears when a forecast goes critical during a live demo would be a powerful moment. Supply chain control towers emphasize automated alerts as a core differentiator over static dashboards.

**Technical approach:** Backend: Add a `/api/v1/alerts` endpoint and an `alerts` table that stores threshold-crossing events (generated during forecast refresh). Frontend: Add a notification toast system (using a library like `sonner` or custom) that polls or WebSocket-subscribes to the alerts feed. Show a badge count on the sidebar. When a new critical alert fires, display a toast with the sector, resource, and predicted exhaustion date.

---

## Gap: No Map / Geospatial Visualization

**What's missing:** The 5 sectors (Wakanda, New Asgard, Sokovia, etc.) are displayed as text labels in dropdowns and bar charts. There is no spatial visualization showing where these sectors are and their relative status.

**Why it matters:** Military/logistics C2 dashboards almost always feature a map view as the primary interface. A map with sector pins color-coded by resource status (green/yellow/red) would immediately communicate the global picture. It transforms the dashboard from a data table into a command center.

**Technical approach:** Use a lightweight map library like `react-simple-maps` or a themed SVG map. Since the sectors are fictional, create a custom SVG "world map" or use a stylized hex-grid. Each sector node shows its status color and key metric. Clicking a sector navigates to its filtered dashboard view. This is primarily a frontend addition with no backend changes.

---

## Gap: Simulation Page Lacks Backend Integration and Multi-Resource Support

**What's missing:** The simulation page (`src/frontend/app/simulation/page.tsx`) runs entirely client-side with simple linear depletion math. It does not use the ML forecasting service at all. It simulates one resource at a time with no ability to see cross-sector cascade effects (e.g., if Wakanda runs out of Arc Reactor Cores, what happens to other sectors that depend on power).

**Why it matters:** A simulation that runs against the actual ML model -- showing how the forecast would change if a snap event occurs -- would demonstrate deep integration between the ML pipeline and the UI. Cross-resource dependency simulation (supply chain cascade modeling) is a standout feature.

**Technical approach:** Add a `/api/v1/simulate` endpoint that accepts hypothetical parameters (e.g., "snap event at hour X", "usage rate doubles") and runs the forecast service with modified data. Return the predicted impact. On the frontend, show side-by-side comparison of current forecast vs. simulated scenario. This transforms the simulation from a toy calculator into a genuine what-if analysis tool backed by ML.

---

## Opportunity: OpenAI Structured Outputs for Guaranteed Schema Compliance

**What could be added:** The current `extract_intel()` function in `jarvis_llm.py` uses `response_format={"type": "json_object"}` which gives best-effort JSON but no schema guarantee. OpenAI's Structured Outputs feature (setting `strict: true` with a JSON schema) guarantees the response matches the exact schema 100% of the time.

**Technical approach:** Replace the current `response_format` with a Pydantic model schema passed via `response_format={"type": "json_schema", "json_schema": {...}}`. The `openai>=1.30` package supports `client.beta.chat.completions.parse()` which returns a typed Pydantic object directly. This eliminates the `json.loads()` + `model_validate()` + `except` chain in the current code, making it more robust and eliminating parse failures.

---

## Opportunity: Next.js Server Actions for Report Submission

**What could be added:** The report submission flow currently goes: client-side form -> fetch POST to FastAPI -> response. With Next.js 15+ Server Actions, the form submission could be handled server-side, enabling progressive enhancement (works without JavaScript), streaming responses, and better error handling.

**Technical approach:** Convert the `ReportForm` component to use a Server Action that calls the FastAPI backend from the Next.js server. This eliminates the CORS requirement for this flow and provides better UX with `useFormStatus` for pending states and `useActionState` for error handling. The current client-side approach works fine, but Server Actions would demonstrate mastery of the latest Next.js features.

---

## Opportunity: Multi-Model Forecast Comparison View

**What could be added:** The forecast service already has a strategy pattern with a registry (`STRATEGY_REGISTRY` in `jarvis_forecast.py`). Currently only two strategies exist (linear regression and snap-aware linear regression). Adding more strategies (polynomial regression, exponential decay, moving average) and showing their predictions side-by-side would demonstrate ML sophistication.

**Technical approach:** Add 1-2 new strategies to the strategy registry (e.g., `PolynomialRegressionStrategy` using `sklearn.preprocessing.PolynomialFeatures`, or `ExponentialDecayStrategy`). Modify the forecast API to return predictions from multiple strategies. On the frontend, show a comparison chart with each strategy's predicted exhaustion line in a different color. Let the user toggle strategies on/off. This reuses the existing strategy pattern infrastructure and scikit-learn dependency.

---

## Opportunity: Dark/Light Theme and Accessibility

**What could be added:** The UI is hardcoded to dark mode (`<html lang="en" className="dark">` in `layout.tsx`). All component styles use hardcoded gray-900/gray-800 backgrounds. There is no theme toggle, no reduced-motion support, and no ARIA labels on interactive elements.

**Technical approach:** This is lower priority for a hackathon but would demonstrate attention to detail. Use `next-themes` for theme switching. The existing Tailwind setup supports `dark:` prefixes natively. Add `aria-label` attributes to icon-only buttons and chart elements. Add `prefers-reduced-motion` media query handling to disable chart animations.

---

## Opportunity: Export and Reporting Features

**What could be added:** There is no way to export data from the dashboard. Users cannot download a CSV of resource logs, export a PDF report of forecasts, or share a snapshot of the current dashboard state. Real C2 systems always have export capabilities for offline analysis and reporting up the chain of command.

**Technical approach:** Backend: Add `/api/v1/resources/export` endpoint that returns CSV (using pandas `to_csv()` -- already installed). Frontend: Add "Export CSV" and "Generate Report" buttons to the dashboard. For PDF, use the browser's print stylesheet or a library like `jspdf`. For a simpler approach, a "Copy to Clipboard" button that formats the current summary as markdown would be quick to implement and useful for demos.

---

## Summary of Highest-Impact Findings

| # | Finding | Type | Impact | Effort |
|---|---------|------|--------|--------|
| 1 | Conversational AI chat with function calling | Gap | Very High | Medium |
| 2 | Anomaly detection with Isolation Forest | Gap | High | Low |
| 3 | WebSocket/SSE real-time push | Gap | High | Medium |
| 4 | Alert/notification system | Gap | High | Medium |
| 5 | Map/geospatial visualization | Gap | High | Medium |
| 6 | OpenAI Structured Outputs upgrade | Opportunity | Medium | Low |
| 7 | Multi-model forecast comparison | Opportunity | Medium | Low |
| 8 | Backend-integrated simulation with what-if | Gap | Medium | Medium |
| 9 | Data export (CSV/PDF) | Opportunity | Medium | Low |
| 10 | Server Actions for form submission | Opportunity | Low | Low |
