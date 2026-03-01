"""JARVIS autonomous planning agent with streaming reasoning via SSE."""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import settings
from app.services.event_bus import broadcast
from app.services.governor import governor_instance

logger = logging.getLogger(__name__)

AGENT_SYSTEM_PROMPT = """You are JARVIS, the autonomous AI resource management system for Project Sentinel.

You operate in a continuous observe-reason-plan loop. Each cycle you receive current system state and must:
1. Assess the situation (1-2 sentences)
2. Identify the most critical threat (if any)
3. Propose up to 2 concrete actions with confidence scores (0.0-1.0)
4. Provide a brief rationale

Respond ONLY in this JSON format:
Do NOT wrap the JSON in markdown code blocks or backticks. Return raw JSON only.
{
  "situation": "Brief situational assessment",
  "critical_threat": null or "description of highest priority threat",
  "actions": [
    {"type": "governor_override", "sector": "...", "resource": "...", "units": 0.0, "confidence": 0.0, "rationale": "..."},
    {"type": "alert", "message": "...", "severity": "info|warning|critical", "confidence": 0.0}
  ],
  "reasoning_chain": ["Step 1: ...", "Step 2: ...", "Step 3: ..."]
}

CRITICAL — governor_override "units" field:
- "units" is PRODUCTION UNITS PER 10-SECOND CYCLE, not per hour.
- Default production rates: Medical Kits=8, Clean Water=10, Vibranium=3, Pym Particles=5, Arc Reactor Cores=4.
- Valid override range: 1.0 to 20.0 units/cycle. Never exceed 20.
- Example: to boost Medical Kits by 50%, use units=12.0 (not 2700 or any hourly figure).

Apply governor overrides only when confidence >= 0.75. Always include your reasoning chain."""


async def _gather_observation(db_session) -> dict[str, Any]:
    """Gather current system state for agent reasoning."""
    from sqlalchemy import func, select

    from app.models.forecast import Forecast
    from app.models.resource_log import ResourceLog

    observation: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "stocks": [],
        "forecasts": [],
        "defcon": None,
    }

    # Latest stock per sector+resource
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
    result = await db_session.execute(query)
    for row in result.scalars().all():
        observation["stocks"].append({
            "sector_id": row.sector_id,
            "resource_type": row.resource_type,
            "stock_level": row.stock_level,
            "usage_rate_hourly": row.usage_rate_hourly,
        })

    # Latest forecasts
    fsubq = (
        select(
            Forecast.sector_id,
            Forecast.resource_type,
            func.max(Forecast.computed_at).label("max_computed"),
        )
        .group_by(Forecast.sector_id, Forecast.resource_type)
        .subquery()
    )
    fquery = select(Forecast).join(
        fsubq,
        (Forecast.sector_id == fsubq.c.sector_id)
        & (Forecast.resource_type == fsubq.c.resource_type)
        & (Forecast.computed_at == fsubq.c.max_computed),
    )
    fresult = await db_session.execute(fquery)
    for row in fresult.scalars().all():
        observation["forecasts"].append({
            "sector_id": row.sector_id,
            "resource_type": row.resource_type,
            "hours_until_exhaustion": row.hours_until_exhaustion,
            "confidence": row.confidence,
        })

    # DEFCON level
    try:
        async with httpx.AsyncClient(timeout=5.0) as http_client:
            resp = await http_client.get(f"{settings.FEED_SERVICE_URL}/feed/defcon")
            resp.raise_for_status()
            observation["defcon"] = resp.json()
    except Exception:
        observation["defcon"] = {"level": 5, "label": "NORMAL"}

    return observation


async def _execute_actions(decision: dict[str, Any], db_session) -> None:
    """Execute high-confidence actions from the agent's decision."""
    for action in decision.get("actions", []):
        confidence = action.get("confidence", 0.0)
        action_type = action.get("type", "")

        if action_type == "governor_override" and confidence >= 0.75:
            units = max(0.0, min(action.get("units", 0.0), 30.0))
            governor_instance.set_override(
                action["sector"], action["resource"], units
            )
            # Propagate override to feed service
            try:
                async with httpx.AsyncClient(timeout=10.0) as http_client:
                    await http_client.post(
                        f"{settings.FEED_SERVICE_URL}/control/production",
                        json={
                            "sector_id": action["sector"],
                            "resource_type": action["resource"],
                            "units_per_cycle": units,
                        },
                    )
            except Exception as exc:
                logger.warning("Failed to propagate agent override to feed service: %s", exc)
            logger.info(
                "Agent override: %s/%s -> %.1f units (conf=%.2f)",
                action["sector"],
                action["resource"],
                units,
                confidence,
            )

        elif action_type == "alert":
            await broadcast("agent_alert", {
                "message": action.get("message", ""),
                "severity": action.get("severity", "info"),
                "confidence": confidence,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })


async def run_agent_cycle(db_session) -> None:
    """One observe-reason-plan-act-reflect cycle."""
    # 1. Observe
    await broadcast("agent_thinking", {
        "phase": "observing",
        "message": "Scanning all sector resource levels...",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    observation = await _gather_observation(db_session)

    # 2. Reason with Claude (streaming)
    await broadcast("agent_thinking", {
        "phase": "reasoning",
        "message": "Analyzing resource trends and threats...",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    if not settings.ANTHROPIC_API_KEY:
        logger.warning("Agent cycle skipped: no ANTHROPIC_API_KEY")
        await broadcast("agent_decision", {
            "situation": "Agent offline — no API key configured",
            "threat": None,
            "actions_taken": 0,
            "reasoning_chain": ["No API key configured"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return

    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    full_response = ""
    async with client.messages.stream(
        model="claude-haiku-4-5-20251001",
        max_tokens=800,
        system=AGENT_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": json.dumps(observation)}],
    ) as stream:
        async for text in stream.text_stream:
            full_response += text
            await broadcast("agent_thinking", {
                "phase": "reasoning",
                "partial": text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    # 3. Plan — broadcast planning phase
    await broadcast("agent_thinking", {
        "phase": "planning",
        "message": "Evaluating proposed actions...",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    # 4. Parse and act
    # Strip markdown code fences if present (model sometimes wraps JSON in ```json ... ```)
    clean_response = re.sub(r'^```(?:json)?\s*\n?', '', full_response.strip())
    clean_response = re.sub(r'\n?```\s*$', '', clean_response).strip()

    try:
        decision = json.loads(clean_response)
    except json.JSONDecodeError:
        logger.warning("Agent response not valid JSON: %s", clean_response[:200])
        await broadcast("agent_decision", {
            "situation": "Agent response parse error",
            "threat": None,
            "actions_taken": 0,
            "reasoning_chain": ["Response was not valid JSON"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return

    # Act phase
    await broadcast("agent_thinking", {
        "phase": "acting",
        "message": f"Executing {len(decision.get('actions', []))} proposed actions...",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    await _execute_actions(decision, db_session)

    # 5. Reflect — broadcast final decision
    await broadcast("agent_decision", {
        "situation": decision.get("situation", ""),
        "threat": decision.get("critical_threat"),
        "actions_taken": len(decision.get("actions", [])),
        "reasoning_chain": decision.get("reasoning_chain", []),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
