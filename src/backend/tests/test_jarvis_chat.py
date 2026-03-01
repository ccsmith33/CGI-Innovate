import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.database import get_db, set_session_factory
from app.main import app
from app.models.forecast import Forecast
from app.models.resource_log import ResourceLog


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_text_block(text: str):
    """Build a mock Anthropic text content block."""
    block = MagicMock()
    block.type = "text"
    block.text = text
    return block


def _make_tool_use_block(block_id: str, name: str, input_dict: dict | None = None):
    """Build a mock Anthropic tool_use content block."""
    block = MagicMock()
    block.type = "tool_use"
    block.id = block_id
    block.name = name
    block.input = input_dict or {}
    return block


def _make_anthropic_response(text: str | None = None, stop_reason: str = "end_turn", tool_blocks=None):
    """Build a mock Anthropic Messages response."""
    content = []
    if text is not None:
        content.append(_make_text_block(text))
    if tool_blocks:
        content.extend(tool_blocks)
    response = MagicMock()
    response.stop_reason = stop_reason
    response.content = content
    return response


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@patch("app.routers.jarvis_chat.settings")
async def test_graceful_degradation_no_api_key(mock_settings, seeded_session):
    """When ANTHROPIC_API_KEY is empty, return fallback offline message."""
    mock_settings.ANTHROPIC_API_KEY = ""

    async def override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/jarvis/chat",
            json={"message": "Hello", "conversation_history": []},
        )

    app.dependency_overrides.clear()
    assert resp.status_code == 200
    data = resp.json()
    assert data["reply"] == "JARVIS is offline. API key not configured."
    assert data["function_calls_made"] == []


@pytest.mark.asyncio
@patch("app.routers.jarvis_chat.settings")
@patch("app.routers.jarvis_chat.AsyncAnthropic")
async def test_simple_chat_no_function_calls(mock_anthropic_cls, mock_settings, seeded_session):
    """When the model replies without calling any function, return the reply directly."""
    mock_settings.ANTHROPIC_API_KEY = "test-key"

    mock_client = AsyncMock()
    mock_anthropic_cls.return_value = mock_client

    mock_client.messages.create = AsyncMock(
        return_value=_make_anthropic_response("All sectors are operational, sir.")
    )

    async def override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/jarvis/chat",
            json={"message": "Status report", "conversation_history": []},
        )

    app.dependency_overrides.clear()
    assert resp.status_code == 200
    data = resp.json()
    assert data["reply"] == "All sectors are operational, sir."
    assert data["function_calls_made"] == []


@pytest.mark.asyncio
@patch("app.routers.jarvis_chat.settings")
@patch("app.routers.jarvis_chat.AsyncAnthropic")
async def test_function_calling_dispatch(mock_anthropic_cls, mock_settings, seeded_session):
    """When the model calls a function, execute it and return the final response."""
    mock_settings.ANTHROPIC_API_KEY = "test-key"

    # Seed a forecast for the function to find
    forecast = Forecast(
        sector_id="Wakanda",
        resource_type="Vibranium (kg)",
        predicted_exhaustion_date=datetime(2026, 3, 1, tzinfo=timezone.utc),
        hours_until_exhaustion=48.0,
        confidence=0.85,
        strategy_used="linear_regression",
        snap_detected=False,
        computed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    seeded_session.add(forecast)
    await seeded_session.commit()

    mock_client = AsyncMock()
    mock_anthropic_cls.return_value = mock_client

    # First call: model requests get_all_forecasts
    tool_block = _make_tool_use_block("call_1", "get_all_forecasts")
    first_response = _make_anthropic_response(
        text=None,
        stop_reason="tool_use",
        tool_blocks=[tool_block],
    )

    # Second call: model provides the final answer
    second_response = _make_anthropic_response(
        "Based on forecasts, Wakanda Vibranium will exhaust in 48 hours."
    )

    mock_client.messages.create = AsyncMock(
        side_effect=[first_response, second_response]
    )

    async def override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/jarvis/chat",
            json={"message": "Which sector runs out first?", "conversation_history": []},
        )

    app.dependency_overrides.clear()
    assert resp.status_code == 200
    data = resp.json()
    assert "Wakanda" in data["reply"]
    assert "get_all_forecasts" in data["function_calls_made"]


@pytest.mark.asyncio
@patch("app.routers.jarvis_chat.settings")
@patch("app.routers.jarvis_chat.AsyncAnthropic")
async def test_conversation_history_forwarded(mock_anthropic_cls, mock_settings, seeded_session):
    """Conversation history should be included in messages sent to Anthropic."""
    mock_settings.ANTHROPIC_API_KEY = "test-key"

    mock_client = AsyncMock()
    mock_anthropic_cls.return_value = mock_client
    mock_client.messages.create = AsyncMock(
        return_value=_make_anthropic_response("Understood.")
    )

    async def override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/jarvis/chat",
            json={
                "message": "What about Sokovia?",
                "conversation_history": [
                    {"role": "user", "content": "Which sector runs out first?"},
                    {"role": "assistant", "content": "Wakanda is critical."},
                ],
            },
        )

    app.dependency_overrides.clear()
    assert resp.status_code == 200

    # Verify the messages list sent to Anthropic includes history
    call_args = mock_client.messages.create.call_args
    messages = call_args.kwargs.get("messages") or call_args[1].get("messages")
    # 2 history + 1 new = 3 messages (system is separate param now)
    assert len(messages) == 3
    assert messages[0]["content"] == "Which sector runs out first?"
    assert messages[1]["content"] == "Wakanda is critical."
    assert messages[2]["content"] == "What about Sokovia?"

    # Verify system prompt is passed as system= parameter
    system = call_args.kwargs.get("system") or call_args[1].get("system")
    assert "JARVIS" in system


