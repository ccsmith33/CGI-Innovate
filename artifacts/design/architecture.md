# Project Sentinel -- System Architecture

> **Version**: 1.0
> **Date**: 2026-02-28
> **Status**: Proposed -- Awaiting Human Approval
> **Author**: Architecture Agent

---

## 1. Executive Summary

Project Sentinel is a Command & Control (C2) dashboard for real-time resource management during a simulated multi-sector crisis ("The Avengers Initiative"). The system ingests 10,000 rows of historical time-series data and 200 unstructured field intelligence reports, then provides:

1. **Interactive analytics** -- sector-by-sector resource stock visualization with filtering and drill-down.
2. **AI-powered entity extraction** -- an LLM (OpenAI gpt-5.2) converts raw field report text into structured intelligence rows.
3. **ML-driven forecasting** -- a pluggable forecasting service predicts "Time-to-Zero" per sector/resource pair, including anomaly-aware handling of "Thanos Snap" events.
4. **Privacy-by-design security** -- a server-side PII redaction pipeline strips hero aliases and secure contact info *before* any text leaves the backend for LLM processing.

The architecture follows a strict **four-pillar** separation of concerns:

| Pillar | Role | Technology |
|--------|------|------------|
| **The Vault** | Persistent storage + REST API | PostgreSQL 16 + FastAPI + SQLAlchemy |
| **The HUD** | Interactive dashboard | Next.js 15 + shadcn/ui + Recharts |
| **Jarvis** | AI entity extraction + ML forecasting | OpenAI gpt-5.2 + pluggable ML service |
| **The Shield** | PII redaction middleware | Python regex pipeline |

The system is containerized with Docker, orchestrated via docker-compose for local development, and deployed to DigitalOcean App Platform for production.

**Key architectural drivers:**

- **Judging rubric**: Architecture is 40% of the score. Every design decision is documented with an ADR.
- **24-hour constraint**: A solo developer must ship the system in one day. The architecture maximizes productivity by using well-supported, batteries-included frameworks (Next.js, FastAPI, shadcn/ui) and minimizing custom infrastructure.
- **Pluggability**: The ML forecasting layer uses a Strategy pattern so algorithms can be swapped without changing the API contract -- critical for rapid experimentation during the hackathon.

---

## 2. System Diagram

```
 +-------------------------------------------------------------+
 |                        THE HUD (Next.js 15)                  |
 |  +------------------+  +----------------+  +---------------+ |
 |  | Dashboard Page   |  | Report Submit  |  | Intel Table   | |
 |  | (Recharts graphs)|  | (Form + status)|  | (Live feed)   | |
 |  +--------+---------+  +-------+--------+  +-------+-------+ |
 +-----------|----------------------|-------------------|--------+
             |                      |                   |
             | GET /resources/*     | POST /reports     | GET /reports
             | GET /forecasts/*     |                   |
             v                      v                   v
 +-----------+----------------------+-------------------+--------+
 |                  THE VAULT (FastAPI Backend)                  |
 |                                                               |
 |  +-------------------+    +----------------------------------+|
 |  | Resource Router   |    | Report Router                    ||
 |  | GET /resources    |    | POST /reports/submit             ||
 |  | GET /resources/   |    | GET  /reports                    ||
 |  |   {sector}        |    | GET  /reports/{id}               ||
 |  | GET /forecasts    |    +----------+-----------------------+|
 |  | GET /forecasts/   |               |                        |
 |  |   {sector}/       |               | raw_text               |
 |  |   {resource}      |               v                        |
 |  +---------+---------+    +----------+-----------------------+|
 |            |              |  THE SHIELD (PII Middleware)      ||
 |            |              |  1. Regex: hero aliases           ||
 |            |              |  2. Regex: phone numbers          ||
 |            |              |  3. Regex: inline PII in text     ||
 |            |              |  4. Audit log entry               ||
 |            |              +----------+-----------------------+||
 |            |                         |                        ||
 |            |                         | redacted_text          ||
 |            |                         v                        ||
 |            |              +----------+-----------------------+||
 |            |              |      JARVIS (AI/ML Layer)        |||
 |            |              |                                   |||
 |            |              |  +-------------+ +--------------+|||
 |            |              |  | LLM Service | | ML Forecast  ||||
 |            |              |  | (gpt-5.2)   | | (Strategy    ||||
 |            |              |  | Entity      | |  Pattern)    ||||
 |            |              |  | Extraction  | |              ||||
 |            |              |  +------+------+ +------+-------+|||
 |            |              +---------|---------------|--------+||
 |            |                        |               |         ||
 |            v                        v               v         ||
 |  +---------+------------------------------------------------+||
 |  |                   PostgreSQL 16                           |||
 |  |  +----------------+ +----------------+ +----------------+|||
 |  |  | resource_logs  | | intel_reports  | | redaction_log  ||||
 |  |  +----------------+ +----------------+ +----------------+|||
 |  |  +----------------+ +----------------+                   |||
 |  |  | forecasts      | | sectors /      |                   |||
 |  |  |                | | resource_types |                   |||
 |  |  +----------------+ +----------------+                   |||
 |  +----------------------------------------------------------+||
 +---------------------------------------------------------------+

 Docker Compose: frontend (port 3000), backend (port 8000), db (port 5432)
```

---

## 3. Component Breakdown

### 3.1 The HUD -- Next.js 15 Frontend

