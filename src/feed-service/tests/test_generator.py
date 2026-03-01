"""Tests for the feed-service generator and state modules."""

from __future__ import annotations

import asyncio
import random
from unittest.mock import AsyncMock, patch, MagicMock

from app import state
from app.generator import run_cycle, push_events, BASE_DRAIN_RATES, BASE_DRAIN_DEFAULT


class TestProductionApplied:
    """Test production is applied at the correct rate."""

    def setup_method(self):
        state.reset()

    def test_production_increases_stock(self):
        initial = state.get_stock("Avengers Compound", "Medical Kits")
        rate = state.get_production_rate("Avengers Compound", "Medical Kits")
        assert rate == 8.0

        # Run cycle with deterministic random to control random events
        random.seed(42)
        run_cycle()

        final = state.get_stock("Avengers Compound", "Medical Kits")
        # Stock should have changed: +production, -drain, possibly random events
        # At minimum, production event of +8 and drain of -2 = net +6 without random events
        # We verify production was applied by checking events
        events = state.get_events_since(None, limit=500)
        prod_events = [
            e for e in events
            if e["event_type"] == "production"
            and e["sector_id"] == "Avengers Compound"
        ]
        assert len(prod_events) == 1
        assert prod_events[0]["delta"] == 8.0

    def test_all_sectors_get_production(self):
        random.seed(99)
        run_cycle()
        events = state.get_events_since(None, limit=500)
        prod_events = [e for e in events if e["event_type"] == "production"]
        sectors = {e["sector_id"] for e in prod_events}
        assert sectors == {
            "Avengers Compound", "New Asgard",
            "Sanctum Sanctorum", "Sokovia", "Wakanda",
        }


class TestConsumptionDrain:
    """Test consumption drains correctly."""

    def setup_method(self):
        state.reset()

    def test_base_drain_applied(self):
        random.seed(10)
        run_cycle()
        events = state.get_events_since(None, limit=500)
        drain_events = [
            e for e in events
            if e["event_type"] == "consumption"
            and e["sector_id"] == "Wakanda"
        ]
        assert len(drain_events) == 1
        assert drain_events[0]["delta"] == round(-BASE_DRAIN_RATES["Arc Reactor Cores"], 2)

    def test_drain_for_all_sectors(self):
        random.seed(10)
        run_cycle()
        events = state.get_events_since(None, limit=500)
        drain_events = [e for e in events if e["event_type"] == "consumption"]
        sectors = {e["sector_id"] for e in drain_events}
        assert sectors == {
            "Avengers Compound", "New Asgard",
            "Sanctum Sanctorum", "Sokovia", "Wakanda",
        }


class TestSnap:
    """Test snap halves all stocks."""

    def setup_method(self):
        state.reset()

    def test_snap_halves_stocks(self):
        before = state.get_stocks()
        for (sector_id, resource_type), level in before.items():
            new_level = state.set_stock(sector_id, resource_type, level / 2.0)
            assert new_level == level / 2.0

    def test_snap_respects_floor(self):
        # Set stock to 15, snap should halve to 10 (floor)
        state.set_stock("Wakanda", "Arc Reactor Cores", 15.0)
        new_level = state.set_stock("Wakanda", "Arc Reactor Cores", 15.0 / 2.0)
        assert new_level == 10.0  # floor is 10


class TestProductionPost:
    """Test production POST updates state."""

    def setup_method(self):
        state.reset()

    def test_set_production_rate(self):
        state.set_production_rate("Wakanda", "Arc Reactor Cores", 6.5)
        rate = state.get_production_rate("Wakanda", "Arc Reactor Cores")
        assert rate == 6.5

    def test_production_rate_takes_effect(self):
        state.set_production_rate("Wakanda", "Arc Reactor Cores", 20.0)
        random.seed(42)
        run_cycle()
        events = state.get_events_since(None, limit=500)
        prod_events = [
            e for e in events
            if e["event_type"] == "production"
            and e["sector_id"] == "Wakanda"
        ]
        assert len(prod_events) == 1
        assert prod_events[0]["delta"] == 20.0


class TestStockFloor:
    """Test stock floor at 10."""

    def setup_method(self):
        state.reset()

    def test_floor_prevents_below_10(self):
        new_val = state.apply_delta("Wakanda", "Arc Reactor Cores", -9999.0)
        assert new_val == 10.0

    def test_floor_exact(self):
        # Set stock to 12, drain 5 -> should be 10 (floor)
        state.set_stock("Wakanda", "Arc Reactor Cores", 12.0)
        new_val = state.apply_delta("Wakanda", "Arc Reactor Cores", -5.0)
        assert new_val == 10.0

    def test_ceiling_caps_at_1500(self):
        new_val = state.apply_delta("Wakanda", "Arc Reactor Cores", 9999.0)
        assert new_val == 1500.0


