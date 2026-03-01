# AI/ML Innovation Research Report

> **Author**: researcher-ai
> **Date**: 2026-02-28
> **Scope**: Advanced intelligence, predictive systems, autonomous decision-making for Project Sentinel

---

## Current State Analysis

Project Sentinel currently has:

- **Governor**: A Champion/Challenger/Backup model pattern that fits linear regressions on 20 data points per sector, computes urgency scores, and allocates a $100K production budget across 5 sector/resource pairs. The promotion logic is simple confidence comparison.
- **Forecasting**: Strategy pattern with 4 strategies -- linear regression, polynomial regression, exponential decay, and snap-aware linear regression. All are classical curve-fitting approaches using scikit-learn.
- **Anomaly Detection**: IsolationForest with fixed 5% contamination on stock levels only (univariate).
- **LLM Integration**: JARVIS chat with OpenAI tool-calling loop (up to 5 rounds) for querying forecasts, anomalies, intel reports, and resource history. Entity extraction from field reports via structured JSON schema.
- **Feed Service**: Cycle-based simulation (10s intervals) with production, base drain, and random events.

The system is solid but the AI/ML layer is essentially **classical statistics + a chatbot**. There is enormous room for techniques that would be visually impressive, technically deep, and demonstrably intelligent to judges.

---

## Innovation Ideas (Ranked by Wow Factor)

### 1. Reinforcement Learning Governor (MUST-HAVE)

**What it does**: Replace the heuristic urgency-score allocation with a trained RL agent (e.g., Proximal Policy Optimization or DQN) that learns an optimal budget allocation policy by interacting with the simulation environment. The agent's state is the vector of [stock_level, consumption_rate, trend_slope, snap_detected] per sector. Its action is a continuous allocation vector (production units per sector) constrained to the $100K budget. The reward function penalizes sectors falling below critical thresholds and rewards maintaining stable stock levels near targets.

**Why it's impressive**: RL is the gold standard for sequential decision-making under uncertainty. Judges see a system that *learns from its own mistakes* rather than following fixed rules. The before/after comparison (heuristic vs RL) is a killer demo moment -- show the RL agent discovering non-obvious strategies like preemptively boosting production before a predicted demand spike.

**Technical approach**:
- Use Stable Baselines3 (PPO or SAC for continuous action spaces)
- The feed-service simulation is already a perfect Gym-compatible environment -- wrap it with a `gymnasium.Env` interface
- State: 5 sectors x 4 features = 20-dim vector
- Action: 5-dim continuous allocation vector, softmax-normalized to budget constraint
- Reward: `-sum(max(0, target - stock)^2)` penalizing deficits, bonus for stability
- Pre-train offline on historical data, then fine-tune in live simulation
- Display the RL agent's learned value function as a heatmap on the dashboard

**Complexity**: Medium-High. Stable Baselines3 handles the heavy lifting. The main work is wrapping the simulation as a Gym environment and tuning the reward function. ~8-12 hours for a working prototype.

**Visual surface**: Show a "Governor Brain" panel with the RL policy's value landscape, action confidence, and episode reward curve. Display "Why did I do this?" explanations derived from SHAP values on the policy network.

---

### 2. Autonomous Planning Agent with Memory and Reasoning (MUST-HAVE)

**What it does**: Upgrade JARVIS from a reactive chatbot to an autonomous agent that continuously monitors system state, formulates multi-step plans, executes them via tool calls, and maintains persistent memory of what worked and what didn't. The agent runs on a background loop: observe -> reason -> plan -> act -> reflect.

Key capabilities:
- **Proactive alerting**: JARVIS notices a concerning trend (e.g., Wakanda Arc Reactor Cores consumption spiking) before the user asks, generates a situation report, and proposes action plans
- **Multi-step reasoning**: When asked "What should we do about the Vibranium shortage?", JARVIS chains tool calls (check current stock -> check consumption trend -> check forecast -> check intel reports for relevant threats -> check what Governor is currently allocating -> propose override)
- **Memory**: JARVIS remembers past interactions, past decisions, and their outcomes. "Last time we boosted Sokovia production, it stabilized in 4 cycles" informs future recommendations
- **Self-critique**: After proposing an action, JARVIS runs a second pass asking "What could go wrong?" and surfaces risks

**Why it's impressive**: This is the frontier of LLM applications. Judges see an AI that thinks, plans, remembers, and self-corrects -- not just answers questions. The "agent loop" pattern (ReAct/Plan-and-Solve) is one of the hottest topics in AI engineering. Streaming the agent's chain-of-thought live to the frontend is deeply compelling.

