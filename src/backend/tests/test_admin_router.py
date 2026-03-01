import hashlib

import pytest

from app.models.intel_report import IntelReport
from app.models.redaction_log import RedactionLog


async def _seed_redaction_log(session, count=3):
    """Seed intel reports and matching redaction log entries."""
    from datetime import datetime, timezone

    for i in range(count):
        report = IntelReport(
            raw_text=f"raw text {i}",
            redacted_text=f"[REDACTED] text {i}",
            metadata_json={},
            priority="Routine",
            status="processed",
            timestamp=datetime(2026, 1, 1, i, tzinfo=timezone.utc),
        )
        session.add(report)
        await session.flush()

        log_entry = RedactionLog(
            report_id=report.report_id,
            original_text_hash=hashlib.sha256(f"raw text {i}".encode()).hexdigest(),
            redacted_text=f"[REDACTED] text {i}",
            patterns_matched=[f"hero_name:Hero {i}"],
        )
        session.add(log_entry)

    await session.commit()


@pytest.mark.asyncio
async def test_get_redaction_log_returns_items(clean_session, clean_client):
    await _seed_redaction_log(clean_session, count=3)

    response = await clean_client.get("/api/v1/admin/redaction-log")
    assert response.status_code == 200

    data = response.json()
    assert "total" in data
    assert "items" in data
    assert data["total"] == 3
    assert len(data["items"]) == 3

    item = data["items"][0]
    assert "id" in item
    assert "report_id" in item
    assert "original_text_hash" in item
    assert "redacted_text" in item
    assert "patterns_matched" in item
    assert "redacted_at" in item


@pytest.mark.asyncio
async def test_get_redaction_log_pagination(clean_session, clean_client):
    await _seed_redaction_log(clean_session, count=5)

    response = await clean_client.get("/api/v1/admin/redaction-log?limit=2&offset=0")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 5
    assert len(data["items"]) == 2

    response2 = await clean_client.get("/api/v1/admin/redaction-log?limit=2&offset=2")
    assert response2.status_code == 200
    data2 = response2.json()
    assert data2["total"] == 5
    assert len(data2["items"]) == 2


@pytest.mark.asyncio
async def test_get_redaction_log_empty(clean_client):
    response = await clean_client.get("/api/v1/admin/redaction-log")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert data["items"] == []


@pytest.mark.asyncio
async def test_get_redaction_log_limit_max(clean_client):
    response = await clean_client.get("/api/v1/admin/redaction-log?limit=300")
    assert response.status_code == 422  # exceeds max of 200
