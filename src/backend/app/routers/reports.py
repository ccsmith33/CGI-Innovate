from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, get_session_factory
from app.models.intel_report import IntelReport
from app.models.redaction_log import RedactionLog
from pydantic import BaseModel

from app.schemas.report import (
    ReportListResponse,
    ReportResponse,
    ReportSubmitRequest,
    ReportSubmitResponse,
)
from app.services.shield import redact_pii


class RedactionPreviewRequest(BaseModel):
    text: str


class RedactionPreviewResponse(BaseModel):
    original: str
    redacted: str
    patterns_matched: list[str]

router = APIRouter(prefix="/reports", tags=["reports"])


async def process_report_background(report_id: str, redacted_text: str):
    from app.services.jarvis_llm import extract_intel

    async with get_session_factory()() as session:
        try:
            entities = await extract_intel(redacted_text)
            result = await session.execute(
                select(IntelReport).where(IntelReport.report_id == report_id)
            )
            report = result.scalar_one()
            report.extracted_entities = entities
            report.status = "processed"
            report.processed_at = datetime.now(timezone.utc)
            await session.commit()
        except Exception as e:
            await session.rollback()
            async with get_session_factory()() as err_session:
                result = await err_session.execute(
                    select(IntelReport).where(IntelReport.report_id == report_id)
                )
                report = result.scalar_one()
                report.status = "error"
                report.error_message = str(e)
                report.processed_at = datetime.now(timezone.utc)
                await err_session.commit()


@router.post("/submit", response_model=ReportSubmitResponse, status_code=202)
async def submit_report(
    body: ReportSubmitRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    redaction_result = redact_pii(body.raw_text, body.metadata)

    report = IntelReport(
        raw_text=body.raw_text,
        redacted_text=redaction_result.redacted_text,
        metadata_json=redaction_result.redacted_metadata,
        priority=body.priority,
        status="processing",
        timestamp=datetime.now(timezone.utc),
    )
    db.add(report)
    await db.flush()

    log_entry = RedactionLog(
        report_id=report.report_id,
        original_text_hash=redaction_result.original_hash,
        redacted_text=redaction_result.redacted_text,
        patterns_matched=redaction_result.patterns_matched,
    )
    db.add(log_entry)
    await db.commit()

    background_tasks.add_task(
        process_report_background, report.report_id, redaction_result.redacted_text
    )

    return ReportSubmitResponse(
        report_id=report.report_id,
        status="processing",
        message="Report accepted. Processing will complete asynchronously.",
    )


@router.post("/process-pending", status_code=202)
async def process_pending_reports(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(IntelReport).where(IntelReport.status == "pending")
    )
    reports = result.scalars().all()
    count = len(reports)
    for report in reports:
        background_tasks.add_task(
            process_report_background, report.report_id, report.redacted_text
        )
    return {"queued": count, "message": f"Queued {count} pending reports for LLM processing."}


@router.get("", response_model=ReportListResponse)
async def list_reports(
    status: str | None = None,
    priority: str | None = None,
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    query = select(IntelReport)
    count_query = select(func.count(IntelReport.report_id))

    if status:
        query = query.where(IntelReport.status == status)
        count_query = count_query.where(IntelReport.status == status)
    if priority:
        query = query.where(IntelReport.priority == priority)
        count_query = count_query.where(IntelReport.priority == priority)

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(IntelReport.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    rows = result.scalars().all()

    return ReportListResponse(
        data=[ReportResponse.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(report_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(IntelReport).where(IntelReport.report_id == report_id)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return ReportResponse.model_validate(report)


@router.post("/preview-redaction", response_model=RedactionPreviewResponse)
async def preview_redaction(body: RedactionPreviewRequest):
    result = redact_pii(body.text)
    return RedactionPreviewResponse(
        original=body.text,
        redacted=result.redacted_text,
        patterns_matched=result.patterns_matched,
    )