| Module | Purpose |
|--------|---------|
| `app/page.tsx` | Root redirect to `/dashboard` |
| `app/dashboard/page.tsx` | Main dashboard: resource charts, sector filters, forecast overlays |
| `app/reports/page.tsx` | Report submission form + live intel table |
| `app/layout.tsx` | Root layout with sidebar navigation, theme provider |
| `components/ui/*` | shadcn/ui primitives (Button, Card, Table, Input, Select, Badge, etc.) |
| `components/charts/resource-chart.tsx` | Recharts line chart: stock levels over time per sector/resource |
| `components/charts/forecast-overlay.tsx` | Recharts overlay: predicted depletion line + Time-to-Zero annotation |
| `components/charts/sector-summary.tsx` | Recharts bar chart: current stock snapshot across sectors |
| `components/reports/report-form.tsx` | Controlled form for submitting raw field report text |
| `components/reports/intel-table.tsx` | Table of processed intelligence with priority badges |
| `components/reports/status-badge.tsx` | "Pending" / "Processed" / "Error" status indicator |
| `components/layout/sidebar.tsx` | Navigation sidebar: Dashboard, Reports, Settings |
| `components/layout/header.tsx` | Top bar with title + sector quick-filter |
| `lib/api.ts` | Typed fetch wrappers for all backend endpoints |
| `lib/types.ts` | Shared TypeScript interfaces mirroring API response shapes |
| `lib/utils.ts` | shadcn/ui utility (`cn` function) |

### 3.2 The Vault -- FastAPI Backend

| Module | Purpose |
|--------|---------|
| `app/main.py` | FastAPI application factory, CORS config, router registration |
| `app/config.py` | Pydantic `Settings` class reading from environment variables |
| `app/database.py` | SQLAlchemy async engine + session factory |
| `app/models/resource_log.py` | SQLAlchemy model: `resource_logs` table |
| `app/models/intel_report.py` | SQLAlchemy model: `intel_reports` table |
| `app/models/forecast.py` | SQLAlchemy model: `forecasts` table |
| `app/models/redaction_log.py` | SQLAlchemy model: `redaction_log` table |
| `app/schemas/resource.py` | Pydantic request/response schemas for resource endpoints |
| `app/schemas/report.py` | Pydantic request/response schemas for report endpoints |
| `app/schemas/forecast.py` | Pydantic request/response schemas for forecast endpoints |
| `app/routers/resources.py` | REST endpoints for resource queries and aggregation |
| `app/routers/reports.py` | REST endpoints for report submission and retrieval |
| `app/routers/forecasts.py` | REST endpoints for forecast queries |
| `app/routers/health.py` | `GET /health` liveness probe |
| `app/services/shield.py` | PII redaction pipeline (The Shield) |
| `app/services/jarvis_llm.py` | OpenAI gpt-5.2 entity extraction (Jarvis AI) |
| `app/services/jarvis_forecast.py` | ML forecasting orchestrator + strategy registry (Jarvis ML) |
| `app/services/strategies/base.py` | `ForecastingStrategy` abstract base class |
| `app/services/strategies/linear_regression.py` | Linear regression strategy implementation |
| `app/services/strategies/snap_aware.py` | Snap-aware strategy: detects anomaly, fits only on post-snap data |
| `scripts/seed_db.py` | CLI script: reads CSV + JSON, seeds PostgreSQL |
| `alembic/` | Database migration directory |
| `alembic.ini` | Alembic configuration |
| `tests/` | Pytest test suite |

### 3.3 Jarvis -- AI/ML Layer

Lives inside the backend as Python service modules. Not a separate network service (no additional latency, simpler deployment for a solo developer in 24 hours).

**AI (LLM Entity Extraction):**
- Receives redacted text from The Shield.
- Calls OpenAI gpt-5.2 with a structured extraction prompt.
- Returns JSON: `{sector, resource_type, severity, summary}`.
- Validates LLM output against a Pydantic schema; falls back to a "parse_failed" status if validation fails.

**ML (Forecasting):**
- Uses Strategy pattern (see Section 8).
- Default strategy: `SnapAwareLinearRegression` -- detects `snap_event_detected=True`, partitions data, fits linear regression on post-snap segment only.
- Calculates Time-to-Zero: `stock_level / usage_rate_hourly` extrapolated forward.

### 3.4 The Shield -- PII Redaction

A synchronous Python module invoked by the report router **before** any LLM call. Details in Section 7.

---

## 4. Repository Structure

