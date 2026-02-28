from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.forecast import Forecast
from app.schemas.forecast import (
    ForecastListResponse,
    ForecastRefreshResponse,
    ForecastResponse,
)
from app.services.jarvis_forecast import DEFAULT_STRATEGY, ForecastService

router = APIRouter(prefix="/forecasts", tags=["forecasts"])


@router.get("", response_model=ForecastListResponse)
async def list_forecasts(db: AsyncSession = Depends(get_db)):
    # Get the latest forecast per sector+resource (max computed_at)
    subq = (
        select(
            Forecast.sector_id,
            Forecast.resource_type,
            func.max(Forecast.computed_at).label("max_computed"),
        )
        .group_by(Forecast.sector_id, Forecast.resource_type)
        .subquery()
    )

    query = select(Forecast).join(
        subq,
        (Forecast.sector_id == subq.c.sector_id)
        & (Forecast.resource_type == subq.c.resource_type)
        & (Forecast.computed_at == subq.c.max_computed),
    )

    result = await db.execute(query)
    rows = result.scalars().all()
    return ForecastListResponse(
        data=[ForecastResponse.model_validate(r) for r in rows]
    )


@router.get("/{sector_id}/{resource_type}", response_model=ForecastResponse)
async def get_forecast(
    sector_id: str,
    resource_type: str,
    db: AsyncSession = Depends(get_db),
):
    # Get the latest forecast for this sector+resource
    result = await db.execute(
        select(Forecast)
        .where(Forecast.sector_id == sector_id)
        .where(Forecast.resource_type == resource_type)
        .order_by(Forecast.computed_at.desc())
        .limit(1)
    )
    forecast = result.scalar_one_or_none()
    if not forecast:
        raise HTTPException(status_code=404, detail="Forecast not found")
    return ForecastResponse.model_validate(forecast)


@router.post("/refresh", response_model=ForecastRefreshResponse, status_code=202)
async def refresh_forecasts(db: AsyncSession = Depends(get_db)):
    service = ForecastService(db)
    await service.compute_all_forecasts()
    return ForecastRefreshResponse(
        message="Forecast refresh initiated", strategy=DEFAULT_STRATEGY
    )
