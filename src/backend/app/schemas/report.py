from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator


class ReportSubmitRequest(BaseModel):
    raw_text: str
    metadata: dict | None = None
    priority: str = "Routine"

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        allowed = {"Routine", "High", "Avengers Level Threat"}
        if v not in allowed:
            raise ValueError(f"priority must be one of: {allowed}")
        return v


class ReportSubmitResponse(BaseModel):
    report_id: str
    status: str
    message: str


class ReportResponse(BaseModel):
    report_id: str
    timestamp: datetime
    priority: str
    status: str
    redacted_text: str | None = None
    extracted_entities: dict | None = None
    created_at: datetime
    error_message: str | None = None

    model_config = {"from_attributes": True}


class ReportListResponse(BaseModel):
    data: list[ReportResponse]
    total: int
    limit: int
    offset: int
