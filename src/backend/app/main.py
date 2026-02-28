from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.models import Forecast, IntelReport, RedactionLog, ResourceLog  # noqa: F401
from app.routers.forecasts import router as forecasts_router
from app.routers.health import router as health_router
from app.routers.reports import router as reports_router
from app.routers.resources import router as resources_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="Project Sentinel API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(resources_router, prefix="/api/v1")
app.include_router(reports_router, prefix="/api/v1")
app.include_router(forecasts_router, prefix="/api/v1")
