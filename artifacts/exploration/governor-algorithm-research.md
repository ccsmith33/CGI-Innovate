# Governor Algorithm Research Brief

> **Context**: The CGI governor runs a 30-second ML feedback control loop allocating a $1M/cycle budget across 25 slots (5 sectors x 5 resource types). The current implementation uses linear regression on the last 20 DB rows and a hand-crafted urgency formula. This brief evaluates replacement approaches.

---

## 1. Control Theory Alternatives

### PID Controller (Proportional-Integral-Derivative)

PID computes a control signal from the weighted sum of the current error (P), accumulated past error (I), and rate of error change (D). Each of the 25 resource slots would get its own PID loop tracking `(target_stock - current_stock)`.

**Pros:**
- Extremely simple to implement (< 30 lines per loop)
- Sub-millisecond computation; no solver overhead
- Derivative term naturally detects rate-of-change (slope), replacing linear regression
- Well-understood tuning methods (Ziegler-Nichols, Cohen-Coon)

**Cons:**
- No constraint handling: PID outputs can exceed budget or go negative; requires external clamping
- No cross-resource awareness: 25 independent PID loops cannot coordinate a shared budget
- No lookahead: purely reactive, cannot predict "if I boost now, where will stock be in 5 cycles?"
- Integral windup risk when stocks are clamped at ceiling/floor for extended periods
- Tuning 25 independent loops (75 gains: Kp, Ki, Kd each) is tedious

**Verdict**: Too simplistic for a multi-resource budget-constrained problem. Would require a budget arbitration layer on top, which recreates the current hand-crafted approach.

### Model Predictive Control (MPC)

MPC solves an optimization problem at each cycle: given a model of the system dynamics, find the sequence of control actions over a finite horizon (e.g., 5-10 cycles ahead) that minimizes a cost function subject to constraints. Only the first action is applied; the rest are discarded and re-optimized next cycle.

**Pros:**
- Native constraint handling: budget cap, min/max production rates, and cross-resource dependencies are all encoded as constraints
- Lookahead: explicitly projects "if I set production=X, where will stocks be in N cycles?" -- directly solves Problem #4
- Handles coupled resources (dependency penalties from state.py) as cross-constraints
- Naturally adapts to changing conditions each cycle (receding horizon)
- Can incorporate a disturbance model for snap events
- For 25 decision variables with linear/quadratic costs, solves in 1-10ms via OSQP or ECOS

**Cons:**
- Requires a system dynamics model (stock[t+1] = stock[t] + production - drain - random)
- Model mismatch degrades performance; needs periodic re-identification
- More complex to implement than PID (~100-200 lines + cvxpy setup)
- Debugging "why did it choose this allocation?" is harder than a hand-crafted formula

**Verdict**: Strong fit. The resource allocation problem is naturally a constrained optimization, and 25 variables is trivially small for modern solvers. MPC directly addresses all four stated problems.

**Libraries**: `cvxpy` (modeling) + `OSQP` or `ECOS` (solvers), or `do-mpc` for a full MPC framework.

### LQR (Linear Quadratic Regulator)

LQR computes a static optimal gain matrix K such that `u = -K * x` minimizes a quadratic cost over an infinite horizon. It assumes a linear system with no constraints.

**Pros:**
- Closed-form solution (solve Riccati equation once); near-zero runtime cost
- Optimal for linear unconstrained systems
- Handles MIMO (multi-input multi-output) naturally

**Cons:**
- No constraint handling at all: cannot enforce budget caps, min/max rates, or non-negativity
- Assumes linear time-invariant dynamics, but dependency penalties and snap events make this system nonlinear and time-varying
- Infinite-horizon assumption is poor fit for a system where conditions change every 10 seconds
- Requires accurate A, B matrices (system identification) that stay valid

**Verdict**: Poor fit. The hard budget constraint and nonlinear dependency penalties disqualify LQR without significant modifications (which would effectively turn it into MPC).

**Libraries**: `python-control` (`control.lqr()`), `scipy.linalg.solve_continuous_are`.

---

## 2. Reinforcement Learning Approaches

### Q-Learning / DQN

Discretizes the action space (e.g., production levels in 10-unit increments) and learns a value function Q(state, action) mapping resource states to optimal allocation decisions.

**Pros:**
- Model-free: no need to specify system dynamics
- Can discover non-obvious allocation strategies
- Off-policy: can learn from historical data

**Cons:**
- Action space explosion: even coarse discretization of 25 continuous allocation slots creates an astronomically large action space (e.g., 10 levels^25 = 10^25 actions)
- Requires thousands to millions of episodes to converge; real-time training on 30s cycles is infeasible
- No constraint guarantees: must learn budget feasibility through penalty rewards, which is unreliable