# ---------------------------------------------------------------------------
# Streaming endpoint tests (/chat-stream)
# ---------------------------------------------------------------------------

def _parse_sse_events(raw_text: str) -> list[dict]:
    """Parse SSE text into a list of JSON event dicts."""
    events = []
    for line in raw_text.split("\n"):
        line = line.strip()
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


@pytest.mark.asyncio
@patch("app.routers.jarvis_chat.settings")
async def test_stream_offline_no_api_key(mock_settings, seeded_session):
    """When ANTHROPIC_API_KEY is empty, stream returns offline chunk + done."""
    mock_settings.ANTHROPIC_API_KEY = ""

    async def override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/jarvis/chat-stream",
            json={"message": "Hello", "conversation_history": []},
        )

    app.dependency_overrides.clear()
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    events = _parse_sse_events(resp.text)
    assert len(events) == 2
    assert events[0]["type"] == "chunk"
    assert events[0]["text"] == "JARVIS is offline. API key not configured."
    assert events[1]["type"] == "done"


@pytest.mark.asyncio
@patch("app.routers.jarvis_chat.settings")
@patch("app.routers.jarvis_chat.AsyncAnthropic")
async def test_stream_simple_response(mock_anthropic_cls, mock_settings, seeded_session):
    """Streaming endpoint returns chunk events followed by done."""
    mock_settings.ANTHROPIC_API_KEY = "test-key"

    mock_client = AsyncMock()
    mock_anthropic_cls.return_value = mock_client

    # First call (non-streaming): model gives final answer (no tool calls)
    first_response = _make_anthropic_response("All sectors operational.")

    mock_client.messages.create = AsyncMock(return_value=first_response)

    # Second call: streaming response via client.messages.stream()
    async def fake_text_stream():
        for text in ["All ", "sectors ", "operational."]:
            yield text

    mock_stream_ctx = AsyncMock()
    mock_stream_obj = MagicMock()
    mock_stream_obj.text_stream = fake_text_stream()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_obj)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_client.messages.stream = MagicMock(return_value=mock_stream_ctx)

    async def override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/jarvis/chat-stream",
            json={"message": "Status", "conversation_history": []},
        )

    app.dependency_overrides.clear()
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    events = _parse_sse_events(resp.text)
    chunk_events = [e for e in events if e["type"] == "chunk"]
    done_events = [e for e in events if e["type"] == "done"]

    assert len(chunk_events) == 3
    assert chunk_events[0]["text"] == "All "
    assert chunk_events[1]["text"] == "sectors "
    assert chunk_events[2]["text"] == "operational."
    assert len(done_events) == 1


@pytest.mark.asyncio
@patch("app.routers.jarvis_chat.settings")
@patch("app.routers.jarvis_chat.AsyncAnthropic")
async def test_stream_with_tool_calls(mock_anthropic_cls, mock_settings, seeded_session):
    """Streaming endpoint handles tool calls before streaming final response."""
    mock_settings.ANTHROPIC_API_KEY = "test-key"

    mock_client = AsyncMock()
    mock_anthropic_cls.return_value = mock_client

    # First call: model requests a tool call
    tool_block = _make_tool_use_block("call_1", "get_resource_summary")
    tool_response = _make_anthropic_response(
        text=None,
        stop_reason="tool_use",
        tool_blocks=[tool_block],
    )

    # Second call: model gives final answer (non-streaming triggers stream path)
    final_response = _make_anthropic_response("Resources are stable.")

    mock_client.messages.create = AsyncMock(
        side_effect=[tool_response, final_response]
    )

    # Third call: the streaming response
    async def fake_text_stream():
        yield "Resources are stable."

    mock_stream_ctx = AsyncMock()
    mock_stream_obj = MagicMock()
    mock_stream_obj.text_stream = fake_text_stream()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_obj)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_client.messages.stream = MagicMock(return_value=mock_stream_ctx)

    async def override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/jarvis/chat-stream",
            json={"message": "Resource status?", "conversation_history": []},
        )

    app.dependency_overrides.clear()
    assert resp.status_code == 200

    events = _parse_sse_events(resp.text)
    chunk_events = [e for e in events if e["type"] == "chunk"]
    done_events = [e for e in events if e["type"] == "done"]

    assert len(chunk_events) >= 1
    assert len(done_events) == 1


@pytest.mark.asyncio
@patch("app.routers.jarvis_chat.settings")
@patch("app.routers.jarvis_chat.AsyncAnthropic")
async def test_stream_done_event_always_sent(mock_anthropic_cls, mock_settings, seeded_session):
    """The done event is always the last event in the stream."""
    mock_settings.ANTHROPIC_API_KEY = "test-key"

    mock_client = AsyncMock()
    mock_anthropic_cls.return_value = mock_client

    first_response = _make_anthropic_response("OK.")
    mock_client.messages.create = AsyncMock(return_value=first_response)

    async def fake_text_stream():
        yield "OK."

    mock_stream_ctx = AsyncMock()
    mock_stream_obj = MagicMock()
    mock_stream_obj.text_stream = fake_text_stream()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_obj)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_client.messages.stream = MagicMock(return_value=mock_stream_ctx)

    async def override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/jarvis/chat-stream",
            json={"message": "Test", "conversation_history": []},
        )

    app.dependency_overrides.clear()
    events = _parse_sse_events(resp.text)
    assert events[-1]["type"] == "done"
