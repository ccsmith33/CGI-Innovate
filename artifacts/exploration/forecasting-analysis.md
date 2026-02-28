# Forecasting Analysis: Resource Depletion Prediction

## 1. Data Summary

### Dataset Overview

| Property | Value |
|---|---|
| Total rows | 10,000 |
| Columns | `timestamp`, `sector_id`, `resource_type`, `stock_level`, `usage_rate_hourly`, `snap_event_detected` |
| Date range | 2026-01-01T00:00:00 to 2026-01-17T15:00:00 |
| Duration | ~400 hours (16.6 days) |
| Frequency | Hourly |
| Unique timestamps | 400 |
| Readings per timestamp | 25 (5 series x 5 sensor replicas) |

### Forecast Series (5 unique sector + resource combinations)

| Sector | Resource | Initial Stock | Depletion Rate (units/hr) | Status at End of Data |
|---|---|---|---|---|
| Avengers Compound | Medical Kits | 800 | ~2.29 | Depleted (zero at Jan 8 12:00) |
| New Asgard | Vibranium (kg) | 2,500 | ~4.90 | Active (~566 remaining) |
| Sanctum Sanctorum | Clean Water (L) | 2,500 | ~4.81 | Active (~733 remaining) |
| Sokovia | Pym Particles | 800 | ~2.31 | Depleted (zero at Jan 7 20:00) |
| Wakanda | Arc Reactor Cores | 800 | ~2.20 | Depleted (zero at Jan 7 14:00) |

### Data Structure: 5 Sensor Replicas

Each (sector, resource, timestamp) tuple has **5 rows** with slightly different `stock_level` values. These are sensor replicas providing redundant measurements. The developer should **average** these 5 readings per timestamp to get a single time series per combination before fitting any model.

After averaging: each series has **400 data points** at hourly intervals.

### Stock Level Characteristics

- Range: 0.00 to 2,500.00
- **Not monotonically decreasing**: ~40% of hourly transitions show small increases (noise)
- Overall trend is clearly linear downward
- Residual standard deviation from linear trend: 110-174 units (significant noise)
- 3 of 5 series have already hit zero and remain at zero (floor effect)

### Snap Event ("Thanos Snap")

- **When**: 2 timestamps -- 2026-01-01T19:00 and 2026-01-01T20:00 (hours 19-20)
- **Affected rows**: 39 out of 10,000 (0.39%)
- **Impact**: Sudden ~50% drop in stock levels across all sectors
  - New Asgard: 2406 -> 1683 (30% drop)
  - Sanctum Sanctorum: 2426 -> 1455 (40% drop)
  - Avengers Compound: 700 -> 423 (40% drop)
  - Sokovia: 710 -> 409 (42% drop)
  - Wakanda: 705 -> 425 (40% drop)
- **Recovery**: Stock levels jump back to pre-snap trajectory at hour 21
  - This means the Snap is a **transient anomaly**, not a permanent regime change
- **Flag distribution**: 4 of 5 sensor readings per combo are flagged True; 1 remains False (the "clean" reading)

### Key Insight: The Snap is Transient

The Snap causes a 2-hour dip followed by full recovery. It does NOT permanently alter the depletion trajectory. This means:
- Snap data points are **outliers** that should be excluded or down-weighted
- There is no need for regime-change detection or segmented models
- The `snap_event_detected` boolean column makes filtering trivial

---

## 2. Implementation Context

The Developer Implementation Guide specifies:
- **Jarvis layer**: "Create a function that takes the last 10-20 records of a specific resource and calculates a Time-to-Zero"
- **Data Integration Map**: CSV Data -> Linear Regression / Trend Analysis -> Predicted Exhaustion Date
- **Strategy tip**: "Your ML model should be robust enough to handle this anomaly"

This means the forecasting function:
1. Receives a sector_id and resource_type
2. Queries the last 10-20 averaged data points for that series
3. Fits a model to predict when stock_level reaches zero
4. Returns a predicted exhaustion date/time

---

## 3. Algorithm Comparison

### Evaluation Criteria

