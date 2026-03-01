"""Tests for crisis scenarios and VLM image analysis endpoints."""

import json
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestScenarios:
    """Test the crisis scenario endpoints."""

    async def test_list_scenarios(self, client):
        """GET /governor/scenarios returns list of available scenarios."""
        resp = await client.get("/api/v1/governor/scenarios")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 3
        ids = {s["id"] for s in data}
        assert ids == {"thanos_incursion", "hydra_sabotage", "pandemic_surge"}
        for scenario in data:
            assert "name" in scenario
            assert "description" in scenario

    async def test_trigger_valid_scenario(self, client):
        """POST /governor/scenario/<id> triggers a known scenario."""
        resp = await client.post("/api/v1/governor/scenario/thanos_incursion")
        assert resp.status_code == 200
        data = resp.json()
        assert "initiated" in data["message"]
        assert data["steps"] == 6  # thanos has 6 steps

    async def test_trigger_unknown_scenario_returns_404(self, client):
        """POST /governor/scenario/<id> returns 404 for unknown scenario."""
        resp = await client.post("/api/v1/governor/scenario/nonexistent")
        assert resp.status_code == 404

    async def test_hydra_scenario_step_count(self, client):
        """HYDRA scenario has 3 steps."""
        resp = await client.post("/api/v1/governor/scenario/hydra_sabotage")
        assert resp.status_code == 200
        assert resp.json()["steps"] == 3

    async def test_pandemic_scenario_step_count(self, client):
        """Pandemic scenario has 3 steps."""
        resp = await client.post("/api/v1/governor/scenario/pandemic_surge")
        assert resp.status_code == 200
        assert resp.json()["steps"] == 3


class TestImageAnalysis:
    """Test the VLM image analysis endpoint."""

    async def test_analyze_image_with_mocked_anthropic(self, client):
        """POST /reports/analyze-image returns structured analysis with mocked VLM."""
        mock_analysis = {
            "threat_type": "infrastructure_damage",
            "affected_sector": "Wakanda",
            "severity": "HIGH",
            "resources_at_risk": ["Arc Reactor Cores"],
            "summary": "Significant damage to reactor facility detected.",
            "recommended_action": "Deploy repair teams immediately.",
        }

        mock_content_block = MagicMock()
        mock_content_block.text = json.dumps(mock_analysis)

        mock_response = MagicMock()
        mock_response.content = [mock_content_block]

        mock_anthropic_instance = AsyncMock()
        mock_anthropic_instance.messages.create = AsyncMock(return_value=mock_response)

        with patch("anthropic.AsyncAnthropic", return_value=mock_anthropic_instance):
            # Create a fake image file
            image_data = b'\x89PNG\r\n\x1a\n' + b'\x00' * 100  # minimal PNG-like bytes
            resp = await client.post(
                "/api/v1/reports/analyze-image",
                files={"file": ("test.png", BytesIO(image_data), "image/png")},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "analysis" in data
        assert "report_id" in data
        analysis = data["analysis"]
        assert analysis["threat_type"] == "infrastructure_damage"
        assert analysis["affected_sector"] == "Wakanda"
        assert analysis["severity"] == "HIGH"
