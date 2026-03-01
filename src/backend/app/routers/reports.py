import base64
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
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

logger = logging.getLogger(__name__)


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


@router.post("/analyze-image")
async def analyze_image(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
):
    """Analyze a field intelligence photograph using Claude Vision."""
    image_data = await file.read()
    b64 = base64.standard_b64encode(image_data).decode()
    media_type = file.content_type or "image/jpeg"

    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_type, "data": b64},
                },
                {
                    "type": "text",
                    "text": (
                        "You are JARVIS analyzing a field intelligence photograph for Project Sentinel.\n\n"
                        "Analyze this image and respond ONLY in this JSON format:\n"
                        "{\n"
                        '  "threat_type": "one of: infrastructure_damage, hostile_activity, resource_disruption, environmental_hazard, civilian_impact, unknown",\n'
                        '  "affected_sector": "one of: Avengers Compound, New Asgard, Sanctum Sanctorum, Sokovia, Wakanda, Unknown",\n'
                        '  "severity": "LOW|MEDIUM|HIGH|CRITICAL",\n'
                        '  "resources_at_risk": ["list of affected resource types"],\n'
                        '  "summary": "2-3 sentence intelligence assessment",\n'
                        '  "recommended_action": "specific action for the commander"\n'
                        "}"
                    ),
                },
            ],
        }],
    )

    try:
        result = json.loads(response.content[0].text)
    except (json.JSONDecodeError, IndexError) as exc:
        raise HTTPException(status_code=502, detail=f"Failed to parse VLM response: {exc}")

    report = IntelReport(
        raw_text=f"[VISUAL INTEL] {result.get('summary', '')}",
        redacted_text=result.get("summary", ""),
        priority="High",
        status="processed",
        timestamp=datetime.now(timezone.utc),
        extracted_entities={
            "sector_id": result.get("affected_sector", "Unknown"),
            "resource_type": ", ".join(result.get("resources_at_risk", [])),
            "severity": result.get("severity", "MEDIUM"),
            "summary": result.get("summary", ""),
            "threat_type": result.get("threat_type", "unknown"),
            "recommended_action": result.get("recommended_action", ""),
        },
    )
    db.add(report)
    await db.commit()

    return {"analysis": result, "report_id": report.report_id}
