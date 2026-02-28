# Decision Log -- Project Sentinel

> Tracks all architectural and technical decisions. Each decision has a unique D-ID referenced by downstream artifacts (architecture, stories, code).

| D-ID | Decision | Rationale | Status | ADR |
|------|----------|-----------|--------|-----|
| D-001 | Python FastAPI for backend API | Async-native, auto OpenAPI docs, Pydantic-first, native Python ML/AI ecosystem | Approved | ADR-001 |
| D-002 | PostgreSQL 16 for persistent storage | ACID compliance, JSONB for metadata, mature indexing, time-series performance | Approved | ADR-002 |
| D-003 | Strategy pattern for ML forecasting | Swap algorithms without API changes, open/closed principle, rapid experimentation | Approved | ADR-003 |
| D-004 | Server-side PII regex redaction before LLM | Zero-trust PII handling; redact at earliest pipeline point; never expose raw PII to OpenAI | Approved | ADR-004 |
| D-005 | DigitalOcean App Platform for deployment | Managed containers + managed PostgreSQL, fast setup, predictable cost | Approved | ADR-005 |
| D-006 | Denormalized sector/resource columns (no reference tables) | Only 5 fixed values each; join overhead unjustified; validated via Python enums | Approved | -- |
| D-007 | Next.js 15 App Router for frontend | Server components for initial load, file-based routing, TypeScript-native, shadcn/ui compat | Approved | -- |
| D-008 | Recharts for chart visualization | React-native composable API, supports line/bar/area, easy forecast overlay | Approved | -- |
| D-009 | SQLAlchemy + Alembic for ORM and migrations | Industry-standard Python ORM, type-safe, version-controlled schema changes | Approved | -- |
| D-010 | Docker + docker-compose for local dev | Reproducible environment, single-command startup, mirrors production | Approved | -- |
| D-011 | Snap-aware regression as default ML strategy | Naive regression across snap boundary produces incorrect forecasts; post-snap-only fitting is more accurate | Approved | -- |
| D-012 | SHA-256 hash in redaction log (not raw text storage) | Provides integrity verification without duplicating PII in the audit table | Approved | -- |
