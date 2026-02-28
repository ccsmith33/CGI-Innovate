from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from sqlalchemy.types import JSON

from app.database import Base


class RedactionLog(Base):
    __tablename__ = "redaction_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("intel_reports.report_id"), nullable=False
    )
    original_text_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    redacted_text: Mapped[str] = mapped_column(Text, nullable=False)
    patterns_matched: Mapped[list] = mapped_column(JSON, nullable=False)
    redacted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
