# Research Audit: Project Sentinel

## Executive Summary

Project Sentinel is in **good shape overall** but has several concrete gaps that need addressing before demo:

- **CRITICAL**: Missing `GET /api/v1/admin/redaction-log` endpoint (specified in architecture Section 5.5, not implemented)
- **CRITICAL**: `NEXT_PUBLIC_API_URL` is passed as runtime env var in docker-compose but Next.js bakes `NEXT_PUBLIC_*` vars at **build time** -- the value will be `undefined` in the built container
- **HIGH**: Frontend has **zero test files** -- violates quality standards ("All code must have tests. No exceptions.")
- **MEDIUM**: 6 missing database indexes specified in architecture
- **MEDIUM**: `intel_reports.metadata_json` uses `JSON` type instead of `JSONB` per spec
- **LOW**: `confidence` in `Forecast` model is nullable but spec says it should always be present

---

## Targeted Investigation: Three Key Questions

### Question 1: sector_id vs resource_type -- Is It a 1:1 Mapping?

**Answer: YES, it is strictly 1:1. Each sector maps to exactly one resource_type.**

#### Evidence from the CSV data

The file `Prompt-Resources/challenger_package/challenger_package/historical_avengers_data.csv` contains 10,000 rows. Analysis of every unique `(sector_id, resource_type)` pair shows exactly **5 pairs**, one resource per sector:

| sector_id | resource_type |
|-----------|---------------|
| Avengers Compound | Medical Kits |
| New Asgard | Vibranium (kg) |
| Sanctum Sanctorum | Clean Water (L) |
| Sokovia | Pym Particles |
| Wakanda | Arc Reactor Cores |

There are 5 unique sectors and 5 unique resource_types. Each sector appears with exactly one resource_type. No sector ever has multiple resource types, and no resource type appears in multiple sectors.

#### Evidence from the seed script (`src/backend/scripts/seed_db.py`)

The seed script at line 37 groups by `["timestamp", "sector_id", "resource_type"]`. It does NOT introduce any new sector/resource combinations -- it simply aggregates the 5 replicas per combo in the CSV. After aggregation, the 10,000 raw rows become exactly **2,000 rows** (5 pairs x 400 timestamps x 1 aggregated row each).

#### Evidence from the forecast service (`src/backend/app/services/jarvis_forecast.py`)

The `compute_all_forecasts()` method at line 75-81 queries all distinct `(sector_id, resource_type)` pairs from the database:
```python
result = await self.db.execute(
    select(
        distinct(ResourceLog.sector_id),
        ResourceLog.resource_type,
    ).group_by(ResourceLog.sector_id, ResourceLog.resource_type)
)
pairs = result.all()
```
This will return exactly 5 pairs given the data.

#### Frontend implications

In `src/frontend/app/dashboard/page.tsx`, there are **two independent filter dropdowns** (lines 181-207):
- Sector filter: lists all 5 sectors
- Resource Type filter: lists all 5 resource_types

These filters are **independent** -- the user can select any sector + any resource type combination, including invalid ones (e.g., "Wakanda" + "Medical Kits"). This will result in **zero data** on the chart since that combination does not exist in the database.

**The resource_type dropdown is redundant given the 1:1 mapping.** Selecting a sector implicitly determines the resource type. The current UX is misleading -- it suggests the user should independently choose both, but 20 of the 25 possible sector+resource combinations are empty.

The dashboard does auto-select the first valid pair on load (lines 118-124), which mitigates the initial experience, but a user manually changing one filter without the other will see empty charts.

**Recommendation:** Either (a) remove the resource_type dropdown and auto-derive it from the selected sector, or (b) make the resource_type dropdown dynamically filter based on the selected sector (which would always show exactly 1 option), or (c) replace both dropdowns with a single "Sector + Resource" combined selector showing only the 5 valid pairs.

---

### Question 2: Why Only 2,000 Rows Seeded From a 10,000-Row Dataset?

**Answer: This is by design, not an oversight. The CSV contains 5 replicas per observation, and the seed script intentionally aggregates them.**

#### Root cause: aggregation in `seed_db.py` lines 37-41

```python
agg = df.groupby(["timestamp", "sector_id", "resource_type"]).agg(
    stock_level=("stock_level", "mean"),
    usage_rate_hourly=("usage_rate_hourly", "mean"),
    snap_event_detected=("snap_event_detected", "any"),
).reset_index()
```

The script prints this aggregation explicitly at line 43:
```python
print(f"Aggregated to {len(agg)} rows from {len(df)} raw rows")
```

