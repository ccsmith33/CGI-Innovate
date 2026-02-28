import pytest
import uuid


@pytest.mark.asyncio
async def test_submit_report_returns_202(clean_client):
    response = await clean_client.post(
        "/api/v1/reports/submit",
        json={
            "raw_text": "Tony Stark reports Wakanda vibranium levels critical.",
            "metadata": {"hero_alias": "Tony Stark", "secure_contact": "555-0101"},
            "priority": "High",
        },
    )
    assert response.status_code == 202
    data = response.json()
    assert "report_id" in data
    assert data["status"] == "processing"


@pytest.mark.asyncio
async def test_submit_report_creates_redaction_log(clean_client):
    response = await clean_client.post(
        "/api/v1/reports/submit",
        json={
            "raw_text": "Bruce Banner spotted in Sokovia.",
            "metadata": {"hero_alias": "Bruce Banner", "secure_contact": "555-0199"},
            "priority": "Routine",
        },
    )
    assert response.status_code == 202
    report_id = response.json()["report_id"]

    # Fetch the report to verify it was stored
    report_response = await clean_client.get(f"/api/v1/reports/{report_id}")
    assert report_response.status_code == 200
    report_data = report_response.json()
    # Status could be "processing" or "processed" depending on background task timing
    assert report_data["status"] in ("processing", "processed")
    # raw_text and metadata_json should NOT be in response
    assert "raw_text" not in report_data
    assert "metadata_json" not in report_data


@pytest.mark.asyncio
async def test_get_reports_list(clean_client):
    # Submit a report first
    await clean_client.post(
        "/api/v1/reports/submit",
        json={"raw_text": "Test report.", "priority": "Routine"},
    )

    response = await clean_client.get("/api/v1/reports")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "total" in data
    assert len(data["data"]) >= 1


@pytest.mark.asyncio
async def test_get_report_by_id(clean_client):
    # Submit a report first
    submit_resp = await clean_client.post(
        "/api/v1/reports/submit",
        json={"raw_text": "Test report for get.", "priority": "Routine"},
    )
    report_id = submit_resp.json()["report_id"]

    response = await clean_client.get(f"/api/v1/reports/{report_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["report_id"] == report_id


@pytest.mark.asyncio
async def test_get_report_not_found(clean_client):
    fake_id = str(uuid.uuid4())
    response = await clean_client.get(f"/api/v1/reports/{fake_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_report_excludes_raw_text(clean_client):
    submit_resp = await clean_client.post(
        "/api/v1/reports/submit",
        json={"raw_text": "Secret raw text here.", "priority": "Routine"},
    )
    report_id = submit_resp.json()["report_id"]

    response = await clean_client.get(f"/api/v1/reports/{report_id}")
    data = response.json()
    assert "raw_text" not in data
    assert "metadata_json" not in data
