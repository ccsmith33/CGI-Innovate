from datetime import datetime, timedelta

import numpy as np
from sklearn.linear_model import LinearRegression

from app.services.strategies.base import ForecastingStrategy, ForecastResult


def _iqr_filter(
    stock_levels: list[float], timestamps: list[datetime]
) -> tuple[list[float], list[datetime]]:
    """Remove IQR-based outliers. Skip if fewer than 10 points would remain."""
    arr = np.array(stock_levels)
    q1 = float(np.quantile(arr, 0.25))
    q3 = float(np.quantile(arr, 0.75))
    iqr = q3 - q1

    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr

    filtered = [
        (s, t)
        for s, t in zip(stock_levels, timestamps)
        if lower <= s <= upper
    ]

    if len(filtered) < 10:
        return stock_levels, timestamps

    filtered_stocks = [s for s, _ in filtered]
    filtered_ts = [t for _, t in filtered]
    return filtered_stocks, filtered_ts


class LinearRegressionStrategy(ForecastingStrategy):
    def __init__(self):
        self._slope: float = 0.0
        self._intercept: float = 0.0
        self._r_squared: float = 0.0
        self._t0: datetime | None = None
        self._last_timestamp: datetime | None = None

    def fit(
        self,
        timestamps: list[datetime],
        stock_levels: list[float],
        snap_flags: list[bool] | None = None,
    ) -> None:
        if len(timestamps) < 2:
            self._slope = 0.0
            self._intercept = stock_levels[0] if stock_levels else 0.0
            self._r_squared = 0.0
            self._t0 = timestamps[0] if timestamps else None
            self._last_timestamp = timestamps[-1] if timestamps else None
            return

        # Apply IQR outlier filtering
        stock_levels, timestamps = _iqr_filter(stock_levels, timestamps)

        self._t0 = timestamps[0]
        self._last_timestamp = timestamps[-1]

        X = np.array(
            [(t - self._t0).total_seconds() / 3600 for t in timestamps]
        ).reshape(-1, 1)
        y = np.array(stock_levels)

        model = LinearRegression()
        model.fit(X, y)

        self._slope = float(model.coef_[0])
        self._intercept = float(model.intercept_)
        self._r_squared = float(model.score(X, y))

    def predict_exhaustion_date(self) -> ForecastResult:
        if self._slope >= 0 or self._t0 is None:
            return ForecastResult(
                predicted_exhaustion_date=None,
                hours_until_exhaustion=None,
                confidence=self._r_squared,
                strategy_name="linear_regression",
                snap_detected=False,
            )

        hours_to_zero = -self._intercept / self._slope
        exhaustion_date = self._t0 + timedelta(hours=hours_to_zero)

        hours_until = (
            (exhaustion_date - self._last_timestamp).total_seconds() / 3600
            if self._last_timestamp
            else hours_to_zero
        )

        return ForecastResult(
            predicted_exhaustion_date=exhaustion_date,
            hours_until_exhaustion=hours_until,
            confidence=self._r_squared,
            strategy_name="linear_regression",
            snap_detected=False,
        )