**Verdict**: Not viable for this problem without pre-training in simulation, and even then the action space is too large.

### PPO (Proximal Policy Optimization)

On-policy actor-critic method that learns a continuous policy. Handles continuous action spaces naturally.

**Pros:**
- Continuous action space: outputs 25 production rates directly
- Stable training (clipped objective prevents large policy updates)
- State-of-the-art for many control tasks

**Cons:**
- Sample-inefficient: requires 100K-1M+ environment steps to converge
- On-policy: cannot reuse past data, needs fresh rollouts each update
- Training latency: even with a simulation environment, initial convergence takes hours
- No hard constraint guarantees on budget feasibility
- Black-box: explaining "why did it boost Medical Kits?" is nearly impossible

**Verdict**: Overkill for a 25-variable optimization. The problem structure (linear dynamics, convex constraints) makes model-based approaches strictly superior.

### SAC (Soft Actor-Critic)

Off-policy actor-critic with entropy regularization. More sample-efficient than PPO.

**Pros:**
- Most sample-efficient model-free RL algorithm
- Off-policy: can learn from replay buffer, reuse historical data
- Continuous action space with stochastic exploration
- Good at handling multi-objective trade-offs

**Cons:**
- Still requires ~10K-50K episodes for a 25-dimensional problem
- No constraint handling (same as PPO)
- Hyperparameter sensitivity (entropy coefficient, learning rates, network architecture)
- Adds significant infrastructure: replay buffer, twin critics, target networks
- Latency: neural network forward pass (~1-5ms) vs. cvxpy solve (~1-10ms) with no convergence guarantees

**Verdict**: Interesting for a research extension but provides no advantage over MPC for this problem. The convex structure of the allocation problem means an optimal solution exists and can be found directly.

### RL Summary

All RL approaches share a fundamental mismatch: the governor's problem is a constrained convex optimization with known dynamics. RL excels when dynamics are unknown or highly nonlinear. Here, we know the dynamics (stock = stock + production - drain), the constraints (budget, min/max rates), and the objective (keep stocks near targets). Using RL for this is like using a neural network to compute `2 + 2`.

RL could be valuable as a **meta-controller** that tunes MPC parameters (weights, horizon length) over longer time scales, but not as the primary allocator.

---

## 3. Time-Series Models (Replacing Linear Regression)

The current `TrendModel` fits `sklearn.LinearRegression` on 20 data points indexed by cycle number. This section evaluates replacements for better short-series forecasting and step-change detection.

### EWMA (Exponentially Weighted Moving Average)

Computes a smoothed estimate where recent points get exponentially more weight: `S[t] = alpha * x[t] + (1-alpha) * S[t-1]`.

**Pros:**
- O(1) update per new data point; no refitting needed
- Single parameter (alpha/lambda) to tune
- Naturally adapts to level shifts faster than linear regression
- EWMA-based control charts detect small mean shifts (1-sigma) in ~10 observations
- Trivial to implement (3 lines of code)

**Cons:**
- No trend component: only estimates the current level, not the slope
- Cannot project "stock in 5 cycles" without extension (Double EWMA / Holt method)
- No seasonality handling (not needed here)

