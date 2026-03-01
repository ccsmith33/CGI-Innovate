"""Tests for the Governor service, budget optimizer, and router endpoints."""

from __future__ import annotations

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.resource_config import RESOURCE_CONFIG, TOTAL_BUDGET
from app.database import Base, get_db, set_session_factory
from app.main import app
from app.models.control_action import ControlAction
from app.models.resource_log import ResourceLog
from app.services.governor import (
    Governor,
    ModelSnapshot,
    _build_projection_curve,
    _sector_key,
    optimize_allocations,
)
from app.services.strategies.trend_model import TrendModel, TrendResult


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def governor_session(test_engine):
    """DB session with governor-relevant seed data across all 5 sectors."""
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        rows = []
        base_time = datetime(2026, 2, 1, 0, tzinfo=timezone.utc)
        for i, ((sector_id, resource_type), cfg) in enumerate(RESOURCE_CONFIG.items()):
            # 20 data points per sector with a slight downward trend
            for j in range(20):
                rows.append(
                    ResourceLog(
                        timestamp=base_time + timedelta(hours=j),
                        sector_id=sector_id,
                        resource_type=resource_type,
                        stock_level=cfg["target_stock"] - j * 5,
                        usage_rate_hourly=5.0,
                        snap_event_detected=False,
                    )
                )
        session.add_all(rows)
        await session.commit()
        yield session


@pytest.fixture
async def critical_session(test_engine):
    """DB session with one CRITICAL sector (stock < 30% of target)."""
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        rows = []
        base_time = datetime(2026, 2, 1, 0, tzinfo=timezone.utc)
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            for j in range(20):
                if sector_id == "Avengers Compound":
                    # Critical: stock way below 30% of target (600 * 0.3 = 180)
                    stock = 100 - j * 2
                else:
                    stock = cfg["target_stock"] - j * 2
                rows.append(
                    ResourceLog(
                        timestamp=base_time + timedelta(hours=j),
                        sector_id=sector_id,
                        resource_type=resource_type,
                        stock_level=max(stock, 1),
                        usage_rate_hourly=5.0,
                        snap_event_detected=False,
                    )
                )
        session.add_all(rows)
        await session.commit()
        yield session


@pytest.fixture
async def snap_session(test_engine):
    """DB session where only one sector has snap_event_detected=True."""
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        rows = []
        base_time = datetime(2026, 2, 1, 0, tzinfo=timezone.utc)
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            for j in range(20):
                # Only Wakanda has a snap event (on the 10th row)
                snap_flag = (sector_id == "Wakanda" and j == 10)
                rows.append(
                    ResourceLog(
                        timestamp=base_time + timedelta(hours=j),
                        sector_id=sector_id,
                        resource_type=resource_type,
                        stock_level=cfg["target_stock"] - j * 5,
                        usage_rate_hourly=5.0,
                        snap_event_detected=snap_flag,
                    )
                )
        session.add_all(rows)
        await session.commit()
        yield session


@pytest.fixture
async def governor_client(governor_session):
    """Test client with governor seed data."""
    async def override_get_db():
        yield governor_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# TrendModel tests
# ---------------------------------------------------------------------------

class TestTrendModel:
    def test_fit_upward_trend(self):
        model = TrendModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(10)]
        levels = [100.0 + i * 10 for i in range(10)]
        result = model.fit(ts, levels)
        assert result.slope > 0
        assert result.confidence > 50
        assert result.projected_stock_in_5_cycles > levels[-1]

    def test_fit_downward_trend(self):
        model = TrendModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(10)]
        levels = [500.0 - i * 20 for i in range(10)]
        result = model.fit(ts, levels)
        assert result.slope < 0
        assert result.confidence > 50
        assert result.projected_stock_in_5_cycles < levels[-1]

    def test_fit_single_point(self):
        model = TrendModel()
        ts = [datetime(2026, 1, 1, tzinfo=timezone.utc)]
        levels = [300.0]
        result = model.fit(ts, levels)
        assert result.slope == 0.0
        assert result.confidence == 0.0
        assert result.projected_stock_in_5_cycles == 300.0

    def test_confidence_clamped_0_to_100(self):
        """Bug 2: confidence must always be between 0 and 100."""
        model = TrendModel()
        # Noisy data that could produce negative R^2
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(10)]
        levels = [100.0, 200.0, 50.0, 300.0, 10.0, 400.0, 5.0, 500.0, 1.0, 600.0]
        result = model.fit(ts, levels)
        assert 0.0 <= result.confidence <= 100.0

    def test_confidence_perfect_fit(self):
        model = TrendModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(5)]
        levels = [10.0, 20.0, 30.0, 40.0, 50.0]
        result = model.fit(ts, levels)
        assert 99.0 <= result.confidence <= 100.0


