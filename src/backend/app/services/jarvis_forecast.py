from datetime import datetime, timezone

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.forecast import Forecast
from app.models.resource_log import ResourceLog
from app.services.strategies.base import ForecastResult, ForecastingStrategy
from app.services.strategies.linear_regression import LinearRegressionStrategy
from app.services.strategies.snap_aware import SnapAwareLinearRegression

STRATEGY_REGISTRY: dict[str, type[ForecastingStrategy]] = {
    "linear_regression": LinearRegressionStrategy,
    "snap_aware_linear_regression": SnapAwareLinearRegression,
}
DEFAULT_STRATEGY = "snap_aware_linear_regression"


class ForecastService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def compute_forecast(
        self,
        sector_id: str,
        resource_type: str,
        strategy_name: str | None = None,
    ) -> ForecastResult:
        strategy_name = strategy_name or DEFAULT_STRATEGY
        strategy_cls = STRATEGY_REGISTRY[strategy_name]
        strategy = strategy_cls()

        result = await self.db.execute(
            select(ResourceLog)
            .where(ResourceLog.sector_id == sector_id)
            .where(ResourceLog.resource_type == resource_type)
            .order_by(ResourceLog.timestamp)
        )
        rows = result.scalars().all()

        timestamps = [r.timestamp for r in rows]
        stock_levels = [r.stock_level for r in rows]
        snap_flags = [r.snap_event_detected for r in rows]

        strategy.fit(timestamps, stock_levels, snap_flags)
        forecast_result = strategy.predict_exhaustion_date()

        # Delete old forecasts for this sector+resource and insert new
        old = await self.db.execute(
            select(Forecast)
            .where(Forecast.sector_id == sector_id)
            .where(Forecast.resource_type == resource_type)
        )
        for old_row in old.scalars().all():
            await self.db.delete(old_row)

        new_forecast = Forecast(
            sector_id=sector_id,
            resource_type=resource_type,
            predicted_exhaustion_date=forecast_result.predicted_exhaustion_date,
            hours_until_exhaustion=forecast_result.hours_until_exhaustion,
            confidence=forecast_result.confidence,
            strategy_used=forecast_result.strategy_name,
            snap_detected=forecast_result.snap_detected,
            computed_at=datetime.now(timezone.utc),
        )
        self.db.add(new_forecast)
        await self.db.commit()

        return forecast_result

    async def compute_all_forecasts(
        self, strategy_name: str | None = None
    ) -> list[ForecastResult]:
        result = await self.db.execute(
            select(
                distinct(ResourceLog.sector_id),
                ResourceLog.resource_type,
            ).group_by(ResourceLog.sector_id, ResourceLog.resource_type)
        )
        pairs = result.all()

        results = []
        for sector_id, resource_type in pairs:
            fr = await self.compute_forecast(sector_id, resource_type, strategy_name)
            results.append(fr)

        return results