#### Data structure breakdown

- **10,000 raw CSV rows** = 5 sectors x 400 timestamps x 5 replicas per (timestamp, sector, resource) combination
- **2,000 aggregated rows** = 5 sectors x 400 timestamps x 1 averaged row per (timestamp, sector, resource)
- Each replica has slightly different `stock_level` and `usage_rate_hourly` values; the seed script averages these
- `snap_event_detected` uses `any()` -- if ANY of the 5 replicas flagged a snap event, the aggregated row is marked True

#### There is NO artificial LIMIT, slice, or row cap

The seed script iterates over ALL aggregated rows (line 47: `for _, row in agg.iterrows()`) with no early break, no `[:N]` slice, no SQL LIMIT. The 2,000 count is the natural result of the groupby aggregation, not a deliberate restriction.

#### Assessment

This is **correct engineering** -- storing 5 identical-ish replicas per observation would bloat the database with redundant data. Averaging the replicas preserves the signal while reducing storage by 80%. The script is working as intended.

**No fix needed.** The 2,000 rows represent all 400 time points across all 5 sector-resource pairs, which is the full dataset after deduplication.

---

### Question 3: AI Integration -- What Exists vs. What the Brief Requires

#### What the brief requires (from README.md and Developer Implementation Guide)

1. **Predictive Resource Forecasting (ML)**: Use the 10k historical stock data to predict resource depletion timelines via Linear Regression / Trend Analysis. Output: "Predicted Exhaustion Date" line on the chart.

2. **Secure Intelligence Processing (AI/NLP)**: Use an LLM to ingest unstructured field intelligence reports (the 200 JSON reports) and return structured JSON. The reports contain embedded hero names and phone numbers that MUST be redacted before being sent to the LLM.

3. **PII Redaction Security Layer**: A `redactPII(text)` middleware that replaces names and phone numbers with `[REDACTED]` before any text leaves the server to a third-party API.

4. **Real-time Analytics Dashboard**: Interactive charts with filters, real-time updates.

#### What currently exists (with file evidence)

##### ML Forecasting -- IMPLEMENTED

| Component | File | Status |
|-----------|------|--------|
| Strategy pattern base class | `src/backend/app/services/strategies/base.py` | Complete |
| Linear Regression strategy | `src/backend/app/services/strategies/linear_regression.py` | Complete -- uses scikit-learn `LinearRegression`, predicts hours-to-zero |
| Snap-Aware strategy | `src/backend/app/services/strategies/snap_aware.py` | Complete -- filters out snap-event data points before fitting |
| Forecast service | `src/backend/app/services/jarvis_forecast.py` | Complete -- computes forecasts for all 5 sector+resource pairs |
| Forecast model | `src/backend/app/models/forecast.py` | Complete -- stores predicted_exhaustion_date, hours_until_exhaustion, confidence |
| Forecast API endpoints | `src/backend/app/routers/forecasts.py` | Complete -- GET list, GET by sector+resource, POST refresh |
| Startup auto-compute | `src/backend/app/main.py:18-29` | Complete -- background task computes all forecasts on server start |
| Dashboard forecast cards | `src/frontend/app/dashboard/page.tsx:31-96` | Complete -- color-coded cards showing EXHAUSTED/CRITICAL/STABLE |
| Chart forecast overlay | `src/frontend/components/charts/forecast-overlay.tsx` | Present (referenced in dashboard) |
| Chart exhaustion reference line | `src/frontend/components/charts/resource-chart.tsx:125-137` | Complete -- red dashed line at predicted exhaustion date |

**Assessment: ML forecasting is FULLY IMPLEMENTED and well-integrated.** The snap-aware strategy is a nice touch that handles the Thanos Snap anomaly as the brief suggests.

##### PII Redaction (Shield) -- IMPLEMENTED

| Component | File | Status |
|-----------|------|--------|
| `redact_pii()` function | `src/backend/app/services/shield.py` | Complete |
| Known heroes list | `src/backend/app/services/shield.py:6-18` | 12 hero names |
| Phone regex patterns | `src/backend/app/services/shield.py:22-27` | 4 patterns: vanity, 10-digit, 7-digit, parenthetical |
| Metadata redaction | `src/backend/app/services/shield.py:64-68` | Redacts `hero_alias` and `secure_contact` in metadata dict |
| Redaction audit log model | `src/backend/app/models/redaction_log.py` | Stores hash, redacted text, patterns matched |
| Seed-time redaction | `src/backend/scripts/seed_db.py:80-81` | All 200 reports redacted during seeding |
| Submit-time redaction | `src/backend/app/routers/reports.py:54` | New reports redacted before LLM processing |
| Frontend redacted display | `src/frontend/components/reports/intel-table.tsx:36-51` | `RedactedText` component highlights `[REDACTED]` tags in red |

