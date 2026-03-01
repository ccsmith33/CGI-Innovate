from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.resource_log import ResourceLog
from app.services.strategies.isolation_forest import detect_anomalies

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/anomalies")
async def get_anomalies(
    sector_id: str = Query(...),
    resource_type: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ResourceLog)
        .where(ResourceLog.sector_id == sector_id)
        .where(ResourceLog.resource_type == resource_type)
        .order_by(ResourceLog.timestamp)
    )
    rows = result.scalars().all()

    if not rows:
        raise HTTPException(status_code=404, detail="No resource logs found")

    timestamps = [r.timestamp for r in rows]
    stock_levels = [r.stock_level for r in rows]

    anomalies = detect_anomalies(timestamps, stock_levels)

    return {"anomalies": anomalies}
