import json

from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import settings


class ExtractedIntel(BaseModel):
    sector_id: str | None = None
    resource_type: str | None = None
    severity: str = "unknown"
    summary: str = "Parse failed"
    confidence: float = 0.0


SYSTEM_PROMPT = """You are an intelligence analyst for the Avengers Initiative. Extract structured data from the following field report.

Return a JSON object with exactly these fields:
- sector_id: The sector name mentioned (one of: "New Asgard", "Wakanda", "Sokovia", "Sanctum Sanctorum", "Avengers Compound"), or null if unclear
- resource_type: The resource mentioned (one of: "Vibranium (kg)", "Arc Reactor Cores", "Pym Particles", "Clean Water (L)", "Medical Kits"), or null if unclear
- severity: One of "low", "medium", "high", "critical"
- summary: A one-sentence summary of the intelligence
- confidence: A float between 0 and 1 indicating your confidence in the extraction"""

INTEL_JSON_SCHEMA = {
    "name": "intel_extraction",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "sector_id": {
                "type": ["string", "null"],
                "description": "The sector name mentioned",
            },
            "resource_type": {
                "type": ["string", "null"],
                "description": "The resource type mentioned",
            },
            "severity": {
                "type": "string",
                "enum": ["critical", "high", "medium", "low"],
                "description": "Severity level",
            },
            "summary": {
                "type": "string",
                "description": "One-sentence summary of the intelligence",
            },
            "confidence": {
                "type": "number",
                "description": "Confidence score between 0 and 1",
            },
        },
        "required": ["sector_id", "resource_type", "severity", "summary", "confidence"],
        "additionalProperties": False,
    },
}


async def extract_intel(redacted_text: str) -> dict:
    if not settings.OPENAI_API_KEY:
        return ExtractedIntel(summary="No API key configured").model_dump()

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={
                "type": "json_schema",
                "json_schema": INTEL_JSON_SCHEMA,
            },
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": redacted_text},
            ],
        )
        data = json.loads(response.choices[0].message.content)
        return ExtractedIntel.model_validate(data).model_dump()
    except (json.JSONDecodeError, Exception):
        return ExtractedIntel(summary="Parse failed").model_dump()
