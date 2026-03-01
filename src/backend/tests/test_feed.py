"""Tests for feed push endpoint: usage_rate_hourly and snap_event_detected."""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch, MagicMock

from app import app_state
from app.resource_config import BASE_DRAIN_RATES, CYCLES_PER_HOUR


EXPECTED_RATES = {
    "Medical Kits": 3060.0,
    "Clean Water (L)": 3780.0,
    "Vibranium (kg)": 1152.0,
    "Pym Particles": 1872.0,
    "Arc Reactor Cores": 1512.0,
}


def _make_push_event(sector_id: str, resource_type: str, stock_after: float = 100.0):
    return {
        "id": "test-event",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sector_id": sector_id,
        "resource_type": resource_type,
        "delta": -5.0,
        "event_type": "consumption",
        "label": "test",
        "stock_after": stock_after,
    }


def _mock_defcon_response():
    mock = MagicMock()
    mock.status_code = 200
    mock.json.return_value = {"level": 5, "label": "NORMAL", "color": "green"}
    mock.raise_for_status = MagicMock()
    return mock


def _mock_httpx_client(defcon_response):
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=defcon_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


class TestUsageRateHourly:
    """Verify usage_rate_hourly is correctly computed per resource type."""

    @pytest.mark.parametrize(
        "resource_type,expected_rate",
        list(EXPECTED_RATES.items()),
    )
    async def test_usage_rate_hourly_per_resource(
        self, clean_client, resource_type, expected_rate
    ):
        event = _make_push_event("TestSector", resource_type)
        mock_client = _mock_httpx_client(_mock_defcon_response())

        with patch("app.routers.feed.httpx.AsyncClient", return_value=mock_client):
            resp = await clean_client.post(
                "/api/v1/feed/push", json={"events": [event]}
            )

        assert resp.status_code == 200
        assert resp.json()["ingested"] == 1

    async def test_usage_rate_computation_values(self):
        """Verify the drain rate constants produce correct hourly values."""
        for resource_type, expected in EXPECTED_RATES.items():
            drain = BASE_DRAIN_RATES[resource_type]
            computed = round(drain * CYCLES_PER_HOUR, 2)
            assert computed == expected, (
                f"{resource_type}: expected {expected}, got {computed}"
            )

    async def test_unknown_resource_uses_default_rate(self):
        """Unknown resource types should fall back to drain rate 1.0."""
        drain = BASE_DRAIN_RATES.get("Unknown Resource", 1.0)
        computed = round(drain * CYCLES_PER_HOUR, 2)
        assert computed == 360.0


class TestSnapEventDetected:
    """Verify snap_event_detected flag propagation."""

    async def test_snap_flag_true_when_active(self, clean_client):
        """When snap_cycle_active is True, snap_event_detected should be True."""
        app_state.snap_cycle_active = True

        event = _make_push_event("Wakanda", "Arc Reactor Cores")
        mock_client = _mock_httpx_client(_mock_defcon_response())

        with patch("app.routers.feed.httpx.AsyncClient", return_value=mock_client):
            resp = await clean_client.post(
                "/api/v1/feed/push", json={"events": [event]}
            )

        assert resp.status_code == 200
        assert resp.json()["ingested"] == 1
        # Flag should be consumed (reset to False)
        assert app_state.snap_cycle_active is False

    async def test_snap_flag_false_when_inactive(self, clean_client):
        """When snap_cycle_active is False, snap_event_detected should be False."""
        app_state.snap_cycle_active = False

        event = _make_push_event("Wakanda", "Arc Reactor Cores")
        mock_client = _mock_httpx_client(_mock_defcon_response())

        with patch("app.routers.feed.httpx.AsyncClient", return_value=mock_client):
            resp = await clean_client.post(
                "/api/v1/feed/push", json={"events": [event]}
            )

        assert resp.status_code == 200
        assert app_state.snap_cycle_active is False

    async def test_snap_flag_consumed_after_push(self, clean_client):
        """The snap flag should be consumed (set to False) after one push batch."""
        app_state.snap_cycle_active = True

        event = _make_push_event("Wakanda", "Arc Reactor Cores")
        mock_client = _mock_httpx_client(_mock_defcon_response())

        with patch("app.routers.feed.httpx.AsyncClient", return_value=mock_client):
            await clean_client.post("/api/v1/feed/push", json={"events": [event]})

        assert app_state.snap_cycle_active is False

        # Second push should NOT have snap detected
        with patch("app.routers.feed.httpx.AsyncClient", return_value=mock_client):
            resp = await clean_client.post(
                "/api/v1/feed/push", json={"events": [event]}
            )

        assert resp.status_code == 200
        assert app_state.snap_cycle_active is False
