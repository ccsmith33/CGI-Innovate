# QA Audit: Project Sentinel

## Demo Readiness: AT RISK

The system is architecturally sound and implements all major features, but several issues could cause visible failures during the 5-minute live demo. The most critical risks are: (1) no automatic seed execution on `docker compose up`, (2) no wait-for-db logic before backend starts, (3) the OpenAI API call to model `gpt-5.2` which does not exist and will fail, and (4) the `NEXT_PUBLIC_API_URL` set to `http://localhost:8000` inside the Docker container where `localhost` does not resolve to the host.

---

## Critical Demo Risks

### RISK-1: Frontend cannot reach backend inside Docker (CRITICAL)
- **File:** `docker-compose.yml:12` -- `NEXT_PUBLIC_API_URL=http://localhost:8000`
- **Problem:** `NEXT_PUBLIC_*` environment variables in Next.js are baked in at **build time**, not runtime. Even if changed to a runtime variable, the browser-side JavaScript executes on the presenter's machine, so it needs `http://localhost:8000`. However, Next.js standalone mode with `output: 'standalone'` does not inject env vars at runtime. If the build happens inside Docker without the correct env var, the frontend will make API calls to the wrong URL.
- **Mitigation:** Because `lib/api.ts` line 3 falls back to `http://localhost:8000` when the env var is empty, AND the frontend runs on the user's browser (port-mapped to 3000), the browser calls to `http://localhost:8000` WILL reach the backend port-mapped to 8000. This should work **as long as the fallback is used** and the build-time env var doesn't override it with something wrong. Risk is **moderate** -- it will likely work but is fragile.

### RISK-2: No automatic database seeding (HIGH)
- **File:** `docker-compose.yml` -- no seed step defined
- **Problem:** `docker compose up --build` starts the three services but does NOT run `seed_db.py`. The database starts empty. The presenter must manually exec into the backend container and run `python scripts/seed_db.py`. If they forget, the dashboard shows empty charts, the forecast page has no data, and the demo looks broken.
- **Impact:** Empty dashboard on first launch. Demo flow breaks immediately.

### RISK-3: OpenAI model `gpt-5.2` does not exist (HIGH)
- **File:** `src/backend/app/services/jarvis_llm.py:34` -- `model="gpt-5.2"`
- **Problem:** As of February 2026, there is no model named `gpt-5.2` in the OpenAI API. This will return a 404 or model-not-found error from OpenAI. The error handling will catch it and return fallback `{severity: "unknown", summary: "Parse failed", confidence: 0}`, so no 500 crash, but the demo's "show processing flow" step will always show "Parse failed" instead of real extracted intelligence.
- **Impact:** The LLM entity extraction feature -- a core differentiator for scoring -- will not work. All submitted reports will show `severity: unknown, summary: Parse failed`.

### RISK-4: No wait-for-db on backend startup (MEDIUM)
- **File:** `docker-compose.yml:28-29` -- `depends_on: db: condition: service_healthy`
- **Assessment:** The `db` service has a healthcheck using `pg_isready`, and the backend waits for it with `condition: service_healthy`. This is correctly configured. However, the lifespan handler in `main.py:16` runs `Base.metadata.create_all` which could race with migrations. **Risk is LOW** because the healthcheck should gate it properly.

### RISK-5: Backend Dockerfile uses `pip install -e .` (MEDIUM)
- **File:** `src/backend/Dockerfile:13` -- `RUN pip install --no-cache-dir -e .`
- **Problem:** Editable install (`-e .`) in Docker means the package references the COPY'd source. But the `COPY . .` happens AFTER the pip install. The pip install runs against just the `pyproject.toml` with no source code present, which will fail or produce incomplete results for projects with `[project.scripts]` or custom build backends.
- **Assessment:** For a pure FastAPI app with dependencies declared in pyproject.toml, `pip install -e .` will install dependencies but the package itself may not be importable until `COPY . .`. This works because uvicorn imports directly from the file system, not from an installed package. But it is fragile and may cause build failures depending on pyproject.toml configuration.

### RISK-6: Seed script data path resolution (MEDIUM)
- **File:** `src/backend/scripts/seed_db.py:110-114`
- **Problem:** The seed script looks for data at a path relative to the script file: `../../Prompt-Resources/challenger_package/challenger_package/`. Inside the Docker container, the Prompt-Resources directory is NOT copied into the backend image (the Dockerfile only copies `./src/backend`). The seed script will fail with a FileNotFoundError inside Docker.
- **Impact:** Even if you remember to seed, you can't do it from inside the container.