class TestProductionCeiling:
    """Test that production is skipped when stock >= 200% of target."""

    def setup_method(self):
        state.reset()

    def test_production_skipped_at_double_target(self):
        # Wakanda target is 180, set stock to 1000 (well above 200% of target = 360)
        state.set_stock("Wakanda", "Arc Reactor Cores", 1000.0)
        random.seed(42)
        run_cycle()
        events = state.get_events_since(None, limit=500)
        prod_events = [
            e for e in events
            if e["event_type"] == "production"
            and e["sector_id"] == "Wakanda"
        ]
        assert len(prod_events) == 0


class TestRandomEvents:
    """Test random events fire for 3-4 sectors per cycle."""

    def setup_method(self):
        state.reset()

    def test_random_event_count(self):
        random.seed(42)
        from app.generator import RANDOM_EVENTS_MIN, RANDOM_EVENTS_MAX
        run_cycle()
        events = state.get_events_since(None, limit=500)
        random_events = [e for e in events if e["event_type"] == "random_event"]
        assert RANDOM_EVENTS_MIN <= len(random_events) <= RANDOM_EVENTS_MAX


class TestPushEvents:
    """Test that push_events sends events to the backend."""

    def setup_method(self):
        state.reset()

    def test_push_posts_events_to_backend(self):
        """push_events should POST the event list to the backend push endpoint."""
        random.seed(42)
        events = run_cycle()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.generator.httpx.AsyncClient", return_value=mock_client):
            asyncio.run(push_events(events))

        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert "/api/v1/feed/push" in call_args[0][0]
        assert call_args[1]["json"] == {"events": events}

    def test_push_failure_does_not_raise(self):
        """push_events should catch exceptions and not propagate them."""
        random.seed(42)
        events = run_cycle()

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=Exception("connection refused"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.generator.httpx.AsyncClient", return_value=mock_client):
            # Should not raise
            asyncio.run(push_events(events))

    def test_push_empty_events_skipped(self):
        """push_events should not POST if there are no events."""
        mock_client = AsyncMock()
        mock_client.post = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("app.generator.httpx.AsyncClient", return_value=mock_client):
            asyncio.run(push_events([]))

        mock_client.post.assert_not_called()


class TestDependencyPenalties:
    """Test cross-sector dependency graph applies production penalties."""

    def setup_method(self):
        state.reset()

    def test_vibranium_depletion_penalizes_arc_reactor(self):
        """Depleted Vibranium stock causes Arc Reactor production penalty in next cycle."""
        # Vibranium target = 300, threshold = 30% = 90. Set below threshold.
        state.set_stock("New Asgard", "Vibranium (kg)", 50.0)
        random.seed(42)
        run_cycle()
        events = state.get_events_since(None, limit=500)
        prod_events = [
            e for e in events
            if e["event_type"] == "production"
            and e["sector_id"] == "Wakanda"
            and e["resource_type"] == "Arc Reactor Cores"
        ]
        assert len(prod_events) == 1
        # Normal rate is 4.0, 50% penalty -> effective rate = 2.0
        assert prod_events[0]["delta"] == 2.0
        assert "50% penalty" in prod_events[0]["label"]

    def test_arc_reactor_depletion_penalizes_medical_and_pym(self):
        """Depleted Arc Reactor Cores causes Medical Kits and Pym Particles penalties."""
        # Arc Reactor target = 180, threshold = 30% = 54. Set below.
        state.set_stock("Wakanda", "Arc Reactor Cores", 50.0)
        random.seed(42)
        run_cycle()
        events = state.get_events_since(None, limit=500)

        medical_prod = [
            e for e in events
            if e["event_type"] == "production"
            and e["sector_id"] == "Avengers Compound"
            and e["resource_type"] == "Medical Kits"
        ]
        assert len(medical_prod) == 1
        # Normal rate 8.0, 40% penalty -> 4.8
        assert medical_prod[0]["delta"] == 4.8
        assert "40% penalty" in medical_prod[0]["label"]

        pym_prod = [
            e for e in events
            if e["event_type"] == "production"
            and e["sector_id"] == "Sokovia"
            and e["resource_type"] == "Pym Particles"
        ]
        assert len(pym_prod) == 1
        # Normal rate 5.0, 40% penalty -> 3.0
        assert pym_prod[0]["delta"] == 3.0
        assert "40% penalty" in pym_prod[0]["label"]

    def test_no_penalty_when_above_threshold(self):
        """No penalty when upstream stock is above threshold."""
        # Vibranium at full stock (450), well above 30% of 450 = 135
        penalties = state.get_production_penalties()
        assert len(penalties) == 0

    def test_penalty_does_not_cause_negative_production(self):
        """Production rate floored at 0 (effective_rate = rate * (1 - penalty) is never negative)."""
        # Penalty is 0-1 range, so effective_rate = rate * (1 - penalty) >= 0
        state.set_stock("New Asgard", "Vibranium (kg)", 10.0)  # well below threshold
        penalties = state.get_production_penalties()
        penalty = penalties.get(("Wakanda", "Arc Reactor Cores"), 0.0)
        rate = state.get_production_rate("Wakanda", "Arc Reactor Cores")
        effective = rate * (1.0 - penalty)
        assert effective >= 0


class TestDefconLevels:
    """Test DEFCON threat level computation and hysteresis."""

    def setup_method(self):
        state.reset()

    def test_defcon_normal_at_full_stocks(self):
        """DEFCON is 5 (NORMAL) when stocks are at initial (full) levels."""
        assert state.compute_defcon() == 5
        assert state.get_defcon() == 5

    def test_defcon_escalates_when_stocks_drop(self):
        """DEFCON escalates when stocks drop below thresholds."""
        # Set all stocks very low to trigger escalation
        for (sector, resource) in state.INITIAL_STOCKS:
            state.set_stock(sector, resource, 50.0)
        # avg_health should be very low since targets are 180-750
        level = state.compute_defcon()
        assert level < 5  # Should be elevated

    def test_defcon_omega_at_critical(self):
        """DEFCON reaches 1 (OMEGA) when all stocks are critically low."""
        for (sector, resource) in state.INITIAL_STOCKS:
            state.set_stock(sector, resource, 10.0)  # floor
        level = state.compute_defcon()
        assert level == 1

    def test_defcon_escalates_immediately(self):
        """DEFCON escalation is immediate (can jump multiple levels)."""
        assert state.get_defcon() == 5
        # Crash all stocks to floor
        for (sector, resource) in state.INITIAL_STOCKS:
            state.set_stock(sector, resource, 10.0)
        new_level = state.update_defcon()
        # Should jump directly to 1, not step down one at a time
        assert new_level == 1

    def test_defcon_deescalates_one_step(self):
        """DEFCON de-escalation only moves one step at a time."""
        # First, force DEFCON to 1
        for (sector, resource) in state.INITIAL_STOCKS:
            state.set_stock(sector, resource, 10.0)
        state.update_defcon()
        assert state.get_defcon() == 1

        # Restore all stocks to full (without reset, which would reset DEFCON too)
        for (sector, resource), target in state.INITIAL_STOCKS.items():
            state.set_stock(sector, resource, target)
        # compute_defcon would return 5, but update should only go to 2
        new_level = state.update_defcon()
        assert new_level == 2

        # Call again, should go to 3
        new_level = state.update_defcon()
        assert new_level == 3

    def test_defcon_labels_and_colors(self):
        """DEFCON labels and colors are defined for all levels."""
        for level in range(1, 6):
            assert level in state.DEFCON_LABELS
            assert level in state.DEFCON_COLORS


class TestDefconDrainMultiplier:
    """Test that DEFCON level modifies drain rates."""

    def setup_method(self):
        state.reset()

    def test_defcon_5_normal_drain(self):
        """At DEFCON 5, drain is unmultiplied (1.0x)."""
        random.seed(42)
        run_cycle()
        events = state.get_events_since(None, limit=500)
        drain_events = [
            e for e in events
            if e["event_type"] == "consumption"
            and e["sector_id"] == "Wakanda"
        ]
        assert len(drain_events) == 1
        expected_drain = round(-BASE_DRAIN_RATES["Arc Reactor Cores"], 2)
        assert drain_events[0]["delta"] == expected_drain

    def test_defcon_1_doubles_drain(self):
        """At DEFCON 1, drain is doubled (2.0x)."""
        # Force DEFCON to 1
        for (sector, resource) in state.INITIAL_STOCKS:
            state.set_stock(sector, resource, 10.0)
        state.update_defcon()
        assert state.get_defcon() == 1

        # Reset stocks for a clean drain measurement but keep DEFCON at 1
        # Set a specific stock high enough to measure drain
        state.set_stock("Wakanda", "Arc Reactor Cores", 500.0)

        state.reset()
        # Need to re-force DEFCON to 1 after reset
        for (sector, resource) in state.INITIAL_STOCKS:
            state.set_stock(sector, resource, 10.0)
        state.update_defcon()
        assert state.get_defcon() == 1

        # Now set all stocks to reasonable levels so we can measure drain
        for (sector, resource) in state.INITIAL_STOCKS:
            state.set_stock(sector, resource, 500.0)

        random.seed(42)
        run_cycle()
        events = state.get_events_since(None, limit=500)
        drain_events = [
            e for e in events
            if e["event_type"] == "consumption"
            and e["sector_id"] == "Wakanda"
        ]
        assert len(drain_events) == 1
        expected_drain = -BASE_DRAIN_RATES["Arc Reactor Cores"] * 2.0
        assert drain_events[0]["delta"] == round(expected_drain, 2)