| Criterion | Weight | Description |
|---|---|---|
| Accuracy for depletion curves | High | How well does it fit a noisy downward linear trend? |
| Snap anomaly handling | High | Can it handle the 50% transient drop? |
| Time-to-Zero calculation | High | How easy to extrapolate to y=0? |
| Implementation complexity | Medium | Lines of code, dependencies, debugging effort |
| Hackathon feasibility | High | Can it be implemented and tested in hours? |

### Algorithm Comparison Table

| Algorithm | Accuracy | Snap Handling | Time-to-Zero | Complexity | Hackathon Feasibility | Overall |
|---|---|---|---|---|---|---|
| **Linear Regression** (OLS) | Good -- data is fundamentally linear | Poor -- Snap outliers skew slope | Trivial: t = -intercept/slope | Minimal (3-5 lines) | Excellent | 1st choice (with filtering) |
| **Weighted Linear Regression** | Good -- same linear fit | Good -- down-weight Snap points | Trivial: same formula | Low (10-15 lines) | Very Good | Strong 2nd |
| **Robust Regression** (Huber) | Good -- linear kernel | Excellent -- inherently down-weights outliers | Trivial: same formula | Low (5-8 lines, scikit-learn) | Very Good | Strong 2nd (tied) |
| **Exponential Smoothing** (Holt) | Adequate -- assumes exponential, data is linear | Moderate -- Snap bleeds into forecast | Complex: iterative root-finding | Medium (15-20 lines) | Good | 3rd / Fallback |
| **Polynomial Regression** (deg 2-3) | Risky -- overfits noise, unreliable extrapolation | Poor -- Snap amplified by polynomial | Dangerous: polynomial roots can be wildly wrong | Low (5-8 lines) | Poor (misleading results) | Not recommended |

### Detailed Assessment

#### 1. Linear Regression (OLS) -- RECOMMENDED (1st)

**Why it fits**: The data is fundamentally linear -- stock depletes at a roughly constant rate per hour. The Implementation Guide explicitly says "Linear Regression / Trend Analysis." With 10-20 recent data points (which will be far from the Snap event at hour 19-20), OLS is accurate and trivial to implement.

**Snap handling**: If the input window happens to include Snap data, OLS will be skewed. Solution: **filter out rows where `snap_event_detected=True` before fitting**. Since the column exists, this is a one-line filter.

**Strengths**:
- Simplest possible implementation
- Matches what evaluators expect (per the implementation guide)
- Time-to-Zero is a single division
- Easy to explain and debug

**Weaknesses**:
- Assumes constant depletion rate (true for this data)
- No built-in outlier resistance (mitigated by filtering)

#### 2. Weighted Linear Regression -- STRONG ALTERNATIVE

**Why**: Same as OLS but assigns lower weights to Snap-flagged points. Useful if you want to include all data rather than filtering.

**Snap handling**: Assign weight=0.0 (or near-zero) to `snap_event_detected=True` rows. Normal rows get weight=1.0.

**Strengths**:
- Uses all data, no information loss
- Graceful degradation if Snap flag is unreliable
- Still simple to implement

**Weaknesses**:
- Marginally more complex than filtering + OLS
- Weight tuning adds a decision point

#### 3. Robust Regression (HuberRegressor) -- STRONG ALTERNATIVE (tied 2nd)

**Why**: Huber loss automatically down-weights outliers without needing the `snap_event_detected` flag. This is the "smart" approach that handles anomalies the algorithm has never seen.

**Snap handling**: Built-in. Huber loss transitions from squared error (for inliers) to absolute error (for outliers), naturally reducing Snap influence.

**Strengths**:
- No manual filtering needed
- Handles unknown future anomalies automatically
- Impressive for evaluators ("robust to outliers")
- Simple scikit-learn API

**Weaknesses**:
- Requires scikit-learn dependency
- `epsilon` parameter may need tuning (default=1.35 usually fine)
- Slightly harder to explain than OLS

#### 4. Exponential Smoothing (Holt's Linear) -- FALLBACK

**Why**: Holt's method models level + trend, adapting to recent data. Could work for non-stationary depletion.

**Snap handling**: The smoothing window partially absorbs the Snap, but it will distort the level estimate for several periods after.

**Strengths**:
- Adapts to changing depletion rates
- Well-known time-series method

