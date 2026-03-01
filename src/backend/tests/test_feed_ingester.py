"""Tests for FeedIngester: mock httpx calls, verify ResourceLog insertion."""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch, MagicMock

import httpx
from sqlalchemy import select

from app.models.resource_log import ResourceLog
from app.services.feed_ingester import FeedIngester


def _make_mock_response(json_data, status_code=200):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = json_data
    mock.raise_for_status = MagicMock()
    return mock


@pytest.fixture
def sample_events():
    return {
        "events": [
            {
                "id": "evt-1",
                "timestamp": "2026-02-28T10:00:00+00:00",
                "sector_id": "Wakanda",
                "resource_type": "Arc Reactor Cores",
                "delta": -50.0,
                "event_type": "consumption",
                "label": "Combat patrol",
                "stock_after": 500.0,
            },
            {
                "id": "evt-2",
                "timestamp": "2026-02-28T10:00:05+00:00",
                "sector_id": "New Asgard",
                "resource_type": "Vibranium (kg)",
                "delta": 100.0,
                "event_type": "resupply",
                "label": "Supply convoy",
                "stock_after": 700.0,
            },
        ],
        "count": 2,
    }


@pytest.fixture
def sample_status():
    return {
        "sectors": [
            {"sector_id": "Wakanda", "resource_type": "Arc Reactor Cores", "stock_level": 500.0},
            {"sector_id": "New Asgard", "resource_type": "Vibranium (kg)", "stock_level": 700.0},
        ],
        "uptime_seconds": 120.0,
    }


async def test_poll_and_ingest_inserts_resource_logs(
    db_session, sample_events, sample_status
):
    """Verify that poll_and_ingest creates ResourceLog rows for each event."""
    events_response = _make_mock_response(sample_events)
    status_response = _make_mock_response(sample_status)

    mock_client = AsyncMock()

    async def mock_get(url, **kwargs):
        if "/feed/events" in url:
            return events_response
        return status_response

    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.feed_ingester.httpx.AsyncClient", return_value=mock_client):
        with patch("app.services.feed_ingester.ForecastService"):
            ingester = FeedIngester()
            count = await ingester.poll_and_ingest(db_session)

    assert count == 2

    result = await db_session.execute(select(ResourceLog))
    rows = result.scalars().all()
    # The seeded_session already has rows, so filter for our new ones
    new_rows = [r for r in rows if r.sector_id in ("Wakanda", "New Asgard")]

    wakanda_rows = [r for r in new_rows if r.sector_id == "Wakanda" and r.resource_type == "Arc Reactor Cores"]
    assert len(wakanda_rows) >= 1
    assert wakanda_rows[-1].stock_level == 500.0
    assert wakanda_rows[-1].usage_rate_hourly == 7.0
    assert wakanda_rows[-1].snap_event_detected is False

    asgard_rows = [r for r in new_rows if r.sector_id == "New Asgard" and r.resource_type == "Vibranium (kg)"]
    assert len(asgard_rows) >= 1
    assert asgard_rows[-1].stock_level == 700.0


async def test_poll_and_ingest_updates_last_polled(
    db_session, sample_events, sample_status
):
    """Verify last_polled advances to the newest event timestamp."""
    events_response = _make_mock_response(sample_events)
    status_response = _make_mock_response(sample_status)

    mock_client = AsyncMock()

    async def mock_get(url, **kwargs):
        if "/feed/events" in url:
            return events_response
        return status_response

    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.feed_ingester.httpx.AsyncClient", return_value=mock_client):
        with patch("app.services.feed_ingester.ForecastService"):
            ingester = FeedIngester()
            await ingester.poll_and_ingest(db_session)

    assert ingester._last_polled == "2026-02-28T10:00:05+00:00"


async def test_poll_and_ingest_handles_empty_events(db_session):
    """Verify no rows are inserted when feed returns no events."""
    empty_events = {"events": [], "count": 0}
    events_response = _make_mock_response(empty_events)
    status_response = _make_mock_response({"sectors": [], "uptime_seconds": 0})

    mock_client = AsyncMock()

    async def mock_get(url, **kwargs):
        if "/feed/events" in url:
            return events_response
        return status_response

    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.feed_ingester.httpx.AsyncClient", return_value=mock_client):
        ingester = FeedIngester()
        count = await ingester.poll_and_ingest(db_session)

    assert count == 0


async def test_poll_and_ingest_handles_http_error(db_session):
    """Verify graceful handling when the feed service is unreachable."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.feed_ingester.httpx.AsyncClient", return_value=mock_client):
        ingester = FeedIngester()
        count = await ingester.poll_and_ingest(db_session)

    assert count == 0
