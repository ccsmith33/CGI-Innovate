from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.forecast import Forecast
from app.models.resource_log import ResourceLog
from app.schemas.forecast import (
    ForecastListResponse,
    ForecastRefreshResponse,
    ForecastResponse,
)
from app.services.jarvis_forecast import DEFAULT_STRATEGY, ForecastService
from app.services.strategies.exponential_decay import ExponentialDecayStrategy
from app.services.strategies.linear_regression import LinearRegressionStrategy
from app.services.strategies.polynomial_regression import PolynomialRegressionStrategy

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


@router.get("/compare")
async def compare_forecasts(
    sector_id: str = Query(...),
    resource_type: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ResourceLog)
        .where(ResourceLog.sector_id == sector_id)
        .where(ResourceLog.resource_type == resource_type)
        .order_by(ResourceLog.timestamp)
    )
    rows = result.scalars().all()

    if not rows:
        raise HTTPException(status_code=404, detail="No resource logs found")

    timestamps = [r.timestamp for r in rows]
    stock_levels = [r.stock_level for r in rows]
    snap_flags = [r.snap_event_detected for r in rows]

    strategies = {
        "linear_regression": LinearRegressionStrategy(),
        "polynomial_regression": PolynomialRegressionStrategy(),
        "exponential_decay": ExponentialDecayStrategy(),
    }

    results = {}
    for name, strategy in strategies.items():
        strategy.fit(timestamps, stock_levels, snap_flags)
        forecast = strategy.predict_exhaustion_date()
        results[name] = {
            "predicted_exhaustion_date": (
                forecast.predicted_exhaustion_date.isoformat()
                if forecast.predicted_exhaustion_date
                else None
            ),
            "hours_until_exhaustion": forecast.hours_until_exhaustion,
            "confidence": forecast.confidence,
            "strategy_name": forecast.strategy_name,
            "snap_detected": forecast.snap_detected,
        }

    return {"sector_id": sector_id, "resource_type": resource_type, "forecasts": results}
