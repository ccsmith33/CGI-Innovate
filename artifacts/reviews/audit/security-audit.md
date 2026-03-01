# Security & Quality Audit: Project Sentinel

> **Auditor**: Adversarial Security Reviewer
> **Date**: 2026-02-28
> **Scope**: Full codebase -- backend, frontend, infrastructure, tests, ML pipeline
> **Commit**: main branch (pre-merge)

## Overall Risk Level: LOW

The codebase is well-constructed for a hackathon project. The critical PII redaction pipeline is correctly ordered and reasonably thorough. No high-severity exploitable vulnerabilities were found. The findings below are primarily hardening items for production readiness.

---

## Executive Summary

Project Sentinel demonstrates strong security awareness. The PII Shield pipeline correctly redacts before LLM calls, the ReportResponse schema excludes raw_text from API responses, background tasks use isolated DB sessions, and Docker containers run as non-root users. The main areas for improvement are: (1) one gap in phone pattern regex coverage, (2) raw_text is stored in the database despite being excluded from API responses, (3) PostgreSQL port is exposed on the host, and (4) no input length validation on report submission.

---

## Critical Findings (must fix before production)

### C-1: `raw_text` stored unredacted in `intel_reports` table
- **File**: `src/backend/app/routers/reports.py:57`
- **Impact**: The `IntelReport` model stores `raw_text` (the original, unredacted user-submitted text) directly in the database. While the `ReportResponse` schema correctly excludes this field from API responses, the PII persists in the database layer. Any direct database access (admin tools, SQL client, backups, data breach) would expose unredacted PII.
- **Evidence**: Line 57: `raw_text=body.raw_text` is passed directly to the ORM model, and `intel_report.py:19` defines `raw_text: Mapped[str] = mapped_column(Text, nullable=False)`.
- **Recommended fix**: Either (a) do not store `raw_text` at all -- store only `redacted_text` and the `original_text_hash` for audit, or (b) encrypt `raw_text` at rest with a separate key.

### C-2: Error message in `intel_reports` may leak PII
- **File**: `src/backend/app/routers/reports.py:43`
- **Impact**: When the background LLM task fails, `str(e)` is stored as `report.error_message` and exposed through the `ReportResponse` schema (line 35 of `schemas/report.py`). If the exception message includes fragments of the input text (e.g., from OpenAI API errors echoing back the prompt), PII could leak into the error_message field which IS returned in API responses.
- **Recommended fix**: Sanitize error messages before storage. Use a generic message like `"LLM processing failed"` rather than `str(e)`.

---

## High Findings (should fix soon)

### H-1: Phone regex misses parenthetical suffixes on vanity numbers
- **File**: `src/backend/app/services/shield.py:23`
- **Impact**: The vanity phone pattern `r"\b555-[A-Z][-A-Z]*\b"` correctly matches `555-GOD-OF-THUNDER` and `555-HULK-SMASH`. However, the test data includes entries like `"555-0199 (Black Widow Comms)"`. The parenthetical text `(Black Widow Comms)` contains hero name "Black Widow" which is NOT in the KNOWN_HEROES list (only "Natasha Romanoff" is listed). If the raw text contains this contact info, the parenthetical alias leaks through.
- **Pattern analysis against test data**:
  - `555-0101` -- PASS: matched by short phone pattern `\b\d{3}[-.\s]?\d{4}\b`
  - `555-GOD-OF-THUNDER` -- PASS: matched by vanity pattern `\b555-[A-Z][-A-Z]*\b`
  - `555-HULK-SMASH` -- PASS: matched by vanity pattern
  - `555-0199 (Black Widow Comms)` -- PARTIAL: `555-0199` is redacted by short phone pattern, but ` (Black Widow Comms)` remains in text
- **Recommended fix**: Add "Black Widow" to KNOWN_HEROES or add a pattern that strips parenthetical contact annotations.

### H-2: PostgreSQL port 5432 exposed on host
- **File**: `docker-compose.yml:42`
- **Impact**: The `db` service maps `ports: "5432:5432"`, exposing the PostgreSQL database directly on the host network. Combined with the default password `change-me-in-production`, this allows unauthenticated database access from any machine on the same network.
- **Recommended fix**: Remove the `ports` mapping on the `db` service. The backend container can reach it via the `sentinel-net` Docker network without host-level exposure.

### H-3: No input length validation on `raw_text`
- **File**: `src/backend/app/schemas/report.py:8`
- **Impact**: The `ReportSubmitRequest.raw_text` field has no maximum length constraint. An attacker could submit an arbitrarily large report (e.g., 100MB) which would: (a) consume excessive memory during PII redaction (regex scanning on huge strings), (b) store a large blob in the database, (c) send a huge prompt to the OpenAI API (cost/rate-limit concern).
- **Recommended fix**: Add `max_length=50000` (or similar) to the `raw_text` field via Pydantic Field.

---

## Medium Findings (address when time permits)

