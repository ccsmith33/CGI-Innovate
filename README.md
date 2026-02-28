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

### Production (DigitalOcean Droplet)

| Service | URL |
|---------|-----|
| Dashboard | http://209.97.154.53:3000 |
| API Docs (Swagger) | http://209.97.154.53:8000/docs |
| API Health | http://209.97.154.53:8000/health |

## Running Tests

### Backend tests

```bash
docker-compose exec backend pytest
```

### Frontend tests

```bash
docker-compose exec frontend npm test
```

## DigitalOcean Droplet Deployment

### 1. Create a Droplet

- **Image**: Ubuntu 22.04 + Docker (from the DO Marketplace — Docker comes pre-installed)
- **Size**: Basic, 2GB RAM / 1 CPU ($12-24/mo)
- **Authentication**: SSH key (recommended)

### 2. Configure the firewall

In DO Console → Networking → Firewalls, open inbound ports:
- `22` — SSH
- `3000` — Frontend
- `8000` — Backend API (for curl/Postman access, required for demo)

Do **not** expose port 5432 publicly — PostgreSQL stays internal to Docker.

### 3. Deploy

```bash
# SSH into your Droplet
ssh root@YOUR_DROPLET_IP

# Clone the repo
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Configure environment
cp .env.example .env
nano .env   # Set OPENAI_API_KEY, POSTGRES_PASSWORD, and:
            # NEXT_PUBLIC_API_URL=http://YOUR_DROPLET_IP:8000

# Start all services
docker compose up -d --build

# Seed the database
docker compose exec backend python scripts/seed_db.py
```

### 4. Access

| Service | URL |
|---------|-----|
| Dashboard | `http://YOUR_DROPLET_IP:3000` |
| API Docs (Swagger) | `http://YOUR_DROPLET_IP:8000/docs` |
| Health Check | `http://YOUR_DROPLET_IP:8000/health` |

### Updating after a code push

```bash
git pull
docker compose up -d --build
```

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
├── docker-compose.yml          # Orchestrates all services (local + Droplet)
├── .env.example                # Environment variable template
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
