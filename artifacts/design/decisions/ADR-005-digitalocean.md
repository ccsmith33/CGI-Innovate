# ADR-005: DigitalOcean App Platform for Deployment

**Status**: Approved
**Date**: 2026-02-28
**D-ID**: D-005

## Context

The system must be deployable for the hackathon demo. The deployment platform must support:
- Two container services (Next.js frontend, FastAPI backend)
- A managed PostgreSQL database
- Environment variable / secrets management
- Fast setup (solo developer, 24-hour constraint)

Candidates considered:
- DigitalOcean App Platform
- AWS (ECS / Fargate)
- Vercel + separate backend host
- Railway

## Decision

Use DigitalOcean App Platform.

## Rationale

1. **Integrated container + database platform.** App Platform deploys Docker containers and provides managed PostgreSQL in the same dashboard, eliminating multi-service coordination.
2. **Simple configuration.** A single `.do/app.yaml` or the web UI configures both services. No Terraform, CloudFormation, or IAM roles required.
3. **Predictable pricing.** Basic tier is sufficient for a hackathon demo; no surprise costs.
4. **Fast time-to-deploy.** Push to GitHub -> auto-deploy. No CI/CD pipeline to build from scratch.
5. **Secrets management.** Environment variables (OPENAI_API_KEY, DATABASE_URL) are configured as encrypted secrets in the App Platform UI.

## Consequences

- Vendor lock-in to DigitalOcean is minimal -- the system is containerized with Docker, so migration to any container platform is straightforward.
- App Platform has limited auto-scaling options compared to AWS, but scaling is not a concern for a hackathon demo.
