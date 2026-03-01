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


def test_snap_aware_uses_only_post_snap_data():
    """Snap-aware strategy uses only data after (and including) the last snap event."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(30)]

    # Pre-snap trend: stock=200, slope=-1/hr (would exhaust at 200h from t0)
    # Snap occurs at hour 10, stock drops to 50
    # Post-snap trend: stock=50 at h10, slope=-2/hr (should exhaust at 50/2=25h after h10 = h35)
    stock_levels = []
    snap_flags = []
    for i in range(30):
        if i < 10:
            stock_levels.append(200.0 - 1.0 * i)
            snap_flags.append(False)
        elif i == 10:
            stock_levels.append(50.0)
            snap_flags.append(True)
        else:
            stock_levels.append(50.0 - 2.0 * (i - 10))
            snap_flags.append(False)

    strategy = SnapAwareLinearRegression()
    strategy.fit(timestamps, stock_levels, snap_flags)
    result = strategy.predict_exhaustion_date()

    assert result.snap_detected is True
    assert result.strategy_name == "snap_aware_linear_regression"
    assert result.predicted_exhaustion_date is not None

    # Post-snap data starts at hour 10 with stock=50 and slope=-2
    # Exhaustion should be around hour 35 (50/2 = 25h after h10)
    actual_hours = (result.predicted_exhaustion_date - t0).total_seconds() / 3600
    assert abs(actual_hours - 35.0) / 35.0 < 0.10  # within 10%


def test_snap_aware_fallback_no_snap_events():
    """When no snap events exist, snap-aware strategy uses all data (same as linear regression)."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(20)]
    stock_levels = [100.0 - 2.0 * i for i in range(20)]
    snap_flags = [False] * 20

    strategy = SnapAwareLinearRegression()
    strategy.fit(timestamps, stock_levels, snap_flags)
    result = strategy.predict_exhaustion_date()

    assert result.snap_detected is False
    assert result.strategy_name == "snap_aware_linear_regression"
    assert result.predicted_exhaustion_date is not None

    actual_hours = (result.predicted_exhaustion_date - t0).total_seconds() / 3600
    assert abs(actual_hours - 50.0) / 50.0 < 0.05


def test_snap_aware_fallback_no_snap_flags():
    """When snap_flags is None, snap-aware strategy uses all data."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    timestamps = [t0 + timedelta(hours=i) for i in range(20)]
    stock_levels = [100.0 - 2.0 * i for i in range(20)]

    strategy = SnapAwareLinearRegression()
    strategy.fit(timestamps, stock_levels, snap_flags=None)
    result = strategy.predict_exhaustion_date()

    assert result.snap_detected is False
    assert result.predicted_exhaustion_date is not None
    actual_hours = (result.predicted_exhaustion_date - t0).total_seconds() / 3600
    assert abs(actual_hours - 50.0) / 50.0 < 0.05


def test_outlier_filtering_removes_extreme_values():
    """IQR outlier filtering removes extreme values before fitting."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    # 20 points following a clean trend: 200 - 2*i
    timestamps = [t0 + timedelta(hours=i) for i in range(20)]
    stock_levels = [200.0 - 2.0 * i for i in range(20)]

    # Inject extreme outliers at indices 3 and 7
    stock_levels[3] = 5000.0
    stock_levels[7] = -3000.0

    # With outlier filtering, the regression should still approximate the clean trend
    strategy = LinearRegressionStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    assert result.predicted_exhaustion_date is not None
    actual_hours = (result.predicted_exhaustion_date - t0).total_seconds() / 3600
    # Clean trend would exhaust at 100h (200/2). With filtering, should be close.
    assert abs(actual_hours - 100.0) / 100.0 < 0.15  # within 15%


def test_outlier_filtering_skipped_when_too_few_points():
    """Outlier filtering is skipped when fewer than 10 points would remain after filtering."""
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    # Only 8 data points
    timestamps = [t0 + timedelta(hours=i) for i in range(8)]
    stock_levels = [100.0 - 2.0 * i for i in range(8)]

    # Add an outlier -- since we only have 8 points, filtering should be skipped
    stock_levels[3] = 5000.0

    strategy = LinearRegressionStrategy()
    strategy.fit(timestamps, stock_levels)
    result = strategy.predict_exhaustion_date()

    # The outlier is NOT filtered (only 8 points), so the regression will be distorted
    # We just need to verify it doesn't crash and still produces a result
    assert result is not None
    assert result.strategy_name == "linear_regression"


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
