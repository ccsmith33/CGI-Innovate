import pytest


@pytest.mark.asyncio
async def test_preview_redaction_hero_names(client):
    """POST /api/v1/reports/preview-redaction redacts hero names."""
    response = await client.post(
        "/api/v1/reports/preview-redaction",
        json={"text": "Tony Stark reported a vibranium shortage in Wakanda."},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["original"] == "Tony Stark reported a vibranium shortage in Wakanda."
    assert "Tony Stark" not in data["redacted"]
    assert "[REDACTED-NAME]" in data["redacted"]
    assert any("known_hero:Tony Stark" in p for p in data["patterns_matched"])


@pytest.mark.asyncio
async def test_preview_redaction_phone_numbers(client):
    """POST /api/v1/reports/preview-redaction redacts phone numbers."""
    response = await client.post(
        "/api/v1/reports/preview-redaction",
        json={"text": "Contact Peter Parker at 555-123-4567 for details."},
    )
    assert response.status_code == 200
    data = response.json()
    assert "555-123-4567" not in data["redacted"]
    assert "[REDACTED-PHONE]" in data["redacted"]
    assert "Peter Parker" not in data["redacted"]


@pytest.mark.asyncio
async def test_preview_redaction_no_pii(client):
    """POST /api/v1/reports/preview-redaction with no PII returns text unchanged."""
    text = "All clear in sector 7. No issues to report."
    response = await client.post(
        "/api/v1/reports/preview-redaction",
        json={"text": text},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["original"] == text
    assert data["redacted"] == text
    assert data["patterns_matched"] == []


@pytest.mark.asyncio
async def test_preview_redaction_empty_text(client):
    """POST /api/v1/reports/preview-redaction accepts empty text."""
    response = await client.post(
        "/api/v1/reports/preview-redaction",
        json={"text": ""},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["original"] == ""
    assert data["redacted"] == ""


@pytest.mark.asyncio
async def test_preview_redaction_multiple_patterns(client):
    """POST /api/v1/reports/preview-redaction redacts multiple PII items."""
    response = await client.post(
        "/api/v1/reports/preview-redaction",
        json={
            "text": "Bruce Banner called Natasha Romanoff at 212-555-0199 about a situation."
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "Bruce Banner" not in data["redacted"]
    assert "Natasha Romanoff" not in data["redacted"]
    assert "212-555-0199" not in data["redacted"]
    assert len(data["patterns_matched"]) >= 3
