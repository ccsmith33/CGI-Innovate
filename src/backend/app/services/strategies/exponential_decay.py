from datetime import datetime, timedelta

import numpy as np
from scipy.optimize import curve_fit

from app.services.strategies.base import ForecastingStrategy, ForecastResult


def _exp_model(t: np.ndarray, a: float, b: float) -> np.ndarray:
    """stock = a * exp(-b * t)"""
    return a * np.exp(-b * t)


class ExponentialDecayStrategy(ForecastingStrategy):
    def __init__(self):
        self._a: float = 0.0
        self._b: float = 0.0
        self._t0: datetime | None = None
        self._last_timestamp: datetime | None = None
        self._confidence: float = 0.0
        self._fit_success: bool = False
        self._linear_fallback_result: ForecastResult | None = None

    def fit(
        self,
        timestamps: list[datetime],
        stock_levels: list[float],
        snap_flags: list[bool] | None = None,
    ) -> None:
        if len(timestamps) < 2:
            self._confidence = 0.0
            self._t0 = timestamps[0] if timestamps else None
            self._last_timestamp = timestamps[-1] if timestamps else None
            return

        self._t0 = timestamps[0]
        self._last_timestamp = timestamps[-1]

        X = np.array(
            [(t - self._t0).total_seconds() / 3600 for t in timestamps]
        )
        y = np.array(stock_levels)

        try:
            # Initial guesses: a = first stock level, b = small positive decay
            p0 = [y[0] if y[0] > 0 else 1.0, 0.01]
            popt, _ = curve_fit(
                _exp_model, X, y, p0=p0, maxfev=5000
            )
            self._a, self._b = float(popt[0]), float(popt[1])

            # Compute R-squared
            y_pred = _exp_model(X, self._a, self._b)
            ss_res = float(np.sum((y - y_pred) ** 2))
            ss_tot = float(np.sum((y - np.mean(y)) ** 2))
            self._confidence = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
            self._confidence = max(0.0, self._confidence)

            self._fit_success = True
        except (RuntimeError, ValueError, TypeError):
            # Fallback to linear regression
            from app.services.strategies.linear_regression import LinearRegressionStrategy

            linear = LinearRegressionStrategy()
            linear.fit(timestamps, stock_levels, snap_flags)
            self._linear_fallback_result = linear.predict_exhaustion_date()
            self._linear_fallback_result.strategy_name = "exponential_decay (linear_fallback)"
            self._fit_success = False

    def predict_exhaustion_date(self) -> ForecastResult:
        if self._linear_fallback_result is not None:
            return self._linear_fallback_result

        if not self._fit_success or self._t0 is None:
            return ForecastResult(
                predicted_exhaustion_date=None,
                hours_until_exhaustion=None,
                confidence=self._confidence,
                strategy_name="exponential_decay",
                snap_detected=False,
            )

        if self._b <= 0:
            # Not decaying — no exhaustion
            return ForecastResult(
                predicted_exhaustion_date=None,
                hours_until_exhaustion=None,
                confidence=self._confidence,
                strategy_name="exponential_decay",
                snap_detected=False,
            )

        # Exponential decay approaches zero asymptotically.
        # Define exhaustion as stock < 1.0 (practical threshold).
        threshold = 1.0
        if self._a <= threshold:
            return ForecastResult(
                predicted_exhaustion_date=None,
                hours_until_exhaustion=None,
                confidence=self._confidence,
                strategy_name="exponential_decay",
                snap_detected=False,
            )

        hours_to_threshold = np.log(self._a / threshold) / self._b
        exhaustion_date = self._t0 + timedelta(hours=float(hours_to_threshold))

        hours_until = (
            (exhaustion_date - self._last_timestamp).total_seconds() / 3600
            if self._last_timestamp
            else float(hours_to_threshold)
        )

        return ForecastResult(
            predicted_exhaustion_date=exhaustion_date,
            hours_until_exhaustion=hours_until,
            confidence=self._confidence,
            strategy_name="exponential_decay",
            snap_detected=False,
        )
