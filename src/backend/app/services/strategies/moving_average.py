from datetime import datetime, timedelta

import numpy as np

from app.services.strategies.base import ForecastingStrategy, ForecastResult


class MovingAverageStrategy(ForecastingStrategy):
    """Simple N-period moving average baseline strategy."""

    def __init__(self, window: int = 10):
        self._window = window
        self._slope: float = 0.0
        self._last_stock: float = 0.0
        self._t0: datetime | None = None
        self._last_timestamp: datetime | None = None

    def fit(
        self,
        timestamps: list[datetime],
        stock_levels: list[float],
        snap_flags: list[bool] | None = None,
    ) -> None:
        if len(timestamps) < 2:
            self._last_stock = stock_levels[0] if stock_levels else 0.0
            self._t0 = timestamps[0] if timestamps else None
            self._last_timestamp = timestamps[-1] if timestamps else None
            self._slope = 0.0
            return

        self._t0 = timestamps[0]
        self._last_timestamp = timestamps[-1]

        # Compute moving average of stock changes per hour
        window = min(self._window, len(stock_levels))
        recent_stocks = stock_levels[-window:]
        recent_times = timestamps[-window:]

        if len(recent_stocks) < 2:
            self._slope = 0.0
            self._last_stock = stock_levels[-1]
            return

        # Average rate of change per hour
        total_hours = (recent_times[-1] - recent_times[0]).total_seconds() / 3600
        if total_hours <= 0:
            self._slope = 0.0
        else:
            self._slope = (recent_stocks[-1] - recent_stocks[0]) / total_hours

        self._last_stock = stock_levels[-1]

    def predict_exhaustion_date(self) -> ForecastResult:
        if self._slope >= 0 or self._last_timestamp is None:
            return ForecastResult(
                predicted_exhaustion_date=None,
                hours_until_exhaustion=None,
                confidence=0.5,
                strategy_name="moving_average",
                snap_detected=False,
            )

        hours_to_zero = -self._last_stock / self._slope
        exhaustion_date = self._last_timestamp + timedelta(hours=hours_to_zero)

        return ForecastResult(
            predicted_exhaustion_date=exhaustion_date,
            hours_until_exhaustion=hours_to_zero,
            confidence=0.5,
            strategy_name="moving_average",
            snap_detected=False,
        )