**Technical approach**:
- Use Claude API (Anthropic) or OpenAI with tool_use for the agent loop
- Implement a ReAct-style agent: Thought -> Action -> Observation -> Thought loop
- Add a memory store (simple key-value in PostgreSQL or Redis) for persistent cross-session memory
- Background task in FastAPI runs the agent loop every 30-60 seconds
- New tool: `execute_governor_override` lets JARVIS directly adjust allocations (with human approval gate)
- New tool: `create_situation_report` generates structured SITREP documents
- Stream the agent's reasoning chain to the frontend via SSE (Server-Sent Events)

**Complexity**: Medium. The JARVIS chat infrastructure already exists. Main additions are the background loop, memory store, and streaming. ~6-10 hours.

**Visual surface**: A "JARVIS Activity Feed" panel that streams the agent's real-time reasoning: "Observing: Wakanda stock dropped 12% in last hour... Analyzing: Checking consumption rate... Thinking: This exceeds normal variance by 2.3 sigma... Action: Recommending production boost..." This is the single most visually impressive AI feature possible.

---

### 3. Ensemble Forecast Competition with Live Leaderboard (MUST-HAVE)

**What it does**: Run all forecasting strategies simultaneously on every cycle, score their predictions against actual outcomes, and maintain a live leaderboard showing which model is winning. Add 2-3 new strategies (Temporal Fusion Transformer or N-BEATS, Bayesian regression with uncertainty intervals, and a moving-average baseline) to make the competition richer. The best-performing model automatically becomes the Governor's advisor.

**Why it's impressive**: Model competition is how real ML systems work (Kaggle, Netflix Prize, hedge funds). Judges see a live horse race between algorithms with automatic model selection -- this demonstrates genuine ML engineering sophistication, not just "we plugged in sklearn."

**Technical approach**:
- Add new strategy implementations:
  - **N-BEATS / NHiTS** (via Darts or NeuralForecast library): Neural network-based forecasting designed for time series. Uses backward/forward residual learning with interpretable trend+seasonality decomposition.
  - **Bayesian Linear Regression** (via scikit-learn BayesianRidge): Returns uncertainty intervals (credible intervals), not just point estimates. The width of the uncertainty band is itself a powerful signal.
  - **Simple Moving Average baseline**: A deliberately dumb model to make the competition fair and show the value of the smarter models.
- Scoring: After each cycle, compare each model's t-1 prediction against the actual stock level. Track MAE, RMSE, and MAPE per model per sector.
- Leaderboard stored in a new `model_scores` table.
- API endpoint: `GET /governor/leaderboard` returns ranked models with metrics.
- Governor uses the top-ranked model's forecast as input to allocation decisions.

**Complexity**: Medium. The Strategy pattern already supports this cleanly. The main work is implementing new strategies and the scoring/leaderboard logic. ~6-8 hours.

**Visual surface**: A "Model Arena" card on the dashboard showing ranked models with sparkline accuracy charts, colored win/loss streaks, and the current champion highlighted. Show prediction interval bands (from Bayesian model) overlaid on the resource chart -- judges can see uncertainty narrowing as data accumulates.

---

### 4. Causal Inference Engine for Root Cause Analysis

**What it does**: When an anomaly or crisis occurs (e.g., sudden stock drop in Sokovia), automatically determine *why* -- was it a consumption spike, a production failure, a snap event, or a correlated cascade from another sector? Uses Granger causality tests and structural causal models to find directed causal relationships between sectors.

**Why it's impressive**: Most dashboards show *what* happened. This one explains *why*. Causal inference is a step beyond correlation-based ML and signals deep technical understanding. Judges asking "why did this happen?" get a data-driven causal chain, not hand-waving.

**Technical approach**:
- Use `statsmodels.tsa.stattools.grangercausalitytests` to test pairwise Granger causality between sector stock level time series
- Build a directed causal graph: "Wakanda Arc Reactor consumption Granger-causes Sokovia Pym Particle depletion" (resource dependencies)
- When an anomaly is detected, trace backward through the causal graph to identify root causes
- Present results as a directed graph visualization on the frontend (D3.js force-directed graph or Mermaid diagram)
- Integrate with JARVIS: "Agent, why did Sokovia crash?" -> JARVIS queries the causal graph and narrates the chain

**Complexity**: Medium. Granger causality is well-supported in statsmodels. The visualization is the main frontend effort. ~5-7 hours.