```
CGI-Innovate/
|-- docker-compose.yml              # Orchestrates all services
|-- .env.example                     # Environment variable template
|-- .gitignore
|-- CLAUDE.md
|-- artifacts/                       # Project artifacts (non-code)
|   |-- context/
|   |   |-- project-context.md
|   |   |-- decision-log.md
|   |-- design/
|   |   |-- architecture.md          # THIS DOCUMENT
|   |   |-- decisions/
|   |       |-- ADR-001-fastapi.md
|   |       |-- ADR-002-postgresql.md
|   |       |-- ADR-003-strategy-pattern.md
|   |       |-- ADR-004-server-side-pii-redaction.md
|   |       |-- ADR-005-digitalocean.md
|   |-- exploration/
|   |-- planning/
|   |-- implementation/
|   |-- reviews/
|
|-- src/
|   |-- frontend/                    # Next.js 15 application
|   |   |-- package.json
|   |   |-- tsconfig.json
|   |   |-- next.config.ts
|   |   |-- tailwind.config.ts
|   |   |-- postcss.config.mjs
|   |   |-- Dockerfile
|   |   |-- public/
|   |   |-- app/
|   |   |   |-- layout.tsx
|   |   |   |-- page.tsx
|   |   |   |-- globals.css
|   |   |   |-- dashboard/
|   |   |   |   |-- page.tsx
|   |   |   |-- reports/
|   |   |       |-- page.tsx
|   |   |-- components/
|   |   |   |-- ui/                  # shadcn/ui components
|   |   |   |   |-- button.tsx
|   |   |   |   |-- card.tsx
|   |   |   |   |-- table.tsx
|   |   |   |   |-- input.tsx
|   |   |   |   |-- select.tsx
|   |   |   |   |-- badge.tsx
|   |   |   |   |-- textarea.tsx
|   |   |   |-- charts/
|   |   |   |   |-- resource-chart.tsx
|   |   |   |   |-- forecast-overlay.tsx
|   |   |   |   |-- sector-summary.tsx
|   |   |   |-- reports/
|   |   |   |   |-- report-form.tsx
|   |   |   |   |-- intel-table.tsx
|   |   |   |   |-- status-badge.tsx
|   |   |   |-- layout/
|   |   |       |-- sidebar.tsx
|   |   |       |-- header.tsx
|   |   |-- lib/
|   |       |-- api.ts
|   |       |-- types.ts
|   |       |-- utils.ts
|   |
|   |-- backend/                     # Python FastAPI application
|       |-- pyproject.toml
|       |-- Dockerfile
|       |-- alembic.ini
|       |-- alembic/
|       |   |-- env.py
|       |   |-- versions/
|       |-- app/
|       |   |-- __init__.py
|       |   |-- main.py
|       |   |-- config.py
|       |   |-- database.py
|       |   |-- models/
|       |   |   |-- __init__.py
|       |   |   |-- resource_log.py
|       |   |   |-- intel_report.py
|       |   |   |-- forecast.py
|       |   |   |-- redaction_log.py
|       |   |-- schemas/
|       |   |   |-- __init__.py
|       |   |   |-- resource.py
|       |   |   |-- report.py
|       |   |   |-- forecast.py
|       |   |-- routers/
|       |   |   |-- __init__.py
|       |   |   |-- resources.py
|       |   |   |-- reports.py
|       |   |   |-- forecasts.py
|       |   |   |-- health.py
|       |   |-- services/
|       |       |-- __init__.py
|       |       |-- shield.py
|       |       |-- jarvis_llm.py
|       |       |-- jarvis_forecast.py
|       |       |-- strategies/
|       |           |-- __init__.py
|       |           |-- base.py
|       |           |-- linear_regression.py
|       |           |-- snap_aware.py
|       |-- scripts/
|       |   |-- seed_db.py
|       |-- tests/
|           |-- __init__.py
|           |-- conftest.py
|           |-- test_shield.py
|           |-- test_jarvis_llm.py
|           |-- test_jarvis_forecast.py
|           |-- test_resources_router.py
|           |-- test_reports_router.py
|           |-- test_forecasts_router.py
|
|-- Prompt-Resources/                # Provided challenge data (read-only)
    |-- challenger_package/
        |-- challenger_package/
            |-- historical_avengers_data.csv
            |-- field_intel_reports.json
            |-- README.md
            |-- Developer Implementation Guide.pdf
            |-- Presentation Checklist.md
```

---

## 5. REST API Design

Base URL: `http://localhost:8000/api/v1`

### 5.1 Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe |

**Response** `200 OK`:
```json
{ "status": "ok", "version": "1.0.0" }
```

### 5.2 Resources

#### GET `/api/v1/resources`

List resource logs with optional filters.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `sector` | string | No | Filter by sector name |
| `resource_type` | string | No | Filter by resource type |
| `start` | ISO 8601 datetime | No | Start of time range |
| `end` | ISO 8601 datetime | No | End of time range |
| `snap_only` | boolean | No | If true, return only snap event rows |
| `limit` | integer | No | Pagination limit (default 100, max 1000) |
| `offset` | integer | No | Pagination offset (default 0) |

**Response** `200 OK`:
```json
{
  "data": [
    {
      "id": 1,
      "timestamp": "2026-01-01T00:00:00",
      "sector_id": "New Asgard",
      "resource_type": "Vibranium (kg)",
      "stock_level": 2500.0,
      "usage_rate_hourly": 6.43,
      "snap_event_detected": false
    }
  ],
  "total": 10000,
  "limit": 100,
  "offset": 0
}
```

**Status Codes:** `200` success, `422` invalid query parameters.

#### GET `/api/v1/resources/sectors`

List all distinct sector names.

**Response** `200 OK`:
```json
{
  "sectors": ["New Asgard", "Wakanda", "Sokovia", "Sanctum Sanctorum", "Avengers Compound"]
}
```

#### GET `/api/v1/resources/types`

List all distinct resource types.

**Response** `200 OK`:
```json
{
  "resource_types": ["Vibranium (kg)", "Arc Reactor Cores", "Pym Particles", "Clean Water (L)", "Medical Kits"]
}
```

#### GET `/api/v1/resources/summary`

Current stock summary per sector and resource (latest reading per combination).

**Response** `200 OK`:
```json
{
  "data": [
    {
      "sector_id": "Wakanda",
      "resource_type": "Vibranium (kg)",
      "latest_stock_level": 120.5,
      "latest_usage_rate": 4.2,
      "latest_timestamp": "2026-01-28T23:00:00",
      "snap_event_detected": false
    }
  ]
}
```

### 5.3 Reports

#### POST `/api/v1/reports/submit`

Submit a new field report for processing.

**Request Body:**
```json
{
  "raw_text": "Urgent: Avengers Compound is critically low on Arc Reactor Cores.",
  "metadata": {
    "hero_alias": "Tony Stark",
    "secure_contact": "555-0101 (Iron Line)"
  },
  "priority": "High"
}
```

**Response** `202 Accepted`:
```json
{
  "report_id": "a691a8b2-a957-492a-ae62-1b80016d6432",
  "status": "processing",
  "message": "Report accepted. Processing will complete asynchronously."
}
```