**Verdict**: Excellent as a building block. Double EWMA (Holt's method) provides both level and trend, replacing linear regression with better responsiveness to recent data.

### Holt-Winters (Triple Exponential Smoothing)

Extends EWMA with trend and seasonal components. Three smoothing equations for level, trend, and seasonality.

**Pros:**
- Captures level + trend + seasonality in one model
- Well-supported in `statsmodels.tsa.holtwinters`
- Good for periodic patterns

**Cons:**
- Seasonality is irrelevant (resource cycles have no weekly/daily pattern)
- Requires 2+ full seasonal periods of data to fit; with 20 points this limits seasonal period to ~10
- Heavier than EWMA for no benefit in this use case
- Slower fitting than EWMA (~5-20ms for 20 points)

**Verdict**: Overfit for this problem. Holt's method (double exponential smoothing, no seasonality) is the sweet spot.

### ARIMA

Auto-Regressive Integrated Moving Average model. ARIMA(p,d,q) with p=AR order, d=differencing, q=MA order.

**Pros:**
- Theoretically more powerful than exponential smoothing for complex autocorrelation structures
- Can capture mean-reverting behavior (useful when governor is actively correcting)
- Automatic order selection via `pmdarima.auto_arima`

**Cons:**
- Requires stationarity or differencing, which is fragile with only 20 points
- Auto-ARIMA fitting takes 50-200ms (too slow for 25 fits per 30s cycle = 5-10 seconds)
- Prone to overfitting on short series
- More complex to diagnose and tune than exponential smoothing

**Verdict**: Too slow and fragile for 20-point series updated every 30 seconds. Linear regression is actually better than ARIMA for this data length.

### Prophet

Facebook's additive regression model for time series with strong seasonal effects and trend changes.

**Pros:**
- Automatic changepoint detection
- Handles missing data and outliers
- Intuitive decomposition (trend + seasonality + holidays)

**Cons:**
- Designed for daily/weekly/yearly patterns with 100+ data points minimum
- Fitting time: 1-5 seconds per series (catastrophically slow for 25 x per cycle)
- Massive dependency (Stan/cmdstanpy backend)
- Completely wrong tool for 20-point sub-minute data

**Verdict**: Disqualified. Prophet is for long-horizon business forecasting, not real-time control with 20 data points.

### CUSUM (Cumulative Sum) for Step-Change Detection

CUSUM accumulates the sum of deviations from a reference value. A change is flagged when the cumulative sum exceeds a threshold.

**Pros:**
- O(1) update per point; perfect for streaming
- Detects small persistent shifts that linear regression misses
- Well-studied statistical properties (known ARL: Average Run Length)
- Can detect both upward and downward shifts (two-sided CUSUM)
- Directly addresses Problem #1 (missing step changes / snap events)

**Cons:**
- Only detects shifts in mean, not changes in trend slope
- Threshold tuning affects sensitivity vs. false alarm trade-off
- Does not produce a forecast; only signals "something changed"

**Verdict**: Excellent complement to EWMA/Holt for snap event detection. Use CUSUM as a change detector that triggers model reset / urgency boost.

**Libraries**: `ocpdet` (CUSUM + EWMA detectors), `ruptures` (offline changepoint detection), or trivial 10-line implementation.

### Recommendation for Trend Estimation

**Replace linear regression with Double EWMA (Holt's method) + CUSUM**:
- Holt's method gives level + trend with O(1) updates (alpha=0.3, beta=0.1 as starting points)
- CUSUM runs in parallel to detect step changes (snap events)
- When CUSUM fires, reset the Holt smoother to fast-adapt to the new level
- Total computation: < 0.1ms per resource slot

---

## 4. Portfolio Optimization Analogy

The governor is allocating a fixed budget across 25 "assets" (resource slots) where each asset has a "return" (production) and "risk" (depletion probability). This maps well to portfolio theory.

### Mean-Variance Optimization (Markowitz)

Minimize portfolio variance (risk of depletion) for a target return (maintaining stock targets), subject to budget constraint.

**Pros:**
- Exact analogy: budget = total capital, allocation per resource = portfolio weight
- Naturally handles the budget constraint as the "fully invested" constraint
- Covariance between resources captures dependency penalties (Vibranium failure affecting Arc Reactor)
- Efficient frontier shows the trade-off between "average stock health" and "worst-case depletion risk"
- Solves via quadratic programming (same solvers as MPC: cvxpy + OSQP)

**Cons:**
- Assumes normally distributed returns; resource depletion is skewed (snap events create fat tails)
- Static: no dynamics model, no lookahead, no receding horizon
- Covariance estimation from 20 points is noisy
- Does not model the dynamics (stock[t+1] = f(stock[t], allocation))

**Verdict**: The budget-constraint structure maps well, but the lack of dynamics makes this inferior to MPC. However, the risk-parity concept (equalize risk contribution across resources) is a useful heuristic for the urgency formula.

### Kelly Criterion

Determines the optimal fraction of budget to allocate to each "bet" to maximize long-run geometric growth. In resource terms: how much to invest in each resource to maximize the probability all resources stay above critical thresholds.

**Pros:**
- Theoretically optimal for long-run growth
- Simple formula for independent bets: f* = (p*b - q) / b where p=win probability, b=odds, q=1-p
- Naturally risk-aware: Kelly never recommends "all-in" on any single resource

**Cons:**
- Assumes independent bets; resources have dependency penalties (violations of independence)
- Requires accurate probability estimates of depletion (hard with 20 data points)
- Full Kelly is aggressive; fractional Kelly (e.g., half-Kelly) is typically used in practice
- Does not account for dynamics or time horizon

**Verdict**: Interesting heuristic for setting allocation proportions, but not a full solution. Could inform the urgency weights in a simpler allocator.

### Risk-Parity

Allocate budget so that each resource contributes equally to total portfolio risk (probability of critical depletion).

**Pros:**
- Robust: no resource dominates the risk budget
- Simple implementation: weight inversely proportional to volatility
- Naturally prevents over-concentration on "noisy" resources

**Cons:**
- Does not optimize for a target; only equalizes risk
- Ignores that some resources are more critical than others (dependency penalties)

**Verdict**: Could be a useful fallback/baseline allocation when trend data is insufficient.

---

## 5. Final Recommendation

### Primary Recommendation: Linear MPC via CVXPY

**Algorithm**: Model Predictive Control with a linear dynamics model and quadratic cost function, solved as a convex quadratic program.

**Rationale**:

1. **Direct problem fit**: The resource allocation problem IS a constrained optimization. MPC solves it as one, rather than approximating with heuristics.

2. **Addresses all four stated problems**:
   - **Problem 1 (linear regression misses oscillations)**: Replace with Holt's method + CUSUM for trend/level estimation that feeds the MPC state
   - **Problem 2 (brittle urgency formula)**: Eliminated entirely. The objective function (minimize deviation from target stocks) replaces hand-tuned weights
   - **Problem 3 (no feedback on previous cycle)**: MPC naturally uses current state as feedback; the receding horizon re-optimizes every cycle
   - **Problem 4 (no lookahead)**: MPC projects forward N cycles by construction

3. **Computational feasibility**: 25 decision variables with linear constraints solve in 1-10ms via OSQP. With a 30-second cycle, there is 29+ seconds of headroom.

4. **Constraint handling**: Budget cap, min/max production rates, non-negativity, and dependency penalties all become linear constraints. No post-hoc clamping or rebalancing needed.

5. **Transparency**: The optimization objective and constraints are explicit and auditable, unlike RL black boxes.

### Implementation Sketch

```
System dynamics:
  stock[t+1] = stock[t] + production[t] - drain[t] - disturbance[t]

Decision variables:
  production[t] for t = 0..H-1  (H = horizon, e.g., 5 cycles)
  25 variables per timestep = 125 total variables

Objective:
  minimize sum over t of:
    w_track * ||stock[t] - target||^2     # track target stock levels
    + w_effort * ||production[t]||^2       # penalize extreme production
    + w_smooth * ||production[t] - production[t-1]||^2  # smooth changes

Constraints:
  sum(production[t] * cost_per_unit) <= TOTAL_BUDGET   for each t
  0 <= production[t] <= 2 * drain_rate                 for each t, slot
  stock[t] >= 0                                        for each t, slot
  dependency penalties as linear inequality constraints
```

### Recommended Libraries

| Component | Library | Purpose |
|-----------|---------|---------|
| Optimization modeling | `cvxpy` (v1.4+) | Express MPC as convex QP |
| QP solver | `OSQP` (bundled with cvxpy) | Fast first-order solver, warm-starting |
| Trend estimation | Custom Holt's method (~30 lines) | Replace sklearn LinearRegression |
| Change detection | Custom CUSUM (~15 lines) | Detect snap events, trigger state reset |
| Fallback solver | `ECOS` (bundled with cvxpy) | Interior-point solver if OSQP fails |

### Migration Path

1. **Phase 1**: Replace `TrendModel` with Holt + CUSUM (standalone improvement, no MPC yet)
2. **Phase 2**: Replace `optimize_allocations()` with a cvxpy-based MPC solver
3. **Phase 3**: Tune horizon length, cost weights, and CUSUM thresholds via backtesting against historical feed data

### Alternative Considered: Multi-loop PID + Budget Arbiter

A simpler alternative would be 25 PID controllers with a budget arbitration layer. This would be faster to implement but:
- Requires tuning 75+ parameters (3 gains per loop)
- Budget arbitration re-introduces the hand-crafted heuristic problem
- No lookahead capability
- Recommended only if cvxpy is ruled out as a dependency

---

## References

- Boyd & Vandenberghe, *Convex Optimization* (2004) -- foundational text for MPC formulation
- CVXPY documentation: https://www.cvxpy.org/
- OSQP solver: https://osqp.org/ (MPC example: https://osqp.org/docs/examples/mpc.html)
- do-mpc toolbox: https://www.do-mpc.com/
- OCPDet (CUSUM/EWMA): https://github.com/vkhamesi/ocpdet
- Ruptures (changepoint detection): https://github.com/deepcharles/ruptures
- Python Control Systems Library: https://python-control.readthedocs.io/
- statsmodels Holt-Winters: https://www.statsmodels.org/stable/generated/statsmodels.tsa.holtwinters.ExponentialSmoothing.html
- Haber, *MPC Tutorial in Python*: https://aleksandarhaber.com/model-predictive-control-mpc-tutorial-1-unconstrained-formulation-derivation-and-implementation-in-python-from-scratch/
- O-RAN RL resource allocation study: https://arxiv.org/html/2412.01839
