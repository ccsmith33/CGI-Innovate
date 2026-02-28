# ADR-002: PostgreSQL 16 for Database

**Status**: Approved
**Date**: 2026-02-28
**D-ID**: D-002

## Context

The system must store 10,000 time-series resource observations, 200+ field intelligence reports with JSON metadata, forecast results, and a PII redaction audit log. The database must support filtered queries, time-range queries, and JSON storage.

Candidates considered:
- PostgreSQL 16
- MongoDB 7

## Decision

Use PostgreSQL 16.

## Rationale

1. **ACID compliance.** Report processing involves multiple writes (intel_reports, redaction_log) that must be atomic. PostgreSQL transactions guarantee consistency.
2. **JSONB support.** The `metadata_json` and `extracted_entities` columns use JSONB, giving us document-like flexibility without sacrificing relational integrity.
3. **Mature indexing.** Composite indexes, partial indexes (for snap events), and B-tree indexes on timestamps give excellent query performance for dashboard filtering.
4. **Time-series query performance.** `ORDER BY timestamp`, `WHERE timestamp BETWEEN`, and aggregation queries are well-optimized in PostgreSQL.
5. **SQLAlchemy + Alembic.** The most mature Python ORM ecosystem targets PostgreSQL first.
6. **DigitalOcean managed offering.** DigitalOcean provides managed PostgreSQL, simplifying production deployment.

## Consequences

- Requires a running PostgreSQL instance (handled by Docker for local dev, managed service for production).
- Schema migrations managed by Alembic -- adds a small setup cost but ensures reproducible schema evolution.
