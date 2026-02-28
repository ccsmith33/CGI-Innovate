# Story 4: Jarvis ML (Forecasting)

## Status
Ready for Development

## Dependencies
- Story 1 (The Vault) must be complete -- needs resource_logs data and forecast model/schema
- Can run in parallel with Story 3 (Jarvis LLM) -- no shared code dependencies

## Objective
Implement the ML forecasting service using the Strategy pattern. The default strategy is snap-aware linear regression: filter out snap_event_detected=True rows, fit OLS linear regression on the remaining data, and calculate Time-to-Zero (predicted exhaustion date). Expose forecasts via REST endpoints and provide a refresh trigger to recompute all forecasts.

## D-ID References
- D-003: Strategy pattern for ML forecasting
- D-011: Snap-aware regression as default ML strategy (filter snap rows before fitting)

## Acceptance Criteria
- [ ] Snap-flagged rows are filtered out before regression fitting
- [ ] Time-to-Zero prediction is within +/-5% of expected value for synthetic test data with known slope
- [ ] When slope >= 0 (stock stable or increasing), exhaustion date is None
- [ ] R-squared (confidence) is computed and stored with the forecast
- [ ] GET /api/v1/forecasts returns forecasts for all sector+resource combinations
- [ ] GET /api/v1/forecasts/{sector}/{resource_type} returns a specific forecast
- [ ] POST /api/v1/forecasts/refresh recomputes all forecasts and returns 202
- [ ] All forecast tests pass

## Dev Notes

### File Paths
Create or modify inside `src/backend/`:

```
app/services/strategies/
  __init__.py                     # NEW
  base.py                         # NEW: ForecastingStrategy ABC + ForecastResult dataclass
  linear_regression.py            # NEW: LinearRegressionStrategy
  snap_aware.py                   # NEW: SnapAwareLinearRegression (default)
app/services/jarvis_forecast.py   # NEW: ForecastService orchestrator + strategy registry
app/routers/forecasts.py          # NEW: forecast REST endpoints
app/schemas/forecast.py           # NEW: Pydantic schemas for forecast responses
tests/test_jarvis_forecast.py     # NEW: unit + integration tests
```

Update:
```
app/main.py                       # Register forecasts router
```

### Key Implementation Details

#### app/services/strategies/base.py

```python
from abc import ABC, abstractmethod
from datetime import datetime
from dataclasses import dataclass

@dataclass
class ForecastResult:
    predicted_exhaustion_date: datetime | None
    hours_until_exhaustion: float | None
    confidence: float              # R-squared [0, 1]
    strategy_name: str
    snap_detected: bool

class ForecastingStrategy(ABC):
    @abstractmethod
    def fit(self, timestamps: list[datetime], stock_levels: list[float], snap_flags: list[bool] | None = None) -> None:
        ...

    @abstractmethod
    def predict_exhaustion_date(self) -> ForecastResult:
        ...

    def get_trend_line(self) -> list[dict]:
        """Return list of {timestamp: str, predicted_stock: float} for chart overlay."""
        ...
```

#### app/services/strategies/linear_regression.py

**LinearRegressionStrategy:**
- `fit()`:
  1. Convert timestamps to numeric: hours since first timestamp
  2. Use scikit-learn `LinearRegression` from `sklearn.linear_model`
  3. Fit on `X = hours.reshape(-1, 1)`, `y = stock_levels`
  4. Store `slope` (coef_[0]), `intercept` (intercept_), compute R-squared via `model.score()`
  5. Store last timestamp and last stock level for Time-to-Zero calculation

- `predict_exhaustion_date()`:
  1. If slope >= 0: return ForecastResult with `predicted_exhaustion_date=None`, `hours_until_exhaustion=None`
  2. Compute time-to-zero: solve `slope * h + intercept = 0` -> `h = -intercept / slope`
  3. Convert `h` (hours from first timestamp) back to datetime: `first_timestamp + timedelta(hours=h)`
  4. Compute `hours_until_exhaustion` relative to last timestamp: `exhaustion_date - last_timestamp` in hours
  5. Return ForecastResult