**Assessment: PII redaction is FULLY IMPLEMENTED.** The flow is correct: raw text enters -> `redact_pii()` runs server-side -> redacted text stored and sent to LLM -> raw text never exposed to external APIs. The `RedactionLog` table provides an audit trail. The redaction is regex/string-based (not ML-based NLP entity recognition), which is simpler but effective for the known patterns.

**Gap: Missing `GET /api/v1/admin/redaction-log` endpoint.** The architecture specifies this endpoint for demonstrating PII redaction during the presentation (Presentation Checklist item: "Show the request sent to the LLM. Prove that hero names and phone numbers were redacted before leaving your server"). The `redaction_log` table exists and is populated, but there is no API endpoint to query it.

##### LLM Entity Extraction (Jarvis) -- IMPLEMENTED

| Component | File | Status |
|-----------|------|--------|
| `extract_intel()` function | `src/backend/app/services/jarvis_llm.py` | Complete -- calls OpenAI GPT, returns structured JSON |
| System prompt | `src/backend/app/services/jarvis_llm.py:17-24` | Extracts sector_id, resource_type, severity, summary, confidence |
| Background processing | `src/backend/app/routers/reports.py:21-45` | Async background task processes reports after submission |
| Process-pending endpoint | `src/backend/app/routers/reports.py:87-101` | POST to queue all pending reports for LLM processing |
| Auto-trigger on frontend | `src/frontend/components/reports/intel-table.tsx:69-82` | Auto-processes pending reports on first page load |
| Extracted entities display | `src/frontend/components/reports/intel-table.tsx:246-256` | Shows extracted JSON in expandable row detail |
| Status tracking | `src/backend/app/models/intel_report.py:23` | pending -> processing -> processed/error |

**Assessment: LLM entity extraction is FULLY IMPLEMENTED.** The pipeline is:
1. Report submitted (or seeded) -> PII redacted -> stored with status "pending"
2. Process-pending triggered (auto or manual) -> redacted text sent to OpenAI -> structured entities extracted
3. Entities stored in `extracted_entities` JSON column -> displayed in frontend table

**Dependency: Requires `OPENAI_API_KEY` env var.** Without it, the service returns a fallback "No API key configured" response (line 28-29 of `jarvis_llm.py`). Reports will remain in "pending" status or show "Parse failed" entities.

**Note on model:** The code references `gpt-5.2` (line 34 of `jarvis_llm.py`). This is a placeholder or future model name. In production, this should be set to an available model.

##### Real-time Dashboard -- IMPLEMENTED

| Component | File | Status |
|-----------|------|--------|
| SWR polling for resources | `src/frontend/app/dashboard/page.tsx:135-137` | 5s refresh interval |
| SWR polling for summary | `src/frontend/app/dashboard/page.tsx:113` | 5s refresh interval |
| SWR polling for forecasts | `src/frontend/app/dashboard/page.tsx:142-144` | 30s refresh interval |
| SWR polling for reports | `src/frontend/components/reports/intel-table.tsx:64` | 3s refresh interval |
| Interactive chart | `src/frontend/components/charts/resource-chart.tsx` | Recharts with brush, tooltips, reference lines |
| Sector/resource filters | `src/frontend/app/dashboard/page.tsx:181-207` | Two dropdowns + clear button |

**Assessment: Real-time dashboard is FULLY IMPLEMENTED with SWR polling.**

#### Summary: AI Integration Completeness

| Brief Requirement | Implementation Status | Quality |
|-------------------|----------------------|---------|
| ML Forecasting (Linear Regression) | COMPLETE | Good -- snap-aware strategy, confidence scores, exhaustion timeline |
| LLM Entity Extraction (NLP) | COMPLETE | Good -- structured extraction, async processing, error handling |
| PII Redaction (Security Middleware) | COMPLETE | Good -- regex-based, audit log, metadata redaction |
| Admin Redaction Log API | **MISSING** | Needed for demo -- data exists in DB but no endpoint to query it |
| Real-time Dashboard | COMPLETE | Good -- SWR polling, interactive charts, forecast overlay |

**The core AI integration is complete.** The only missing piece is the admin endpoint to expose redaction logs for the demo.

