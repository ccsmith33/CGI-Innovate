# Complex Systems Innovations -- Research Report

> **Researcher**: researcher-systems
> **Date**: 2026-02-28
> **Context**: Feed-service simulation with 5 sector/resource pairs, cycle-based updates (10s), independent sectors, simple random events, Governor ML allocating $100k budget.

---

## Current System Analysis

The feed-service simulation (`src/feed-service/app/generator.py`) runs a simple cycle-based loop:

1. **Production** -- each sector produces at a fixed rate (set by Governor allocation)
2. **Base drain** -- each resource has a constant consumption rate per cycle
3. **Random events** -- 1-2 random sectors receive consumption/resupply deltas per cycle

**Key limitations:**
- Sectors are completely independent -- no cross-sector interactions
- Events are stateless random draws with no narrative or escalation
- No concept of threat level, crisis severity, or systemic stress
- No supply chain dependencies (Medical Kits do not depend on Clean Water; Arc Reactor Cores do not power anything)
- The simulation feels like 5 independent random walks, not a living crisis

---

## Innovation #1: Cross-Sector Dependency Graph (Cascading Failures)

**Rank: 1 -- Highest Impact**

### Mechanics

Define a directed dependency graph between the 5 sector/resource pairs. When a resource drops below a critical threshold in one sector, it degrades production or increases consumption in dependent sectors. This creates cascading failures where a single shortage propagates through the system.

**Proposed dependency graph:**

```
Arc Reactor Cores (Wakanda) --powers--> Medical Kits production (Avengers Compound)
Arc Reactor Cores (Wakanda) --powers--> Pym Particles production (Sokovia)
Clean Water (Sanctum Sanctorum) --required-for--> Medical Kits production (Avengers Compound)
Vibranium (New Asgard) --material-for--> Arc Reactor Cores production (Wakanda)
Clean Water (Sanctum Sanctorum) --sustains--> all sectors (increases drain when scarce)
```

When Arc Reactor Cores drop below 30% of target stock, Medical Kits and Pym Particles production rates are multiplied by a degradation factor (e.g., 0.5). When Vibranium drops below 25%, Arc Reactor Core production degrades -- creating a two-hop cascade: Vibranium shortage -> Arc Reactor shortage -> Medical Kit + Pym Particle shortage.

### Implementation Approach

```python
DEPENDENCY_GRAPH = {
    ("Avengers Compound", "Medical Kits"): [
        {"source": ("Wakanda", "Arc Reactor Cores"), "threshold": 0.30, "effect": "production_multiplier", "value": 0.5},
        {"source": ("Sanctum Sanctorum", "Clean Water (L)"), "threshold": 0.25, "effect": "production_multiplier", "value": 0.6},
    ],
    ("Sokovia", "Pym Particles"): [
        {"source": ("Wakanda", "Arc Reactor Cores"), "threshold": 0.30, "effect": "production_multiplier", "value": 0.5},
    ],
    ("Wakanda", "Arc Reactor Cores"): [
        {"source": ("New Asgard", "Vibranium (kg)"), "threshold": 0.25, "effect": "production_multiplier", "value": 0.4},
    ],
}
```

In `run_cycle()`, before the production step, iterate the dependency graph. For each dependency where the source stock is below `threshold * target_stock`, apply the production multiplier. Generate a `cascade_event` with a descriptive label like "Power shortage in Wakanda degrades Medical Kit production."

**Effort**: Low-medium. The dependency graph is a static dict. The cascade check is ~20 lines of code added to `run_cycle()`. New `cascade_event` type flows through existing event pipeline.

### Judge Impact

This is the single most impressive complex-systems feature. It transforms the simulation from "5 independent meters" into "an interconnected system where everything affects everything." Judges will immediately see cascading failures propagate across sectors. It creates genuine strategic tension for the Governor ML -- should it prioritize upstream resources (Vibranium, Arc Reactor Cores) to prevent downstream cascades?

---

## Innovation #2: DEFCON Threat Level Escalation System

**Rank: 2**

### Mechanics

Implement a 5-level threat escalation system inspired by the real U.S. DEFCON system (but inverted for intuition -- DEFCON 5 is peace, DEFCON 1 is nuclear war). The threat level is computed from aggregate system health and changes simulation behavior at each level.

**Proposed levels:**

