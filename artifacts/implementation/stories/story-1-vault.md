# Story 1: The Vault (Backend Foundation)

## Status
Ready for Development

## Dependencies
None

## Objective
Scaffold the entire Python FastAPI backend, define all SQLAlchemy models and Pydantic schemas, implement the resource data layer with filtered queries, set up Alembic migrations, seed the database from the challenge CSV, and wire everything into docker-compose so all three services start with a single command.

## D-ID References
- D-001: Python FastAPI for backend
- D-002: PostgreSQL 16 for persistent storage
- D-006: Denormalized sector/resource columns (no reference tables)
- D-009: SQLAlchemy + Alembic for ORM and migrations
- D-010: Docker + docker-compose for local dev

## Acceptance Criteria
- [ ] `docker-compose up` starts all 3 services (db, backend, frontend placeholder) cleanly
- [ ] `GET /health` returns `200` with `{"status": "ok", "version": "1.0.0"}`
- [ ] Seed script loads ~2000 aggregated rows (10,000 raw rows averaged by timestamp+sector+resource across 5 replicas)
- [ ] `GET /api/v1/resources?sector=Wakanda` returns filtered rows
- [ ] `GET /api/v1/resources/sectors` returns the 5 distinct sector names
- [ ] `GET /api/v1/resources/types` returns the 5 distinct resource type names
- [ ] `GET /api/v1/resources/summary` returns the latest stock level per sector+resource pair
- [ ] All resource tests pass

## Dev Notes

### File Paths
Create the following files inside `src/backend/`:

```
src/backend/
  pyproject.toml
  Dockerfile
  alembic.ini
  alembic/
    env.py
    versions/
      001_initial_schema.py
  app/
    __init__.py
    main.py
    config.py
    database.py
    models/
      __init__.py
      resource_log.py
      intel_report.py
      forecast.py
      redaction_log.py
    schemas/
      __init__.py
      resource.py
      report.py
      forecast.py
    routers/
      __init__.py
      health.py
      resources.py
    services/
      __init__.py
  scripts/
    seed_db.py
  tests/
    __init__.py
    conftest.py
    test_health.py
    test_resources_router.py
```

Also update the root files:
- `docker-compose.yml` (update/create)
- `.env.example` (create)

### Key Implementation Details

#### pyproject.toml
Dependencies:
```
fastapi
uvicorn[standard]
sqlalchemy[asyncio]
asyncpg
alembic
pydantic-settings
python-dotenv
pandas
numpy
scikit-learn
openai
pytest
httpx
pytest-asyncio
```

#### app/main.py
- FastAPI application factory pattern
- CORS middleware: allow all origins for dev (`allow_origins=["*"]`)
- Register routers: health (no prefix), resources (`/api/v1`)
- Lifespan context manager for DB engine startup/shutdown

#### app/config.py
- Pydantic `BaseSettings` with `model_config = SettingsConfigDict(env_file=".env")`
- Fields: `DATABASE_URL: str`, `OPENAI_API_KEY: str = ""`, `APP_VERSION: str = "1.0.0"`

#### app/database.py
- `create_async_engine` with `DATABASE_URL` from config
- `async_sessionmaker` with `AsyncSession`
- `Base = declarative_base()`
- `get_db()` async generator dependency for FastAPI

#### SQLAlchemy Models (4 tables per architecture.md Section 6.2)

**resource_log.py:**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer, PK, autoincrement | |
| timestamp | DateTime(timezone=True), NOT NULL | |
| sector_id | String(50), NOT NULL, indexed | |
| resource_type | String(50), NOT NULL, indexed | |
| stock_level | Float, NOT NULL | |
| usage_rate_hourly | Float, NOT NULL | |
| snap_event_detected | Boolean, NOT NULL, default=False | |
| created_at | DateTime(timezone=True), server_default=now() | |

Indexes: composite index on `(sector_id, resource_type)`, index on `timestamp`.

**intel_report.py:**
| Column | Type | Notes |
|--------|------|-------|
| report_id | UUID, PK, server_default=gen_random_uuid() | |
| raw_text | Text, NOT NULL | |
| redacted_text | Text, nullable | |
| metadata_json | JSONB, nullable | |
| priority | String(30), NOT NULL | |
| status | String(20), NOT NULL, default='pending' | |
| extracted_entities | JSONB, nullable | |
| error_message | Text, nullable | |
| timestamp | DateTime(timezone=True), NOT NULL | |
| created_at | DateTime(timezone=True), server_default=now() | |
| processed_at | DateTime(timezone=True), nullable | |

