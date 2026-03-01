import json
import logging
from datetime import datetime, timedelta, timezone

from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.forecast import Forecast
from app.models.intel_report import IntelReport
from app.models.redaction_log import RedactionLog
from app.models.resource_log import ResourceLog
from app.services.strategies.isolation_forest import detect_anomalies
from app.services.strategies.exponential_decay import ExponentialDecayStrategy
from app.services.strategies.linear_regression import LinearRegressionStrategy
from app.services.strategies.polynomial_regression import PolynomialRegressionStrategy

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jarvis", tags=["jarvis"])

JARVIS_SYSTEM_PROMPT = (
    "You are JARVIS, the AI Command & Control intelligence for Project Sentinel. "
    "You have access to live data tools. You speak in a professional, tactical manner. "
    "RESPONSE RULES (ABSOLUTE): "
    "Maximum 1 sentence. Never 2. Never a list. "
    "Never enumerate individual resources by name. "
    "Give ONE overall status or the single most critical issue only. "
    "Examples of correct responses: "
    "\"All sectors recovering, Vibranium is the most at risk at 36%.\" "
    "\"Resources are stable. No immediate threats.\" "
    "\"Pym Particles critical at 8%, governor is compensating.\" "
    "No markdown, no bullets, no percentages for every resource."
)

ANTHROPIC_TOOL_DEFINITIONS = [
    {
        "name": "get_all_forecasts",
        "description": "Returns all 5 forecasts with sector, resource, hours_until_exhaustion, predicted_exhaustion_date, confidence, strategy",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_resource_summary",
        "description": "Returns current stock levels and latest usage rates for all sectors",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_anomalies",
        "description": "Runs IsolationForest anomaly detection for the given sector and resource type, returns anomaly list",
        "input_schema": {
            "type": "object",
            "properties": {
                "sector_id": {"type": "string", "description": "The sector name"},
                "resource_type": {"type": "string", "description": "The resource type"},
            },
            "required": ["sector_id", "resource_type"],
        },
    },
    {
        "name": "get_intel_reports",
        "description": "Returns recent intel reports with redacted_text, extracted_entities, severity, sector",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "description": "Filter by status (e.g. 'processed', 'pending'). Use 'all' for no filter.",
                    "default": "all",
                },
                "priority": {
                    "type": "string",
                    "description": "Filter by priority (e.g. 'critical', 'high'). Use 'all' for no filter.",
                    "default": "all",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max number of reports to return",
                    "default": 10,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_redaction_log",
        "description": "Returns recent redaction audit entries",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Max number of entries to return",
                    "default": 10,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_forecast_comparison",
        "description": "Runs all 3 forecast strategies (linear, polynomial, exponential) for a sector+resource and returns comparison",
        "input_schema": {
            "type": "object",
            "properties": {
                "sector_id": {"type": "string", "description": "The sector name"},
                "resource_type": {"type": "string", "description": "The resource type"},
            },
            "required": ["sector_id", "resource_type"],
        },
    },
    {
        "name": "get_resource_history",
        "description": "Returns resource log entries for the last N hours for a given sector and resource type",
        "input_schema": {
            "type": "object",
            "properties": {
                "sector_id": {"type": "string", "description": "The sector name"},
                "resource_type": {"type": "string", "description": "The resource type"},
                "hours_back": {
                    "type": "integer",
                    "description": "Number of hours to look back",
                    "default": 24,
                },
            },
            "required": ["sector_id", "resource_type"],
        },
    },
]


class ChatMessage(BaseModel):
    role: str
    content: str


class JarvisChatRequest(BaseModel):
    message: str
    conversation_history: list[ChatMessage] = []


class JarvisChatResponse(BaseModel):
    reply: str
    function_calls_made: list[str]


# ---------------------------------------------------------------------------
# Tool implementation functions
# ---------------------------------------------------------------------------

async def get_all_forecasts(db: AsyncSession) -> str:
    subq = (
        select(
            Forecast.sector_id,
            Forecast.resource_type,
            func.max(Forecast.computed_at).label("max_computed"),
        )
        .group_by(Forecast.sector_id, Forecast.resource_type)
        .subquery()
    )
    query = select(Forecast).join(
        subq,
        (Forecast.sector_id == subq.c.sector_id)
        & (Forecast.resource_type == subq.c.resource_type)
        & (Forecast.computed_at == subq.c.max_computed),
    )
    result = await db.execute(query)
    rows = result.scalars().all()
    return json.dumps([
        {
            "sector_id": r.sector_id,
            "resource_type": r.resource_type,
            "hours_until_exhaustion": r.hours_until_exhaustion,
            "predicted_exhaustion_date": (
                r.predicted_exhaustion_date.isoformat() if r.predicted_exhaustion_date else None
            ),
            "confidence": r.confidence,
            "strategy_used": r.strategy_used,
        }
        for r in rows
    ])