| Level | Name | Color | Trigger Condition | Simulation Effect |
|-------|------|-------|-------------------|-------------------|
| 5 | NORMAL | Green | All sectors > 60% target | Standard production/drain |
| 4 | ELEVATED | Blue | Any sector < 50% target | +10% base drain globally (stress response) |
| 3 | HIGH | Yellow | 2+ sectors < 40% OR 1 cascade active | +25% drain, random events frequency doubles |
| 2 | CRITICAL | Orange | 3+ sectors < 30% OR 2+ cascades | +50% drain, production efficiency -20%, emergency events trigger |
| 1 | OMEGA | Red | Any sector hits floor (10 units) OR 4+ sectors < 25% | Drain doubles, production halved, "total crisis" mode |

The threat level is recalculated each cycle. Transitions generate distinctive events ("THREAT LEVEL ESCALATED TO DEFCON 3: HIGH"). De-escalation is slower than escalation (hysteresis) -- you need sustained recovery before the level drops.

### Implementation Approach

Add a `ThreatLevel` enum and a `compute_threat_level()` function that evaluates current stocks against thresholds. Store the current level in `state.py`. In `run_cycle()`, apply level-specific modifiers to drain rates and production. Emit `threat_level_change` events when the level transitions.

The frontend receives threat level via the existing event stream. The Command Center header can display a DEFCON-style badge with color and level. The resource charts can show shaded background bands indicating when the system was at different threat levels.

**Effort**: Low. Enum + threshold computation + modifier application in the cycle loop. Frontend display is a single badge component.

### Judge Impact

DEFCON levels are universally understood and visually dramatic. The badge in the header tells the story at a glance. Watching the level escalate from NORMAL to OMEGA during a live demo -- especially when triggered by cascading failures from Innovation #1 -- creates genuine tension. The hysteresis mechanic (slow de-escalation) prevents jarring oscillation and feels realistic.

---

## Innovation #3: Scripted Crisis Scenarios ("Injects")

**Rank: 3**

### Mechanics

Define named crisis scenarios as scripted event sequences that unfold over multiple cycles. Each scenario has a trigger condition (or can be manually activated), a sequence of "injects" (timed events), and narrative labels that tell a story.

**Proposed scenarios:**

1. **Thanos Incursion** -- A 5-cycle escalating crisis. Cycle 1: Vibranium supply disrupted (-40% stock in New Asgard). Cycle 2: Arc Reactor production falters (cascade from Vibranium). Cycle 3: "The Snap" -- all sectors lose 50% stock simultaneously. Cycle 4-5: Recovery phase with boosted resupply events.

2. **Hydra Sabotage** -- Targeted attack on a single sector. One sector's production drops to zero for 3 cycles while drain increases 3x. Other sectors must compensate.

3. **Pandemic Surge** -- Medical Kits and Clean Water demand spikes globally. All sectors' drain for these resources triples for 4 cycles. Pym Particles and Arc Reactor Cores unaffected, creating resource prioritization pressure.

4. **Convoy Ambush** -- A major resupply convoy is destroyed. One random resupply event generates negative deltas instead of positive for 2 cycles. Narrative: "Hydra intercepted the supply convoy en route to Sokovia."

5. **Stark Tech Breakthrough** -- Positive scenario. Arc Reactor Core production doubles for 3 cycles, creating a downstream cascade of improved production in dependent sectors.

### Implementation Approach

```python
SCENARIOS = {
    "thanos_incursion": {
        "name": "Thanos Incursion",
        "duration_cycles": 5,
        "injects": [
            {"cycle": 1, "target": ("New Asgard", "Vibranium (kg)"), "effect": "stock_multiply", "value": 0.6, "label": "Vibranium mines compromised by Thanos forces"},
            {"cycle": 3, "target": "ALL", "effect": "stock_multiply", "value": 0.5, "label": "THE SNAP -- half of all resources vanish"},
            {"cycle": 4, "target": "ALL", "effect": "resupply_boost", "value": 2.0, "label": "Emergency mobilization -- Avengers rally"},
        ],
    },
    # ...
}
```

Add a `ScenarioEngine` that tracks active scenarios and their current cycle offset. Each `run_cycle()` checks for pending injects and applies them. Scenarios can be triggered via an API endpoint (`POST /api/v1/simulation/scenario`) or automatically when certain conditions are met (e.g., Thanos Incursion triggers when system has been at DEFCON 5 for 10+ cycles -- "peace doesn't last").

### Judge Impact

Scenarios transform the demo from "watch random numbers change" into "watch a story unfold." The presenter can say "Let me trigger the Thanos Incursion" and the audience watches the system go from stable to crisis over 50 seconds (5 cycles at 10s each). Combined with cascading failures and DEFCON levels, a scenario creates a compelling narrative arc: peace -> disruption -> cascade -> crisis -> recovery.

---

## Innovation #4: Emergent Sector Behaviors (Hoarding and Rationing)

