# ADR-003: Strategy Pattern for ML Forecasting

**Status**: Approved
**Date**: 2026-02-28
**D-ID**: D-003

## Context

The ML forecasting service must predict "Time-to-Zero" for each sector/resource combination. The challenge explicitly states that the specific algorithm is NOT decided and may change. The data contains "Thanos Snap" anomalies that different algorithms may handle differently.

## Decision

Use the Strategy pattern: define an abstract `ForecastingStrategy` base class with `fit()` and `predict_exhaustion_date()` methods. Concrete strategies (e.g., `LinearRegressionStrategy`, `SnapAwareLinearRegression`) implement this interface. A strategy registry maps string names to classes.

## Rationale

1. **Open/Closed Principle.** New algorithms are added by creating a new class and registering it -- no changes to the API, router, or schema layer.
2. **Hackathon flexibility.** During the 24-hour sprint, we can quickly swap or add strategies without refactoring.
3. **Testability.** Each strategy is independently unit-testable with synthetic data.
4. **Snap anomaly isolation.** The `SnapAwareLinearRegression` strategy wraps `LinearRegressionStrategy` and handles data partitioning, demonstrating how the pattern composes.

## Interface

```python
class ForecastingStrategy(ABC):
    @abstractmethod
    def fit(self, timestamps: list[datetime], stock_levels: list[float]) -> None: ...

    @abstractmethod
    def predict_exhaustion_date(self) -> ForecastResult: ...
```

## Consequences

- Slight abstraction overhead for what may only have 2 concrete implementations in the hackathon. Acceptable because the pattern directly addresses the challenge requirement and demonstrates architectural maturity to judges.
- All strategies must return the same `ForecastResult` dataclass, enforcing a uniform API contract.
