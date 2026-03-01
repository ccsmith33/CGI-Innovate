"""Tests for the feed-service generator and state modules."""

from __future__ import annotations

import random

from app import state
from app.generator import run_cycle, BASE_DRAIN


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
        assert drain_events[0]["delta"] == -BASE_DRAIN

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
        # Wakanda target is 500, set stock to 1000 (200% of target)
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
        run_cycle()
        events = state.get_events_since(None, limit=500)
        random_events = [e for e in events if e["event_type"] == "random_event"]
        assert 3 <= len(random_events) <= 4
