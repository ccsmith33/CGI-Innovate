# Project Sentinel: Deliverables Gap Analysis

> Audited: 2026-02-28
> Auditor: cgi-audit2 researcher
> Sources: Presentation Checklist, README, Developer Implementation Guide (PDF), full source audit

---

## FULLY MET Requirements

### 1. DB seeded with historical_avengers_data.csv
- **Evidence:** `src/backend/scripts/seed_db.py` reads `historical_avengers_data.csv`, aggregates across 5 replicas (groupby timestamp/sector/resource), and bulk-inserts into `resource_logs` table. Also seeds 200 field intel reports from `field_intel_reports.json` with PII redaction applied at seed time.
- **Status:** FULLY MET. The seed script is solid and handles deduplication (skips if already seeded).

### 2. PII Redaction implementation (Shield middleware)
- **Evidence:** `src/backend/app/services/shield.py` implements `redact_pii()` with:
  - Known hero name list (12 Avengers) replaced with `[REDACTED-NAME]`
  - Phone number regex patterns (4 patterns: vanity 555-, 10-digit, 7-digit, parenthetical)
  - Metadata hero_alias and secure_contact redaction
  - SHA-256 hash of original text for audit trail
  - `RedactionLog` table stores every redaction event with patterns matched
- **Status:** FULLY MET. Redaction happens server-side BEFORE LLM call (see `reports.py:66-89` -- `redact_pii` runs, result stored, then background task sends `redaction_result.redacted_text` to LLM).

### 3. Field Report UI: submit with status transitions
- **Evidence:** `src/frontend/components/reports/report-form.tsx` submits via POST to `/api/v1/reports/submit`. Backend returns status `"processing"` (HTTP 202). The `StatusBadge` component at `status-badge.tsx` renders pending/processing/processed/error states with distinct colors and pulse animation for processing.
- The `IntelTable` component polls every 3 seconds (`refreshInterval: 3000`) via SWR, so the status transitions from processing -> processed are visible without page refresh.
- **Status:** FULLY MET. Note: the backend uses "processing" (not "pending") as the initial status for user-submitted reports. Seeded reports use "pending". Both are handled by the UI.

### 4. ML Forecast: trend graph showing when a resource hits zero
- **Evidence:** Multiple ML strategies implemented:
  - `linear_regression.py` - sklearn LinearRegression with IQR outlier filtering
  - `snap_aware.py` - Post-snap data isolation + linear regression
  - `polynomial_regression.py` (exists, unread)
  - `exponential_decay.py` (exists, unread)
- The `ResourceChart` component (`resource-chart.tsx`) renders dashed depletion projection lines from current stock to zero using time-to-zero data from the governor endpoint.
- The `TimeToZeroCard` on the dashboard shows per-resource depletion estimates with EXHAUSTED/DEPLETING/CRITICAL/LOW/STABLE classification.
- **Status:** FULLY MET. The "Predicted Exhaustion Date" line is rendered as a dashed projection on the chart.

### 5. Backend queryable without frontend (curl/Postman)
- **Evidence:** FastAPI with OpenAPI docs at `/docs`. All endpoints are standard REST:
  - `GET /api/v1/resources` - resource logs
  - `GET /api/v1/reports` - intel reports
  - `POST /api/v1/reports/submit` - submit report
  - `GET /api/v1/forecasts` - ML forecasts
  - `GET /api/v1/admin/redaction-log` - redaction audit trail
  - `GET /api/v1/governor/status` - governor status
  - `POST /api/v1/forecasts/refresh` - trigger forecast recompute
- **Status:** FULLY MET. FastAPI auto-generates Swagger UI.

### 6. Interactive graphs (hover for details, zoom, or filters)
- **Evidence:** `resource-chart.tsx` uses Recharts with:
  - Custom `<Tooltip>` showing values on hover
  - Toggle buttons per sector/resource to filter visible lines
  - `activeDot` on hover
- **Status:** FULLY MET for hover + filters. No zoom, but filters satisfy the "or" in the requirement.

### 7. Real-time UI updates (no full page refresh)
- **Evidence:** SWR with `refreshInterval` used throughout:
  - Dashboard summary: 5s poll
  - Forecasts: 30s poll
  - Time-to-zero: 5s poll
  - Intel reports: 3s poll
  - Resource chart: 5s poll
- **Status:** FULLY MET. SWR polling provides near-real-time updates without page refresh.

### 8. "Thanos Snap" anomaly handling (explainability for Q&A)
- **Evidence:** `snap_aware.py` implements `SnapAwareLinearRegression`:
  - Detects snap events via `snap_flags`
  - Isolates post-snap data for regression (discards pre-snap)
  - Applies IQR outlier filtering on post-snap data
  - Sets `snap_detected=True` on forecast results
- The governor endpoint `/governor/snap` can trigger snap events through the feed service.
- The `TimeToZeroCard` displays "Snap detected" label when applicable.
- **Status:** FULLY MET. The team can explain this clearly in Q&A.

