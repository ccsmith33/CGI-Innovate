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

def _make_openai_response(content: str, finish_reason: str = "stop", tool_calls=None):
    """Build a mock OpenAI ChatCompletion response."""
    message = MagicMock()
    message.content = content
    message.tool_calls = tool_calls
    choice = MagicMock()
    choice.finish_reason = finish_reason
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


def _make_tool_call(call_id: str, fn_name: str, arguments: str = "{}"):
    tc = MagicMock()
    tc.id = call_id
    tc.function = MagicMock()
    tc.function.name = fn_name
    tc.function.arguments = arguments
    return tc


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@patch("app.routers.jarvis_chat.settings")
async def test_graceful_degradation_no_api_key(mock_settings, seeded_session):
    """When OPENAI_API_KEY is empty, return fallback offline message."""
    mock_settings.OPENAI_API_KEY = ""

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
@patch("app.routers.jarvis_chat.AsyncOpenAI")
async def test_simple_chat_no_function_calls(mock_openai_cls, mock_settings, seeded_session):
    """When the model replies without calling any function, return the reply directly."""
    mock_settings.OPENAI_API_KEY = "test-key"

    mock_client = AsyncMock()
    mock_openai_cls.return_value = mock_client

    mock_client.chat.completions.create = AsyncMock(
        return_value=_make_openai_response("All sectors are operational, sir.")
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
@patch("app.routers.jarvis_chat.AsyncOpenAI")
async def test_function_calling_dispatch(mock_openai_cls, mock_settings, seeded_session):
    """When the model calls a function, execute it and return the final response."""
    mock_settings.OPENAI_API_KEY = "test-key"

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
    mock_openai_cls.return_value = mock_client

    # First call: model requests get_all_forecasts
    tool_call = _make_tool_call("call_1", "get_all_forecasts")
    first_response = _make_openai_response(
        content=None,
        finish_reason="tool_calls",
        tool_calls=[tool_call],
    )

    # Second call: model provides the final answer
    second_response = _make_openai_response(
        "Based on forecasts, Wakanda Vibranium will exhaust in 48 hours."
    )

    mock_client.chat.completions.create = AsyncMock(
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
@patch("app.routers.jarvis_chat.AsyncOpenAI")
async def test_conversation_history_forwarded(mock_openai_cls, mock_settings, seeded_session):
    """Conversation history should be included in messages sent to OpenAI."""
    mock_settings.OPENAI_API_KEY = "test-key"

    mock_client = AsyncMock()
    mock_openai_cls.return_value = mock_client
    mock_client.chat.completions.create = AsyncMock(
        return_value=_make_openai_response("Understood.")
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

    # Verify the messages list sent to OpenAI includes history
    call_args = mock_client.chat.completions.create.call_args
    messages = call_args.kwargs.get("messages") or call_args[1].get("messages")
    # system + 2 history + 1 new = 4 messages
    assert len(messages) == 4
    assert messages[1]["content"] == "Which sector runs out first?"
    assert messages[2]["content"] == "Wakanda is critical."
    assert messages[3]["content"] == "What about Sokovia?"