The backend processes the report synchronously within the request but returns 202 to signal that the result is available via polling. Processing steps:
1. Persist raw report to `intel_reports` with `status='pending'`.
2. Run The Shield: redact PII from `raw_text` and `metadata`.
3. Log redaction to `redaction_log`.
4. Send redacted text to Jarvis LLM for entity extraction.
5. Update `intel_reports` row with extracted entities and `status='processed'` (or `status='error'` on failure).

**Status Codes:** `202` accepted, `422` validation error.

#### GET `/api/v1/reports`

List all processed intelligence reports.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | No | Filter: `pending`, `processed`, `error` |
| `priority` | string | No | Filter: `Routine`, `High`, `Avengers Level Threat` |
| `limit` | integer | No | Default 50 |
| `offset` | integer | No | Default 0 |

**Response** `200 OK`:
```json
{
  "data": [
    {
      "report_id": "a691a8b2-a957-492a-ae62-1b80016d6432",
      "timestamp": "2026-01-15T21:41:48",
      "priority": "Routine",
      "status": "processed",
      "redacted_text": "Urgent: Avengers Compound is critically low on Arc Reactor Cores. The civilians are worried.",
      "extracted_entities": {
        "sector": "Avengers Compound",
        "resource_type": "Arc Reactor Cores",
        "severity": "critical",
        "summary": "Critically low Arc Reactor Cores at Avengers Compound"
      },
      "created_at": "2026-01-15T21:41:48"
    }
  ],
  "total": 200,
  "limit": 50,
  "offset": 0
}
```

**Status Codes:** `200` success, `422` invalid parameters.

#### GET `/api/v1/reports/{report_id}`

Get a single report by ID.

**Response** `200 OK`: Same shape as a single item from the list endpoint.

**Status Codes:** `200` success, `404` not found.

### 5.4 Forecasts

#### GET `/api/v1/forecasts`

Get forecasts for all sector/resource combinations.

**Response** `200 OK`:
```json
{
  "data": [
    {
      "id": 1,
      "sector_id": "Wakanda",
      "resource_type": "Vibranium (kg)",
      "predicted_exhaustion_date": "2026-03-15T14:00:00",
      "hours_until_exhaustion": 360.5,
      "confidence": 0.87,
      "strategy_used": "snap_aware_linear_regression",
      "snap_detected": true,
      "computed_at": "2026-02-28T12:00:00"
    }
  ]
}
```

#### GET `/api/v1/forecasts/{sector}/{resource_type}`

Get forecast for a specific sector and resource.

**Response** `200 OK`: Single forecast object (same shape as list item).

**Status Codes:** `200` success, `404` no forecast available.

#### POST `/api/v1/forecasts/refresh`

Trigger a re-computation of all forecasts using the current data and active strategy.

**Response** `202 Accepted`:
```json
{
  "message": "Forecast refresh initiated",
  "strategy": "snap_aware_linear_regression"
}
```

**Status Codes:** `202` accepted.

### 5.5 Redaction Log (Admin)

#### GET `/api/v1/admin/redaction-log`

List PII redaction audit entries. Intended for demo/presentation purposes to prove PII was redacted before LLM calls.

**Response** `200 OK`:
```json
{
  "data": [
    {
      "id": 1,
      "report_id": "a691a8b2-...",
      "original_hash": "sha256:abc123...",
      "redacted_text": "Urgent: Avengers Compound is...",
      "patterns_matched": ["hero_alias:Tony Stark", "phone:555-0101"],
      "redacted_at": "2026-01-15T21:41:49"
    }
  ]
}
```

---

## 6. PostgreSQL Schema

### 6.1 Entity Relationship

```
sectors (reference)        resource_types (reference)
    |                           |
    +--------+    +-------------+
             |    |
         resource_logs
             |
         forecasts (per sector + resource_type)

intel_reports --> redaction_log (1:1)
```

### 6.2 Table Definitions

#### `resource_logs`

Stores the 10,000 historical resource observations from the CSV.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `SERIAL` | `PRIMARY KEY` | Auto-increment |
| `timestamp` | `TIMESTAMPTZ` | `NOT NULL` | Observation time |
| `sector_id` | `VARCHAR(50)` | `NOT NULL` | Sector name |
| `resource_type` | `VARCHAR(50)` | `NOT NULL` | Resource name |
| `stock_level` | `DOUBLE PRECISION` | `NOT NULL` | Current stock |
| `usage_rate_hourly` | `DOUBLE PRECISION` | `NOT NULL` | Consumption rate |
| `snap_event_detected` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Thanos Snap flag |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Row insertion time |

**Indexes:**
- `ix_resource_logs_sector_resource` on `(sector_id, resource_type)` -- fast filtered queries
- `ix_resource_logs_timestamp` on `(timestamp)` -- time-range queries
- `ix_resource_logs_snap` on `(snap_event_detected)` WHERE `snap_event_detected = TRUE` -- partial index for anomaly queries

#### `intel_reports`

