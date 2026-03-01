"""Tests for the Governor service, budget optimizer, and router endpoints."""

from __future__ import annotations

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.resource_config import BASE_DRAIN_RATES, RESOURCE_CONFIG, TOTAL_BUDGET
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
from app.services.strategies.trend_model import TrendModel, TrendResult as OldTrendResult
from app.services.strategies.holt_cusum import HoltCUSUMModel, TrendResult
from app.services.strategies.mpc_optimizer import solve_simple


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
# Legacy TrendModel tests (trend_model.py still exists)
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
# HoltCUSUMModel tests
# ---------------------------------------------------------------------------

class TestHoltCUSUMModel:
    def test_declining_series_negative_slope(self):
        model = HoltCUSUMModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(20)]
        levels = [500.0 - i * 10 for i in range(20)]
        result = model.fit(ts, levels)
        assert result.slope < 0
        assert result.current_stock == levels[-1]
        assert result.projected_stock_in_5_cycles < result.current_stock

    def test_flat_series_slope_near_zero(self):
        model = HoltCUSUMModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(20)]
        levels = [500.0] * 20
        result = model.fit(ts, levels)
        assert abs(result.slope) < 1.0
        assert result.confidence > 90.0

    def test_upward_series_positive_slope(self):
        model = HoltCUSUMModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(20)]
        levels = [100.0 + i * 5 for i in range(20)]
        result = model.fit(ts, levels)
        assert result.slope > 0
        assert result.projected_stock_in_5_cycles > result.current_stock

    def test_step_change_detected(self):
        """A sudden jump in the series should trigger CUSUM step-change detection."""
        model = HoltCUSUMModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(20)]
        # Flat at 500 for 10 points, then sudden drop to 200 for 10 points
        levels = [500.0] * 10 + [200.0] * 10
        result = model.fit(ts, levels)
        assert result.step_change_detected is True

    def test_no_step_change_on_smooth_trend(self):
        """A smooth linear decline should NOT trigger step-change."""
        model = HoltCUSUMModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(20)]
        levels = [500.0 - i * 10 for i in range(20)]
        result = model.fit(ts, levels)
        assert result.step_change_detected is False

    def test_single_point(self):
        model = HoltCUSUMModel()
        ts = [datetime(2026, 1, 1, tzinfo=timezone.utc)]
        levels = [300.0]
        result = model.fit(ts, levels)
        assert result.slope == 0.0
        assert result.confidence == 0.0
        assert result.projected_stock_in_5_cycles == 300.0
        assert result.step_change_detected is False

    def test_two_points(self):
        model = HoltCUSUMModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(2)]
        levels = [100.0, 110.0]
        result = model.fit(ts, levels)
        assert result.slope > 0
        assert result.current_stock == 110.0

    def test_confidence_bounded_0_to_100(self):
        model = HoltCUSUMModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(10)]
        # Noisy data
        levels = [100.0, 300.0, 50.0, 400.0, 20.0, 500.0, 10.0, 600.0, 5.0, 700.0]
        result = model.fit(ts, levels)
        assert 0.0 <= result.confidence <= 100.0
        assert 0.0 <= result.r_squared <= 1.0

    def test_projected_stock_non_negative(self):
        """Projected stock in 5 cycles should never go below 0."""
        model = HoltCUSUMModel()
        ts = [datetime(2026, 1, 1, i, tzinfo=timezone.utc) for i in range(20)]
        # Rapidly declining — would project negative without floor
        levels = [100.0 - i * 10 for i in range(20)]
        result = model.fit(ts, levels)
        assert result.projected_stock_in_5_cycles >= 0.0

    def test_trend_result_has_step_change_default(self):
        """TrendResult can be constructed without step_change_detected (default False)."""
        tr = TrendResult(
            slope=1.0,
            r_squared=0.9,
            confidence=90.0,
            projected_stock_in_5_cycles=500.0,
            current_stock=450.0,
        )
        assert tr.step_change_detected is False


# ---------------------------------------------------------------------------
# Smooth proportional controller tests (via optimize_allocations)
# ---------------------------------------------------------------------------