---

## 1. API Contract Compliance

### Spec: Section 5 of architecture.md

| Endpoint | Spec | Implemented | Status | Notes |
|----------|------|-------------|--------|-------|
| `GET /health` | 5.1 | `routers/health.py` | PASS | Returns `{status, version}` |
| `GET /api/v1/resources` | 5.2 | `routers/resources.py:21` | PASS | All 7 query params implemented (sector, resource_type, start, end, snap_only, limit, offset) |
| `GET /api/v1/resources/sectors` | 5.2 | `routers/resources.py:66` | PASS | Returns `{sectors: [...]}` |
| `GET /api/v1/resources/types` | 5.2 | `routers/resources.py:75` | PASS | Returns `{resource_types: [...]}` |
| `GET /api/v1/resources/summary` | 5.2 | `routers/resources.py:84` | PASS | Returns latest reading per sector+resource |
| `POST /api/v1/reports/submit` | 5.3 | `routers/reports.py:48` | PASS | 202 Accepted, background processing |
| `GET /api/v1/reports` | 5.3 | `routers/reports.py:104` | PASS | Filtering by status and priority |
| `GET /api/v1/reports/{report_id}` | 5.3 | `routers/reports.py:137` | PASS | 404 on not found |
| `POST /api/v1/reports/process-pending` | -- | `routers/reports.py:87` | PASS | Not in spec but useful addition |
| `GET /api/v1/forecasts` | 5.4 | `routers/forecasts.py:17` | PASS | Latest forecast per sector+resource |
| `GET /api/v1/forecasts/{sector}/{resource_type}` | 5.4 | `routers/forecasts.py:44` | PASS | 404 on not found |
| `POST /api/v1/forecasts/refresh` | 5.4 | `routers/forecasts.py:64` | PASS | 202 Accepted |
| `GET /api/v1/admin/redaction-log` | 5.5 | **NOT IMPLEMENTED** | **FAIL** | No admin router exists |

### Missing Endpoint: Admin Redaction Log

Architecture Section 5.5 specifies `GET /api/v1/admin/redaction-log` to list PII redaction audit entries. **This endpoint is not implemented.** There is no admin router. This is important for the demo since it proves PII redaction is working.

---

## 2. Database Schema Compliance

### Table: `resource_logs`

| Column | Spec Type | Impl Type | Status |
|--------|-----------|-----------|--------|
| `id` | SERIAL PK | Integer PK autoincrement | PASS |
| `timestamp` | TIMESTAMPTZ NOT NULL | DateTime(timezone=True) NOT NULL | PASS |
| `sector_id` | VARCHAR(50) NOT NULL | String(50) NOT NULL | PASS |
| `resource_type` | VARCHAR(50) NOT NULL | String(50) NOT NULL | PASS |
| `stock_level` | DOUBLE PRECISION NOT NULL | Float NOT NULL | PASS |
| `usage_rate_hourly` | DOUBLE PRECISION NOT NULL | Float NOT NULL | PASS |
| `snap_event_detected` | BOOLEAN NOT NULL DEFAULT FALSE | Boolean NOT NULL default=False | PASS |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | DateTime(timezone=True) server_default=func.now() | PASS |

**Indexes:**
| Spec Index | Implemented | Status |
|------------|-------------|--------|
| `ix_resource_logs_sector_resource` on (sector_id, resource_type) | `__table_args__` composite index | PASS |
| `ix_resource_logs_timestamp` on (timestamp) | `__table_args__` index | PASS |
| `ix_resource_logs_snap` partial index on snap_event_detected WHERE TRUE | **NOT IMPLEMENTED** | **FAIL** |

### Table: `intel_reports`

| Column | Spec Type | Impl Type | Status | Notes |
|--------|-----------|-----------|--------|-------|
| `report_id` | UUID PK | String(36) PK, default=uuid4() | PASS | String instead of native UUID -- works fine with SQLite testing |
| `raw_text` | TEXT NOT NULL | Text NOT NULL | PASS |
| `redacted_text` | TEXT | Text nullable | PASS |
| `metadata_json` | **JSONB** | **JSON** | **FAIL** | Spec says JSONB; implementation uses generic JSON |
| `priority` | VARCHAR(30) NOT NULL | String(30) NOT NULL | PASS |
| `status` | VARCHAR(20) NOT NULL DEFAULT 'pending' | String(20) NOT NULL default='pending' | PASS |
| `extracted_entities` | **JSONB** | **JSON** | **FAIL** | Same issue -- JSON instead of JSONB |
| `error_message` | TEXT | Text nullable | PASS |
| `timestamp` | TIMESTAMPTZ NOT NULL | DateTime(timezone=True) NOT NULL | PASS |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | DateTime(timezone=True) server_default=func.now() | PASS |
| `processed_at` | TIMESTAMPTZ | DateTime(timezone=True) nullable | PASS |

