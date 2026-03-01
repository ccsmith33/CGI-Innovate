import pytest
from datetime import datetime, timedelta, timezone

from app.services.strategies.polynomial_regression import PolynomialRegressionStrategy
from app.services.strategies.exponential_decay import ExponentialDecayStrategy


def test_polynomial_regression_synthetic():
    """Polynomial regression should predict exhaustion on a quadratic decay curve."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(20)]
    # Quadratic decay: stock = 200 - 0.5 * t^2 (hits zero around t=20)
    stock_levels = [200.0 - 0.5 * i * i for i in range(20)]

    strategy = PolynomialRegressionStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    assert result.strategy_name == "polynomial_regression"
    assert result.predicted_exhaustion_date is not None
    assert result.confidence > 0.9


def test_polynomial_regression_linear_data():
    """Polynomial regression should still work on purely linear data."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(20)]
    stock_levels = [100.0 - 2.0 * i for i in range(20)]

    strategy = PolynomialRegressionStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    assert result.predicted_exhaustion_date is not None
    actual_hours = (result.predicted_exhaustion_date - t0).total_seconds() / 3600
    assert abs(actual_hours - 50.0) / 50.0 < 0.10


def test_polynomial_regression_increasing_stock():
    """No exhaustion when stock is increasing."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(20)]
    stock_levels = [100.0 + 5.0 * i for i in range(20)]

    strategy = PolynomialRegressionStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    assert result.predicted_exhaustion_date is None


def test_polynomial_regression_single_point():
    """Single data point should not crash."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    strategy = PolynomialRegressionStrategy()
    strategy.fit([t0], [100.0])
    result = strategy.predict_exhaustion_date()
    assert result.predicted_exhaustion_date is None


def test_exponential_decay_synthetic():
    """Exponential decay should fit a decaying exponential curve."""
    import numpy as np

    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(50)]
    # stock = 500 * exp(-0.02 * t) -- reaches threshold 1.0 at t = ln(500)/0.02 ~ 310h
    stock_levels = [500.0 * np.exp(-0.02 * i) for i in range(50)]

    strategy = ExponentialDecayStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    assert result.strategy_name == "exponential_decay"
    assert result.predicted_exhaustion_date is not None
    assert result.confidence > 0.9


def test_exponential_decay_linear_fallback():
    """Exponential decay should fall back to linear when curve fitting fails."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    # Data that can't be fit with a * exp(-b * t) -- negative values
    timestamps = [t0 + timedelta(hours=i) for i in range(20)]
    stock_levels = [100.0 - 20.0 * i for i in range(20)]  # goes negative

    strategy = ExponentialDecayStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    # Should either succeed with exponential or fall back to linear
    assert result is not None
    assert result.strategy_name in ("exponential_decay", "exponential_decay (linear_fallback)")


def test_exponential_decay_single_point():
    """Single data point should not crash."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    strategy = ExponentialDecayStrategy()
    strategy.fit([t0], [100.0])
    result = strategy.predict_exhaustion_date()
    assert result.predicted_exhaustion_date is None


@pytest.mark.asyncio
async def test_compare_endpoint(client):
    """GET /api/v1/forecasts/compare returns all 3 strategy results."""
    response = await client.get(
        "/api/v1/forecasts/compare",
        params={"sector_id": "Wakanda", "resource_type": "Vibranium (kg)"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["sector_id"] == "Wakanda"
    assert data["resource_type"] == "Vibranium (kg)"
    assert "forecasts" in data
    assert "linear_regression" in data["forecasts"]
    assert "polynomial_regression" in data["forecasts"]
    assert "exponential_decay" in data["forecasts"]

    for name, forecast in data["forecasts"].items():
        assert "confidence" in forecast
        assert "strategy_name" in forecast


@pytest.mark.asyncio
async def test_compare_endpoint_not_found(client):
    """GET /api/v1/forecasts/compare returns 404 for nonexistent data."""
    response = await client.get(
        "/api/v1/forecasts/compare",
        params={"sector_id": "Nonexistent", "resource_type": "FakeResource"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_compare_endpoint_requires_params(client):
    """GET /api/v1/forecasts/compare requires sector_id and resource_type."""
    response = await client.get("/api/v1/forecasts/compare")
    assert response.status_code == 422
