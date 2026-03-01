"""Tests for the feed proxy router."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

import httpx


MOCK_FEED_STATUS = {
    "sectors": [
        {"sector_id": "Wakanda", "resource_type": "Arc Reactor Cores", "stock_level": 550.0},
        {"sector_id": "New Asgard", "resource_type": "Vibranium (kg)", "stock_level": 600.0},
    ],
    "uptime_seconds": 60.0,
}


def _make_mock_response(json_data, status_code=200):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = json_data
    mock.raise_for_status = MagicMock()
    return mock


async def test_feed_status_proxy_success(client):
    """Verify the proxy endpoint returns feed status data."""
    mock_response = _make_mock_response(MOCK_FEED_STATUS)
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.feed.httpx.AsyncClient", return_value=mock_client):
        resp = await client.get("/api/v1/feed/status")

    assert resp.status_code == 200
    data = resp.json()
    assert "sectors" in data
    assert len(data["sectors"]) == 2
    assert data["uptime_seconds"] == 60.0


async def test_feed_status_proxy_service_unavailable(client):
    """Verify 502 when the feed service is down."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.feed.httpx.AsyncClient", return_value=mock_client):
        resp = await client.get("/api/v1/feed/status")

    assert resp.status_code == 502
    assert "Feed service unavailable" in resp.json()["detail"]