**Indexes:**
| Spec Index | Implemented | Status |
|------------|-------------|--------|
| `ix_intel_reports_status` on (status) | **NOT IMPLEMENTED** | **FAIL** |
| `ix_intel_reports_priority` on (priority) | **NOT IMPLEMENTED** | **FAIL** |
| `ix_intel_reports_timestamp` on (timestamp) | **NOT IMPLEMENTED** | **FAIL** |

### Table: `forecasts`

| Column | Spec Type | Impl Type | Status |
|--------|-----------|-----------|--------|
| `id` | SERIAL PK | Integer PK autoincrement | PASS |
| `sector_id` | VARCHAR(50) NOT NULL | String(50) NOT NULL | PASS |
| `resource_type` | VARCHAR(50) NOT NULL | String(50) NOT NULL | PASS |
| `predicted_exhaustion_date` | TIMESTAMPTZ | DateTime(timezone=True) nullable | PASS |
| `hours_until_exhaustion` | DOUBLE PRECISION | Float nullable | PASS |
| `confidence` | DOUBLE PRECISION | Float nullable | PASS |
| `strategy_used` | VARCHAR(50) NOT NULL | String(50) NOT NULL | PASS |
| `snap_detected` | BOOLEAN NOT NULL DEFAULT FALSE | Boolean NOT NULL default=False | PASS |
| `computed_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | DateTime(timezone=True) server_default=func.now() | PASS |

**Constraints:**
- UNIQUE (sector_id, resource_type, computed_at): **PASS** -- implemented via `UniqueConstraint`

**Indexes:**
| Spec Index | Implemented | Status |
|------------|-------------|--------|
| `ix_forecasts_sector_resource` on (sector_id, resource_type) | **NOT IMPLEMENTED** | **FAIL** |
| `ix_forecasts_computed_at` on (computed_at DESC) | **NOT IMPLEMENTED** | **FAIL** |

### Table: `redaction_log`

| Column | Spec Type | Impl Type | Status |
|--------|-----------|-----------|--------|
| `id` | SERIAL PK | Integer PK autoincrement | PASS |
| `report_id` | UUID NOT NULL FK | String(36) FK NOT NULL | PASS |
| `original_text_hash` | VARCHAR(64) NOT NULL | String(64) NOT NULL | PASS |
| `redacted_text` | TEXT NOT NULL | Text NOT NULL | PASS |
| `patterns_matched` | JSONB NOT NULL | JSON NOT NULL | PASS (uses generic JSON but functionally ok) |
| `redacted_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | DateTime(timezone=True) server_default=func.now() | PASS |

**Indexes:**
| Spec Index | Implemented | Status |
|------------|-------------|--------|
| `ix_redaction_log_report_id` on (report_id) | **NOT IMPLEMENTED** | **FAIL** |

### Schema Summary

- All 4 tables exist: PASS
- Column names and types: 2 JSONB->JSON deviations on `intel_reports`
- Missing indexes: 7 total (1 partial on resource_logs, 3 on intel_reports, 2 on forecasts, 1 on redaction_log)

---

## 3. Test Coverage

### Backend Test Files

| Source File | Test File | Tests | Status |
|-------------|-----------|-------|--------|
| `app/routers/health.py` | `tests/test_health.py` | 1 test | Covered |
| `app/routers/resources.py` | `tests/test_resources_router.py` | 7 tests | Covered |
| `app/routers/reports.py` | `tests/test_reports_router.py` | 6 tests | Covered |
| `app/routers/forecasts.py` | `tests/test_jarvis_forecast.py` (shared) | 3 router tests | Covered (combined file) |
| `app/services/shield.py` | `tests/test_shield.py` | 9 tests | Well covered |
| `app/services/jarvis_llm.py` | `tests/test_jarvis_llm.py` | 5 tests | Well covered |
| `app/services/jarvis_forecast.py` | `tests/test_jarvis_forecast.py` | 4 unit tests + 3 router tests | Covered |
| `app/services/strategies/linear_regression.py` | `tests/test_jarvis_forecast.py` | 3 tests | Covered |
| `app/services/strategies/snap_aware.py` | `tests/test_jarvis_forecast.py` | 1 test | Covered |
| `app/config.py` | **None** | 0 | **NOT COVERED** |
| `app/database.py` | **None** | 0 | **NOT COVERED** (indirectly tested via conftest) |
| `app/main.py` | **None** | 0 | **NOT COVERED** (indirectly tested via router tests) |
| `scripts/seed_db.py` | **None** | 0 | **NOT COVERED** |