**Visual surface**: A "Causal Map" panel showing directed arrows between sectors. When an anomaly fires, the causal chain lights up in red, tracing from root cause to effect. Clicking a link shows the Granger test statistics and confidence.

---

### 5. Anomaly Narration with LLM-Driven Situational Awareness

**What it does**: When the IsolationForest or any model detects an anomaly, automatically generate a natural-language "Intelligence Brief" that explains the anomaly in context: what happened, how unusual it is compared to historical patterns, which other sectors might be affected, and what actions are recommended. Stream these briefs to a live "Alert Feed" on the dashboard.

**Why it's impressive**: Raw anomaly scores (-0.23) mean nothing to non-ML judges. A narrative like "ALERT: Vibranium stocks in New Asgard dropped 34% in the last 2 hours -- 3.2 standard deviations below normal. Historical pattern suggests this precedes a supply chain disruption affecting downstream Pym Particle production. Recommend immediate production reallocation." -- that is viscerally impressive.

**Technical approach**:
- Enhance IsolationForest to also detect multivariate anomalies (cross-sector patterns)
- When anomaly triggers, gather context: current stocks, recent trends, sector correlations, active intel reports
- Feed structured context to LLM with a SITREP prompt template
- Stream the generated brief via SSE to a dedicated frontend panel
- Optionally, let JARVIS autonomously decide whether to act on the anomaly (with human confirmation)

**Complexity**: Low-Medium. The anomaly detection and LLM integration already exist. This is primarily a prompt engineering + frontend display task. ~4-6 hours.

**Visual surface**: A scrolling "COMMS Channel" feed of AI-generated intelligence briefs with severity color-coding, timestamp, affected sectors highlighted, and expandable details. Each brief includes a "JARVIS recommends..." action button.

---

### 6. Temporal Fusion Transformer (TFT) for Multi-Horizon Forecasting

**What it does**: Implement Google's Temporal Fusion Transformer -- a state-of-the-art deep learning model specifically designed for multi-horizon time series forecasting with interpretable attention. TFT produces not just point predictions but quantile forecasts (10th, 50th, 90th percentile), attention weights showing which past events matter most, and variable importance scores showing which features drive the forecast.

**Why it's impressive**: TFT is genuinely cutting-edge (top of leaderboards on M-competition benchmarks). The interpretability features are unique -- judges can see the model literally "paying attention" to specific past events (like a snap) that influenced its prediction. The quantile forecasts provide actionable uncertainty bounds.

**Technical approach**:
- Use the `pytorch-forecasting` or `darts` library (both have TFT implementations)
- Features per sector: stock_level, production_rate, consumption_rate, snap_detected, hour_of_day, sector_id (categorical)
- Train on historical data, predict multiple horizons: 1 cycle, 5 cycles, 20 cycles ahead
- Extract attention weights and display them as a heatmap ("the model is looking at these past events")
- Extract variable importance and display as a bar chart
- Add quantile prediction bands to the resource chart

**Complexity**: High. TFT requires PyTorch and careful data preprocessing. Training may need GPU or pre-trained weights. ~10-14 hours for a polished implementation, but a simplified version with Darts could be done in ~6-8 hours.

**Visual surface**: Resource charts with fan-shaped prediction intervals (narrow in the near term, widening further out). An "Attention Map" panel showing which historical data points the model considers most important for its current prediction. Variable importance bar chart.

---

### 7. Multi-Armed Bandit for Exploration-Exploitation in Resource Allocation

**What it does**: Frame the budget allocation problem as a contextual multi-armed bandit: each sector is an "arm", the context is the current system state, and the reward is resource stability. The bandit naturally balances exploitation (allocate to the sector we know needs it most) with exploration (occasionally try different allocations to discover better strategies). Use Thompson Sampling or Upper Confidence Bound (UCB).

**Why it's impressive**: Bandit algorithms are elegant and explainable. The exploration-exploitation tradeoff is intuitive even to non-technical judges. You can visualize the posterior distributions per sector, showing the system's uncertainty narrowing over time as it learns which allocations work best.

**Technical approach**:
- Implement contextual Thompson Sampling: maintain a Beta posterior per sector for "will this sector hit critical if we don't boost it?"
- Context features: current stock ratio (stock/target), trend slope, consumption rate
- On each cycle: sample from each sector's posterior, allocate proportional to sampled urgency
- Update posteriors based on whether the sector's stock improved or deteriorated
- Visualize posterior distributions as animated violin plots

**Complexity**: Low-Medium. Thompson Sampling is straightforward to implement from scratch (no heavy libraries needed). ~4-6 hours.

