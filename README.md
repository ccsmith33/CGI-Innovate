# Project Sentinel

Command & Control dashboard for real-time resource management during a simulated multi-sector crisis. Built with Next.js 15, FastAPI, PostgreSQL, and OpenAI.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js 20+](https://nodejs.org/) (for local frontend development without Docker)
- [Python 3.12+](https://www.python.org/) (for local backend development without Docker)

## Local Development

### 1. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your values. At minimum, set a real `OPENAI_API_KEY`.

### 2. Start all services

```bash
docker-compose up --build
```

This starts three containers:
- **frontend** (Next.js) on http://localhost:3000
- **backend** (FastAPI) on http://localhost:8000
- **db** (PostgreSQL) on localhost:5432

### 3. Seed the database

Once the services are running:

```bash
docker-compose exec backend python scripts/seed_db.py
```

This loads the historical resource data (10,000 rows) and field intelligence reports (200 documents) into PostgreSQL.

## Accessing Services

| Service | URL | Description |
|---------|-----|-------------|
| Dashboard | http://localhost:3000 | Main application UI |
| API Docs | http://localhost:8000/docs | Interactive Swagger/OpenAPI documentation |
| API Health | http://localhost:8000/health | Backend health check endpoint |

## Running Tests

### Backend tests

```bash
docker-compose exec backend pytest
```

### Frontend tests

```bash
docker-compose exec frontend npm test
```

## DigitalOcean Deployment

### Via CLI

```bash
doctl apps create --spec .do/app.yaml
```

### Via Web Console

1. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
2. Create a new app from your GitHub repository
3. Import the app spec from `.do/app.yaml`
4. Set the `OPENAI_API_KEY` secret in the app settings
5. Deploy

The app spec configures:
- Backend service with health checks
- Frontend service with build-time API URL injection
- Managed PostgreSQL database (dev tier)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for entity extraction (gpt-5.2) | Yes |
| `POSTGRES_DB` | PostgreSQL database name | Yes (default: `sentinel`) |
| `POSTGRES_USER` | PostgreSQL username | Yes (default: `sentinel`) |
| `POSTGRES_PASSWORD` | PostgreSQL password | Yes |
| `POSTGRES_HOST` | PostgreSQL host | Yes (default: `db`) |
| `POSTGRES_PORT` | PostgreSQL port | Yes (default: `5432`) |
| `DATABASE_URL` | Full async database connection string | Yes (derived from above) |
| `NEXT_PUBLIC_API_URL` | Backend API URL for frontend | Yes (default: `http://localhost:8000`) |

## Project Structure

```
CGI-Innovate/
├── docker-compose.yml          # Local development orchestration
├── .env.example                # Environment variable template
├── .do/app.yaml                # DigitalOcean App Platform spec
├── src/
│   ├── frontend/               # Next.js 15 + shadcn/ui + Recharts
│   │   ├── Dockerfile
│   │   ├── app/                # Next.js app router pages
│   │   ├── components/         # React components
│   │   └── lib/                # Utilities and API client
│   └── backend/                # FastAPI + SQLAlchemy + OpenAI
│       ├── Dockerfile
│       ├── app/                # Application modules
│       ├── scripts/            # Database seeding scripts
│       ├── alembic/            # Database migrations
│       └── tests/              # Pytest test suite
└── artifacts/                  # Project documentation and design artifacts
```