### Frontend Test Files

**NO TEST FILES EXIST in `src/frontend/`**.

This is a **blocking violation** of quality standards: "All code must have tests. No exceptions."

**Total backend tests: ~38 tests across 6 test files**
**Total frontend tests: 0**

---

## 4. Docker Configuration

### Frontend Build Arg Issue (CRITICAL)

**docker-compose.yml** sets `NEXT_PUBLIC_API_URL` as a runtime `environment` variable. Next.js `NEXT_PUBLIC_*` variables are **baked in at build time** via `next build`. They must be passed as **build args** in the Dockerfile, not runtime env vars.

**Without this fix, `process.env.NEXT_PUBLIC_API_URL` will be `undefined` in the built production container**, causing all API calls to fall back to `http://localhost:8000` (which works during local dev with `docker-compose` port mapping but will break in production).

---

## 5. Frontend API Integration

### Endpoint Coverage

| Backend Endpoint | `lib/api.ts` Function | Used In | Status |
|-----------------|----------------------|---------|--------|
| `GET /health` | **NOT COVERED** | -- | N/A (not needed for UI) |
| `GET /api/v1/resources` | `fetchResources()` | `dashboard/page.tsx` | PASS |
| `GET /api/v1/resources/sectors` | `fetchSectors()` | `dashboard/page.tsx` | PASS |
| `GET /api/v1/resources/types` | `fetchResourceTypes()` | `dashboard/page.tsx` | PASS |
| `GET /api/v1/resources/summary` | `fetchSummary()` | `dashboard/page.tsx` | PASS |
| `POST /api/v1/reports/submit` | `submitReport()` | Report submission form | PASS |
| `GET /api/v1/reports` | `fetchReports()` | `intel-table.tsx` | PASS |
| `GET /api/v1/reports/{id}` | `fetchReport()` | Available but not used in current UI | PASS |
| `POST /api/v1/reports/process-pending` | `processAllPendingReports()` | `intel-table.tsx` (auto + manual) | PASS |
| `GET /api/v1/forecasts` | `fetchForecasts()` | `dashboard/page.tsx` | PASS |
| `GET /api/v1/forecasts/{sector}/{resource}` | `fetchForecast()` | Available but not used in current UI | PASS |
| `POST /api/v1/forecasts/refresh` | `refreshForecasts()` | `dashboard/page.tsx` (Refresh button) | PASS |
| `GET /api/v1/admin/redaction-log` | **NOT COVERED** | -- | **FAIL** (endpoint doesn't exist yet) |

---

## Prioritized Fix List

### P0 -- Demo-Breaking

1. **Fix `NEXT_PUBLIC_API_URL` Docker build arg** -- Frontend API calls will not reach the backend in production containers
   - File: `docker-compose.yml`, `src/frontend/Dockerfile`
   - Change: Pass as build arg, not runtime env var

2. **Implement `GET /api/v1/admin/redaction-log` endpoint** -- Needed to demonstrate PII redaction during the 5-minute presentation
   - File: New `src/backend/app/routers/admin.py`
   - The data already exists in the `redaction_log` table; just needs an API to expose it

### P1 -- Quality Gate Violations

3. **Add frontend tests** -- Zero test files violates "All code must have tests. No exceptions."
   - Minimum: test `api.ts` fetch functions, test key components render

### P2 -- UX Improvement

4. **Fix sector/resource filter UX** -- The two independent dropdowns are misleading given the 1:1 mapping
   - File: `src/frontend/app/dashboard/page.tsx` lines 181-207
   - Options: (a) Remove resource_type dropdown, (b) make it dependent on sector, (c) use a single combined dropdown

### P3 -- Schema Compliance

5. **Add 7 missing database indexes** -- Spec deviation; won't affect demo with small dataset
6. **Change `JSON` to `JSONB`** for `intel_reports.metadata_json` and `intel_reports.extracted_entities`

### P4 -- Cleanup

7. **Verify `gpt-5.2` model string** in `src/backend/app/services/jarvis_llm.py:34` -- Ensure this is an available OpenAI model or update to a valid one
