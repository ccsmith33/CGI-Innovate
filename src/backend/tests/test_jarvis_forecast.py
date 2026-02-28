import pytest
from datetime import datetime, timedelta, timezone

from app.services.strategies.linear_regression import LinearRegressionStrategy
from app.services.strategies.snap_aware import SnapAwareLinearRegression


def test_linear_regression_synthetic_data():
    """Synthetic data: intercept=100, slope=-2 per hour -> exhaustion at 50 hours."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(20)]
    stock_levels = [100.0 - 2.0 * i for i in range(20)]  # slope = -2

    strategy = LinearRegressionStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    assert result.predicted_exhaustion_date is not None
    expected_exhaustion = t0 + timedelta(hours=50)
    actual_hours = (result.predicted_exhaustion_date - t0).total_seconds() / 3600
    assert abs(actual_hours - 50.0) / 50.0 < 0.05  # within 5%


def test_snap_filtering():
    """Snap rows are outliers. Without filtering, prediction is off. With filtering, it matches clean trend."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(20)]
    # Clean trend: 100 - 2*i
    stock_levels = [100.0 - 2.0 * i for i in range(20)]
    snap_flags = [False] * 20

    # Add snap outliers (big drop at hour 5 and 10)
    stock_levels[5] = 20.0
    snap_flags[5] = True
    stock_levels[10] = 10.0
    snap_flags[10] = True

    strategy = SnapAwareLinearRegression()
    strategy.fit(timestamps, stock_levels, snap_flags)
    result = strategy.predict_exhaustion_date()

    assert result.snap_detected is True
    assert result.strategy_name == "snap_aware_linear_regression"
    assert result.predicted_exhaustion_date is not None
    actual_hours = (result.predicted_exhaustion_date - t0).total_seconds() / 3600
    assert abs(actual_hours - 50.0) / 50.0 < 0.05  # within 5%


def test_slope_positive_no_exhaustion():
    """When stock is increasing, there should be no exhaustion date."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(10)]
    stock_levels = [100.0 + 5.0 * i for i in range(10)]  # positive slope

    strategy = LinearRegressionStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    assert result.predicted_exhaustion_date is None
    assert result.hours_until_exhaustion is None


def test_r_squared_computed():
    """Confidence (R-squared) should be between 0 and 1."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(10)]
    stock_levels = [100.0 - 2.0 * i for i in range(10)]

    strategy = LinearRegressionStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    assert 0 <= result.confidence <= 1


@pytest.mark.asyncio
async def test_forecast_router_list(client):
    response = await client.get("/api/v1/forecasts")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data


@pytest.mark.asyncio
async def test_forecast_router_specific_not_found(client):
    response = await client.get("/api/v1/forecasts/NonExistent/FakeResource")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_forecast_refresh(client):
    response = await client.post("/api/v1/forecasts/refresh")
    assert response.status_code == 202
    data = response.json()
    assert data["message"] == "Forecast refresh initiated"
    assert "strategy" in data

    # Verify forecasts were created
    list_response = await client.get("/api/v1/forecasts")
    assert list_response.status_code == 200
    forecasts = list_response.json()["data"]
    assert len(forecasts) > 0
