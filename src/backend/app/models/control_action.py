from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from sqlalchemy.types import JSON

from app.database import Base


class ControlAction(Base):
    __tablename__ = "control_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    champion_confidence: Mapped[float] = mapped_column(Float, nullable=False)
    backup_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_budget_used: Mapped[float] = mapped_column(Float, nullable=False)
    allocations_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    sectors_adjusted: Mapped[int] = mapped_column(Integer, nullable=False)
    champion_data_points: Mapped[int] = mapped_column(Integer, nullable=False)
