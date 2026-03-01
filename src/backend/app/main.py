import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine, get_session_factory
from app.models import ControlAction, Forecast, IntelReport, RedactionLog, ResourceLog  # noqa: F401
from app.routers.admin import router as admin_router
from app.routers.analytics import router as analytics_router
from app.routers.feed import router as feed_router
from app.routers.forecasts import router as forecasts_router
from app.routers.governor import router as governor_router
from app.routers.health import router as health_router
from app.routers.jarvis_chat import router as jarvis_chat_router
from app.routers.reports import router as reports_router
from app.routers.resources import router as resources_router

logger = logging.getLogger(__name__)


async def _startup_background():
    """Compute forecasts for all sector+resource pairs on startup."""
    await asyncio.sleep(3)  # let DB settle after table creation
    try:
        from app.services.jarvis_forecast import ForecastService

        async with get_session_factory()() as session:
            service = ForecastService(session)
            results = await service.compute_all_forecasts()
            logger.info("Startup: computed %d forecasts", len(results))
    except Exception as exc:
        logger.warning("Startup forecast computation failed: %s", exc)


async def _feed_polling_loop():
    """Poll the feed service every 10 seconds and ingest events."""
    from app.services.feed_ingester import FeedIngester

    await asyncio.sleep(5)  # let feed service start up
    ingester = FeedIngester()

    while True:
        try:
            async with get_session_factory()() as session:
                count = await ingester.poll_and_ingest(session)
                if count:
                    logger.info("Feed ingester: ingested %d events", count)
        except Exception as exc:
            logger.warning("Feed polling error: %s", exc)
        await asyncio.sleep(10)


async def _governor_loop():
    """Run the governor ML control loop every 30 seconds."""
    from app.services.governor import governor_instance

    await asyncio.sleep(15)  # let feed ingester populate some data first

    while True:
        try:
            async with get_session_factory()() as session:
                action = await governor_instance.run_cycle(session)
                if action:
                    logger.info(
                        "Governor cycle: confidence=%.1f%% budget=$%.0f sectors_adjusted=%d",
                        action.champion_confidence,
                        action.total_budget_used,
                        action.sectors_adjusted,
                    )
        except Exception as exc:
            logger.warning("Governor loop error: %s", exc)
        await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    asyncio.create_task(_startup_background())
    asyncio.create_task(_feed_polling_loop())
    asyncio.create_task(_governor_loop())
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
app.include_router(admin_router, prefix="/api/v1")
app.include_router(analytics_router, prefix="/api/v1")
app.include_router(feed_router, prefix="/api/v1")
app.include_router(jarvis_chat_router, prefix="/api/v1")
app.include_router(governor_router, prefix="/api/v1")