---

## Test Suite Quality Assessment

### test_shield.py (9 tests) -- GOOD
- **Assertion quality:** Strong. Tests verify both positive conditions (`[REDACTED-NAME]` present) AND negative conditions (original PII string absent). Example: `test_no_pii_in_output` (line 56-67) checks 6 different PII values are absent from output.
- **Edge cases missing:**
  - Empty string input (`redact_pii("")`)
  - Very long strings (1MB+ text)
  - Special characters in hero names (T'Challa apostrophe -- tested indirectly via KNOWN_HEROES list but not explicitly)
  - Unicode characters in text
  - Multiple occurrences of the same hero name
  - Metadata with extra unexpected keys
  - Phone numbers at text boundaries (start/end of string)
- **Isolation:** Tests are fully isolated -- no shared state, no DB dependency, pure unit tests.
- **Overall:** Best test file in the suite. Thorough behavioral testing with specific assertions.

### test_jarvis_llm.py (5 tests) -- GOOD
- **Assertion quality:** Good. Tests cover happy path, malformed JSON, missing fields, API errors, and no API key.
- **Edge cases missing:**
  - LLM returns JSON with unexpected/extra keys (e.g., `{"sector_id": "Wakanda", "extra_field": "foo"}`) -- actually handled by Pydantic `model_validate` but not tested
  - LLM returns empty string content
  - LLM returns valid JSON but with wrong value types (e.g., `confidence: "high"` instead of a float)
  - Rate limit (429) specifically -- tested generically via `Exception("API timeout")`
- **Isolation:** Properly mocked -- no real OpenAI calls. Settings patched correctly.
- **Overall:** Solid mock-based testing. Covers the critical failure modes.

### test_jarvis_forecast.py (7 tests) -- GOOD with GAPS
- **Assertion quality:** Unit tests are strong (synthetic data, known slopes, 5% tolerance). Router tests are weaker.
- **Edge cases missing:**
  - All data points are snap events (every row filtered out) -- `snap_aware.py` line 32 falls back to using all data, but this is not tested
  - Only 1 data point (not enough for regression)
  - Zero stock levels throughout
  - Identical timestamps (division issues)
  - Very large stock values
- **Router test gaps:**
  - `test_forecast_router_list` only checks status 200 and `data` key exists -- does not verify forecast content
  - `test_forecast_router_specific_not_found` is a good negative test
  - `test_forecast_refresh` checks 202 and verifies forecasts exist -- good integration test
- **Isolation:** Uses the seeded test database from conftest.py. Tests are properly scoped.

### test_health.py (1 test) -- MINIMAL but SUFFICIENT
- Tests the health endpoint returns 200 with correct body. Adequate for its scope.

### test_resources_router.py (7 tests) -- GOOD
- **Assertion quality:** Good. Tests verify filtering, sector/type lists, summary structure, and pagination.
- **Edge cases missing:**
  - Invalid sector name (nonexistent sector) -- should return empty data, not 500
  - Special characters in query params (URL encoding)
  - Pagination beyond total (offset > total_count)
  - Negative limit/offset values
- **Isolation:** Uses seeded test database. Properly isolated.

### test_reports_router.py (6 tests) -- GOOD with IMPORTANT GAP
- **Assertion quality:** Good. Tests cover submission, retrieval, listing, 404, and field exclusion.
- **Critical gap:** `test_submit_report_creates_redaction_log` (line 22) does NOT actually verify the redaction_log table was populated. It only checks that the report was stored and the status is processing/processed. The story acceptance criterion says "redaction_log row is written" -- this is NOT directly tested.
- **Edge cases missing:**
  - Submit with empty `raw_text` (empty string) -- what happens?
  - Submit with extremely long raw_text
  - Submit with invalid priority value (should get validation error)
  - Submit with no metadata at all (None)
  - Submit with metadata containing unexpected keys

### conftest.py -- GOOD with NOTE
- **SQLite vs PostgreSQL:**
  - Uses `sqlite+aiosqlite:///:memory:` for tests
  - Models use `JSON` type (not `JSONB`) in most cases, which is SQLite-compatible
  - `intel_report.py` imports `JSONB` from `sqlalchemy.dialects.postgresql` but actually uses `JSON` type in column definitions -- this is correct for SQLite compatibility
  - `server_default=func.now()` works on both PostgreSQL and SQLite
  - UUID is stored as `String(36)` not as a PostgreSQL UUID type -- compatible
  - **No incompatibility found** -- the test DB is a faithful substitute

---

## Acceptance Criteria Coverage

### Story 1: The Vault (Backend Foundation)
| Criterion | Implemented | Tested |
|-----------|-------------|--------|
| `docker-compose up` starts 3 services | YES | NO (manual verification) |
| `GET /health` returns 200 | YES | YES (`test_health.py`) |
| Seed script loads ~2000 rows | YES | NO (seed_db.py exists but no test) |
| `GET /resources?sector=Wakanda` | YES | YES (`test_filter_by_sector`) |
| `GET /resources/sectors` returns 5 sectors | YES | YES (`test_get_sectors`) |
| `GET /resources/types` returns 5 types | YES | YES (`test_get_types`) |
| `GET /resources/summary` | YES | YES (`test_get_summary`) |
| All resource tests pass | YES | YES |

**Gaps:** Seed script has no automated test. Docker-compose not integration-tested.

### Story 2: The Shield (PII Redaction)
| Criterion | Implemented | Tested |
|-----------|-------------|--------|
| "Tony Stark" replaced with [REDACTED-NAME] | YES | YES (`test_redact_hero_alias_from_text`) |
| "555-0101 (Iron Line)" phone redacted | YES | YES (`test_redact_short_phone`) |
| "555-GOD-OF-THUNDER" vanity redacted | YES | YES (`test_redact_vanity_phone`) |
| Standard phone "555-867-5309" redacted | YES | YES (`test_redact_standard_phone`) |
| hero_alias from metadata redacted in text | YES | YES (`test_redact_hero_alias_from_text`) |
| Known heroes caught by defensive pass | YES | YES (`test_redact_known_hero_inline`) |
| redaction_log row written with SHA-256 hash | YES | PARTIALLY (router test checks report exists but doesn't query redaction_log table directly) |
| POST returns 202 with report_id | YES | YES (`test_submit_report_returns_202`) |
| All shield tests pass | YES | YES |

**Gaps:** Redaction log table population is not directly verified in tests.

### Story 3: Jarvis AI (LLM Entity Extraction)
| Criterion | Implemented | Tested |
|-----------|-------------|--------|
| POST returns 202 immediately | YES | YES (`test_submit_report_returns_202`) |
| GET /reports/{id} shows status=processed with entities | YES | PARTIALLY (test checks status but not entity content) |
| Malformed JSON fallback | YES | YES (`test_malformed_json_fallback`) |
| Missing fields fallback | YES | YES (`test_missing_fields_fallback`) |
| GET /reports returns paginated list | YES | YES (`test_get_reports_list`) |
| GET /reports/{id} returns 404 for nonexistent | YES | YES (`test_get_report_not_found`) |
| All LLM tests pass | YES | YES |

**Gaps:** No test verifies that `extracted_entities` contains specific expected fields after processing. Background task timing makes this hard to test deterministically.

### Story 4: Jarvis ML (Forecasting)
| Criterion | Implemented | Tested |
|-----------|-------------|--------|
| Snap-flagged rows filtered | YES | YES (`test_snap_filtering`) |
| Time-to-Zero within +/-5% | YES | YES (`test_linear_regression_synthetic_data`) |
| Slope >= 0: exhaustion is None | YES | YES (`test_slope_positive_no_exhaustion`) |
| R-squared computed | YES | YES (`test_r_squared_computed`) |
| GET /forecasts returns all | YES | YES (`test_forecast_router_list`) |
| GET /forecasts/{sector}/{resource_type} | YES | YES (`test_forecast_router_specific_not_found`) |
| POST /forecasts/refresh returns 202 | YES | YES (`test_forecast_refresh`) |
| All forecast tests pass | YES | YES |

**Gaps:** No test for GET /forecasts/{sector}/{resource_type} returning 200 with valid data. Only the 404 case is tested.

### Story 5: HUD Dashboard (Frontend)
| Criterion | Implemented | Tested |
|-----------|-------------|--------|
| Next.js scaffolded with TS, Tailwind, App Router | YES | NO |
| shadcn/ui initialized with components | YES | NO |
| Dashboard shows historical charts | YES | NO |
| Sector/resource filter dropdowns | YES | NO |
| Forecast overlay as dashed line | YES | NO |
| Sector summary bar chart | YES | NO |
| Hover tooltips | YES | NO |
| Recharts Brush for zoom | YES | NO |
| SWR auto-refresh every 5 seconds | YES | NO |
| Sidebar navigation | YES | NO |
| Dark theme | YES | NO |
| `output: 'standalone'` | YES | NO |
| Frontend Dockerfile | YES | NO |

**Gaps:** ZERO frontend tests. All criteria are implemented but none are tested.

### Story 6: HUD Input + Intel Table (Frontend)
| Criterion | Implemented | Tested |
|-----------|-------------|--------|
| Reports page at /reports | YES | NO |
| Form has required fields | YES | NO |
| Redaction labels on inputs | YES | NO |
| Priority select options | YES | NO |
| Submit POSTs and shows report_id | YES | NO |
| Intel table polls every 3s | YES | NO |
| Table columns correct | YES | NO |
| Status badge colors | YES | NO |
| Priority badge colors | YES | NO |
| Expandable rows with JSON | YES | NO |
| Sidebar links | YES | NO |

**Gaps:** ZERO frontend tests. All criteria are implemented but none are tested.

---

## Edge Cases Not Handled

| # | Scenario | Expected Behavior | Actual/Likely Behavior |
|---|----------|-------------------|----------------------|
| 1 | Empty `raw_text` submitted via API | 422 validation error | **Accepted** -- `ReportSubmitRequest` has no `min_length` validator on `raw_text`. Empty string passes. Redaction runs on empty string. LLM receives empty text. |
| 2 | `raw_text` is only whitespace | 422 validation error or meaningful rejection | Same as #1 -- accepted and processed. Form UI disables submit when `!rawText.trim()` but API has no server-side validation. |
| 3 | OpenAI returns 429 rate limit | Show graceful error to user, retry | Error caught by generic `except`, report set to `status="error"`. No retry. No user-visible feedback beyond "Parse failed" in the table. |
| 4 | All stock levels at zero | Forecast shows "already exhausted" or similar | Regression fits with intercept=0 and slope~0. `slope >= 0` check returns `predicted_exhaustion_date=None`. No indication that resources are **already** exhausted. |
| 5 | Sector name with spaces in URL | URL-encoded properly | `forecasts.py:44` uses `{sector_id}` path param -- FastAPI URL-decodes automatically. "Sanctum Sanctorum" works. Frontend `api.ts:52` uses `encodeURIComponent`. **Handled correctly.** |
| 6 | Backend not running when frontend loads | Show error state | SWR `error` state handled in `intel-table.tsx:60-68` showing "Failed to load reports. Is the API running?". Dashboard page likely has similar handling. **Partially handled.** |
| 7 | Intel table is empty (no reports) | Show empty state message | `intel-table.tsx:77-79` shows "No intelligence reports yet." **Handled correctly.** |
| 8 | All snap_flags are True (all data filtered) | Handle gracefully | `snap_aware.py:32` falls back to using all unfiltered data. Regression runs on outlier data. Result may be nonsensical but won't crash. |
| 9 | LLM returns unexpected keys in JSON | Ignore extra keys | Pydantic `model_validate` with default config ignores extra fields. **Handled correctly.** |
| 10 | Single data point for forecasting | Handle edge case | `linear_regression.py:23-29` handles `len(timestamps) < 2` by setting slope=0, intercept=stock_levels[0]. No crash but returns no exhaustion date. **Handled.** |
| 11 | `snap_flags` is a list of all False values | `if snap_flags:` evaluates to True | `snap_aware.py:18` -- `if snap_flags:` -- a non-empty list of `[False, False, ...]` evaluates to `True`, so filtering runs but filters nothing out. `self._snap_detected = any(snap_flags) = False`. **Correct behavior.** |
| 12 | Frontend SWR polling gets network error | Recover gracefully | SWR retries on error by default with exponential backoff. UI shows loading state until recovery. **Handled by SWR defaults.** |
| 13 | Report submitted with invalid priority via direct API call | 422 error | `ReportSubmitRequest` has `field_validator` that rejects invalid priorities. Returns 422. **Handled correctly.** |

---

## Seed Script Analysis

### Idempotency: PARTIAL
- **File:** `src/backend/scripts/seed_db.py:128-131`
- The script checks `SELECT COUNT(*) FROM resource_logs` and skips if rows exist.
- **Problem 1:** Only checks `resource_logs` table. If resource_logs were seeded but intel_reports were not (e.g., script crashed between the two), running again would skip everything, leaving intel_reports empty.
- **Problem 2:** If a `report_id` from the JSON file conflicts with an existing report (e.g., partial re-run), `session.add(report)` with a duplicate primary key will crash with an IntegrityError.
- **Assessment:** The idempotency check is simple but sufficient for the happy path. A second clean run will correctly skip. Partial failure recovery is not handled.

### Error Handling: MINIMAL
- No try/except around CSV parsing or JSON loading.
- If the CSV file is missing, the script crashes with FileNotFoundError (no graceful message).
- If a row has invalid data types, pandas may coerce silently or crash.

### Path Resolution: FRAGILE
- Hardcoded relative path resolution from script location.
- Will not work inside Docker container (data files not copied into image).

### Data Correctness
- Aggregation logic (groupby + mean) is correct.
- `snap_event_detected` uses `any()` correctly (True if any replica detected snap).
- Intel reports are seeded with redaction applied -- this is correct.

---

## Missing Frontend Tests

There are **ZERO** frontend test files outside of `node_modules/`. No test runner (Jest, Vitest, Playwright, etc.) is configured.

### Top 3 Components That Should Have Tests

1. **`report-form.tsx`** -- The most critical interactive component. Tests should verify:
   - Form submission calls the API with correct payload
   - Submit button disabled when `rawText` is empty
   - Error state displays on API failure
   - Form clears after successful submission

2. **`intel-table.tsx`** -- Core data display for the demo. Tests should verify:
   - Table renders report data correctly
   - Empty state message shows when no reports
   - Error state shows when API is down
   - Row expansion/collapse works
   - SWR polling is configured with correct interval

3. **`lib/api.ts`** -- Data layer. Tests should verify:
   - Correct URL construction with query params
   - Error thrown on non-200 responses
   - `encodeURIComponent` applied to path params

---

## Recommendations (priority ordered)

### P0: Fix before demo (will likely cause visible failure)

1. **Fix OpenAI model name** -- Change `gpt-5.2` to a valid model (e.g., `gpt-4o` or `gpt-4-turbo`). Current model name will cause every LLM extraction to fail silently with "Parse failed". This is the most impactful single fix.
   - File: `src/backend/app/services/jarvis_llm.py:34`

2. **Add seed step to docker-compose or a startup script** -- Create an entrypoint script for the backend that waits for DB, runs migrations/seed, then starts uvicorn. Or add a one-shot seed service to docker-compose. Without this, the presenter must manually seed the DB.

3. **Ensure data files are accessible for seeding** -- Either mount `Prompt-Resources/` as a volume in docker-compose, or copy the data files into the backend Docker image.

### P1: Fix if time allows (could cause issues but recoverable)

4. **Add `min_length=1` validator on `ReportSubmitRequest.raw_text`** -- Prevents empty report submissions from the API. The frontend already prevents empty submissions via UI, but direct API calls can bypass this.
   - File: `src/backend/app/schemas/report.py:8`

5. **Add the missing positive-path test for GET /forecasts/{sector}/{resource_type}** returning 200 -- Only the 404 case is tested. The story specifies this endpoint should be tested with valid data.

6. **Add a direct redaction_log verification test** -- The story acceptance criterion says "redaction_log row is written" but no test queries the redaction_log table to verify this.

### P2: Nice to have (won't break demo but improve quality)

7. **Add frontend smoke tests** -- Even a single test that verifies the pages render without crashing would add confidence.

8. **Add edge case tests for shield.py** -- Empty string, special characters (T'Challa apostrophe), very long input.

9. **Handle "already exhausted" scenario in forecasts** -- When all stock levels are zero, the current behavior returns `predicted_exhaustion_date=None` (same as "stock increasing"), which is misleading.

10. **Add retry logic or timeout handling for OpenAI calls** -- Currently a single failure = permanent "Parse failed" status with no recovery path.
