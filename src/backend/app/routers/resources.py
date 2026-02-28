from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.resource_log import ResourceLog
from app.schemas.resource import (
    ResourceListResponse,
    ResourceLogResponse,
    ResourceTypesResponse,
    SectorsResponse,
    SummaryItem,
    SummaryResponse,
)

router = APIRouter(prefix="/resources", tags=["resources"])


@router.get("", response_model=ResourceListResponse)
async def list_resources(
    sector: str | None = None,
    resource_type: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    snap_only: bool | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    query = select(ResourceLog)
    count_query = select(func.count(ResourceLog.id))

    if sector:
        query = query.where(ResourceLog.sector_id == sector)
        count_query = count_query.where(ResourceLog.sector_id == sector)
    if resource_type:
        query = query.where(ResourceLog.resource_type == resource_type)
        count_query = count_query.where(ResourceLog.resource_type == resource_type)
    if start:
        query = query.where(ResourceLog.timestamp >= start)
        count_query = count_query.where(ResourceLog.timestamp >= start)
    if end:
        query = query.where(ResourceLog.timestamp <= end)
        count_query = count_query.where(ResourceLog.timestamp <= end)
    if snap_only:
        query = query.where(ResourceLog.snap_event_detected == True)
        count_query = count_query.where(ResourceLog.snap_event_detected == True)

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(ResourceLog.timestamp.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    rows = result.scalars().all()

    return ResourceListResponse(
        data=[ResourceLogResponse.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/sectors", response_model=SectorsResponse)
async def get_sectors(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(distinct(ResourceLog.sector_id)).order_by(ResourceLog.sector_id)
    )
    sectors = [row[0] for row in result.all()]
    return SectorsResponse(sectors=sectors)


@router.get("/types", response_model=ResourceTypesResponse)
async def get_resource_types(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(distinct(ResourceLog.resource_type)).order_by(ResourceLog.resource_type)
    )
    types = [row[0] for row in result.all()]
    return ResourceTypesResponse(resource_types=types)


@router.get("/summary", response_model=SummaryResponse)
async def get_summary(db: AsyncSession = Depends(get_db)):
    # Subquery to get the max timestamp per sector+resource
    subq = (
        select(
            ResourceLog.sector_id,
            ResourceLog.resource_type,
            func.max(ResourceLog.timestamp).label("max_ts"),
        )
        .group_by(ResourceLog.sector_id, ResourceLog.resource_type)
        .subquery()
    )

    query = select(ResourceLog).join(
        subq,
        (ResourceLog.sector_id == subq.c.sector_id)
        & (ResourceLog.resource_type == subq.c.resource_type)
        & (ResourceLog.timestamp == subq.c.max_ts),
    )

    result = await db.execute(query)
    rows = result.scalars().all()

    return SummaryResponse(
        data=[
            SummaryItem(
                sector_id=r.sector_id,
                resource_type=r.resource_type,
                latest_stock_level=r.stock_level,
                latest_usage_rate=r.usage_rate_hourly,
                latest_timestamp=r.timestamp,
                snap_event_detected=r.snap_event_detected,
            )
            for r in rows
        ]
    )
