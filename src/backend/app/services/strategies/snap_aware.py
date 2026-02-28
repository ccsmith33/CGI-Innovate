from datetime import datetime

from app.services.strategies.base import ForecastingStrategy, ForecastResult
from app.services.strategies.linear_regression import LinearRegressionStrategy


class SnapAwareLinearRegression(ForecastingStrategy):
    def __init__(self):
        self._inner = LinearRegressionStrategy()
        self._snap_detected = False

    def fit(
        self,
        timestamps: list[datetime],
        stock_levels: list[float],
        snap_flags: list[bool] | None = None,
    ) -> None:
        if snap_flags:
            filtered = [
                (t, s)
                for t, s, f in zip(timestamps, stock_levels, snap_flags)
                if not f
            ]
            self._snap_detected = any(snap_flags)
            if len(filtered) >= 2:
                clean_ts, clean_stocks = zip(*filtered)
                self._inner.fit(list(clean_ts), list(clean_stocks))
            elif filtered:
                clean_ts, clean_stocks = zip(*filtered)
                self._inner.fit(list(clean_ts), list(clean_stocks))
            else:
                self._inner.fit(timestamps, stock_levels)
        else:
            self._inner.fit(timestamps, stock_levels)

    def predict_exhaustion_date(self) -> ForecastResult:
        result = self._inner.predict_exhaustion_date()
        result.snap_detected = self._snap_detected
        result.strategy_name = "snap_aware_linear_regression"
        return result
