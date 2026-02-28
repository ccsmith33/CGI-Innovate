from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class ResourceLog(Base):
    __tablename__ = "resource_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sector_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    stock_level: Mapped[float] = mapped_column(Float, nullable=False)
    usage_rate_hourly: Mapped[float] = mapped_column(Float, nullable=False)
    snap_event_detected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("ix_resource_logs_sector_resource", "sector_id", "resource_type"),
        Index("ix_resource_logs_timestamp", "timestamp"),
    )