**forecast.py:**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer, PK, autoincrement | |
| sector_id | String(50), NOT NULL | |
| resource_type | String(50), NOT NULL | |
| predicted_exhaustion_date | DateTime(timezone=True), nullable | |
| hours_until_exhaustion | Float, nullable | |
| confidence | Float, nullable | |
| strategy_used | String(50), NOT NULL | |
| snap_detected | Boolean, NOT NULL, default=False | |
| computed_at | DateTime(timezone=True), server_default=now() | |

Unique constraint on `(sector_id, resource_type, computed_at)`.

**redaction_log.py:**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer, PK, autoincrement | |
| report_id | UUID, FK to intel_reports.report_id, NOT NULL | |
| original_text_hash | String(64), NOT NULL | SHA-256 hex digest |
| redacted_text | Text, NOT NULL | |
| patterns_matched | JSONB, NOT NULL | |
| redacted_at | DateTime(timezone=True), server_default=now() | |

#### Pydantic Schemas (resource.py)
- `ResourceLogResponse`: mirrors the resource_log columns (id, timestamp, sector_id, resource_type, stock_level, usage_rate_hourly, snap_event_detected)
- `ResourceListResponse`: `data: list[ResourceLogResponse]`, `total: int`, `limit: int`, `offset: int`
- `SectorsResponse`: `sectors: list[str]`
- `ResourceTypesResponse`: `resource_types: list[str]`
- `SummaryItem`: `sector_id, resource_type, latest_stock_level, latest_usage_rate, latest_timestamp, snap_event_detected`
- `SummaryResponse`: `data: list[SummaryItem]`
- `HealthResponse`: `status: str`, `version: str`

#### routers/health.py
- `GET /health` -> `HealthResponse(status="ok", version=settings.APP_VERSION)`

#### routers/resources.py
- `GET /api/v1/resources` with query params: `sector: str | None`, `resource_type: str | None`, `start: datetime | None`, `end: datetime | None`, `snap_only: bool | None`, `limit: int = 100` (max 1000), `offset: int = 0`
  - Build SQLAlchemy query with optional `.where()` clauses
  - Return `ResourceListResponse`
- `GET /api/v1/resources/sectors` -> distinct `sector_id` values
- `GET /api/v1/resources/types` -> distinct `resource_type` values
- `GET /api/v1/resources/summary` -> for each (sector_id, resource_type), get the row with the latest timestamp. Use a subquery or window function.

#### scripts/seed_db.py
- Read `Prompt-Resources/challenger_package/challenger_package/historical_avengers_data.csv` with pandas
- Group by `(timestamp, sector_id, resource_type)` and average `stock_level`, `usage_rate_hourly` across 5 replicas
- For `snap_event_detected`, use `any()` (True if any replica detected snap)
- Insert ~2000 aggregated rows into `resource_logs`
- Use synchronous SQLAlchemy engine for the seed script (simpler than async for a one-time script)
- Print row count on completion

#### Dockerfile (src/backend/)
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install .
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### docker-compose.yml (root)
Three services:
- `db`: postgres:16-alpine, port 5432, env vars for POSTGRES_DB/USER/PASSWORD, named volume `pgdata`
- `backend`: build from `./src/backend`, port 8000, DATABASE_URL pointing to db service, depends_on db with healthcheck
- `frontend`: placeholder (node:20-alpine with a sleep command or simple static serve) on port 3000, depends_on backend

### Test Requirements

**tests/conftest.py:**
- Create an async test database (SQLite in-memory or test PostgreSQL)
- Provide `AsyncClient` fixture using httpx for testing FastAPI app
- Seed a small set of test data (5-10 rows covering 2 sectors, 2 resource types)

**tests/test_health.py:**
- `test_health_returns_ok`: GET /health -> 200, body has status="ok" and version="1.0.0"

**tests/test_resources_router.py:**
- `test_list_resources`: GET /api/v1/resources -> 200, returns data array
- `test_filter_by_sector`: GET /api/v1/resources?sector=Wakanda -> only Wakanda rows
- `test_filter_by_resource_type`: GET /api/v1/resources?resource_type=Vibranium (kg) -> only that type
- `test_get_sectors`: GET /api/v1/resources/sectors -> returns list of sector names
- `test_get_types`: GET /api/v1/resources/types -> returns list of resource type names
- `test_get_summary`: GET /api/v1/resources/summary -> returns latest stock per combo

## Estimated Scope
L (Large) -- this is the foundation that everything else builds on
