from datetime import datetime, timedelta

import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures

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


class PolynomialRegressionStrategy(ForecastingStrategy):
    def __init__(self, degree: int = 2):
        self._degree = degree
        self._model: LinearRegression | None = None
        self._poly: PolynomialFeatures | None = None
        self._t0: datetime | None = None
        self._last_timestamp: datetime | None = None
        self._r_squared: float = 0.0

    def fit(
        self,
        timestamps: list[datetime],
        stock_levels: list[float],
        snap_flags: list[bool] | None = None,
    ) -> None:
        if len(timestamps) < 2:
            self._r_squared = 0.0
            self._t0 = timestamps[0] if timestamps else None
            self._last_timestamp = timestamps[-1] if timestamps else None
            return

        stock_levels, timestamps = _iqr_filter(stock_levels, timestamps)

        self._t0 = timestamps[0]
        self._last_timestamp = timestamps[-1]

        X = np.array(
            [(t - self._t0).total_seconds() / 3600 for t in timestamps]
        ).reshape(-1, 1)
        y = np.array(stock_levels)

        self._poly = PolynomialFeatures(degree=self._degree)
        X_poly = self._poly.fit_transform(X)

        self._model = LinearRegression()
        self._model.fit(X_poly, y)
        self._r_squared = float(self._model.score(X_poly, y))

    def predict_exhaustion_date(self) -> ForecastResult:
        if self._model is None or self._t0 is None:
            return ForecastResult(
                predicted_exhaustion_date=None,
                hours_until_exhaustion=None,
                confidence=self._r_squared,
                strategy_name="polynomial_regression",
                snap_detected=False,
            )

        # Search for zero crossing by evaluating the polynomial at fine time steps
        max_hours = 8760  # search up to 1 year ahead
        test_hours = np.linspace(0, max_hours, 10000).reshape(-1, 1)
        test_poly = self._poly.transform(test_hours)
        predictions = self._model.predict(test_poly)

        # Find first time the prediction crosses zero
        zero_crossings = np.where(predictions <= 0)[0]

        if len(zero_crossings) == 0:
            return ForecastResult(
                predicted_exhaustion_date=None,
                hours_until_exhaustion=None,
                confidence=self._r_squared,
                strategy_name="polynomial_regression",
                snap_detected=False,
            )

        hours_to_zero = float(test_hours[zero_crossings[0], 0])
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
            strategy_name="polynomial_regression",
            snap_detected=False,
        )