- `get_trend_line()`:
  - Generate predicted values at each input timestamp plus extrapolated points up to exhaustion date
  - Return list of dicts: `{"timestamp": iso_string, "predicted_stock": float}`

#### app/services/strategies/snap_aware.py

**SnapAwareLinearRegression:**
- Wraps `LinearRegressionStrategy` via composition (not inheritance)
- `fit()`:
  1. If snap_flags provided, filter out rows where `snap_flag=True`
  2. Track whether any snap was detected (`self._snap_detected = True`)
  3. Delegate filtered timestamps + stock_levels to inner `LinearRegressionStrategy.fit()`
- `predict_exhaustion_date()`:
  1. Get result from inner strategy
  2. Override `snap_detected` and `strategy_name` fields
  3. Return modified ForecastResult

#### app/services/jarvis_forecast.py

**Strategy Registry:**
```python
STRATEGY_REGISTRY = {
    "linear_regression": LinearRegressionStrategy,
    "snap_aware_linear_regression": SnapAwareLinearRegression,
}
DEFAULT_STRATEGY = "snap_aware_linear_regression"
```

**ForecastService:**
```python
class ForecastService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def compute_forecast(self, sector_id: str, resource_type: str, strategy_name: str | None = None) -> ForecastResult:
        # 1. Query resource_logs for this sector+resource, ordered by timestamp
        # 2. Instantiate strategy via registry
        # 3. Call strategy.fit(timestamps, stock_levels, snap_flags)
        # 4. Call strategy.predict_exhaustion_date()
        # 5. Upsert into forecasts table (delete old forecast for same sector+resource, insert new)
        # 6. Return ForecastResult

    async def compute_all_forecasts(self, strategy_name: str | None = None) -> list[ForecastResult]:
        # 1. Get all distinct (sector_id, resource_type) pairs from resource_logs
        # 2. For each pair, call compute_forecast()
        # 3. Return list of results
```

#### app/schemas/forecast.py
- `ForecastResponse`: `id, sector_id, resource_type, predicted_exhaustion_date, hours_until_exhaustion, confidence, strategy_used, snap_detected, computed_at`
- `ForecastListResponse`: `data: list[ForecastResponse]`
- `ForecastRefreshResponse`: `message: str`, `strategy: str`

#### app/routers/forecasts.py
- `GET /api/v1/forecasts` -> query forecasts table, return latest forecast per sector+resource (use subquery on max computed_at)
- `GET /api/v1/forecasts/{sector}/{resource_type}` -> single forecast or 404
- `POST /api/v1/forecasts/refresh` -> call `ForecastService.compute_all_forecasts()`, return 202 with `{"message": "Forecast refresh initiated", "strategy": DEFAULT_STRATEGY}`

### Test Requirements

**tests/test_jarvis_forecast.py:**

- `test_linear_regression_synthetic_data`: Create synthetic data with known slope=-2.0 and intercept=100.0 (50 hours to zero). Fit LinearRegressionStrategy. Assert predicted exhaustion is within 5% of expected.

- `test_snap_filtering`: Create data with 2 snap-flagged rows that are outliers (50% drop). Fit SnapAwareLinearRegression. Assert snap rows are excluded and prediction matches non-snap trend.

- `test_slope_positive_no_exhaustion`: Create data with positive slope (stock increasing). Assert `predicted_exhaustion_date is None` and `hours_until_exhaustion is None`.

- `test_r_squared_computed`: After fit, assert 0 <= confidence <= 1.

- `test_forecast_router_list`: GET /api/v1/forecasts -> 200, returns data array (after seeding forecasts).

- `test_forecast_router_specific`: GET /api/v1/forecasts/Wakanda/Arc%20Reactor%20Cores -> 200 or 404 depending on data.

- `test_forecast_refresh`: POST /api/v1/forecasts/refresh -> 202, verify forecasts table has new rows.

## Estimated Scope
L (Large) -- core ML logic + strategy pattern + service orchestrator + REST endpoints
