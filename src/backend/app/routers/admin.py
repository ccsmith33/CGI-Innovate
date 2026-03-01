from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.redaction_log import RedactionLog

router = APIRouter(prefix="/admin", tags=["admin"])


class RedactionLogItem(BaseModel):
    id: int
    report_id: str
    original_text_hash: str
    redacted_text: str
    patterns_matched: list
    redacted_at: datetime

    model_config = {"from_attributes": True}


class RedactionLogResponse(BaseModel):
    total: int
    items: list[RedactionLogItem]


@router.get("/redaction-log", response_model=RedactionLogResponse)
async def get_redaction_log(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    count_result = await db.execute(select(func.count(RedactionLog.id)))
    total = count_result.scalar() or 0

    query = (
        select(RedactionLog)
        .order_by(RedactionLog.redacted_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    rows = result.scalars().all()

    return RedactionLogResponse(
        total=total,
        items=[RedactionLogItem.model_validate(r) for r in rows],
    )
