"""Lightweight trend model for the Governor service.

Fits a linear regression on stock_level vs time index to determine
whether a sector's stock is trending up or down.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np
from sklearn.linear_model import LinearRegression


@dataclass
class TrendResult:
    slope: float  # units/cycle trend
    r_squared: float
    confidence: float  # r_squared * 100
    projected_stock_in_5_cycles: float
    current_stock: float


class TrendModel:
    """Fits last N data points to a linear regression on stock_level vs cycle index."""

    def fit(self, timestamps: list[datetime], stock_levels: list[float]) -> TrendResult:
        n = len(stock_levels)
        if n < 2:
            current = stock_levels[0] if stock_levels else 0.0
            return TrendResult(
                slope=0.0,
                r_squared=0.0,
                confidence=0.0,
                projected_stock_in_5_cycles=current,
                current_stock=current,
            )

        X = np.arange(n).reshape(-1, 1)
        y = np.array(stock_levels)

        model = LinearRegression()
        model.fit(X, y)

        slope = float(model.coef_[0])
        r_squared = float(model.score(X, y))
        r_squared = max(0.0, min(1.0, r_squared))
        confidence = r_squared * 100.0

        current_stock = stock_levels[-1]
        projected = float(model.predict(np.array([[n - 1 + 5]]))[0])

        return TrendResult(
            slope=slope,
            r_squared=r_squared,
            confidence=confidence,
            projected_stock_in_5_cycles=projected,
            current_stock=current_stock,
        )
