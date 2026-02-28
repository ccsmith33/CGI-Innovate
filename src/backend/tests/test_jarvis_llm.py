import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.jarvis_llm import extract_intel


@pytest.mark.asyncio
@patch("app.services.jarvis_llm.settings")
async def test_valid_extraction(mock_settings):
    mock_settings.OPENAI_API_KEY = "test-key"

    mock_response = MagicMock()
    mock_response.choices = [
        MagicMock(
            message=MagicMock(
                content=json.dumps(
                    {
                        "sector_id": "Wakanda",
                        "resource_type": "Vibranium (kg)",
                        "severity": "high",
                        "summary": "Vibranium supplies are critically low.",
                        "confidence": 0.9,
                    }
                )
            )
        )
    ]

    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    with patch("app.services.jarvis_llm.AsyncOpenAI", return_value=mock_client):
        result = await extract_intel("Redacted report about vibranium.")

    assert result["sector_id"] == "Wakanda"
    assert result["resource_type"] == "Vibranium (kg)"
    assert result["severity"] == "high"
    assert result["confidence"] == 0.9


@pytest.mark.asyncio
@patch("app.services.jarvis_llm.settings")
async def test_malformed_json_fallback(mock_settings):
    mock_settings.OPENAI_API_KEY = "test-key"

    mock_response = MagicMock()
    mock_response.choices = [
        MagicMock(message=MagicMock(content="This is not JSON"))
    ]

    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    with patch("app.services.jarvis_llm.AsyncOpenAI", return_value=mock_client):
        result = await extract_intel("Some redacted text.")

    assert result["severity"] == "unknown"
    assert result["summary"] == "Parse failed"
    assert result["confidence"] == 0.0


@pytest.mark.asyncio
@patch("app.services.jarvis_llm.settings")
async def test_missing_fields_fallback(mock_settings):
    mock_settings.OPENAI_API_KEY = "test-key"

    mock_response = MagicMock()
    mock_response.choices = [
        MagicMock(
            message=MagicMock(
                content=json.dumps({"sector_id": "Wakanda"})
            )
        )
    ]

    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

    with patch("app.services.jarvis_llm.AsyncOpenAI", return_value=mock_client):
        result = await extract_intel("Report text.")

    assert result["sector_id"] == "Wakanda"
    assert result["severity"] == "unknown"
    assert result["summary"] == "Parse failed"
    assert result["confidence"] == 0.0


@pytest.mark.asyncio
@patch("app.services.jarvis_llm.settings")
async def test_api_error_fallback(mock_settings):
    mock_settings.OPENAI_API_KEY = "test-key"

    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=Exception("API timeout")
    )

    with patch("app.services.jarvis_llm.AsyncOpenAI", return_value=mock_client):
        result = await extract_intel("Report text.")

    assert result["severity"] == "unknown"
    assert result["summary"] == "Parse failed"
    assert result["confidence"] == 0.0


@pytest.mark.asyncio
@patch("app.services.jarvis_llm.settings")
async def test_no_api_key(mock_settings):
    mock_settings.OPENAI_API_KEY = ""

    result = await extract_intel("Report text.")
    assert result["summary"] == "No API key configured"
