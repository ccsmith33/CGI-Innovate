"""Tests for JARVIS autonomous planning agent."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestGatherObservation:
    """Test observation gathering from DB."""

    async def test_gather_observation_returns_stocks(self, seeded_session):
        from app.services.jarvis_agent import _gather_observation

        with patch("app.services.jarvis_agent.httpx") as mock_httpx:
            mock_client = AsyncMock()
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"level": 5, "label": "NORMAL"}
            mock_resp.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_httpx.AsyncClient.return_value = mock_client

            obs = await _gather_observation(seeded_session)

        assert "stocks" in obs
        assert "forecasts" in obs
        assert "defcon" in obs
        assert "timestamp" in obs
        assert isinstance(obs["stocks"], list)
        assert len(obs["stocks"]) >= 1

    async def test_gather_observation_defcon_fallback(self, seeded_session):
        """If DEFCON fetch fails, fallback to NORMAL."""
        from app.services.jarvis_agent import _gather_observation

        with patch("app.services.jarvis_agent.httpx") as mock_httpx:
            mock_httpx.AsyncClient.side_effect = Exception("connection refused")

            obs = await _gather_observation(seeded_session)

        assert obs["defcon"] == {"level": 5, "label": "NORMAL"}


class TestExecuteActions:
    """Test action execution logic."""

    async def test_high_confidence_override_is_applied(self, db_session):
        from app.services.jarvis_agent import _execute_actions

        decision = {
            "actions": [
                {
                    "type": "governor_override",
                    "sector": "Wakanda",
                    "resource": "Arc Reactor Cores",
                    "units": 12.0,
                    "confidence": 0.85,
                    "rationale": "Urgent need",
                },
            ],
        }

        with patch("app.services.jarvis_agent.httpx") as mock_httpx:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=MagicMock())
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_httpx.AsyncClient.return_value = mock_client

            await _execute_actions(decision, db_session)

            mock_client.post.assert_called_once()
            call_kwargs = mock_client.post.call_args
            body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
            assert body["sector_id"] == "Wakanda"
            assert body["units_per_cycle"] == 12.0

    async def test_low_confidence_override_is_skipped(self, db_session):
        from app.services.jarvis_agent import _execute_actions

        decision = {
            "actions": [
                {
                    "type": "governor_override",
                    "sector": "Wakanda",
                    "resource": "Arc Reactor Cores",
                    "units": 12.0,
                    "confidence": 0.50,
                    "rationale": "Tentative",
                },
            ],
        }

        with patch("app.services.jarvis_agent.httpx") as mock_httpx:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_httpx.AsyncClient.return_value = mock_client

            await _execute_actions(decision, db_session)

            mock_client.post.assert_not_called()

    async def test_alert_action_broadcasts(self, db_session):
        from app.services.jarvis_agent import _execute_actions

        decision = {
            "actions": [
                {
                    "type": "alert",
                    "message": "Vibranium critically low",
                    "severity": "critical",
                    "confidence": 0.9,
                },
            ],
        }

        with patch("app.services.jarvis_agent.broadcast", new_callable=AsyncMock) as mock_bc:
            await _execute_actions(decision, db_session)

            mock_bc.assert_called_once()
            call_args = mock_bc.call_args
            assert call_args[0][0] == "agent_alert"
            assert call_args[0][1]["message"] == "Vibranium critically low"
            assert call_args[0][1]["severity"] == "critical"


class TestRunAgentCycle:
    """Test the full agent cycle."""

    async def test_cycle_broadcasts_thinking_and_decision(self, seeded_session):
        """Agent cycle broadcasts agent_thinking and agent_decision events."""
        from app.services.jarvis_agent import run_agent_cycle

        mock_decision = {
            "situation": "All sectors stable",
            "critical_threat": None,
            "actions": [],
            "reasoning_chain": ["Step 1: Checked stocks", "Step 2: All nominal"],
        }

        # Mock the Anthropic streaming response
        mock_text_stream = AsyncMock()
        mock_text_stream.__aiter__ = lambda self: self
        _chunks = [json.dumps(mock_decision)]
        _idx = 0

        async def _anext(self):
            nonlocal _idx
            if _idx < len(_chunks):
                val = _chunks[_idx]
                _idx += 1
                return val
            raise StopAsyncIteration

        mock_text_stream.__anext__ = _anext

        mock_stream_ctx = AsyncMock()
        mock_stream_ctx.text_stream = mock_text_stream
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_ctx)
        mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_anthropic = MagicMock()
        mock_anthropic.messages.stream = MagicMock(return_value=mock_stream_ctx)

        broadcast_calls = []

        async def capture_broadcast(event_type, data):
            broadcast_calls.append((event_type, data))

        with (
            patch("app.services.jarvis_agent.settings") as mock_settings,
            patch("app.services.jarvis_agent.broadcast", side_effect=capture_broadcast),
            patch("anthropic.AsyncAnthropic", return_value=mock_anthropic),
            patch("app.services.jarvis_agent.httpx") as mock_httpx,
        ):
            mock_settings.ANTHROPIC_API_KEY = "test-key"
            mock_settings.FEED_SERVICE_URL = "http://feed:8001"

            # Mock DEFCON fetch
            mock_client = AsyncMock()
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"level": 4, "label": "ELEVATED"}
            mock_resp.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_httpx.AsyncClient.return_value = mock_client

            await run_agent_cycle(seeded_session)

        # Check that we broadcast agent_thinking events
        thinking_events = [c for c in broadcast_calls if c[0] == "agent_thinking"]
        assert len(thinking_events) >= 3  # observing, reasoning, planning/acting

        # Check phase progression
        phases = [e[1]["phase"] for e in thinking_events]
        assert "observing" in phases
        assert "reasoning" in phases

        # Check agent_decision broadcast
        decision_events = [c for c in broadcast_calls if c[0] == "agent_decision"]
        assert len(decision_events) == 1
        dec = decision_events[0][1]
        assert dec["situation"] == "All sectors stable"
        assert dec["actions_taken"] == 0
        assert len(dec["reasoning_chain"]) == 2

    async def test_cycle_no_api_key_broadcasts_offline(self, seeded_session):
        """Without API key, agent broadcasts offline status."""
        from app.services.jarvis_agent import run_agent_cycle

        broadcast_calls = []

        async def capture_broadcast(event_type, data):
            broadcast_calls.append((event_type, data))

        with (
            patch("app.services.jarvis_agent.settings") as mock_settings,
            patch("app.services.jarvis_agent.broadcast", side_effect=capture_broadcast),
            patch("app.services.jarvis_agent.httpx") as mock_httpx,
        ):
            mock_settings.ANTHROPIC_API_KEY = ""
            mock_settings.FEED_SERVICE_URL = "http://feed:8001"

            mock_client = AsyncMock()
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"level": 5, "label": "NORMAL"}
            mock_resp.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_httpx.AsyncClient.return_value = mock_client

            await run_agent_cycle(seeded_session)

        decision_events = [c for c in broadcast_calls if c[0] == "agent_decision"]
        assert len(decision_events) == 1
        assert "offline" in decision_events[0][1]["situation"].lower()

    async def test_cycle_invalid_json_does_not_crash(self, seeded_session):
        """If Claude returns non-JSON, the cycle handles it gracefully."""
        from app.services.jarvis_agent import run_agent_cycle

        # Mock stream that returns invalid JSON
        mock_text_stream = AsyncMock()
        mock_text_stream.__aiter__ = lambda self: self
        _chunks = ["This is not valid JSON at all"]
        _idx = 0

        async def _anext(self):
            nonlocal _idx
            if _idx < len(_chunks):
                val = _chunks[_idx]
                _idx += 1
                return val
            raise StopAsyncIteration

        mock_text_stream.__anext__ = _anext

        mock_stream_ctx = AsyncMock()
        mock_stream_ctx.text_stream = mock_text_stream
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_ctx)
        mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_anthropic = MagicMock()
        mock_anthropic.messages.stream = MagicMock(return_value=mock_stream_ctx)

        broadcast_calls = []

        async def capture_broadcast(event_type, data):
            broadcast_calls.append((event_type, data))

        with (
            patch("app.services.jarvis_agent.settings") as mock_settings,
            patch("app.services.jarvis_agent.broadcast", side_effect=capture_broadcast),
            patch("anthropic.AsyncAnthropic", return_value=mock_anthropic),
            patch("app.services.jarvis_agent.httpx") as mock_httpx,
        ):
            mock_settings.ANTHROPIC_API_KEY = "test-key"
            mock_settings.FEED_SERVICE_URL = "http://feed:8001"

            mock_client = AsyncMock()
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"level": 5, "label": "NORMAL"}
            mock_resp.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_httpx.AsyncClient.return_value = mock_client

            # Should not raise
            await run_agent_cycle(seeded_session)

        decision_events = [c for c in broadcast_calls if c[0] == "agent_decision"]
        assert len(decision_events) == 1
        assert "parse error" in decision_events[0][1]["situation"].lower()


    async def test_cycle_handles_json_wrapped_in_code_fences(self, seeded_session):
        """If Claude wraps JSON in ```json code fences, the cycle still parses it."""
        from app.services.jarvis_agent import run_agent_cycle

        mock_decision = {
            "situation": "All sectors stable",
            "critical_threat": None,
            "actions": [],
            "reasoning_chain": ["Step 1: Checked stocks"],
        }

        # Wrap valid JSON in markdown code fences
        fenced_json = "```json\n" + json.dumps(mock_decision) + "\n```"

        mock_text_stream = AsyncMock()
        mock_text_stream.__aiter__ = lambda self: self
        _chunks = [fenced_json]
        _idx = 0

        async def _anext(self):
            nonlocal _idx
            if _idx < len(_chunks):
                val = _chunks[_idx]
                _idx += 1
                return val
            raise StopAsyncIteration

        mock_text_stream.__anext__ = _anext

        mock_stream_ctx = AsyncMock()
        mock_stream_ctx.text_stream = mock_text_stream
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_ctx)
        mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)

        mock_anthropic = MagicMock()
        mock_anthropic.messages.stream = MagicMock(return_value=mock_stream_ctx)

        broadcast_calls = []

        async def capture_broadcast(event_type, data):
            broadcast_calls.append((event_type, data))

        with (
            patch("app.services.jarvis_agent.settings") as mock_settings,
            patch("app.services.jarvis_agent.broadcast", side_effect=capture_broadcast),
            patch("anthropic.AsyncAnthropic", return_value=mock_anthropic),
            patch("app.services.jarvis_agent.httpx") as mock_httpx,
        ):
            mock_settings.ANTHROPIC_API_KEY = "test-key"
            mock_settings.FEED_SERVICE_URL = "http://feed:8001"

            mock_client = AsyncMock()
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"level": 5, "label": "NORMAL"}
            mock_resp.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_resp)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_httpx.AsyncClient.return_value = mock_client

            # Should not raise — fences should be stripped
            await run_agent_cycle(seeded_session)

        # Should get a successful decision, not a parse error
        decision_events = [c for c in broadcast_calls if c[0] == "agent_decision"]
        assert len(decision_events) == 1
        assert decision_events[0][1]["situation"] == "All sectors stable"
        assert decision_events[0][1]["actions_taken"] == 0


class TestAgentLoopWiring:
    """Test that the agent loop is wired into main.py."""

    async def test_agent_loop_registered_in_lifespan(self):
        """Verify _agent_loop function exists in main module."""
        from app.main import _agent_loop

        assert callable(_agent_loop)