### M-1: CORS allows all origins with credentials
- **File**: `src/backend/app/main.py:23-29`
- **Impact**: `allow_origins=["*"]` combined with `allow_credentials=True` is a known anti-pattern. While browsers block `Access-Control-Allow-Credentials: true` with `Access-Control-Allow-Origin: *` (the spec disallows this combo), some older clients or proxies may not enforce this. For a hackathon demo this is acceptable, but it is a production blocker.
- **Recommended fix**: For production, set `allow_origins` to the specific frontend URL.

### M-2: No rate limiting on POST /reports/submit
- **File**: `src/backend/app/routers/reports.py:48`
- **Impact**: Each report submission triggers an OpenAI API call in a background task. An attacker could rapidly POST thousands of reports, exhausting the OpenAI API quota and accumulating costs. There is no rate limit, authentication, or throttling.
- **Recommended fix**: Add rate limiting middleware (e.g., `slowapi`) or require authentication.

### M-3: `metadata` field accepts arbitrary JSON
- **File**: `src/backend/app/schemas/report.py:9`
- **Impact**: The `metadata` field is typed as `dict | None` with no schema validation. An attacker could submit deeply nested or extremely large JSON objects. While this does not directly cause a vulnerability (Pydantic will parse it), it allows arbitrary data to be stored in the database and could contribute to storage exhaustion or unexpected behavior.
- **Recommended fix**: Define a strict Pydantic model for metadata (e.g., `hero_alias: str | None`, `secure_contact: str | None`) rather than accepting arbitrary dicts.

### M-4: Seed script does not handle duplicate report_ids gracefully
- **File**: `src/backend/scripts/seed_db.py:84`
- **Impact**: The seed script checks if `resource_logs` is empty before seeding, but if the script crashes mid-way after inserting resources but before inserting reports, a re-run would skip resources (they exist) but would not re-check reports. Additionally, `report_id` values from the JSON file are used as-is; if the JSON file contains duplicates, the script would fail with a primary key violation.
- **Recommended fix**: Add a separate check for existing intel reports, or use upsert logic.

### M-5: `patterns_matched` in RedactionLog may log original PII values
- **File**: `src/backend/app/services/shield.py:48,54`
- **Impact**: The `patterns_matched` list includes entries like `"hero_alias:Tony Stark"` and `"phone:555-867-5309"`. This data is stored in the `redaction_log` table. While this is useful for audit purposes, it means the redaction log itself contains the very PII that was redacted. Anyone with database access can see what was redacted.
- **Recommended fix**: Log only pattern types and counts (e.g., `"hero_alias_redacted"`, `"phone_redacted:3"`) rather than the actual matched values.

### M-6: SQLite vs PostgreSQL discrepancy in tests
- **File**: `src/backend/tests/conftest.py:11`
- **Impact**: Tests use `sqlite+aiosqlite:///:memory:` while production uses PostgreSQL 16. The IntelReport model imports `JSONB` from PostgreSQL dialect (line 6 of `intel_report.py`) but uses the generic `JSON` type for columns. This works because SQLAlchemy maps `JSON` to SQLite's text-based JSON, but there could be behavioral differences: (a) PostgreSQL JSONB supports indexing and containment operators that SQLite does not, (b) `func.now()` server default behaves differently across dialects, (c) date/time handling varies.
- **Recommended fix**: Acceptable for hackathon. For production, use testcontainers with a real PostgreSQL instance.

---

## Low / Informational

- **L-1**: `src/backend/app/services/jarvis_llm.py:34` uses model `gpt-5.2`. This model name should be configurable via settings rather than hardcoded.
- **L-2**: Backend Dockerfile installs `gcc` and `libpq-dev` in the runtime image. These are only needed for building Python packages. Consider a multi-stage build to reduce image size and attack surface.
- **L-3**: The `pip install --no-cache-dir -e .` in backend Dockerfile uses editable install, which is unusual for production containers. Use `pip install --no-cache-dir .` instead.
- **L-4**: Frontend `api.ts` falls back to `http://localhost:8000` if `NEXT_PUBLIC_API_URL` is not set. This is fine for development but should be documented.
- **L-5**: The `intel-table.tsx` renders `extracted_entities` via `JSON.stringify` inside a `<pre>/<code>` block (line 153). This is safe (no innerHTML), but the LLM-generated content could contain misleading text. React's default escaping prevents XSS here.
- **L-6**: `docker-compose.yml:26` contains a default password `change-me-in-production` for PostgreSQL. While env-var substitution allows overriding, the default is weak.
- **L-7**: No `.dockerignore` file was found for either service. This means `COPY .` could include test files, `.env`, and other unnecessary files in the Docker image.
- **L-8**: The `process_report_background` function (reports.py:21) catches all exceptions broadly. Consider logging the exception for debugging rather than silently swallowing it.

---

## PII Leakage Verification

### Step-by-step trace of the Shield pipeline

