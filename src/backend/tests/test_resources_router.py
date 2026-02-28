import pytest


@pytest.mark.asyncio
async def test_list_resources(client):
    response = await client.get("/api/v1/resources")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert "total" in data
    assert len(data["data"]) > 0


@pytest.mark.asyncio
async def test_filter_by_sector(client):
    response = await client.get("/api/v1/resources?sector=Wakanda")
    assert response.status_code == 200
    data = response.json()
    assert all(r["sector_id"] == "Wakanda" for r in data["data"])


@pytest.mark.asyncio
async def test_filter_by_resource_type(client):
    response = await client.get("/api/v1/resources?resource_type=Vibranium (kg)")
    assert response.status_code == 200
    data = response.json()
    assert all(r["resource_type"] == "Vibranium (kg)" for r in data["data"])


@pytest.mark.asyncio
async def test_get_sectors(client):
    response = await client.get("/api/v1/resources/sectors")
    assert response.status_code == 200
    data = response.json()
    assert "sectors" in data
    assert "Wakanda" in data["sectors"]
    assert "New Asgard" in data["sectors"]


@pytest.mark.asyncio
async def test_get_types(client):
    response = await client.get("/api/v1/resources/types")
    assert response.status_code == 200
    data = response.json()
    assert "resource_types" in data
    assert "Vibranium (kg)" in data["resource_types"]


@pytest.mark.asyncio
async def test_get_summary(client):
    response = await client.get("/api/v1/resources/summary")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert len(data["data"]) > 0
    # Each item should have the expected fields
    item = data["data"][0]
    assert "sector_id" in item
    assert "resource_type" in item
    assert "latest_stock_level" in item
    assert "latest_usage_rate" in item
    assert "latest_timestamp" in item


@pytest.mark.asyncio
async def test_pagination(client):
    response = await client.get("/api/v1/resources?limit=2&offset=0")
    assert response.status_code == 200
    data = response.json()
    assert data["limit"] == 2
    assert data["offset"] == 0
    assert len(data["data"]) <= 2
