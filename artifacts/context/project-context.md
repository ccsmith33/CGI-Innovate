# Project Context -- Project Sentinel

> **Last Updated**: 2026-02-28

## What Is This Project?

Project Sentinel is a full-stack C2 (Command & Control) dashboard built for the CGI Innovate 2026 hackathon. It manages resources during a simulated multi-sector crisis ("The Avengers Initiative"). Teams have 24 hours; we are a solo developer.

## Judging Rubric

| Weight | Category | What Judges Want |
|--------|----------|-----------------|
| 40% | Architecture | Clean separation of concerns, documented decisions, modular design |
| 20% | Intelligent Processing | LLM entity extraction quality, ML forecasting accuracy, Snap anomaly handling |
| 20% | Security | PII redaction PROVEN in demo -- show server logs that names/phones never reach the LLM |
| 20% | UI & Professionalism | Interactive charts, responsive layout, loading states, professional look |

## Tech Stack (Locked)

- **Frontend**: Next.js 15 + TypeScript, shadcn/ui, Tailwind CSS, Recharts
- **Backend**: Python FastAPI (separate service, NOT Next.js API routes)
- **Database**: PostgreSQL 16, SQLAlchemy + Alembic
- **LLM**: OpenAI gpt-5.2
- **ML**: Pluggable strategy pattern (default: SnapAwareLinearRegression)
- **PII Redaction**: Python regex middleware, server-side before LLM
- **Containerization**: Docker + docker-compose
- **Deployment**: DigitalOcean App Platform

## The Four Pillars

1. **The Vault** -- PostgreSQL + FastAPI REST API. Tables: `resource_logs`, `intel_reports`, `forecasts`, `redaction_log`.
2. **The HUD** -- Next.js dashboard. Pages: `/dashboard` (charts + forecasts), `/reports` (form + intel table).
3. **Jarvis** -- AI/ML layer inside the backend. LLM extracts entities from redacted report text. ML forecasting uses the Strategy pattern.
4. **The Shield** -- PII redaction pipeline. Runs BEFORE any LLM call. Strips hero aliases, phone numbers, inline names. Logs every redaction for audit.

## Data

- `historical_avengers_data.csv`: 10,000 rows. Columns: `timestamp, sector_id, resource_type, stock_level, usage_rate_hourly, snap_event_detected`. 5 sectors, 5 resource types. Contains Thanos Snap anomaly (sudden 50% drop).
- `field_intel_reports.json`: 200 reports. Fields: `report_id, metadata: {hero_alias, secure_contact}, raw_text, timestamp, priority`. PII = hero_alias + secure_contact.

## Key Architecture Decisions

| D-ID | Decision | File |
|------|----------|------|
| D-001 | FastAPI over Node.js backend | ADR-001 |
| D-002 | PostgreSQL over MongoDB | ADR-002 |
| D-003 | Strategy pattern for ML | ADR-003 |
| D-004 | Server-side PII redaction | ADR-004 |
| D-005 | DigitalOcean App Platform | ADR-005 |

## Repository Layout

```
src/frontend/     -- Next.js 15 app
src/backend/      -- Python FastAPI app
  app/routers/    -- REST endpoints
  app/models/     -- SQLAlchemy models
  app/schemas/    -- Pydantic schemas
  app/services/   -- Shield, Jarvis LLM, Jarvis Forecast
  app/services/strategies/  -- ML strategy pattern classes
  scripts/        -- DB seed script
  tests/          -- pytest suite
```

## API Base URL

`http://localhost:8000/api/v1`

Key endpoints:
- `GET /resources` -- historical resource data with filters
- `GET /resources/summary` -- latest stock per sector/resource
- `POST /reports/submit` -- submit field report (triggers Shield -> Jarvis pipeline)
- `GET /reports` -- list processed intel
- `GET /forecasts` -- all Time-to-Zero predictions
- `GET /forecasts/{sector}/{resource_type}` -- specific forecast
- `POST /forecasts/refresh` -- recompute all forecasts
- `GET /admin/redaction-log` -- audit trail for PII redaction

## Demo Flow (5-min presentation)

1. Show architecture diagram.
2. Submit a report from the UI.
3. Show status change from "Pending" to "Processed".
4. Show extracted entities in the intel table.
5. Show the resource chart with forecast overlay and Time-to-Zero.
6. Show server logs / redaction log proving PII was redacted before LLM call.