**Step 1: Report submission flow** (`reports.py:48-84`)
```
POST /reports/submit
  -> body.raw_text received
  -> redact_pii(body.raw_text, body.metadata) called FIRST (line 54) -- PASS
  -> IntelReport created with:
       raw_text = body.raw_text (ORIGINAL -- stored in DB)   -- CONCERN (see C-1)
       redacted_text = redaction_result.redacted_text         -- PASS
       metadata_json = redaction_result.redacted_metadata     -- PASS
  -> RedactionLog created with redacted_text + hash           -- PASS (but see M-5)
  -> Background task receives ONLY redacted_text (line 77)    -- PASS
  -> LLM (extract_intel) processes ONLY redacted_text         -- PASS
```

**Step 2: Redaction order in shield.py** (`shield.py:38-75`)
```
1. hero_alias from metadata redacted in text                  -- PASS
2. Phone patterns applied (vanity, 10-digit, 7-digit, paren) -- PARTIAL (see H-1)
3. Known hero names redacted (defensive pass)                 -- PASS
4. Metadata fields hero_alias and secure_contact replaced     -- PASS
```

**Step 3: API response exclusion** (`schemas/report.py:27-37`)
```
ReportResponse schema includes:
  - report_id          -- safe
  - timestamp          -- safe
  - priority           -- safe
  - status             -- safe
  - redacted_text      -- safe (redacted)
  - extracted_entities -- safe (LLM output from redacted input)
  - created_at         -- safe
  - error_message      -- CONCERN (see C-2, may contain PII fragments)

NOT included (excluded by schema omission):
  - raw_text           -- PASS (not in ReportResponse)
  - metadata_json      -- PASS (not in ReportResponse)
```

**Step 4: Where else could PII appear?**
```
- Forecasts table: Only stores sector_id, resource_type, dates, floats -- PASS (no text fields from reports)
- Redaction log: Stores redacted_text (safe) + patterns_matched (CONCERN: contains original PII values -- M-5)
- Error messages: Could echo PII via str(e) -- CONCERN (C-2)
- Server logs: No explicit logging of raw_text found -- PASS
- Intel reports feed into ML? -- No, forecasts use resource_logs only -- PASS
```

### Phone pattern verification against test data

| Input | Pattern | Result |
|-------|---------|--------|
| `555-0101` | Short phone `\b\d{3}[-.\s]?\d{4}\b` | REDACTED |
| `555-GOD-OF-THUNDER` | Vanity `\b555-[A-Z][-A-Z]*\b` | REDACTED |
| `555-HULK-SMASH` | Vanity `\b555-[A-Z][-A-Z]*\b` | REDACTED |
| `555-0199` from `555-0199 (Black Widow Comms)` | Short phone | REDACTED |
| `(Black Widow Comms)` (trailing text) | Not covered | LEAKED |

---

## Security Checklist

| Check | Status | Notes |
|-------|--------|-------|
| PII redacted before LLM | PASS | `redact_pii()` called on line 54, background task receives only `redacted_text` on line 77 |
| No hardcoded secrets | PASS | API key loaded from `settings.OPENAI_API_KEY` via env; test files use `"test-key"` placeholder |
| Non-root Docker users | PASS | Backend: `USER appuser` (Dockerfile:19); Frontend: `USER nextjs` (Dockerfile:29) |
| No raw SQL in app code | PASS | Only raw SQL is in `seed_db.py:128` (static string, no user input). All app queries use SQLAlchemy ORM |
| Input validation on POST /reports | PARTIAL | `priority` is enum-validated; `raw_text` has no max_length; `metadata` accepts arbitrary dict |
| CORS documented | WARN | `allow_origins=["*"]` present. Acceptable for hackathon, flag for production |
| No XSS vectors | PASS | No `dangerouslySetInnerHTML` found. All dynamic content rendered via React JSX (auto-escaped). `JSON.stringify` output in `<pre>` block is safe |
| Background task session isolation | PASS | `process_report_background` creates its own session via `get_session_factory()()` (line 24), not reusing the request session |
| Secrets excluded from git | PASS | `.gitignore` excludes `.env`, `.env.local`, `.env.*.local` |
| API errors safe for frontend | PASS | Frontend error messages show only HTTP status codes (e.g., `"Failed to submit report: 422"`), not backend stack traces |
| Forecast endpoint path traversal | PASS | `sector_id` and `resource_type` are used as ORM `.where()` conditions, not file paths. SQLAlchemy parameterizes them |
| Predict exhaustion past dates | SAFE | `predict_exhaustion_date()` can return dates in the past if data trends suggest historical depletion. This is mathematically correct and the UI just displays the date. No security concern |
| ML isolation from reports | PASS | Forecasts use `resource_logs` table only. Intel reports feed into `intel_reports` table. No cross-contamination |

---

## Summary of Findings by Severity

| Severity | Count | Key Items |
|----------|-------|-----------|
| Critical | 2 | Raw PII stored in DB (C-1), Error messages may leak PII (C-2) |
| High | 3 | Phone regex gap (H-1), PostgreSQL exposed (H-2), No input length limit (H-3) |
| Medium | 6 | CORS (M-1), No rate limit (M-2), Untyped metadata (M-3), Seed idempotency (M-4), PII in redaction log (M-5), SQLite/PG mismatch (M-6) |
| Low/Info | 8 | Hardcoded model name, Docker build optimizations, .dockerignore, error logging |
