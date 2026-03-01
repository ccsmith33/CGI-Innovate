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
from app.routers.sse import router as sse_router

logger = logging.getLogger(__name__)

_agent_paused: bool = False


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


async def _governor_loop():
    """Run the governor ML control loop every 30 seconds."""
    from app.services.event_bus import broadcast
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
                    await broadcast("governor_decision", {
                        "rationale": action.rationale,
                        "budget": action.total_budget_used,
                    })
        except Exception as exc:
            logger.warning("Governor loop error: %s", exc)
        await asyncio.sleep(30)


async def _agent_loop():
    """Run JARVIS autonomous agent every 60 seconds."""
    from app.services.jarvis_agent import run_agent_cycle

    await asyncio.sleep(30)  # let system warm up
    while True:
        try:
            if not _agent_paused:
                async with get_session_factory()() as session:
                    await run_agent_cycle(session)
        except Exception as exc:
            logger.warning("Agent loop error: %s", exc)
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    asyncio.create_task(_startup_background())
    asyncio.create_task(_governor_loop())
    asyncio.create_task(_agent_loop())
    yield


app = FastAPI(title="Project Sentinel API", version="1.0.0", lifespan=lifespan)


@app.post("/api/v1/agent/pause")
async def pause_agent():
    global _agent_paused
    _agent_paused = True
    from app.services.event_bus import broadcast
    await broadcast("agent_status", {"paused": True})
    return {"paused": True}


@app.post("/api/v1/agent/resume")
async def resume_agent():
    global _agent_paused
    _agent_paused = False
    from app.services.event_bus import broadcast
    await broadcast("agent_status", {"paused": False})
    return {"paused": False}


@app.get("/api/v1/agent/status")
async def agent_status():
    return {"paused": _agent_paused}


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
app.include_router(sse_router, prefix="/api/v1")
