"""Tests for the SSE event stream and event bus."""

import asyncio
import json

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.services.event_bus import broadcast, subscribe, unsubscribe, _queues, _lock


@pytest.fixture(autouse=True)
async def clean_queues():
    """Ensure the global queue list is clean before/after each test."""
    async with _lock:
        _queues.clear()
    yield
    async with _lock:
        _queues.clear()


class TestEventBus:
    """Test the event bus subscribe/unsubscribe/broadcast mechanics."""

    async def test_broadcast_reaches_subscriber(self):
        """Broadcasting a message reaches a subscribed queue."""
        q = await subscribe()
        await broadcast("test_event", {"key": "value"})
        msg = q.get_nowait()
        parsed = json.loads(msg)
        assert parsed["type"] == "test_event"
        assert parsed["data"]["key"] == "value"

    async def test_multiple_subscribers_receive_broadcast(self):
        """Multiple concurrent clients each receive all broadcasts."""
        q1 = await subscribe()
        q2 = await subscribe()
        await broadcast("multi", {"n": 1})
        msg1 = json.loads(q1.get_nowait())
        msg2 = json.loads(q2.get_nowait())
        assert msg1["type"] == "multi"
        assert msg2["type"] == "multi"

    async def test_unsubscribed_client_removed(self):
        """Unsubscribed clients are removed from queue list."""
        q = await subscribe()
        async with _lock:
            assert q in _queues
        await unsubscribe(q)
        async with _lock:
            assert q not in _queues

    async def test_unsubscribe_nonexistent_is_safe(self):
        """Unsubscribing a queue that was already removed does not raise."""
        q = asyncio.Queue()
        await unsubscribe(q)  # should not raise

    async def test_dead_queues_cleaned_on_broadcast(self):
        """Full queues are automatically removed during broadcast."""
        q = await subscribe()
        # Fill the queue to capacity (maxsize=100)
        for i in range(100):
            q.put_nowait(f"filler-{i}")
        # Next broadcast should detect the full queue and remove it
        await broadcast("overflow", {"x": 1})
        async with _lock:
            assert q not in _queues


class TestSSEEndpoint:
    """Test the GET /api/v1/stream SSE endpoint."""

    def test_stream_route_registered(self):
        """The /api/v1/stream route is registered on the app."""
        routes = [r.path for r in app.routes if hasattr(r, "path")]
        assert "/api/v1/stream" in routes

    async def test_stream_returns_event_source_response(self):
        """The event_stream handler returns an EventSourceResponse with text/event-stream."""
        from unittest.mock import AsyncMock
        from app.routers.sse import event_stream

        mock_request = AsyncMock()
        mock_request.is_disconnected = AsyncMock(return_value=True)
        resp = await event_stream(mock_request)
        # EventSourceResponse is a streaming response
        assert resp.media_type == "text/event-stream"

    async def test_heartbeat_in_generator_output(self):
        """The SSE generator yields an initial heartbeat event."""
        from unittest.mock import AsyncMock
        from app.routers.sse import event_stream

        mock_request = AsyncMock()
        mock_request.is_disconnected = AsyncMock(return_value=True)
        resp = await event_stream(mock_request)

        # Consume the generator from the response body
        events = []
        async for item in resp.body_iterator:
            events.append(item)
            # The first yielded item should be the heartbeat, then the loop
            # checks is_disconnected and breaks. Collect a few then stop.
            if len(events) >= 2:
                break

        # The first event should be the heartbeat
        assert events[0]["event"] == "heartbeat"
        assert events[0]["data"] == "connected"