Stores raw and processed field intelligence reports.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `report_id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique report ID |
| `raw_text` | `TEXT` | `NOT NULL` | Original unredacted text (stored server-side only) |
| `redacted_text` | `TEXT` | | Text after PII redaction |
| `metadata_json` | `JSONB` | | Original metadata (hero_alias, secure_contact) -- stored encrypted at rest |
| `priority` | `VARCHAR(30)` | `NOT NULL` | "Routine", "High", "Avengers Level Threat" |
| `status` | `VARCHAR(20)` | `NOT NULL DEFAULT 'pending'` | "pending", "processed", "error" |
| `extracted_entities` | `JSONB` | | LLM output: {sector, resource_type, severity, summary} |
| `error_message` | `TEXT` | | Error details if LLM processing fails |
| `timestamp` | `TIMESTAMPTZ` | `NOT NULL` | Report timestamp from source data |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Row insertion time |
| `processed_at` | `TIMESTAMPTZ` | | When processing completed |

**Indexes:**
- `ix_intel_reports_status` on `(status)` -- filter by processing state
- `ix_intel_reports_priority` on `(priority)` -- filter by urgency
- `ix_intel_reports_timestamp` on `(timestamp)` -- chronological ordering

#### `forecasts`

Stores computed Time-to-Zero predictions per sector/resource.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `SERIAL` | `PRIMARY KEY` | Auto-increment |
| `sector_id` | `VARCHAR(50)` | `NOT NULL` | Sector name |
| `resource_type` | `VARCHAR(50)` | `NOT NULL` | Resource name |
| `predicted_exhaustion_date` | `TIMESTAMPTZ` | | NULL if resource is stable/increasing |
| `hours_until_exhaustion` | `DOUBLE PRECISION` | | Hours from `computed_at` to exhaustion |
| `confidence` | `DOUBLE PRECISION` | | R-squared or equivalent metric [0, 1] |
| `strategy_used` | `VARCHAR(50)` | `NOT NULL` | Name of the strategy class used |
| `snap_detected` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` | Whether snap anomaly was found in the data window |
| `computed_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | When this forecast was generated |

**Constraints:**
- `UNIQUE (sector_id, resource_type, computed_at)` -- one forecast per combination per compute cycle

**Indexes:**
- `ix_forecasts_sector_resource` on `(sector_id, resource_type)` -- lookup
- `ix_forecasts_computed_at` on `(computed_at DESC)` -- latest forecast first

#### `redaction_log`

Audit trail proving PII was stripped before LLM processing.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `SERIAL` | `PRIMARY KEY` | Auto-increment |
| `report_id` | `UUID` | `NOT NULL REFERENCES intel_reports(report_id)` | FK to the report |
| `original_text_hash` | `VARCHAR(64)` | `NOT NULL` | SHA-256 hash of the original text (for integrity, not storage of raw PII) |
| `redacted_text` | `TEXT` | `NOT NULL` | Text after redaction |
| `patterns_matched` | `JSONB` | `NOT NULL` | List of matched PII patterns, e.g. `["hero_alias:Tony Stark", "phone:555-0101"]` |
| `redacted_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Timestamp of redaction |

**Indexes:**
- `ix_redaction_log_report_id` on `(report_id)` -- join to intel_reports

### 6.3 Design Notes

- **No separate `sectors` or `resource_types` reference tables.** With only 5 sectors and 5 resource types that are fixed in the challenge data, separate tables add join overhead without benefit. The values are validated at the application layer via Python enums. If the domain grew, we would normalize -- but for a 24-hour hackathon with fixed data, denormalization is the right trade-off (see D-006).
- **`metadata_json` as JSONB.** The metadata schema is simple and fixed (`hero_alias`, `secure_contact`), but JSONB allows flexible extension without a migration if additional metadata fields appear. The raw PII is stored server-side for audit purposes but is NEVER sent to the LLM or returned by the public API. The public API returns only `redacted_text` and `extracted_entities`.
- **Timestamps use `TIMESTAMPTZ`.** All timestamps are stored in UTC. The frontend converts to the user's local timezone for display.

---

## 7. Security Architecture -- The Shield

### 7.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| PII leakage to third-party LLM (OpenAI) | Server-side regex redaction **before** LLM call |
| PII leakage via API response | Public API never returns `raw_text` or `metadata_json`; only `redacted_text` |
| PII stored insecurely at rest | `metadata_json` stored in PostgreSQL; DB access restricted to backend service |
| Tampering with redaction log | `original_text_hash` (SHA-256) provides integrity verification |

### 7.2 Redaction Pipeline

```
User submits report
        |
        v
 +------+------+
 | Receive raw  |
 | report text  |
 | + metadata   |
 +------+------+
        |
        v
 +------+------+
 | Step 1:     |   Known hero aliases from metadata.hero_alias
 | Redact hero |   Regex: re.escape(alias) replaced with [REDACTED-NAME]
 | alias from  |   Applied to: raw_text
 | raw_text    |
 +------+------+
        |
        v
 +------+------+
 | Step 2:     |   Regex for phone patterns:
 | Redact phone|   \b\d{3}[-.]?\d{4}\b  (7-digit)
 | numbers from|   \b\d{3}[-.]?\d{3}[-.]?\d{4}\b  (10-digit)
 | raw_text    |   \b555-[A-Z-]+\b  (vanity numbers like 555-GOD-OF-THUNDER)
 +------+------+
        |
        v
 +------+------+
 | Step 3:     |   Catch-all for names that appear inline in the text
 | Redact      |   but were not in metadata (defensive pattern).
 | known hero  |   Match against a static list of known hero names.
 | name roster |
 +------+------+
        |
        v
 +------+------+
 | Step 4:     |   Write to redaction_log:
 | Audit log   |   - SHA-256 hash of original text
 |             |   - Redacted text
 |             |   - List of all patterns matched
 +------+------+
        |
        v
 +------+------+
 | Output:     |   redacted_text sent to Jarvis LLM
 | Clean text  |   metadata is NEVER forwarded to the LLM
 +------+------+
```

### 7.3 Implementation Details

