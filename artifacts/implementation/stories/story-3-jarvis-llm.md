# Story 3: Jarvis AI (LLM Entity Extraction)

## Status
Ready for Development

## Dependencies
- Story 2 (The Shield) must be complete -- needs redaction pipeline and POST /reports/submit endpoint

## Objective
Implement the OpenAI gpt-5.2 entity extraction service that takes redacted report text and returns structured intelligence (sector, resource_type, severity, summary, confidence). Wire it as a FastAPI BackgroundTask on report submission so the POST returns 202 immediately while extraction runs asynchronously. Complete the GET /reports and GET /reports/{id} endpoints for polling processed results.

## D-ID References
- D-001: Python FastAPI for backend (async-native for background tasks)
- D-004: Server-side PII redaction before LLM (Shield runs first, then Jarvis receives only redacted text)

## Acceptance Criteria
- [ ] POST /api/v1/reports/submit returns 202 immediately (Shield runs synchronously, LLM runs in BackgroundTask)
- [ ] GET /api/v1/reports/{id} eventually shows status="processed" with extracted_entities containing sector_id, resource_type, severity, summary, confidence
- [ ] Malformed LLM JSON response falls back gracefully to `{sector_id: null, resource_type: null, severity: "unknown", summary: "Parse failed", confidence: 0}` -- no 500 error
- [ ] Missing fields in LLM response are filled with defaults -- no KeyError
- [ ] GET /api/v1/reports returns paginated list of all reports with status and extracted_entities
- [ ] GET /api/v1/reports/{id} returns 404 for non-existent report_id
- [ ] All LLM tests pass with mocked OpenAI client

## Dev Notes

### File Paths
Create or modify inside `src/backend/`:

```
app/services/jarvis_llm.py      # NEW: LLM entity extraction service
app/routers/reports.py           # MODIFY: add BackgroundTask for LLM, add GET endpoints
tests/test_jarvis_llm.py         # NEW: unit tests with mocked OpenAI
tests/test_reports_router.py     # MODIFY: add tests for GET endpoints
```

### Key Implementation Details

#### app/services/jarvis_llm.py

**Function signature:**
```python
async def extract_intel(redacted_text: str) -> dict:
```

**OpenAI call details:**
- Model: `gpt-5.2`
- Use `response_format={"type": "json_object"}` to enforce JSON output
- System prompt (example):
  ```
  You are an intelligence analyst for the Avengers Initiative. Extract structured data from the following field report.

  Return a JSON object with exactly these fields:
  - sector_id: The sector name mentioned (one of: "New Asgard", "Wakanda", "Sokovia", "Sanctum Sanctorum", "Avengers Compound"), or null if unclear
  - resource_type: The resource mentioned (one of: "Vibranium (kg)", "Arc Reactor Cores", "Pym Particles", "Clean Water (L)", "Medical Kits"), or null if unclear
  - severity: One of "low", "medium", "high", "critical"
  - summary: A one-sentence summary of the intelligence
  - confidence: A float between 0 and 1 indicating your confidence in the extraction
  ```
- User message: the redacted_text string

**Pydantic validation schema:**
```python
class ExtractedIntel(BaseModel):
    sector_id: str | None = None
    resource_type: str | None = None
    severity: str = "unknown"
    summary: str = "Parse failed"
    confidence: float = 0.0
```

**Error handling:**
- Wrap the OpenAI call in try/except
- On `json.JSONDecodeError` or Pydantic `ValidationError`: return the fallback dict with defaults
- On OpenAI API errors (timeout, rate limit, etc.): return fallback dict and set report status to "error" with error_message
- Never raise -- always return a dict so the caller can update the report row

**OpenAI client initialization:**
- Instantiate `openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)` at module level or via dependency injection
- If `OPENAI_API_KEY` is empty/missing, skip the call and return fallback dict with summary="No API key configured"

#### app/routers/reports.py (updates from Story 2)

**POST /api/v1/reports/submit (modified flow):**
1. Run `redact_pii()` synchronously (from Story 2 -- unchanged)
2. Create intel_report row with status="processing"
3. Create redaction_log row
4. Add `BackgroundTask` that calls `extract_intel(redacted_text)` and then updates the intel_report row:
   - On success: `status="processed"`, `extracted_entities=result_dict`, `processed_at=now()`
   - On failure: `status="error"`, `error_message=str(error)`, `processed_at=now()`
5. Return 202 immediately

**Background task function:**
```python
async def process_report(report_id: UUID, redacted_text: str):
    try:
        entities = await extract_intel(redacted_text)
        # update intel_report: status="processed", extracted_entities=entities
    except Exception as e:
        # update intel_report: status="error", error_message=str(e)
```

**GET /api/v1/reports:**
- Query params: `status: str | None`, `priority: str | None`, `limit: int = 50`, `offset: int = 0`
- Return `ReportListResponse` with total count
- Order by `created_at DESC`
- NEVER return `raw_text` or `metadata_json` in the response (security: PII must not leak via API)

**GET /api/v1/reports/{report_id}:**
- Return single `ReportResponse` or 404
- Same field restrictions: no raw_text, no metadata_json

### Test Requirements

**tests/test_jarvis_llm.py (unit tests with mocked OpenAI):**
- `test_valid_extraction`: Mock OpenAI to return valid JSON -> extract_intel returns correct sector_id, resource_type, severity, summary, confidence
- `test_malformed_json_fallback`: Mock OpenAI to return non-JSON text -> returns fallback dict with severity="unknown"
- `test_missing_fields_fallback`: Mock OpenAI to return JSON with missing fields -> defaults fill in correctly
- `test_api_error_fallback`: Mock OpenAI to raise an exception -> returns fallback dict, no crash

**tests/test_reports_router.py (add to existing):**
- `test_get_reports_list`: GET /api/v1/reports -> 200, returns data array
- `test_get_report_by_id`: GET /api/v1/reports/{valid_id} -> 200, returns report
- `test_get_report_not_found`: GET /api/v1/reports/{random_uuid} -> 404
- `test_report_excludes_raw_text`: Response body does NOT contain `raw_text` or `metadata_json` keys

## Estimated Scope
M (Medium)
