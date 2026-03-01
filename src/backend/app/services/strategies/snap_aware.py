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
        if snap_flags and any(snap_flags):
            self._snap_detected = True

            # Find the most recent snap timestamp
            latest_snap_idx = max(
                i for i, f in enumerate(snap_flags) if f
            )
            latest_snap_ts = timestamps[latest_snap_idx]

            # Use only data at or after the latest snap timestamp
            filtered = [
                (t, s)
                for t, s in zip(timestamps, stock_levels)
                if t >= latest_snap_ts
            ]

            if len(filtered) >= 2:
                post_ts, post_stocks = zip(*filtered)
                post_ts_list = list(post_ts)
                post_stocks_list = list(post_stocks)

                # Apply IQR outlier filtering
                post_stocks_list, post_ts_list = _iqr_filter(
                    post_stocks_list, post_ts_list
                )

                self._inner.fit(post_ts_list, post_stocks_list)
            else:
                # Not enough post-snap data, use what we have
                if filtered:
                    post_ts, post_stocks = zip(*filtered)
                    self._inner.fit(list(post_ts), list(post_stocks))
                else:
                    self._inner.fit(timestamps, stock_levels)
        else:
            # No snap events: fallback to all data with outlier filtering
            ts_list = list(timestamps)
            sl_list = list(stock_levels)
            sl_list, ts_list = _iqr_filter(sl_list, ts_list)
            self._inner.fit(ts_list, sl_list)

    def predict_exhaustion_date(self) -> ForecastResult:
        result = self._inner.predict_exhaustion_date()
        result.snap_detected = self._snap_detected
        result.strategy_name = "snap_aware_linear_regression"
        return result


def _iqr_filter(
    stock_levels: list[float], timestamps: list[datetime]
) -> tuple[list[float], list[datetime]]:
    """Remove IQR-based outliers. Skip if fewer than 10 points would remain."""
    import numpy as np

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
        # Safety guard: skip outlier removal
        return stock_levels, timestamps

    filtered_stocks = [s for s, _ in filtered]
    filtered_ts = [t for _, t in filtered]
    return filtered_stocks, filtered_ts