**Weaknesses**:
- Overkill: the data doesn't have changing depletion rates
- Time-to-Zero requires iterative forward projection (no closed-form)
- Alpha/beta parameter tuning
- Snap recovery causes persistent forecast error

#### 5. Polynomial Regression (degree 2-3) -- NOT RECOMMENDED

**Why not**: The data is linear. A polynomial will fit training data slightly better (overfitting noise), but extrapolation is dangerous -- a degree-2 polynomial can curve upward instead of reaching zero, or reach zero far too early.

**Snap handling**: Polynomials amplify outliers even more than OLS.

**Strengths**: None meaningful for this use case.

**Weaknesses**: Unstable extrapolation, overfitting, misleading Time-to-Zero predictions.

---

## 4. Snap Anomaly Handling Strategy

### Recommended: Filter Approach

**Filter rows where `snap_event_detected=True` before fitting.**

Rationale:
- The Snap is a transient 2-hour anomaly followed by full recovery
- The `snap_event_detected` column makes filtering trivial (one line of code)
- The implementation guide says "last 10-20 records" -- if querying recent data for a series that hasn't been near the Snap recently, filtering has no effect (safe no-op)
- Simplest approach, zero tuning required

```typescript
// Filter snap events before fitting
const cleanData = dataPoints.filter(d => !d.snap_event_detected);
```

### Alternative: Robust Regression (no filtering needed)

If the developer prefers not to filter (e.g., concerned about unknown anomalies without flags), use HuberRegressor which inherently handles outliers.

### Comparison

| Strategy | Complexity | Effectiveness | Handles Unknown Anomalies |
|---|---|---|---|
| **Filter** (`snap_event_detected=False`) | 1 line | Excellent for flagged anomalies | No |
| **Robust Regression** (Huber) | ~5 lines | Excellent | Yes |
| **Segmented** (fit before/after Snap) | ~20 lines | Overkill -- Snap is transient | No |

**The segmented approach is not recommended.** Since the Snap is transient (stock recovers after 2 hours), there is no regime change to model. Segmented regression adds complexity for no benefit.

---

## 5. Time-to-Zero Calculation

### For Linear/Weighted/Robust Regression

All linear models produce: `stock_level = slope * hours + intercept`

Where `slope` is negative (depletion) and `hours` is the time variable.

```
Time-to-Zero (hours from epoch) = -intercept / slope
```

Then convert hours-from-epoch back to a datetime:

```typescript
// Given: slope (negative), intercept (positive), referenceDate (start of time axis)
function calculateTimeToZero(
  slope: number,
  intercept: number,
  referenceDate: Date
): Date | null {
  if (slope >= 0) return null; // Not depleting
  const hoursToZero = -intercept / slope;
  const msToZero = hoursToZero * 3600 * 1000;
  return new Date(referenceDate.getTime() + msToZero);
}
```

### For Holt's Exponential Smoothing

No closed-form solution. Must iteratively project forward:

```typescript
function calculateTimeToZeroHolt(
  level: number,    // current smoothed level
  trend: number,    // current smoothed trend (negative)
  lastDate: Date
): Date | null {
  if (trend >= 0) return null;
  // Holt forecast: F(h) = level + h * trend
  // Set F(h) = 0: h = -level / trend
  const hoursToZero = -level / trend;
  const msToZero = hoursToZero * 3600 * 1000;
  return new Date(lastDate.getTime() + msToZero);
}
```

Note: Holt's linear method also gives a closed-form for the linear case, but in practice the level/trend estimates are noisier than OLS.

---

## 6. Sample Implementation: Top 2 Approaches

### Approach 1: Linear Regression with Snap Filtering (Recommended)

