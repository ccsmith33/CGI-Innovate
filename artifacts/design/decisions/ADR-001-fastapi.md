# ADR-001: Python FastAPI for Backend API

**Status**: Approved
**Date**: 2026-02-28
**D-ID**: D-001

## Context

The backend must serve a REST API for resource data, process field reports through a PII redaction pipeline and LLM, and run ML forecasting. The hackathon is 24 hours with a solo developer.

Candidates considered:
- Node.js (Express/Fastify)
- Python (FastAPI)
- Go (Gin/Chi)

## Decision

Use Python FastAPI.

## Rationale

1. **Native AI/ML ecosystem.** OpenAI's Python SDK, scikit-learn, numpy, and pandas are all first-class Python libraries. Using Node.js or Go would require FFI bridges or separate services.
2. **Async-native.** FastAPI is built on Starlette and supports `async/await` out of the box, matching the I/O-bound workload (database queries, LLM API calls).
3. **Auto-generated OpenAPI docs.** FastAPI produces interactive Swagger UI at `/docs`, which is valuable for the demo and for frontend development.
4. **Pydantic integration.** Request/response validation via Pydantic models reduces boilerplate and catches bugs at the API boundary.
5. **Developer velocity.** Python is the fastest language for prototyping AI/ML pipelines in a 24-hour constraint.

## Consequences

- Frontend (TypeScript/Next.js) and backend (Python) use different languages. This is acceptable because they communicate via REST JSON and are separately containerized.
- Python's GIL is not a concern for this workload -- the bottleneck is I/O (DB, LLM API), not CPU-bound computation.