class TestBudgetOptimizer:
    def test_critical_sector_gets_boosted(self):
        """A sector well below target gets more than drain (proportional ramp)."""
        trends = {}
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            if sector_id == "Avengers Compound":
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
        avengers_drain = BASE_DRAIN_RATES["Medical Kits"]
        assert allocations[avengers_key] > avengers_drain + 0.01

    def test_all_at_target_allocations_equal_drain(self):
        """When all stocks are at target with zero slope, every allocation == drain."""
        trends = {}
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            trends[key] = TrendResult(
                slope=0.0,
                r_squared=0.9,
                confidence=90.0,
                projected_stock_in_5_cycles=cfg["target_stock"],
                current_stock=cfg["target_stock"],
            )
        allocations = optimize_allocations(trends, RESOURCE_CONFIG)
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            drain = BASE_DRAIN_RATES.get(resource_type, cfg["base_production"])
            assert abs(allocations[key] - drain) < 0.01, (
                f"{key}: allocation {allocations[key]:.2f} should equal drain {drain}"
            )

    def test_declining_sector_gets_more_than_drain(self):
        """A sector with stock below target gets allocated more than its drain rate."""
        trends = {}
        for (sector_id, resource_type), cfg in RESOURCE_CONFIG.items():
            key = _sector_key(sector_id, resource_type)
            if sector_id == "Avengers Compound":
                trends[key] = TrendResult(
                    slope=-10.0,
                    r_squared=0.9,
                    confidence=90.0,
                    projected_stock_in_5_cycles=cfg["target_stock"] * 0.4,
                    current_stock=cfg["target_stock"] * 0.5,
                )
            else:
                trends[key] = TrendResult(
                    slope=0.0,
                    r_squared=0.9,
                    confidence=90.0,
                    projected_stock_in_5_cycles=cfg["target_stock"],
                    current_stock=cfg["target_stock"],
                )
        allocations = optimize_allocations(trends, RESOURCE_CONFIG)
        avengers_key = _sector_key("Avengers Compound", "Medical Kits")
        drain = BASE_DRAIN_RATES["Medical Kits"]
        assert allocations[avengers_key] > drain + 0.01, (
            f"Below-target sector should get more than drain rate {drain}, "
            f"got {allocations[avengers_key]:.2f}"
        )


# ---------------------------------------------------------------------------
# solve_simple unit tests (recovery-target controller)
# ---------------------------------------------------------------------------