async def get_resource_summary(db: AsyncSession) -> str:
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
    return json.dumps([
        {
            "sector_id": r.sector_id,
            "resource_type": r.resource_type,
            "stock_level": r.stock_level,
            "usage_rate_hourly": r.usage_rate_hourly,
            "snap_event_detected": r.snap_event_detected,
            "timestamp": r.timestamp.isoformat(),
        }
        for r in rows
    ])


async def get_anomalies_fn(db: AsyncSession, sector_id: str, resource_type: str) -> str:
    result = await db.execute(
        select(ResourceLog)
        .where(ResourceLog.sector_id == sector_id)
        .where(ResourceLog.resource_type == resource_type)
        .order_by(ResourceLog.timestamp)
    )
    rows = result.scalars().all()
    if not rows:
        return json.dumps({"anomalies": [], "message": "No data found for this sector/resource pair"})

    timestamps = [r.timestamp for r in rows]
    stock_levels = [r.stock_level for r in rows]
    anomalies = detect_anomalies(timestamps, stock_levels)
    return json.dumps({"anomalies": anomalies})


async def get_intel_reports_fn(
    db: AsyncSession, status: str = "all", priority: str = "all", limit: int = 10
) -> str:
    query = select(IntelReport)
    if status != "all":
        query = query.where(IntelReport.status == status)
    if priority != "all":
        query = query.where(IntelReport.priority == priority)
    query = query.order_by(IntelReport.created_at.desc()).limit(limit)
    result = await db.execute(query)
    rows = result.scalars().all()
    return json.dumps([
        {
            "report_id": r.report_id,
            "redacted_text": r.redacted_text,
            "extracted_entities": r.extracted_entities,
            "priority": r.priority,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ])


async def get_redaction_log_fn(db: AsyncSession, limit: int = 10) -> str:
    query = (
        select(RedactionLog)
        .order_by(RedactionLog.redacted_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    rows = result.scalars().all()
    return json.dumps([
        {
            "id": r.id,
            "report_id": r.report_id,
            "redacted_text": r.redacted_text,
            "patterns_matched": r.patterns_matched,
            "redacted_at": r.redacted_at.isoformat() if r.redacted_at else None,
        }
        for r in rows
    ])


async def get_forecast_comparison_fn(
    db: AsyncSession, sector_id: str, resource_type: str
) -> str:
    result = await db.execute(
        select(ResourceLog)
        .where(ResourceLog.sector_id == sector_id)
        .where(ResourceLog.resource_type == resource_type)
        .order_by(ResourceLog.timestamp)
    )
    rows = result.scalars().all()
    if not rows:
        return json.dumps({"error": "No resource logs found for this sector/resource pair"})

    timestamps = [r.timestamp for r in rows]
    stock_levels = [r.stock_level for r in rows]
    snap_flags = [r.snap_event_detected for r in rows]

    strategies = {
        "linear_regression": LinearRegressionStrategy(),
        "polynomial_regression": PolynomialRegressionStrategy(),
        "exponential_decay": ExponentialDecayStrategy(),
    }

    results = {}
    for name, strategy in strategies.items():
        strategy.fit(timestamps, stock_levels, snap_flags)
        forecast = strategy.predict_exhaustion_date()
        results[name] = {
            "predicted_exhaustion_date": (
                forecast.predicted_exhaustion_date.isoformat()
                if forecast.predicted_exhaustion_date
                else None
            ),
            "hours_until_exhaustion": forecast.hours_until_exhaustion,
            "confidence": forecast.confidence,
            "snap_detected": forecast.snap_detected,
        }

    return json.dumps({"sector_id": sector_id, "resource_type": resource_type, "forecasts": results})


async def get_resource_history_fn(
    db: AsyncSession, sector_id: str, resource_type: str, hours_back: int = 24
) -> str:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours_back)
    result = await db.execute(
        select(ResourceLog)
        .where(ResourceLog.sector_id == sector_id)
        .where(ResourceLog.resource_type == resource_type)
        .where(ResourceLog.timestamp >= cutoff)
        .order_by(ResourceLog.timestamp)
    )
    rows = result.scalars().all()
    return json.dumps([
        {
            "timestamp": r.timestamp.isoformat(),
            "stock_level": r.stock_level,
            "usage_rate_hourly": r.usage_rate_hourly,
            "snap_event_detected": r.snap_event_detected,
        }
        for r in rows
    ])


FUNCTION_DISPATCH = {
    "get_all_forecasts": lambda db, args: get_all_forecasts(db),
    "get_resource_summary": lambda db, args: get_resource_summary(db),
    "get_anomalies": lambda db, args: get_anomalies_fn(
        db, args.get("sector_id", ""), args.get("resource_type", "")
    ),
    "get_intel_reports": lambda db, args: get_intel_reports_fn(
        db,
        status=args.get("status", "all"),
        priority=args.get("priority", "all"),
        limit=args.get("limit", 10),
    ),
    "get_redaction_log": lambda db, args: get_redaction_log_fn(
        db, limit=args.get("limit", 10)
    ),
    "get_forecast_comparison": lambda db, args: get_forecast_comparison_fn(
        db, args.get("sector_id", ""), args.get("resource_type", "")
    ),
    "get_resource_history": lambda db, args: get_resource_history_fn(
        db,
        args.get("sector_id", ""),
        args.get("resource_type", ""),
        hours_back=args.get("hours_back", 24),
    ),
}


@router.post("/chat", response_model=JarvisChatResponse)
async def jarvis_chat(body: JarvisChatRequest, db: AsyncSession = Depends(get_db)):
    if not settings.ANTHROPIC_API_KEY:
        return JarvisChatResponse(
            reply="JARVIS is offline. API key not configured.",
            function_calls_made=[],
        )

    messages = []
    for msg in body.conversation_history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": body.message})

    client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    function_calls_made: list[str] = []

    # Allow up to 5 rounds of function calling
    for _ in range(5):
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=60,
            system=JARVIS_SYSTEM_PROMPT,
            messages=messages,
            tools=ANTHROPIC_TOOL_DEFINITIONS,
        )

        tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

        if response.stop_reason == "tool_use" and tool_use_blocks:
            # Add assistant message with ALL content blocks
            messages.append({"role": "assistant", "content": response.content})

            # Add tool results as a single user message
            tool_results = []
            for block in tool_use_blocks:
                fn_name = block.name
                fn_args = block.input  # already a dict
                function_calls_made.append(fn_name)

                handler = FUNCTION_DISPATCH.get(fn_name)
                if handler:
                    result_str = await handler(db, fn_args)
                else:
                    result_str = json.dumps({"error": f"Unknown function: {fn_name}"})

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_str,
                })
            messages.append({"role": "user", "content": tool_results})
        else:
            # Final response from the model
            text_blocks = [b for b in response.content if b.type == "text"]
            reply = text_blocks[0].text if text_blocks else ""
            return JarvisChatResponse(reply=reply, function_calls_made=function_calls_made)

    # If we exhaust the loop, return the last response
    return JarvisChatResponse(
        reply="I've gathered the data but couldn't formulate a final response. Please try again.",
        function_calls_made=function_calls_made,
    )


