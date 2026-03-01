RESOURCE_CONFIG = {
    ("Avengers Compound", "Medical Kits"): {
        "cost_per_unit": 1750,
        "target_stock": 600,
        "base_production": 8.0,
    },
    ("New Asgard", "Vibranium (kg)"): {
        "cost_per_unit": 4000,
        "target_stock": 300,
        "base_production": 3.0,
    },
    ("Sanctum Sanctorum", "Clean Water (L)"): {
        "cost_per_unit": 1000,
        "target_stock": 750,
        "base_production": 10.0,
    },
    ("Sokovia", "Pym Particles"): {
        "cost_per_unit": 4500,
        "target_stock": 420,
        "base_production": 5.0,
    },
    ("Wakanda", "Arc Reactor Cores"): {
        "cost_per_unit": 5000,
        "target_stock": 180,
        "base_production": 4.0,
    },
}
TOTAL_BUDGET = 1_000_000  # per cycle (testing)
MAINTENANCE_BUDGET = 950_000  # baseline, leaving $50K flex

# Drain rate per 3-second cycle, matching feed-service generator.py BASE_DRAIN_RATES
BASE_DRAIN_RATES: dict[str, float] = {
    "Medical Kits": 12.75,
    "Clean Water (L)": 15.75,
    "Vibranium (kg)": 4.8,
    "Pym Particles": 7.8,
    "Arc Reactor Cores": 6.3,
}
CYCLES_PER_HOUR: float = 1200.0  # one cycle every 3 seconds = 1200/hour
