# Performance Audit: Project Sentinel

> **Auditor**: Performance Agent
> **Date**: 2026-02-28
> **Scope**: Database queries, ML forecasting, OpenAI API calls, frontend polling, Docker configuration

## Performance Risk Level: MEDIUM

The application is well-architected for a demo/hackathon context. Most queries are properly indexed and paginated. However, several issues could cause visible sluggishness under load or during live demo: the forecast computation loads all rows into memory per pair, the OpenAI client is instantiated per-call, there are no Docker resource limits, and some missing indexes deviate from the architecture spec.

---

## Critical Performance Issues

### 1. Forecast computation loads ALL resource_log rows into memory (HIGH)

**File**: `src/backend/app/services/jarvis_forecast.py:33-39`

```python
result = await self.db.execute(
    select(ResourceLog)
    .where(ResourceLog.sector_id == sector_id)
    .where(ResourceLog.resource_type == resource_type)
    .order_by(ResourceLog.timestamp)
)
rows = result.scalars().all()
```

For each sector+resource pair, this loads **all** matching rows into Python memory. With 10,000 total rows across 25 pairs, that is ~400 rows per pair -- acceptable for the demo data set. But the query is **unbounded**: if data grows, this becomes an OOM risk. There is no `LIMIT` clause.

Additionally, `compute_all_forecasts()` (line 72-88) runs **sequentially** through all pairs, issuing a separate full-table-scan query for each. For 25 pairs, this means 25 separate queries plus 25 delete+insert cycles, all inside the same request handler (the `/refresh` endpoint is synchronous from the caller's perspective despite being async internally).

**Impact**: The `/forecasts/refresh` endpoint blocks for the entire sequential computation. With 25 pairs, each querying ~400 rows and fitting a linear regression, estimated wall time is 1-3 seconds. Acceptable for demo but would degrade with more data.

### 2. OpenAI client instantiated per-call (MEDIUM)

**File**: `src/backend/app/services/jarvis_llm.py:31`

```python
client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
```

A new `AsyncOpenAI` client is created for every `extract_intel()` call. This means a new HTTP connection pool is created and torn down for each request, preventing TCP connection reuse and adding ~50-100ms of overhead per call.

**Impact**: During seed processing of 200 reports or if 50 reports are submitted simultaneously, this creates 50+ independent connection pools. The `AsyncOpenAI` client uses `httpx` internally with its own connection pool -- instantiating it once and reusing would eliminate this overhead.

### 3. No retry logic or timeout on OpenAI API calls (MEDIUM)

**File**: `src/backend/app/services/jarvis_llm.py:33-40`

```python
response = await client.chat.completions.create(
    model="gpt-5.2",
    response_format={"type": "json_object"},
    messages=[...],
)
```

- **No timeout**: If OpenAI is slow, the background task hangs indefinitely.
- **No retry**: Transient 429/500/503 errors immediately fall to the catch-all exception handler, marking the report as "error" permanently.
- **No concurrency limit**: `BackgroundTasks.add_task()` fires tasks into an unbounded asyncio task queue. If 50 reports are submitted simultaneously, 50 concurrent OpenAI API calls will fire, likely triggering rate limits.

---

## Database Query Analysis

### GET `/api/v1/resources` -- Efficiency: GOOD

- **Pagination**: Enforced. Default `limit=100`, max `limit=1000`. Offset-based.
- **Columns**: Loads full ORM model (`select(ResourceLog)`), which is effectively `SELECT *`. However, the response schema uses most columns, so this is acceptable.
- **Indexes used**: `ix_resource_logs_sector_resource` for sector+resource filters, `ix_resource_logs_timestamp` for ordering. Both defined in the model.
- **Count query**: Separate `SELECT COUNT(*)` runs without LIMIT/OFFSET -- efficient with indexes.
- **No N+1**: Single query pattern.

### GET `/api/v1/resources/summary` -- Efficiency: GOOD

- **Pattern**: Uses a subquery to get `MAX(timestamp)` per `(sector_id, resource_type)`, then joins back to get the full row. This is a proper "latest row per group" pattern.
- **Indexes used**: `ix_resource_logs_sector_resource` for the GROUP BY, `ix_resource_logs_timestamp` for the MAX.
- **Rows returned**: At most 25 rows (5 sectors x 5 resources). Very efficient.
- **No N+1**: Single query.

### GET `/api/v1/resources/sectors` and `/types` -- Efficiency: GOOD

- `SELECT DISTINCT sector_id` and `SELECT DISTINCT resource_type` with individual column indexes.
- Returns at most 5 values each. Trivial cost.

### GET `/api/v1/reports` -- Efficiency: GOOD

- **Pagination**: Default `limit=50`, max `limit=1000`.
- **Filtering**: By `status` and `priority`.
- **Missing indexes**: The `IntelReport` model has **no indexes** on `status` or `priority`. The architecture (Section 6.2) specifies:
  - `ix_intel_reports_status` on `(status)`
  - `ix_intel_reports_priority` on `(priority)`
  - `ix_intel_reports_timestamp` on `(timestamp)`

  None of these are defined in `src/backend/app/models/intel_report.py`. With only ~200 reports this is not a performance issue, but it deviates from the architecture spec.

### GET `/api/v1/reports/{report_id}` -- Efficiency: GOOD

- Primary key lookup. O(1).

### GET `/api/v1/forecasts` -- Efficiency: GOOD

- Same "latest per group" subquery pattern as resources/summary.
- **Missing indexes**: The `Forecast` model has a `UniqueConstraint` on `(sector_id, resource_type, computed_at)` but no explicit indexes for:
  - `ix_forecasts_sector_resource` on `(sector_id, resource_type)`
  - `ix_forecasts_computed_at` on `(computed_at DESC)`

  The UniqueConstraint creates an implicit index on all three columns, which partially covers lookup by `(sector_id, resource_type)`. However, the architecture specifies separate indexes for these.

### GET `/api/v1/forecasts/{sector}/{resource}` -- Efficiency: GOOD

- Filtered query with `ORDER BY computed_at DESC LIMIT 1`. Efficient with the unique constraint's implicit index.

### POST `/api/v1/forecasts/refresh` -- Efficiency: FAIR

- Runs `compute_all_forecasts()` synchronously within the request.
- For each of 25 pairs: loads all rows, fits sklearn model, deletes old forecasts row-by-row, inserts new. The delete pattern (`for old_row in old.scalars().all(): await self.db.delete(old_row)`) issues N individual DELETE statements rather than a single `DELETE WHERE` bulk query.

### Architecture Index Compliance Summary

| Index (from architecture.md) | Defined in models? | Status |
|---|---|---|
| `ix_resource_logs_sector_resource` | Yes | OK |
| `ix_resource_logs_timestamp` | Yes | OK |
| `ix_resource_logs_snap` (partial) | **No** | MISSING |
| `ix_intel_reports_status` | **No** | MISSING |
| `ix_intel_reports_priority` | **No** | MISSING |
| `ix_intel_reports_timestamp` | **No** | MISSING |
| `ix_forecasts_sector_resource` | **No** (covered by UniqueConstraint partially) | MISSING |
| `ix_forecasts_computed_at` | **No** | MISSING |
| `ix_redaction_log_report_id` | **No** (FK exists, but no explicit index) | MISSING |

**6 of 9 specified indexes are missing from the model definitions.** PostgreSQL automatically creates indexes for primary keys and unique constraints, so `forecasts` has partial coverage. Foreign keys do NOT automatically get indexes in PostgreSQL.

---

## ML Forecast Performance

### Row Loading
- Each `compute_forecast()` call loads ALL `resource_log` rows for that sector+resource pair into memory as full ORM objects.
- With ~400 rows per pair (10,000 total / 25 pairs), memory usage is approximately 400 * ~1KB = ~400KB per pair. Manageable.
- The query is **unbounded** -- no LIMIT. If data grows to 100K rows, this loads 4,000 rows per pair as full ORM objects.

### Caching
- Forecast results **are** cached in the `forecasts` table after computation. The `list_forecasts` and `get_forecast` endpoints read from this table, not from live computation.
- Old forecasts are deleted and replaced on each `/refresh` call.
- The delete pattern is inefficient: loads all old rows, then deletes one-by-one. A single `DELETE FROM forecasts WHERE sector_id = ? AND resource_type = ?` would be faster.

### Compute Time Estimate
- sklearn `LinearRegression.fit()` on 400 rows is very fast: ~0.5ms per pair.
- 25 pairs: ~12.5ms of pure computation.
- DB overhead (25 queries + 25 delete cycles + 25 inserts + commits): ~100-200ms total.
- **Estimated total for `/forecasts/refresh`**: 200-500ms. Acceptable for demo.

### Sequential vs. Parallel
- `compute_all_forecasts()` processes pairs sequentially with `for ... await`. Since each iteration hits the DB and does CPU work, parallelizing with `asyncio.gather()` could improve throughput. However, given the ~200-500ms total time, this is not critical.

---

## Frontend Polling Analysis

### SWR Intervals
| Data | Interval | Architecture Spec | Status |
|---|---|---|---|
| Resources | 5000ms (5s) | 5s | OK |
| Summary | 5000ms (5s) | Not specified | OK |
| Forecasts | 30000ms (30s) | Not specified | OK (forecasts rarely change) |
| Reports | 3000ms (3s) | 3s | OK |

### Payload Size Concerns

**Resources endpoint**: The dashboard requests `limit: '500'` (line 36 of `dashboard/page.tsx`):
```js
const resourceParams: Record<string, string> = { limit: '500' }
```

Every 5 seconds, the frontend fetches up to 500 resource log rows. Each row has ~7 fields. Estimated JSON payload: ~500 * 200 bytes = ~100KB per poll. This is reasonable for a LAN demo but could be optimized by only fetching new data since last poll (i.e., using a `start` timestamp filter).

**Reports endpoint**: `fetchReports()` in `intel-table.tsx` calls with no limit parameter, so it defaults to the server's `limit=50`. With 200 reports and the JSON entities payload, estimated size: ~50 * 500 bytes = ~25KB per poll every 3 seconds. Reasonable.

### Re-rendering
- Recharts does NOT have built-in data diffing. On every SWR poll, `ResourceChart` receives a new data array, causing a full re-render of the chart. With 500 data points, this creates a new SVG path computation every 5 seconds. Recharts is known to be relatively slow with large datasets.
- The chart does `dot={false}`, which helps (no 500 individual dot elements). But the `Brush` component at the bottom adds extra rendering cost.
- The `resource-chart.tsx` component also **re-filters and re-sorts** the data on every render (lines 61-82), even though the backend already filters and sorts. This is redundant work.

### Chart Double-Filtering
In `resource-chart.tsx:61-65`:
```js
const filtered = data.filter(
    (d) =>
      (!sector || d.sector_id === sector) &&
      (!resource || d.resource_type === resource)
  )
```
The backend already applies sector and resource_type filters (the dashboard passes these params to `fetchResources`). This client-side filter is redundant CPU work on every render.

---

## Docker Configuration

### Resource Limits: NONE

No `mem_limit`, `cpus`, `deploy.resources`, or equivalent settings are defined for any service.

- **frontend**: No limits. A Next.js build can consume 1-2GB RAM.
- **backend**: No limits. Uvicorn + FastAPI is lightweight (~100MB), but uncontrolled background tasks could spike.
- **db**: No limits. PostgreSQL with default `shared_buffers` will claim ~128MB, but can grow.

**Risk**: A runaway process (e.g., concurrent OpenAI background tasks timing out and accumulating) could consume all host memory. For a demo on a DigitalOcean droplet with limited RAM, this is a real risk.

### Restart Policy

- **frontend**: No restart policy defined. Defaults to `no`. If the frontend crashes, it stays down.
- **backend**: No restart policy defined.
- **db**: No restart policy defined.

Architecture should specify `restart: unless-stopped` for all services.

### Startup Order

- **backend -> db**: Correct. `depends_on: db: condition: service_healthy` with a proper `pg_isready` healthcheck. The backend will wait for PostgreSQL to be ready.
- **frontend -> backend**: Uses simple `depends_on: - backend` without healthcheck condition. The frontend could start before the backend is fully ready (table creation, etc.). However, since the frontend makes API calls at runtime, not at build time, this is acceptable -- API calls will simply fail until the backend is up, and SWR will retry.

### Database Migrations

- The backend uses `Base.metadata.create_all()` on startup (in `main.py` lifespan), NOT Alembic migrations. This means:
  - Tables are created if they don't exist.
  - Schema changes are NOT applied (create_all doesn't alter existing tables).
  - Alembic is present in the project structure but not wired into the startup sequence.

### Seed Script

- The seed script (`scripts/seed_db.py`) uses **bulk insert** for resource_logs: `session.execute(ResourceLog.__table__.insert(), batch)`. This is efficient -- a single INSERT with multiple value sets.
- However, intel reports are inserted **row-by-row** with `session.add(report)` in a loop (200 reports). This is less efficient but acceptable for 200 rows.
- The seed script is run manually (`python scripts/seed_db.py`), not as part of the Docker startup sequence.

### Database Volume

- `pgdata` uses a default Docker named volume. On DigitalOcean, this maps to the droplet's filesystem. Performance depends on the droplet's disk type (SSD by default on modern droplets).
- No volume driver or mount options specified. Default is fine for demo.

---

## OpenAI Background Task Queue Analysis

**Scenario**: 50 reports submitted simultaneously.

1. Each `POST /reports/submit` synchronously creates the report and redaction log, then schedules a `BackgroundTasks.add_task()`.
2. FastAPI's `BackgroundTasks` runs tasks **after** the response is sent, but they execute in the **same event loop** (not a thread pool).
3. All 50 `extract_intel()` calls will fire concurrently as asyncio tasks.
4. Each creates its own `AsyncOpenAI` client and HTTP connection.
5. OpenAI rate limits (typically 3,500 RPM for GPT-4 class models) would likely not be hit with 50 requests, but there is no backpressure mechanism.
6. If OpenAI is slow (2-3s per call), all 50 tasks are in-flight simultaneously, each holding an open HTTP connection and a database session.

**Risk**: LOW for the demo (200 pre-seeded reports, manual submission during demo). But architecturally, there is no concurrency limit.

---

## Recommendations (Priority Ordered)

### Quick Wins (< 30 min each)

1. **Move OpenAI client to module-level singleton** -- Instantiate `AsyncOpenAI` once in `jarvis_llm.py` at module scope, reuse for all calls. Reduces connection overhead by ~50-100ms per call.

2. **Add missing indexes to models** -- Add the 6 missing indexes specified in the architecture to `intel_report.py`, `forecast.py`, and `resource_log.py`. Even though they are not performance-critical at demo scale, they ensure architecture compliance and prevent audit findings.

3. **Remove redundant client-side filtering in ResourceChart** -- The `data.filter()` in `resource-chart.tsx` duplicates backend filtering. Remove it to save CPU on every 5s re-render.

4. **Add `restart: unless-stopped`** to all three services in `docker-compose.yml`. One-line change per service, prevents demo crashes from being permanent.

5. **Use bulk DELETE in forecast refresh** -- Replace the row-by-row delete loop in `jarvis_forecast.py` with:
   ```python
   await self.db.execute(
       delete(Forecast)
       .where(Forecast.sector_id == sector_id)
       .where(Forecast.resource_type == resource_type)
   )
   ```

### Medium Priority (30-60 min)

6. **Add timeout to OpenAI API call** -- Set `timeout=30` on the `AsyncOpenAI` client to prevent background tasks from hanging indefinitely.

7. **Add resource limits to Docker services** -- Set `mem_limit: 512m` for backend, `mem_limit: 1g` for frontend, `mem_limit: 256m` for db. Prevents a runaway container from killing the host.

8. **Limit resource_log rows loaded for forecasting** -- Add a `LIMIT` or time-window filter to `compute_forecast()` to bound memory usage. For linear regression, the last 1000 rows per pair is sufficient.

### Low Priority (Nice-to-have)

9. **Add basic retry logic for OpenAI calls** -- Use the `max_retries` parameter built into the OpenAI client: `AsyncOpenAI(max_retries=2)`.

10. **Consider using `useSWRImmutable` for static data** -- Sectors and resource types never change at runtime. Using `useSWRImmutable` instead of `useSWR` for these would eliminate unnecessary re-fetches.

11. **Add a concurrency semaphore for background report processing** -- Limit concurrent OpenAI calls to 5-10 using an `asyncio.Semaphore`.