@router.post("/chat-stream")
async def jarvis_chat_stream(body: JarvisChatRequest, db: AsyncSession = Depends(get_db)):
    if not settings.ANTHROPIC_API_KEY:
        async def offline():
            yield f'data: {json.dumps({"type": "chunk", "text": "JARVIS is offline. API key not configured."})}\n\n'
            yield f'data: {json.dumps({"type": "done"})}\n\n'
        return StreamingResponse(offline(), media_type="text/event-stream")

    async def generate():
        messages = []
        for msg in body.conversation_history:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": body.message})

        client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

        # Tool calling rounds (non-streaming)
        for _ in range(5):
            response = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=60,
                system=JARVIS_SYSTEM_PROMPT,
                messages=messages,
                tools=ANTHROPIC_TOOL_DEFINITIONS,
            )

            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

            if response.stop_reason == "tool_use" and tool_use_blocks:
                messages.append({"role": "assistant", "content": response.content})
                tool_results = []
                for block in tool_use_blocks:
                    fn_name = block.name
                    fn_args = block.input
                    handler = FUNCTION_DISPATCH.get(fn_name)
                    result_str = await handler(db, fn_args) if handler else json.dumps({"error": f"Unknown function: {fn_name}"})
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_str,
                    })
                messages.append({"role": "user", "content": tool_results})
            else:
                # Final response — stream it
                async with client.messages.stream(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=60,
                    system=JARVIS_SYSTEM_PROMPT,
                    messages=messages,
                    tools=ANTHROPIC_TOOL_DEFINITIONS,
                ) as stream:
                    async for text in stream.text_stream:
                        yield f'data: {json.dumps({"type": "chunk", "text": text})}\n\n'
                yield f'data: {json.dumps({"type": "done"})}\n\n'
                return

        # Exhausted loop
        yield f'data: {json.dumps({"type": "chunk", "text": "Could not formulate a response. Please try again."})}\n\n'
        yield f'data: {json.dumps({"type": "done"})}\n\n'

    return StreamingResponse(generate(), media_type="text/event-stream")