**Visual surface**: Animated "uncertainty bells" per sector that start wide and narrow as the system learns. Show the exploration/exploitation ratio over time. Highlight moments where the bandit "explored" and discovered something useful.

---

### 8. Federated Anomaly Detection Across Sectors

**What it does**: Instead of running IsolationForest independently per sector, implement a cross-sector anomaly detection system that finds correlated anomalies: "When Wakanda stock drops suddenly, Sokovia stock follows 2 cycles later." Uses a multivariate approach (Multivariate IsolationForest or DBSCAN on the joint stock vector) and a correlation matrix that updates in real-time.

**Why it's impressive**: Shows systems thinking -- individual anomalies are noise, correlated anomalies are signal. The correlation matrix updating live on the dashboard is a compelling visual. Detecting cascading failures before they propagate is a genuinely useful capability.

**Technical approach**:
- Run IsolationForest on the full 5-dimensional stock vector (all sectors jointly)
- Compute rolling Pearson correlation matrix between sector stock levels (window = 50 cycles)
- Flag "cascade alerts" when an anomaly in sector A is followed by correlated deviation in sector B within a window
- Visualize as a heatmap correlation matrix with pulsing cells when cascade is detected

**Complexity**: Low. Multivariate IsolationForest is a one-line change. Correlation matrix is simple numpy. ~3-5 hours.

**Visual surface**: A 5x5 correlation heatmap that updates live. Cascade alerts with animated arrows showing the propagation path between sectors.

---

## Top 3 Must-Have Recommendations

### Priority 1: Autonomous Planning Agent with Memory (#2)

**Rationale**: This is the highest-impact, most visible innovation. Every interaction with the system goes through JARVIS. An agent that proactively monitors, reasons out loud, and proposes actions turns the dashboard from a monitoring tool into a command center with genuine AI intelligence. The streaming chain-of-thought is the single most compelling demo moment. Implementation builds on existing JARVIS infrastructure.

### Priority 2: Ensemble Forecast Competition with Live Leaderboard (#3)

**Rationale**: Best ratio of implementation effort to impressiveness. The Strategy pattern already exists and is clean. Adding 2-3 new strategies + a scoring/leaderboard system shows real ML engineering rigor (model selection, evaluation, competition). The visual leaderboard is immediately understandable and engaging. Bayesian uncertainty intervals add a layer of sophistication to the charts.

### Priority 3: Reinforcement Learning Governor (#1)

**Rationale**: RL is the technically deepest innovation on this list. A system that literally learns to make better decisions by interacting with its own simulation is the kind of thing that wins hackathons. The before/after comparison (heuristic vs RL) is a compelling narrative. However, it's ranked third because it's the most complex to implement well and the hardest to debug under time pressure. If time permits, this is the feature that elevates the project from "very good" to "extraordinary."

---

## Implementation Priority Matrix

| Innovation | Wow Factor | Complexity | Hours Est. | Dependencies |
|---|---|---|---|---|
| Autonomous Planning Agent | 10/10 | Medium | 6-10h | Existing JARVIS chat |
| Ensemble Forecast Competition | 8/10 | Medium | 6-8h | Existing Strategy pattern |
| RL Governor | 10/10 | Medium-High | 8-12h | Feed service as Gym env |
| Causal Inference Engine | 7/10 | Medium | 5-7h | Stock level time series |
| Anomaly Narration | 7/10 | Low-Medium | 4-6h | Existing anomaly detection + LLM |
| TFT Forecasting | 9/10 | High | 6-14h | PyTorch, training data |
| Multi-Armed Bandit | 6/10 | Low-Medium | 4-6h | Current Governor |
| Federated Anomaly Detection | 6/10 | Low | 3-5h | Existing IsolationForest |

---

## Quick Wins (< 4 hours each)

These are smaller enhancements that amplify the impact of the major innovations:

1. **SHAP Explainability Layer**: Add SHAP value computation to any sklearn model and display feature importance charts. Shows the Governor "explaining" why it made each decision. (~2-3 hours)

2. **Confidence Calibration**: Track whether the Governor's confidence scores are actually predictive (calibration curve). Display a reliability diagram. (~2 hours)

3. **Drift Detection**: Implement Page-Hinkley or ADWIN drift detector on each sector's stock level distribution. Alert when the underlying data distribution shifts (e.g., after a snap). (~2-3 hours)

4. **Ensemble Averaging**: Simple model that averages predictions from all strategies (with inverse-MAE weighting). Often outperforms individual models. (~1-2 hours)
