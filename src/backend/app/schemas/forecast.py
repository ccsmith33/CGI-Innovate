from datetime import datetime

from pydantic import BaseModel


class ForecastResponse(BaseModel):
    id: int
    sector_id: str
    resource_type: str
    predicted_exhaustion_date: datetime | None = None
    hours_until_exhaustion: float | None = None
    confidence: float | None = None
    strategy_used: str
    snap_detected: bool
    computed_at: datetime

    model_config = {"from_attributes": True}


class ForecastListResponse(BaseModel):
    data: list[ForecastResponse]


class ForecastRefreshResponse(BaseModel):
    message: str
    strategy: str