```python
# app/services/shield.py (conceptual)

import re
import hashlib
from dataclasses import dataclass

KNOWN_HEROES = [
    "Tony Stark", "Natasha Romanoff", "Thor Odinson",
    "Peter Parker", "Bruce Banner", "Steve Rogers",
    "Wanda Maximoff", "Clint Barton", "Scott Lang",
    "T'Challa", "Stephen Strange", "Carol Danvers",
]

PHONE_PATTERNS = [
    r"\b555-[A-Z][-A-Z]*\b",                   # vanity: 555-GOD-OF-THUNDER
    r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b",      # standard: 555-0101, 555.0101
    r"\b\d{3}[-.\s]?\d{4}\b",                   # short: 555-0101
    r"\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b",         # parenthetical: (555) 555-0101
]

@dataclass
class RedactionResult:
    redacted_text: str
    original_hash: str
    patterns_matched: list[str]

def redact_pii(raw_text: str, metadata: dict | None = None) -> RedactionResult:
    original_hash = hashlib.sha256(raw_text.encode()).hexdigest()
    patterns_matched = []
    text = raw_text

    # Step 1: Redact hero alias from metadata
    if metadata and metadata.get("hero_alias"):
        alias = metadata["hero_alias"]
        if alias in text:
            text = text.replace(alias, "[REDACTED-NAME]")
            patterns_matched.append(f"hero_alias:{alias}")

    # Step 2: Redact phone numbers
    for pattern in PHONE_PATTERNS:
        matches = re.findall(pattern, text)
        for match in matches:
            text = text.replace(match, "[REDACTED-PHONE]")
            patterns_matched.append(f"phone:{match}")

    # Step 3: Redact known hero names that appear inline
    for hero in KNOWN_HEROES:
        if hero in text:
            text = text.replace(hero, "[REDACTED-NAME]")
            patterns_matched.append(f"hero_name:{hero}")

    return RedactionResult(
        redacted_text=text,
        original_hash=original_hash,
        patterns_matched=patterns_matched,
    )
```

### 7.4 Key Security Properties

1. **PII never reaches the LLM.** The Shield runs synchronously in the request path, *before* the LLM call. There is no code path where unredacted text is sent to OpenAI.
2. **PII never appears in API responses.** The public API returns `redacted_text`, not `raw_text`. The `metadata_json` column is excluded from all Pydantic response schemas.
3. **Audit trail is immutable.** Each redaction creates a `redaction_log` entry with a SHA-256 hash of the original text, the redacted output, and the matched patterns. During the demo, this log proves that redaction occurred.
4. **Defense in depth.** Step 3 (known hero roster) catches names that appear inline in the text body even if they were not provided in the metadata field.

---

## 8. ML Forecasting Service -- Jarvis ML

### 8.1 Strategy Pattern Interface

```python
# app/services/strategies/base.py

from abc import ABC, abstractmethod
from datetime import datetime
from dataclasses import dataclass

@dataclass
class ForecastResult:
    predicted_exhaustion_date: datetime | None  # None if resource is stable
    hours_until_exhaustion: float | None
    confidence: float                            # R-squared or equivalent [0, 1]
    strategy_name: str
    snap_detected: bool

class ForecastingStrategy(ABC):
    """Abstract base class for all forecasting strategies."""

    @abstractmethod
    def fit(self, timestamps: list[datetime], stock_levels: list[float]) -> None:
        """Fit the model to historical data."""
        ...

    @abstractmethod
    def predict_exhaustion_date(self) -> ForecastResult:
        """Predict when the resource will reach zero stock."""
        ...
```

### 8.2 Linear Regression Strategy

```python
# app/services/strategies/linear_regression.py

import numpy as np
from datetime import datetime, timedelta
from .base import ForecastingStrategy, ForecastResult

class LinearRegressionStrategy(ForecastingStrategy):
    """Simple linear regression on stock_level vs. time."""

    def __init__(self):
        self._slope: float | None = None
        self._intercept: float | None = None
        self._r_squared: float = 0.0
        self._last_timestamp: datetime | None = None
        self._last_stock: float = 0.0

    def fit(self, timestamps: list[datetime], stock_levels: list[float]) -> None:
        # Convert timestamps to hours-since-first
        t0 = timestamps[0]
        hours = np.array([(t - t0).total_seconds() / 3600 for t in timestamps])
        levels = np.array(stock_levels)

        # Least squares fit
        n = len(hours)
        sum_x = hours.sum()
        sum_y = levels.sum()
        sum_xy = (hours * levels).sum()
        sum_x2 = (hours ** 2).sum()

        denom = n * sum_x2 - sum_x ** 2
        self._slope = (n * sum_xy - sum_x * sum_y) / denom
        self._intercept = (sum_y - self._slope * sum_x) / n

        # R-squared
        y_pred = self._slope * hours + self._intercept
        ss_res = ((levels - y_pred) ** 2).sum()
        ss_tot = ((levels - levels.mean()) ** 2).sum()
        self._r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

        self._last_timestamp = timestamps[-1]
        self._last_stock = stock_levels[-1]

    def predict_exhaustion_date(self) -> ForecastResult:
        if self._slope is None or self._slope >= 0:
            # Stock is stable or increasing -- no exhaustion predicted
            return ForecastResult(
                predicted_exhaustion_date=None,
                hours_until_exhaustion=None,
                confidence=self._r_squared,
                strategy_name="linear_regression",
                snap_detected=False,
            )

        # hours_to_zero = -current_stock / slope
        hours_to_zero = -self._last_stock / self._slope
        exhaustion_date = self._last_timestamp + timedelta(hours=hours_to_zero)

        return ForecastResult(
            predicted_exhaustion_date=exhaustion_date,
            hours_until_exhaustion=hours_to_zero,
            confidence=max(0, self._r_squared),
            strategy_name="linear_regression",
            snap_detected=False,
        )
```