# ---------------------------------------------------------------------------
# Budget optimizer tests
# ---------------------------------------------------------------------------

class TestBudgetOptimizer:
    def test_total_stays_under_budget(self):
        trends = {}
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            trends[key] = TrendResult(
                slope=-5.0,
                r_squared=0.9,
                confidence=90.0,
                projected_stock_in_5_cycles=cfg["target_stock"] - 25,
                current_stock=cfg["target_stock"] * 0.8,
            )
        allocations = optimize_allocations(trends, RESOURCE_CONFIG)
        total_cost = sum(
            allocations[_sector_key(sid, rt)] * cfg["cost_per_unit"]
            for (sid, rt), cfg in RESOURCE_CONFIG.items()
        )
        assert total_cost <= TOTAL_BUDGET

    def test_critical_sector_gets_boosted(self):
        trends = {}
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            if sector_id == "Avengers Compound":
                # CRITICAL: stock below 30% of target
                current = cfg["target_stock"] * 0.2
            else:
                current = cfg["target_stock"] * 0.8
            trends[key] = TrendResult(
                slope=-3.0,
                r_squared=0.85,
                confidence=85.0,
                projected_stock_in_5_cycles=current - 15,
                current_stock=current,
            )
        allocations = optimize_allocations(trends, RESOURCE_CONFIG)
        avengers_key = _sector_key("Avengers Compound", "Medical Kits")
        avengers_base = RESOURCE_CONFIG[("Avengers Compound", "Medical Kits")]["base_production"]
        assert allocations[avengers_key] > avengers_base

    def test_no_sector_below_80pct_base(self):
        trends = {}
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            # All critical to force heavy rebalancing
            trends[key] = TrendResult(
                slope=-10.0,
                r_squared=0.95,
                confidence=95.0,
                projected_stock_in_5_cycles=50,
                current_stock=cfg["target_stock"] * 0.1,
            )
        allocations = optimize_allocations(trends, RESOURCE_CONFIG)
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            min_prod = cfg["base_production"] * 0.8
            assert allocations[key] >= min_prod - 0.01  # small float tolerance


# ---------------------------------------------------------------------------
# Champion/Challenger/Backup tests
# ---------------------------------------------------------------------------

class TestChampionChallengerSwap:
    def test_first_snapshot_becomes_champion(self):
        gov = Governor()
        snap = ModelSnapshot(
            trained_at=datetime.now(timezone.utc),
            data_points=100,
            confidences={"a": 80.0},
            allocations={"a": 5.0},
            overall_confidence=80.0,
        )
        gov._promote(snap)
        assert gov.champion is snap
        assert gov.challenger is None
        assert gov.backup is None

    def test_challenger_wins_promotes_to_champion(self):
        gov = Governor()
        old_champ = ModelSnapshot(
            trained_at=datetime.now(timezone.utc),
            data_points=50,
            overall_confidence=70.0,
        )
        gov.champion = old_champ

        better = ModelSnapshot(
            trained_at=datetime.now(timezone.utc),
            data_points=100,
            overall_confidence=85.0,
        )
        gov._promote(better)
        assert gov.champion is better
        assert gov.backup is old_champ
        assert gov.challenger is None

    def test_champion_wins_discards_challenger(self):
        gov = Governor()
        champ = ModelSnapshot(
            trained_at=datetime.now(timezone.utc),
            data_points=100,
            overall_confidence=90.0,
        )
        gov.champion = champ

        worse = ModelSnapshot(
            trained_at=datetime.now(timezone.utc),
            data_points=100,
            overall_confidence=60.0,
        )
        gov._promote(worse)
        assert gov.champion is champ
        assert gov.challenger is None

    def test_backup_preserved_after_second_promotion(self):
        gov = Governor()
        first = ModelSnapshot(trained_at=datetime.now(timezone.utc), data_points=50, overall_confidence=60.0)
        gov._promote(first)

        second = ModelSnapshot(trained_at=datetime.now(timezone.utc), data_points=80, overall_confidence=75.0)
        gov._promote(second)
        assert gov.champion is second
        assert gov.backup is first

        third = ModelSnapshot(trained_at=datetime.now(timezone.utc), data_points=100, overall_confidence=90.0)
        gov._promote(third)
        assert gov.champion is third
        assert gov.backup is second