### 9. Database schema explainability (for Q&A)
- **Evidence:** Clear schema with 5 tables:
  - `resource_logs` - time-series stock levels
  - `intel_reports` - field reports with raw/redacted text + extracted entities
  - `redaction_logs` - audit trail of PII redaction
  - `forecasts` - ML forecast results
  - `control_actions` - governor decision log
- PostgreSQL with async SQLAlchemy (asyncpg driver).
- **Status:** FULLY MET. Schema is clean and defensible.

---

## PARTIALLY MET Requirements

### 10. Server logs / "Debug View" showing PII was stripped before LLM call (CRITICAL per checklist)
- **What's there:**
  - The `/api/v1/admin/redaction-log` endpoint returns the full audit trail: `original_text_hash`, `redacted_text`, and `patterns_matched` for every processed report.
  - The report form has a live "Redaction Preview" panel (`report-form.tsx:130-151`) that shows `[REDACTED]` tags in real time as you type.
  - The `IntelTable` expanded row shows "Shield-Protected Report Text (PII Redacted)" with highlighted `[REDACTED]` tags.
  - Backend `fetchRedactionLog()` API function exists in `lib/api.ts:228-239`.
- **What's missing:**
  - **NO dedicated "Debug View" page or panel** in the frontend that shows server logs or the redaction log in a visual format. The admin redaction-log endpoint exists but there is no UI page to display it.
  - **NO visible server-side console/log output** showing the before/after of PII redaction. The `shield.py` `redact_pii()` function does not log anything to stdout/server logs. There are no `logger.info("Redacting PII: before=..., after=...")` statements.
  - During the demo, the team would need to either: (a) show the `/api/v1/admin/redaction-log` via curl/Postman, (b) use the inline redaction preview in the form, or (c) expand a report row in the intel table to show the redacted text.
- **Gap severity: MEDIUM-HIGH.** The checklist specifically says "Have your server logs or a 'Debug View' ready to show." The inline preview and expanded rows partially satisfy this, but judges may expect a dedicated debug/admin page or visible server log output.

### 11. Admin/Analytics view differentiated from Input view
- **What's there:**
  - Sidebar navigation separates pages: Analytics (dashboard), Ops Map, Simulation, Field Intel (reports).
  - The dashboard is analytics-focused (charts, forecasts, time-to-zero cards).
  - The reports page is input-focused (form + table).
  - The admin API endpoint (`/api/v1/admin/redaction-log`) exists.
- **What's missing:**
  - **No role-based access control.** There is no login, no user roles, no authentication. Any user can access any page.
  - **No dedicated "Admin" page** in the sidebar navigation. The sidebar has: Analytics, Ops Map, Simulation, Field Intel -- but no "Admin" link.
  - The checklist asks: "Is the 'Admin' or 'Analytics' view restricted or differentiated from the 'Input' view?" The views ARE differentiated (analytics dashboard vs. field intel input page), but there's no restriction/authentication.
- **Gap severity: LOW-MEDIUM.** The structural differentiation exists. Missing role-based restriction is a nice-to-have but not explicitly required. However, an "Admin" label in the nav linking to a redaction-log view would score better.

---

## NOT MET Requirements

### 12. New data point appears in tables/charts AFTER report is submitted
- **Current behavior:** When a field report is submitted:
  1. Report goes through PII redaction -> LLM extraction -> status becomes "processed"
  2. The extracted entities appear in the IntelTable (sector, resource, severity, summary)
  3. BUT: **the extracted intel does NOT create a new data point in `resource_logs`**. The LLM extracts metadata (sector, resource type, severity, summary) but does NOT insert a new stock level into the resource_logs table.
  4. The charts and resource tables only read from `resource_logs`, which is only fed by the CSV seed data and the feed service.
- **What the checklist says:** "The Result: Show the new data point appearing in your tables or charts."
- **Gap severity: MEDIUM.** The new report DOES appear in the intel table (which IS a table), so this can be demonstrated by showing the intel report row appearing. But if judges expect the chart/resource data to update based on field reports, that connection is missing. The live feed service may bridge this gap if running.

---

## DEMO RISKS

### RISK 1: OpenAI API Key dependency (HIGH)
- The LLM integration in `jarvis_llm.py` requires `OPENAI_API_KEY` env var. If not set, it returns `"No API key configured"` as the summary. If the key is invalid or rate-limited, reports will process to `"error"` status.
- **Impact:** The entire "Intelligence & Security" demo section depends on a working OpenAI key. Without it:
  - Reports will show "No API key configured" instead of extracted entities
  - The Jarvis chat widget won't work
  - The demo flow of submit -> pending -> processed with extracted intelligence breaks
- **Mitigation:** Verify `.env` has a valid `OPENAI_API_KEY` before demo. Have a fallback plan to show pre-processed reports.

### RISK 2: Feed service must be running (MEDIUM)
- The resource chart and time-to-zero cards depend on real-time data from the feed service (polled every 10s by `_feed_polling_loop`). If the feed service is down, the chart will show only historical seed data and may not look "live."
- **Impact:** The "LIVE" indicator on the dashboard may be misleading if no new data is flowing.
- **Mitigation:** Ensure `docker-compose up` brings up all services including the feed service.