### 8.3 Snap-Aware Strategy

The historical data contains "Thanos Snap" events -- sudden 50% stock drops flagged by `snap_event_detected=True`. A naive regression across the full time series would incorrectly extrapolate from the pre-snap plateau, producing wildly wrong depletion forecasts.

**Approach:**
1. Scan the data for `snap_event_detected=True`.
2. If a snap is found, partition the data: use only **post-snap** observations for regression.
3. If no snap is found, use the full dataset.
4. Delegate to `LinearRegressionStrategy` for the actual fit.

```python
# app/services/strategies/snap_aware.py

from datetime import datetime
from .base import ForecastingStrategy, ForecastResult
from .linear_regression import LinearRegressionStrategy

class SnapAwareLinearRegression(ForecastingStrategy):
    """Detects Thanos Snap anomalies and fits only on post-snap data."""

    def __init__(self):
        self._inner = LinearRegressionStrategy()
        self._snap_detected = False

    def fit(
        self,
        timestamps: list[datetime],
        stock_levels: list[float],
        snap_flags: list[bool] | None = None,
    ) -> None:
        if snap_flags:
            # Find the last snap event index
            snap_indices = [i for i, flag in enumerate(snap_flags) if flag]
            if snap_indices:
                self._snap_detected = True
                last_snap_idx = snap_indices[-1]
                # Use only post-snap data for fitting
                timestamps = timestamps[last_snap_idx:]
                stock_levels = stock_levels[last_snap_idx:]

        self._inner.fit(timestamps, stock_levels)

    def predict_exhaustion_date(self) -> ForecastResult:
        result = self._inner.predict_exhaustion_date()
        result.snap_detected = self._snap_detected
        result.strategy_name = "snap_aware_linear_regression"
        return result
```

### 8.4 Strategy Registry and Orchestrator

```python
# app/services/jarvis_forecast.py

from .strategies.base import ForecastingStrategy
from .strategies.linear_regression import LinearRegressionStrategy
from .strategies.snap_aware import SnapAwareLinearRegression

STRATEGY_REGISTRY: dict[str, type[ForecastingStrategy]] = {
    "linear_regression": LinearRegressionStrategy,
    "snap_aware_linear_regression": SnapAwareLinearRegression,
}

DEFAULT_STRATEGY = "snap_aware_linear_regression"

def get_strategy(name: str | None = None) -> ForecastingStrategy:
    strategy_name = name or DEFAULT_STRATEGY
    cls = STRATEGY_REGISTRY[strategy_name]
    return cls()
```

Adding a new algorithm (e.g., exponential smoothing, ARIMA) requires:
1. Create a new class implementing `ForecastingStrategy`.
2. Add it to `STRATEGY_REGISTRY`.
3. No changes to the API, router, or schema layer.

### 8.5 Time-to-Zero Calculation Flow

```
For each (sector_id, resource_type) combination:
    1. Query resource_logs ORDER BY timestamp
    2. Instantiate the active strategy via get_strategy()
    3. Call strategy.fit(timestamps, stock_levels, snap_flags)
    4. Call strategy.predict_exhaustion_date() -> ForecastResult
    5. Persist ForecastResult to the forecasts table
    6. Return to caller (API or refresh job)
```

---

## 9. Data Flow Diagrams

### 9.1 Report Submission Flow

```
 User (HUD)                 Backend (Vault)               Services
 ----------                 ---------------               --------
     |                            |                           |
     |  POST /reports/submit      |                           |
     |  {raw_text, metadata,      |                           |
     |   priority}                |                           |
     |--------------------------->|                           |
     |                            |                           |
     |                     Save to intel_reports              |
     |                     status = "pending"                 |
     |                            |                           |
     |                            |--- Shield.redact_pii() -->|
     |                            |    (raw_text + metadata)  |
     |                            |                           |
     |                            |<-- RedactionResult -------|
     |                            |    (redacted_text,        |
     |                            |     patterns_matched)     |
     |                            |                           |
     |                     Save to redaction_log              |
     |                            |                           |
     |                            |--- Jarvis.extract() ----->|
     |                            |    (redacted_text)        |
     |                            |         |                 |
     |                            |         |  OpenAI API     |
     |                            |         |  gpt-5.2        |
     |                            |         |---------------->|
     |                            |         |<-- JSON --------|
     |                            |         |                 |
     |                            |<-- ExtractedEntities -----|
     |                            |    {sector, resource,     |
     |                            |     severity, summary}    |
     |                            |                           |
     |                     Update intel_reports               |
     |                     status = "processed"               |
     |                     extracted_entities = {...}          |
     |                            |                           |
     |  202 {report_id, status}   |                           |
     |<---------------------------|                           |
     |                            |                           |
     |  GET /reports (polling)    |                           |
     |--------------------------->|                           |
     |  200 {data: [...]}         |                           |
     |<---------------------------|                           |
```

### 9.2 Resource Query + Forecast Flow

```
 User (HUD)                 Backend (Vault)               Services
 ----------                 ---------------               --------
     |                            |                           |
     |  GET /resources            |                           |
     |  ?sector=Wakanda           |                           |
     |  &resource_type=Vibranium  |                           |
     |--------------------------->|                           |
     |                            |                           |
     |                     Query resource_logs                |
     |                     with filters                       |
     |                            |                           |
     |  200 {data: [...]}         |                           |
     |<---------------------------|                           |
     |                            |                           |
     |  GET /forecasts/           |                           |
     |    Wakanda/Vibranium       |                           |
     |--------------------------->|                           |
     |                            |                           |
     |                     Query forecasts table              |
     |                     (latest by computed_at)            |
     |                            |                           |
     |  200 {forecast}            |                           |
     |<---------------------------|                           |
     |                            |                           |
     |  Render: chart +           |                           |
     |  forecast overlay +        |                           |
     |  Time-to-Zero badge        |                           |
```