# ---------------------------------------------------------------------------
# Control action logging tests
# ---------------------------------------------------------------------------

class TestControlActionLogging:
    @pytest.mark.anyio
    async def test_run_cycle_logs_action(self, governor_session):
        gov = Governor()
        with patch.object(gov, "_send_production_commands", new_callable=AsyncMock):
            action = await gov.run_cycle(governor_session)
        assert action is not None
        assert isinstance(action, ControlAction)
        assert action.champion_confidence > 0
        assert action.total_budget_used > 0
        assert action.rationale
        assert action.allocations_json

    @pytest.mark.anyio
    async def test_run_cycle_critical_sector(self, critical_session):
        gov = Governor()
        with patch.object(gov, "_send_production_commands", new_callable=AsyncMock):
            action = await gov.run_cycle(critical_session)
        assert action is not None
        assert action.total_budget_used <= TOTAL_BUDGET


# ---------------------------------------------------------------------------
# Time-to-zero tests
# ---------------------------------------------------------------------------

class TestTimeToZero:
    @pytest.mark.anyio
    async def test_time_to_zero_calculation(self, governor_session):
        gov = Governor()
        results = await gov.compute_time_to_zero(governor_session)
        # Should have all 5 sectors
        assert len(results) == 5
        for key, data in results.items():
            assert data["calculation_method"] == "time_to_zero_no_production"
            assert "sector_id" in data
            assert "resource_type" in data
            assert "current_stock" in data
            # Stock is decreasing so hours_to_zero should be a number
            if data["hours_to_zero"] is not None:
                assert data["hours_to_zero"] > 0

    @pytest.mark.anyio
    async def test_consumption_rate_reasonable(self, governor_session):
        """Bug 1: consumption_rate_hourly must be 100-1000, NOT millions."""
        gov = Governor()
        results = await gov.compute_time_to_zero(governor_session)
        for key, data in results.items():
            rate = data["consumption_rate_hourly"]
            if rate is not None and rate > 0:
                assert rate < 1000, (
                    f"{key}: consumption_rate_hourly={rate} exceeds 1000"
                )

    @pytest.mark.anyio
    async def test_snap_detected_per_sector(self, snap_session):
        """Bug 4: snap_detected must be per-sector, not global."""
        gov = Governor()
        results = await gov.compute_time_to_zero(snap_session)
        wakanda_key = _sector_key("Wakanda", "Arc Reactor Cores")
        assert results[wakanda_key]["snap_detected"] is True

        # All other sectors must NOT have snap_detected
        for key, data in results.items():
            if key != wakanda_key:
                assert data["snap_detected"] is False, (
                    f"{key} should not have snap_detected=True"
                )

    @pytest.mark.anyio
    async def test_projection_curve_present_and_declining(self, governor_session):
        """projection_curve must be present and all projected_stock values declining."""
        gov = Governor()
        results = await gov.compute_time_to_zero(governor_session)
        for key, data in results.items():
            curve = data["projection_curve"]
            assert isinstance(curve, list)
            assert len(curve) >= 1
            # Verify declining (each point <= previous)
            for i in range(1, len(curve)):
                assert curve[i]["projected_stock"] <= curve[i - 1]["projected_stock"], (
                    f"{key}: projection_curve not declining at index {i}"
                )
            # Last point should be at or near zero (if curve extends to depletion)
            if len(curve) > 1:
                assert curve[-1]["projected_stock"] >= 0

    @pytest.mark.anyio
    async def test_exhausted_guard_high_stock(self, governor_session):
        """Bug 3: hours_to_zero must not be 0 when stock > 10."""
        gov = Governor()
        results = await gov.compute_time_to_zero(governor_session)
        for key, data in results.items():
            if data["current_stock"] > 10:
                h = data["hours_to_zero"]
                assert h is None or h > 0, (
                    f"{key}: hours_to_zero={h} but stock={data['current_stock']}"
                )