class TestSolveSimple:
    def _make_trend(self, current_stock, slope=0.0):
        return TrendResult(
            slope=slope,
            r_squared=0.9,
            confidence=90.0,
            projected_stock_in_5_cycles=current_stock + 5 * slope,
            current_stock=current_stock,
        )

    def _solve_one(self, sid, rt, current_stock, slope=0.0):
        """Helper: run solve_simple for a single sector and return its allocation."""
        cfg = RESOURCE_CONFIG[(sid, rt)]
        key = f"{sid}|{rt}"
        trends = {key: self._make_trend(current_stock, slope)}
        result = solve_simple(
            trends=trends,
            config={(sid, rt): cfg},
            drain_rates={},
            total_budget=TOTAL_BUDGET,
        )
        return result[key]

    def test_at_target_returns_drain(self):
        """Stock at target with zero slope -> u = drain (exact break-even)."""
        sid, rt = "Avengers Compound", "Medical Kits"
        drain = BASE_DRAIN_RATES[rt]
        u = self._solve_one(sid, rt, RESOURCE_CONFIG[(sid, rt)]["target_stock"])
        assert abs(u - drain) < 0.01, (
            f"At target: expected drain {drain}, got {u:.2f}"
        )

    def test_50pct_below_target_capped_at_2x_drain(self):
        """Stock 50% below target -> recovery formula wants drain+60 but capped at 2x drain."""
        sid, rt = "Avengers Compound", "Medical Kits"
        drain = BASE_DRAIN_RATES[rt]  # 12.75
        target = RESOURCE_CONFIG[(sid, rt)]["target_stock"]  # 600
        u = self._solve_one(sid, rt, target * 0.5)
        # Uncapped: drain + 300/5 = 72.75, but capped at 2x drain = 25.5
        expected = drain * 2.0
        assert abs(u - expected) < 0.01, (
            f"50% below target: expected capped {expected:.2f}, got {u:.2f}"
        )

    def test_above_target_bleeds_off(self):
        """Stock above target -> u < drain (bleeding off surplus)."""
        sid, rt = "Avengers Compound", "Medical Kits"
        target = RESOURCE_CONFIG[(sid, rt)]["target_stock"]  # 600
        drain = BASE_DRAIN_RATES[rt]  # 12.75
        u = self._solve_one(sid, rt, target * 1.5)
        # projected = 900, surplus = 300
        # bleed_off = 300 / 10 = 30
        # u = max(0, 12.75 - 30) = 0
        assert u < drain, (
            f"Above target: expected u < drain {drain}, got {u:.2f}"
        )

    def test_way_above_target_approaches_zero(self):
        """Stock far above target -> u clamped to 0 (max bleed-off exceeds drain)."""
        sid, rt = "Avengers Compound", "Medical Kits"
        target = RESOURCE_CONFIG[(sid, rt)]["target_stock"]
        u = self._solve_one(sid, rt, target * 5.0)
        # projected = 3000, surplus = 2400
        # bleed_off = 2400 / 10 = 240 >> drain 12.75
        # u = max(0, 12.75 - 240) = 0
        assert u == 0.0, f"Way above target: expected 0, got {u:.2f}"

    def test_negative_slope_increases_allocation(self):
        """Negative slope (declining stock) increases u via 1-step lookahead."""
        sid, rt = "Avengers Compound", "Medical Kits"
        target = RESOURCE_CONFIG[(sid, rt)]["target_stock"]
        # Stock at target but declining fast -> projected is below target
        u_flat = self._solve_one(sid, rt, target, slope=0.0)
        u_declining = self._solve_one(sid, rt, target, slope=-50.0)
        assert u_declining > u_flat + 0.01, (
            f"Declining slope should produce higher allocation: "
            f"flat={u_flat:.2f}, declining={u_declining:.2f}"
        )

    def test_all_keys_present(self):
        """solve_simple returns a key for every sector in config."""
        trends = {}
        for (sid, rt), cfg in RESOURCE_CONFIG.items():
            key = f"{sid}|{rt}"
            trends[key] = self._make_trend(cfg["target_stock"])
        result = solve_simple(
            trends=trends,
            config=RESOURCE_CONFIG,
            drain_rates={},
            total_budget=TOTAL_BUDGET,
        )
        for (sid, rt) in RESOURCE_CONFIG:
            key = f"{sid}|{rt}"
            assert key in result

    def test_missing_trend_uses_target_as_current(self):
        """If a sector has no trend data, current defaults to target -> u = drain."""
        sid, rt = "Avengers Compound", "Medical Kits"
        cfg = RESOURCE_CONFIG[(sid, rt)]
        key = f"{sid}|{rt}"
        drain = BASE_DRAIN_RATES[rt]
        result = solve_simple(
            trends={},
            config={(sid, rt): cfg},
            drain_rates={},
            total_budget=TOTAL_BUDGET,
        )
        assert abs(result[key] - drain) < 0.01, (
            f"No trend data: expected drain {drain}, got {result[key]:.2f}"
        )

    def test_dead_zone_returns_drain(self):
        """Stock within 2% of target -> u = drain (no correction)."""
        sid, rt = "Avengers Compound", "Medical Kits"
        target = RESOURCE_CONFIG[(sid, rt)]["target_stock"]  # 600
        drain = BASE_DRAIN_RATES[rt]
        # 1% below target = 594, well within 2% dead zone
        u = self._solve_one(sid, rt, target * 0.99)
        assert abs(u - drain) < 0.01, (
            f"Inside dead zone: expected drain {drain}, got {u:.2f}"
        )

    def test_backward_compat_alias(self):
        """solve_mpc alias works for backward compatibility."""
        from app.services.strategies.mpc_optimizer import solve_mpc
        assert solve_mpc is solve_simple


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

    def test_champion_wins_applies_fresh_allocations(self):
        gov = Governor()
        champ = ModelSnapshot(
            trained_at=datetime.now(timezone.utc),
            data_points=100,
            overall_confidence=90.0,
            allocations={"a": 5.0, "b": 10.0},
        )
        gov.champion = champ

        worse = ModelSnapshot(
            trained_at=datetime.now(timezone.utc),
            data_points=200,
            overall_confidence=60.0,
            allocations={"a": 8.0, "b": 3.0},
        )
        gov._promote(worse)
        assert gov.champion is champ
        assert gov.challenger is None
        # Fresh allocations and data_points must be applied even though champion won
        assert gov.champion.allocations == {"a": 8.0, "b": 3.0}
        assert gov.champion.data_points == 200

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
        assert action.total_budget_used <= TOTAL_BUDGET + 1.0  # solver tolerance


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