### 9.3 Forecast Refresh Flow

```
 Admin / Cron               Backend (Vault)               Services
 -----------                ---------------               --------
     |                            |                           |
     |  POST /forecasts/refresh   |                           |
     |--------------------------->|                           |
     |                            |                           |
     |                     For each (sector, resource):       |
     |                            |                           |
     |                            |--- get_strategy() ------->|
     |                            |                           |
     |                            |--- strategy.fit() ------->|
     |                            |    (timestamps, levels,   |
     |                            |     snap_flags)           |
     |                            |                           |
     |                            |<-- ForecastResult --------|
     |                            |                           |
     |                     Insert into forecasts table        |
     |                            |                           |
     |  202 {message, strategy}   |                           |
     |<---------------------------|                           |
```

---

## 10. Technology Decisions

Each major technology decision is documented in a full ADR in `artifacts/design/decisions/`. Summary table:

| D-ID | Decision | Rationale | ADR |
|------|----------|-----------|-----|
| D-001 | Python FastAPI for backend | Async-native, auto-generated OpenAPI docs, first-class Pydantic integration, native Python ML ecosystem | ADR-001 |
| D-002 | PostgreSQL 16 for database | ACID compliance, JSONB for flexible metadata, mature indexing, time-series query performance | ADR-002 |
| D-003 | Strategy pattern for ML forecasting | Swap algorithms without API changes, open/closed principle, easy to add new strategies during hackathon | ADR-003 |
| D-004 | Server-side PII redaction before LLM | Zero-trust approach to PII: redact at the earliest possible point in the pipeline, never expose raw PII to external services | ADR-004 |
| D-005 | DigitalOcean App Platform for deployment | Simple container deployment, managed PostgreSQL, predictable pricing, fast setup for hackathon | ADR-005 |
| D-006 | Denormalized sectors/resource_types | Only 5 fixed values each, join overhead unjustified, validated via Python enums | -- |
| D-007 | Next.js 15 App Router for frontend | Server components for initial data load, file-based routing, TypeScript-native, pairs well with shadcn/ui | -- |
| D-008 | Recharts for visualization | React-native, composable, supports line + bar + area charts, easy overlay for forecast lines | -- |
| D-009 | SQLAlchemy + Alembic for ORM/migrations | Industry-standard Python ORM, type-safe models, version-controlled schema migrations | -- |
| D-010 | Docker + docker-compose for local dev | Reproducible environment, single command startup, matches production container deployment | -- |

---

## 11. Deployment Architecture

### 11.1 Local Development (docker-compose)

```yaml
# docker-compose.yml (conceptual)
services:
  db:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: sentinel
      POSTGRES_USER: sentinel
      POSTGRES_PASSWORD: sentinel_dev
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./src/backend
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql+asyncpg://sentinel:sentinel_dev@db:5432/sentinel
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on: [db]

  frontend:
    build: ./src/frontend
    ports: ["3000:3000"]
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000/api/v1
    depends_on: [backend]

volumes:
  pgdata:
```

### 11.2 Production (DigitalOcean App Platform)

Three components deployed as containers:
1. **Web Service** (`frontend`): Next.js on port 3000, publicly routed.
2. **Web Service** (`backend`): FastAPI on port 8000, publicly routed at `/api`.
3. **Database**: DigitalOcean Managed PostgreSQL 16.

Environment variables (`OPENAI_API_KEY`, `DATABASE_URL`) configured via App Platform secrets.

---

## 12. Cross-Cutting Concerns

### 12.1 Error Handling

- **LLM failures**: If OpenAI returns invalid JSON or times out, the report is saved with `status='error'` and `error_message` populated. The UI displays an error badge. The user can re-submit.
- **ML failures**: If the strategy raises during `fit()` or `predict_exhaustion_date()`, the forecast for that sector/resource is skipped and logged. Other forecasts proceed independently.
- **Database errors**: SQLAlchemy exceptions are caught in the routers and returned as `500 Internal Server Error` with a generic message (no stack trace leaked).

### 12.2 CORS

The FastAPI backend configures CORS to allow requests from `http://localhost:3000` (dev) and the production frontend URL.

### 12.3 Logging

Python `logging` module with structured JSON output. Key events logged:
- Report received (report_id, priority)
- PII redaction completed (report_id, patterns_matched count)
- LLM call initiated/completed (report_id, duration_ms)
- Forecast computed (sector, resource, hours_to_zero)

### 12.4 Testing Strategy

| Layer | Tool | Scope |
|-------|------|-------|
| Backend unit tests | pytest | Shield redaction, strategy fit/predict, schema validation |
| Backend integration tests | pytest + httpx | Router endpoints with test database |
| Frontend unit tests | vitest + React Testing Library | Component rendering, form validation |
| E2E smoke test | Manual / Presentation Checklist | Full flow: submit report -> see in table |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **C2 Dashboard** | Command & Control dashboard for coordinating crisis response |
| **Time-to-Zero** | Predicted hours until a resource's stock level reaches zero |
| **Thanos Snap** | Anomaly event in the data where stock levels drop 50% instantaneously |
| **PII** | Personally Identifiable Information (hero aliases, phone numbers) |
| **The Vault** | Database + API layer |
| **The HUD** | Frontend dashboard |
| **Jarvis** | AI (LLM) + ML (forecasting) services |
| **The Shield** | PII redaction middleware |