# ---------------------------------------------------------------------------
# Router endpoint tests
# ---------------------------------------------------------------------------

class TestGovernorRouter:
    @pytest.mark.anyio
    async def test_get_status(self, governor_client):
        resp = await governor_client.get("/api/v1/governor/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "champion" in data
        assert "challenger" in data
        assert "backup" in data
        assert "budget_total" in data

    @pytest.mark.anyio
    async def test_get_decisions_empty(self, governor_client):
        resp = await governor_client.get("/api/v1/governor/decisions")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    @pytest.mark.anyio
    async def test_get_time_to_zero(self, governor_client):
        resp = await governor_client.get("/api/v1/governor/time-to-zero")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    @pytest.mark.anyio
    async def test_post_override(self, governor_client):
        resp = await governor_client.post(
            "/api/v1/governor/override",
            json={
                "sector_id": "Wakanda",
                "resource_type": "Arc Reactor Cores",
                "units_per_cycle": 10.0,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "override_set"
        assert data["units_per_cycle"] == 10.0

    @pytest.mark.anyio
    async def test_post_snap_feed_unavailable(self, governor_client):
        # Feed service is not running in tests, should get 502
        resp = await governor_client.post("/api/v1/governor/snap")
        assert resp.status_code == 502

    @pytest.mark.anyio
    async def test_decisions_with_limit(self, governor_client):
        resp = await governor_client.get("/api/v1/governor/decisions?limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) <= 5

    @pytest.mark.anyio
    async def test_time_to_zero_includes_new_fields(self, governor_client):
        """Response must include snap_detected and projection_curve."""
        resp = await governor_client.get("/api/v1/governor/time-to-zero")
        assert resp.status_code == 200
        data = resp.json()
        for entry in data:
            assert "snap_detected" in entry
            assert "projection_curve" in entry
            assert isinstance(entry["projection_curve"], list)


# ---------------------------------------------------------------------------
# Projection curve unit tests
# ---------------------------------------------------------------------------

class TestProjectionCurve:
    def test_curve_declines_to_zero(self):
        curve = _build_projection_curve(500.0, 100.0)
        assert len(curve) >= 2
        assert curve[0]["projected_stock"] == 500.0
        assert curve[-1]["projected_stock"] == 0.0
        for i in range(1, len(curve)):
            assert curve[i]["projected_stock"] <= curve[i - 1]["projected_stock"]

    def test_curve_capped_at_168h(self):
        # Very low rate: 1 unit/hr on 1000 stock => 1000h, but capped at 168h
        curve = _build_projection_curve(1000.0, 1.0)
        assert curve[-1]["hours_from_now"] <= 168.0
        assert curve[-1]["projected_stock"] > 0  # not depleted yet at 168h

    def test_curve_max_50_points(self):
        curve = _build_projection_curve(10000.0, 10.0)
        assert len(curve) <= 50

    def test_curve_zero_rate(self):
        curve = _build_projection_curve(500.0, 0.0)
        assert len(curve) == 1
        assert curve[0]["projected_stock"] == 500.0

    def test_curve_zero_stock(self):
        curve = _build_projection_curve(0.0, 100.0)
        assert len(curve) == 1
        assert curve[0]["projected_stock"] == 0.0