**Rank: 4**

### Mechanics

Give each sector agent-like behavioral rules that create emergent dynamics:

- **Hoarding**: When a sector detects its stock dropping toward a threshold (e.g., < 40% target), it reduces its "exports" (production available to dependent sectors) and increases its own consumption buffer. This means a sector under stress becomes selfish, making cascading failures more severe for downstream sectors.

- **Rationing**: When a sector enters critical status (< 20% target), its drain rate drops by 50% as it enters "rationing mode." This creates a natural stabilization mechanism but at the cost of reduced operational effectiveness (represented by a new "operational_effectiveness" metric that drops during rationing).

- **Panic buying**: When DEFCON level increases, all sectors' base drain temporarily spikes (simulating panic stockpiling), which paradoxically accelerates the crisis -- a realistic emergent behavior seen in real supply chain disruptions.

### Implementation Approach

Add per-sector state tracking for `behavior_mode` (NORMAL, HOARDING, RATIONING). Compute mode transitions based on stock thresholds each cycle. Modify drain/production values based on mode. Emit `behavior_change` events.

The key insight is that these behaviors create feedback loops: a sector starts hoarding, which reduces supply to dependent sectors, which causes them to start hoarding too -- a contagion effect that emerges from simple per-sector rules without being explicitly programmed.

**Effort**: Medium. Requires per-sector behavioral state and mode-dependent modifiers. The feedback loops are emergent from the interaction of simple rules.

### Judge Impact

Emergent behavior is the hallmark of sophisticated simulation. When a judge asks "why did Sokovia suddenly crash?" and the answer is "Wakanda started hoarding Arc Reactor Cores because Vibranium was running low, which cut Sokovia's power supply, which triggered Sokovia's own rationing mode" -- that demonstrates genuine systems thinking. The simulation tells a story that was not explicitly scripted.

---

## Innovation #5: Discrete Event Simulation (DES) Engine with SimPy

**Rank: 5**

### Mechanics

Replace the fixed 10-second cycle-based loop with a proper discrete-event simulation engine using SimPy. Events occur at irregular intervals driven by the simulation clock rather than wall clock. This enables more realistic temporal dynamics:

- Supply convoys arrive at variable intervals (Poisson-distributed)
- Production is a continuous process with variable output rates
- Crises have realistic temporal profiles (rapid onset, slow recovery)
- Events can schedule future events (a "supply convoy departure" at t=0 schedules "convoy arrival" at t+5)

### Implementation Approach

SimPy provides `simpy.Environment`, `simpy.Resource`, and `simpy.Process` primitives. Each sector becomes a SimPy process that produces, consumes, and responds to events. The simulation runs faster than real-time internally and emits state snapshots at regular intervals for the frontend.

```python
import simpy

def sector_process(env, sector_id, resource_type, shared_state):
    while True:
        # Production occurs at variable intervals
        yield env.timeout(random.expovariate(1.0 / production_interval))
        shared_state.produce(sector_id, resource_type, amount)

        # Check for cascade effects from dependencies
        for dep in get_dependencies(sector_id, resource_type):
            if shared_state.is_below_threshold(dep):
                # Degrade our production
                amount *= dependency_degradation_factor
```

**Caveat**: This is a significant refactor of the feed-service. The current cycle-based architecture is simple and works. SimPy would add significant complexity for modest visible benefit. The main advantage is temporal realism (events at irregular intervals rather than fixed 10s ticks).

**Effort**: High. Requires rewriting the feed-service core loop and state management. SimPy is an additional dependency.

### Judge Impact

Moderate. A SimPy-based simulation is technically impressive to judges who understand simulation engineering, but the visible difference from the audience perspective is subtle -- events arrive at irregular intervals instead of every 10 seconds. The ROI is lower than innovations #1-4 which create visible, dramatic behavioral changes.

---

## Innovation #6: System Health Metrics and Resilience Scoring

**Rank: 6**

### Mechanics

Compute real-time aggregate metrics that quantify the overall system health beyond individual stock levels:

- **System Resilience Index (SRI)**: A 0-100 score computed from: stock headroom across all sectors, dependency chain health (are upstream resources healthy?), recovery rate after disruptions, and diversity of supply (how many sectors can produce a given resource type).

- **Cascade Risk Score**: For each sector, compute the probability that its failure would trigger cascading failures in N other sectors. High cascade risk sectors are "systemic" -- their failure would be disproportionately damaging.

- **Recovery Time Estimate**: When the system is in crisis, estimate how many cycles until stocks return to target levels given current production rates and drain. This gives the Governor ML a planning horizon.

### Implementation Approach

