"""Holt's Double EWMA trend model with CUSUM step-change detection.

Replaces the linear regression TrendModel for better handling of:
- Short time series (20 points)
- Step changes (snap events via CUSUM)
- Non-stationary trends (exponential weighting favors recent data)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np


@dataclass
class TrendResult:
    slope: float              # Holt trend component (units per DB row)
    r_squared: float          # Kept for API compatibility (set to confidence/100)
    confidence: float         # 0-100, based on residual variance
    projected_stock_in_5_cycles: float
    current_stock: float
    step_change_detected: bool = False  # CUSUM triggered


class HoltCUSUMModel:
    """Holt's Double Exponential Smoothing + CUSUM step-change detector.

    Alpha (level smoothing): 0.3 — recent data weighted 3x more than older
    Beta (trend smoothing): 0.1 — trend updates slowly, avoids overreaction
    CUSUM threshold: 3.0 standard deviations of residuals
    """

    def __init__(
        self,
        alpha: float = 0.3,
        beta: float = 0.1,
        cusum_k: float = 0.5,       # allowance (half of expected shift)
        cusum_h: float = 5.0,       # decision threshold (multiples of sigma)
    ) -> None:
        self.alpha = alpha
        self.beta = beta
        self.cusum_k = cusum_k
        self.cusum_h = cusum_h

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
                step_change_detected=False,
            )

        # --- Holt's Double EWMA ---
        L = float(stock_levels[0])
        T = float(stock_levels[1] - stock_levels[0])
        fitted: list[float] = [L]

        for x in stock_levels[1:]:
            L_prev, T_prev = L, T
            L = self.alpha * x + (1.0 - self.alpha) * (L_prev + T_prev)
            T = self.beta * (L - L_prev) + (1.0 - self.beta) * T_prev
            fitted.append(L_prev + T_prev)  # one-step-ahead prediction

        slope = T
        projected_5 = max(0.0, L + 5.0 * T)
        current_stock = float(stock_levels[-1])

        # --- Confidence from residual variance ---
        residuals = [stock_levels[i] - fitted[i] for i in range(n)]
        sigma = float(np.std(residuals)) if n > 2 else 0.0
        stock_range = max(1.0, abs(current_stock))
        confidence = float(max(0.0, min(100.0, 100.0 * (1.0 - sigma / stock_range))))
        r_squared = confidence / 100.0

        # --- CUSUM step-change detection ---
        # Tabular CUSUM using scaled residuals
        step_change = False
        if sigma > 0 and n >= 4:
            k = self.cusum_k * sigma
            h = self.cusum_h * sigma
            c_pos = 0.0
            c_neg = 0.0
            for r in residuals:
                c_pos = max(0.0, c_pos + r - k)
                c_neg = max(0.0, c_neg - r - k)
                if c_pos > h or c_neg > h:
                    step_change = True
                    break

        return TrendResult(
            slope=slope,
            r_squared=r_squared,
            confidence=confidence,
            projected_stock_in_5_cycles=projected_5,
            current_stock=current_stock,
            step_change_detected=step_change,
        )
