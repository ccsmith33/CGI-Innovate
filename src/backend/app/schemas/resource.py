from datetime import datetime

from pydantic import BaseModel


class ResourceLogResponse(BaseModel):
    id: int
    timestamp: datetime
    sector_id: str
    resource_type: str
    stock_level: float
    usage_rate_hourly: float
    snap_event_detected: bool

    model_config = {"from_attributes": True}


class ResourceListResponse(BaseModel):
    data: list[ResourceLogResponse]
    total: int
    limit: int
    offset: int


class SectorsResponse(BaseModel):
    sectors: list[str]


class ResourceTypesResponse(BaseModel):
    resource_types: list[str]


class SummaryItem(BaseModel):
    sector_id: str
    resource_type: str
    latest_stock_level: float
    latest_usage_rate: float
    latest_timestamp: datetime
    snap_event_detected: bool

    model_config = {"from_attributes": True}


class SummaryResponse(BaseModel):
    data: list[SummaryItem]


class HealthResponse(BaseModel):
    status: str
    version: str
