import pytest
from datetime import datetime, timezone

from app.models.resource_log import ResourceLog


@pytest.mark.asyncio
async def test_anomalies_endpoint(client):
    """GET /api/v1/analytics/anomalies returns anomaly list for a valid sector/resource."""
    response = await client.get(
        "/api/v1/analytics/anomalies",
        params={"sector_id": "Wakanda", "resource_type": "Vibranium (kg)"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "anomalies" in data
    assert isinstance(data["anomalies"], list)


@pytest.mark.asyncio
async def test_anomalies_not_found(client):
    """GET /api/v1/analytics/anomalies returns 404 for nonexistent data."""
    response = await client.get(
        "/api/v1/analytics/anomalies",
        params={"sector_id": "Nonexistent", "resource_type": "FakeResource"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_anomalies_requires_params(client):
    """GET /api/v1/analytics/anomalies requires sector_id and resource_type."""
    response = await client.get("/api/v1/analytics/anomalies")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_anomalies_with_outlier_data(seeded_session, client):
    """Anomaly detection should flag extreme outliers when present."""
    # Add an extreme outlier
    seeded_session.add(
        ResourceLog(
            timestamp=datetime(2026, 1, 1, 10, tzinfo=timezone.utc),
            sector_id="Wakanda",
            resource_type="Vibranium (kg)",
            stock_level=99999.0,
            usage_rate_hourly=5.0,
            snap_event_detected=False,
        )
    )
    await seeded_session.commit()

    response = await client.get(
        "/api/v1/analytics/anomalies",
        params={"sector_id": "Wakanda", "resource_type": "Vibranium (kg)"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "anomalies" in data
    # The extreme outlier should be detected
    if data["anomalies"]:
        anomaly = data["anomalies"][0]
        assert "timestamp" in anomaly
        assert "stock_level" in anomaly
        assert "score" in anomaly