### RISK 3: Status shows "Processing" not "Pending" (LOW)
- The checklist says "Show the 'Pending' status change to 'Processed.'" But the backend sets `status="processing"` (not `"pending"`) for user-submitted reports. Seeded JSON reports start as `"pending"`.
- **Impact:** During demo, a new submission will show "Processing" -> "Processed", not "Pending" -> "Processed". Minor semantic difference but judges reading from the checklist may notice.
- **Mitigation:** Could be explained as "Processing = actively being analyzed by Jarvis AI" which actually sounds better than "Pending."

### RISK 4: Docker startup time (MEDIUM)
- Backend waits 3s for DB, feed poller waits 5s, governor waits 15s. Full system warm-up could take 20-30 seconds.
- **Impact:** If demoing from a cold start, there may be empty/loading states on first page load.
- **Mitigation:** Start `docker-compose up` well before demo begins. Have everything warmed up.

### RISK 5: Time-to-zero chart relies on governor (LOW-MEDIUM)
- The depletion projections on the resource chart come from `/governor/time-to-zero`, which requires the governor ML loop to have run at least once (15s startup delay + 30s cycles).
- **Impact:** Dashboard may show "Computing forecasts..." initially.
- **Mitigation:** The governor loop runs automatically. Just ensure it's had time to run before demo.

---

## RECOMMENDATIONS (Prioritized)

### P0 - CRITICAL (Do before demo)

1. **Add a "Debug View" or "Security Log" panel for PII redaction proof.**
   The checklist marks this as **CRITICAL**. Options:
   - **(A) Fastest:** Add an "Admin" / "Security" page to the sidebar that renders the `/api/v1/admin/redaction-log` data in a table. Show original_text_hash, redacted_text with `[REDACTED]` highlighting, and patterns_matched. This takes ~30 min.
   - **(B) Alternative:** During demo, show the redaction preview panel in the report form (already built) AND expand a processed report row in the intel table to show the redacted text. Then switch to the terminal and show `curl localhost:8000/api/v1/admin/redaction-log | jq` to prove server-side redaction.
   - **(C) Quick win:** Add `logger.info()` calls to `shield.py`'s `redact_pii()` to print before/after to server console. Then show Docker logs during demo.

2. **Verify OpenAI API key works.** Run a test submission end-to-end before demo day.

3. **Pre-warm the system.** Start `docker-compose up` at least 2 minutes before the demo so all background tasks (forecasts, governor, feed ingestion) have completed their first cycle.

### P1 - HIGH (Strongly recommended)

4. **Add "Admin" or "Security" link to sidebar navigation.** Even without authentication, having a clearly labeled admin view that shows redaction logs differentiates the admin experience from the input view.

5. **Practice the 5-minute pitch with a timer.** The checklist is very specific about timing (1 min overview, 2 min live demo, 1 min intel/security, 1 min Q&A). Practice hitting each section.

### P2 - MEDIUM (Nice to have)

6. **Add server-side logging to PII redaction.** Even if just `print(f"[SHIELD] Redacted {len(patterns_matched)} patterns from report {report_id}")` in the reports router, this gives visible proof in Docker logs.

7. **Consider renaming initial report status to "Pending" for exact checklist alignment.** Currently uses "processing" for user-submitted reports. Changing to "pending" first, then "processing", then "processed" would exactly match the checklist flow.

8. **Prepare curl commands for backend-only demo.** Have a cheat sheet ready:
   ```bash
   # Submit a report
   curl -X POST localhost:8000/api/v1/reports/submit \
     -H 'Content-Type: application/json' \
     -d '{"raw_text": "Tony Stark reported Vibranium shortage in Wakanda. Contact: 555-0101", "priority": "High"}'

   # Check redaction log
   curl localhost:8000/api/v1/admin/redaction-log | jq

   # Get forecasts
   curl localhost:8000/api/v1/forecasts | jq
   ```

---

## Summary Scorecard

| # | Requirement | Status | Risk |
|---|------------|--------|------|
| 1 | DB seeded with CSV | FULLY MET | None |
| 2 | Server logs / Debug View for PII | PARTIALLY MET | HIGH |
| 3 | Field report submit -> Pending -> Processed | FULLY MET | LOW |
| 4 | New data point in tables/charts | PARTIALLY MET | MEDIUM |
| 5 | ML forecast trend graph (time-to-zero) | FULLY MET | None |
| 6 | PII Redaction proof (CRITICAL) | FULLY MET (backend) / PARTIALLY MET (demo-ability) | HIGH |
| 7 | Real-time UI updates | FULLY MET | None |
| 8 | Admin/Analytics vs Input differentiation | PARTIALLY MET | LOW |
| 9 | Interactive graphs | FULLY MET | None |
| 10 | Backend queryable without frontend | FULLY MET | None |
| 11 | Database schema explainability | FULLY MET | None |
| 12 | Thanos Snap handling | FULLY MET | None |

**Overall assessment:** The system is 80-85% demo-ready. The biggest gap is the lack of a visible "Debug View" or "Security Log" UI for proving PII redaction during the demo. The backend has all the data (redaction_log table, admin API), but there's no frontend page to show it. This is the single highest-priority fix before demo day.