Add a `metrics.py` module in the feed-service that computes these metrics from current state each cycle. Expose via a `/api/v1/simulation/metrics` endpoint. Frontend renders as gauge charts or a single "System Health" indicator.

The Cascade Risk Score is computed by simulating "what if sector X drops to zero?" against the dependency graph and counting affected downstream sectors. This is a lightweight graph traversal, not a full simulation.

**Effort**: Low-medium. Pure computation on existing state. No changes to the simulation loop.

### Judge Impact

These metrics tell a sophisticated story. A "System Resilience Index: 34/100" with a "Cascade Risk: HIGH for Wakanda Arc Reactors" communicates complexity and analytical depth. It also provides natural integration points with the Governor ML -- the ML system could optimize for resilience rather than just stock levels.

---

## Innovation #7: Multi-Agent Governor Competition

**Rank: 7**

### Mechanics

Instead of a single Governor ML allocating the budget, introduce competing allocation strategies that vie for control:

- **Conservative Governor**: Prioritizes maintaining all sectors above critical thresholds. Spreads budget evenly.
- **Aggressive Governor**: Concentrates budget on the highest-value resources (by cost per unit) and lets cheap resources fluctuate.
- **Cascade-Aware Governor**: Prioritizes upstream resources in the dependency graph to prevent cascading failures.

The system runs a "champion/challenger" tournament where the active Governor's performance is measured by the System Resilience Index. If the challenger outperforms the champion over N cycles, it takes over. This creates visible competition and strategic adaptation.

### Implementation Approach

This extends the existing Governor champion/challenger architecture. Add a `CascadeAwareStrategy` that weights allocations by cascade risk score (from Innovation #6). The tournament mechanism already exists -- this adds a new dimension to what "performance" means (resilience vs. raw stock levels).

**Effort**: Medium. Requires the dependency graph (Innovation #1) and cascade risk metrics (Innovation #6) as prerequisites. The strategy itself is a new allocation algorithm.

### Judge Impact

Watching two AI strategies compete to manage a crisis -- and seeing the system switch strategies when one outperforms the other -- is a compelling narrative. "The Conservative Governor couldn't handle the Thanos Incursion, so the system switched to the Cascade-Aware Governor, which prioritized Vibranium and Arc Reactors to prevent downstream failures." This demonstrates adaptive AI and self-healing systems.

---

## Top 3 Recommendations

### 1. Cross-Sector Dependency Graph with Cascading Failures (Innovation #1)

**This is the foundation.** Without cross-sector dependencies, the simulation is 5 independent random walks. With dependencies, every other innovation becomes more meaningful. Cascading failures create the systemic complexity that makes DEFCON levels dramatic, scenarios compelling, and emergent behaviors possible.

**Implementation priority**: First. All other innovations build on this.

### 2. DEFCON Threat Level Escalation System (Innovation #2)

**This is the storytelling layer.** A single badge in the header that changes from green to red tells the entire system story at a glance. Combined with cascading failures, the DEFCON level provides a legible narrative: "We're at DEFCON 3 because Vibranium shortages cascaded into Arc Reactor failures." It also modifies simulation dynamics, creating a feedback loop where crisis begets more crisis.

**Implementation priority**: Second. Depends on stock state but not on the dependency graph -- can be built in parallel.

### 3. Scripted Crisis Scenarios (Innovation #3)

**This is the demo weapon.** In a 5-minute presentation, the ability to say "Watch what happens when Thanos attacks" and have a multi-cycle crisis unfold with cascading failures, escalating DEFCON levels, and sector behavioral responses -- that is unforgettable. Scenarios are the orchestration layer that ties all other innovations into a coherent narrative.

**Implementation priority**: Third. Benefits enormously from #1 and #2 being in place, as scenarios trigger cascades which trigger DEFCON escalation.

---

## Implementation Dependency Order

```
Innovation #1 (Dependencies) ──┐
                                ├──> Innovation #3 (Scenarios)
Innovation #2 (DEFCON Levels) ──┘         │
                                          v
Innovation #4 (Emergent Behaviors) ──> Innovation #6 (Metrics)
                                          │
                                          v
                                Innovation #7 (Multi-Agent Governor)

Innovation #5 (SimPy DES) -- independent but low ROI, defer
```

**Recommended build order**: #1 -> #2 (parallel) -> #3 -> #4 -> #6 -> #7

Innovation #5 (SimPy) is deliberately ranked low. The cycle-based architecture is simple, works well, and the visible benefit of DES is minimal compared to the behavioral innovations above. The 10-second cycle interval already creates a satisfying real-time pace for demos.
