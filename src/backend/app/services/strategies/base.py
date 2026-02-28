from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass
class ForecastResult:
    predicted_exhaustion_date: datetime | None
    hours_until_exhaustion: float | None
    confidence: float
    strategy_name: str
    snap_detected: bool


class ForecastingStrategy(ABC):
    @abstractmethod
    def fit(
        self,
        timestamps: list[datetime],
        stock_levels: list[float],
        snap_flags: list[bool] | None = None,
    ) -> None: ...

    @abstractmethod
    def predict_exhaustion_date(self) -> ForecastResult: ...