```typescript
interface DataPoint {
  timestamp: Date;
  stock_level: number;
  snap_event_detected: boolean;
}

interface ForecastResult {
  slope: number;           // units per hour (negative = depleting)
  intercept: number;       // stock at t=0
  r_squared: number;       // goodness of fit
  exhaustion_date: Date | null;  // predicted Time-to-Zero
}

function forecastDepletion(
  dataPoints: DataPoint[],
  referenceDate: Date
): ForecastResult {
  // Step 1: Filter out Snap anomalies
  const clean = dataPoints.filter(d => !d.snap_event_detected);

  // Step 2: Convert timestamps to hours from reference
  const points = clean.map(d => ({
    x: (d.timestamp.getTime() - referenceDate.getTime()) / 3600000,
    y: d.stock_level,
  }));

  // Step 3: OLS linear regression
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Step 4: R-squared
  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const r_squared = 1 - ssRes / ssTot;

  // Step 5: Time-to-Zero
  let exhaustion_date: Date | null = null;
  if (slope < 0 && intercept > 0) {
    const hoursToZero = -intercept / slope;
    exhaustion_date = new Date(referenceDate.getTime() + hoursToZero * 3600000);
  }

  return { slope, intercept, r_squared, exhaustion_date };
}
```

**Zero dependencies.** Pure math. Works with the "last 10-20 records" approach from the implementation guide.

### Approach 2: Robust Regression (HuberRegressor) -- Python Service

If using a Python ML service layer (as suggested in the implementation guide):

```python
from sklearn.linear_model import HuberRegressor
import numpy as np
from datetime import datetime, timedelta

def forecast_depletion_robust(
    timestamps: list[datetime],
    stock_levels: list[float],
    reference_date: datetime
) -> dict:
    """Forecast depletion using Huber robust regression.
    No snap filtering needed -- Huber handles outliers automatically.
    """
    # Convert to hours from reference
    X = np.array([
        (t - reference_date).total_seconds() / 3600
        for t in timestamps
    ]).reshape(-1, 1)
    y = np.array(stock_levels)

    # Fit robust regression (epsilon=1.35 is default, good for moderate outliers)
    model = HuberRegressor(epsilon=1.35)
    model.fit(X, y)

    slope = model.coef_[0]
    intercept = model.intercept_

    # Time-to-Zero
    exhaustion_date = None
    if slope < 0 and intercept > 0:
        hours_to_zero = -intercept / slope
        exhaustion_date = reference_date + timedelta(hours=hours_to_zero)

    return {
        "slope": slope,
        "intercept": intercept,
        "exhaustion_date": exhaustion_date.isoformat() if exhaustion_date else None,
    }
```

**Requires**: `scikit-learn` (pip install scikit-learn). One import, ~15 lines.

---

## 7. Ranked Recommendation

| Rank | Algorithm | Snap Strategy | When to Use |
|---|---|---|---|
| **1st** | Linear Regression (OLS) | Filter `snap_event_detected=True` | Default choice. Matches implementation guide. Zero dependencies. |
| **2nd** | Robust Regression (Huber) | Built-in outlier handling | If using Python service layer. More resilient to unknown anomalies. |
| **Fallback** | Exponential Smoothing (Holt) | Pre-filter Snap rows | Only if depletion rate changes over time (not observed in this data). |

### Decision Guidance for Developer

- **If implementing in TypeScript (backend)**: Use Approach 1 (OLS + filter). No dependencies, trivial to implement and test.
- **If implementing a Python ML service**: Use Approach 2 (HuberRegressor). One dependency, automatic outlier handling, impressive for evaluators.
- **Either way**: Average the 5 sensor readings per timestamp first, then fit on the averaged series.

### Data Preprocessing Pipeline

Regardless of algorithm choice, the developer should:

1. Query data for a specific `sector_id` + `resource_type`
2. **Average** the 5 sensor readings per timestamp -> 1 value per hour
3. Take the last N data points (guide says 10-20; recommend 20 for stability)
4. Filter Snap rows (if using OLS) OR pass directly (if using Huber)
5. Fit linear model
6. Calculate Time-to-Zero
7. Return exhaustion date (or "already depleted" if stock is at zero)

### Edge Cases to Handle

- **Already depleted** (stock_level = 0): Return "already exhausted" immediately, no regression needed
- **Flat or increasing trend** (slope >= 0): Return "no depletion detected" -- do not predict a Time-to-Zero
- **Insufficient data** (< 3 points after filtering): Fall back to simple rate calculation using `usage_rate_hourly` column
- **Predicted date in the past**: Stock already exhausted; report the predicted date as historical
