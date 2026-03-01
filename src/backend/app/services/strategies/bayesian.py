from datetime import datetime, timedelta

import numpy as np
from sklearn.linear_model import BayesianRidge

from app.services.strategies.base import ForecastingStrategy, ForecastResult


class BayesianRidgeStrategy(ForecastingStrategy):
    """Bayesian Ridge regression strategy with prediction intervals."""

    def __init__(self):
        self._model: BayesianRidge | None = None
        self._t0: datetime | None = None
        self._last_timestamp: datetime | None = None
        self._r_squared: float = 0.0
        self._slope: float = 0.0

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

        self._t0 = timestamps[0]
        self._last_timestamp = timestamps[-1]

        X = np.array(
            [(t - self._t0).total_seconds() / 3600 for t in timestamps]
        ).reshape(-1, 1)
        y = np.array(stock_levels)

        self._model = BayesianRidge()
        self._model.fit(X, y)
        self._r_squared = float(self._model.score(X, y))
        self._slope = float(self._model.coef_[0])

    def predict_exhaustion_date(self) -> ForecastResult:
        if self._model is None or self._t0 is None or self._slope >= 0:
            return ForecastResult(
                predicted_exhaustion_date=None,
                hours_until_exhaustion=None,
                confidence=self._r_squared,
                strategy_name="bayesian_ridge",
                snap_detected=False,
            )

        intercept = float(self._model.intercept_)
        hours_to_zero = -intercept / self._slope
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
            strategy_name="bayesian_ridge",
            snap_detected=False,
        )
