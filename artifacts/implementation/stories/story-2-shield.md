# Story 2: The Shield (PII Redaction)

## Status
Ready for Development

## Dependencies
- Story 1 (The Vault) must be complete -- needs models, database, and FastAPI app scaffold

## Objective
Implement the server-side PII redaction pipeline that strips hero aliases, phone numbers, and known hero names from report text and metadata before any data reaches the LLM. Log every redaction to the audit table with a SHA-256 hash for integrity verification. Wire the initial POST /reports/submit endpoint that runs redaction synchronously.

## D-ID References
- D-004: Server-side PII regex redaction before LLM
- D-012: SHA-256 hash in redaction log (not raw text storage)

## Acceptance Criteria
- [ ] "Tony Stark" in report text is replaced with "[REDACTED-NAME]"
- [ ] "555-0101 (Iron Line)" in secure_contact is redacted -- phone pattern matched
- [ ] "555-GOD-OF-THUNDER" vanity number pattern is redacted
- [ ] Standard phone patterns like "555-867-5309" are redacted
- [ ] hero_alias value from metadata is redacted from text body
- [ ] Known hero names (from KNOWN_HEROES roster) appearing inline in text are caught by defensive pass
- [ ] `redaction_log` row is written with SHA-256 hash of original text, redacted output, and patterns_matched list
- [ ] POST /api/v1/reports/submit accepts a report, runs redaction, stores intel_report with status="processing", returns 202 with report_id
- [ ] All shield tests pass

## Dev Notes

### File Paths
Create or modify inside `src/backend/`:

```
app/services/shield.py          # NEW: PII redaction service
app/schemas/report.py           # NEW: Pydantic schemas for reports
app/routers/reports.py          # NEW: report submission endpoint (partial -- LLM comes in Story 3)
tests/test_shield.py            # NEW: unit tests for redaction
tests/test_reports_router.py    # NEW: integration test for POST /reports/submit
```

Update:
```
app/main.py                     # Register reports router
```

### Key Implementation Details

#### app/services/shield.py

```python
KNOWN_HEROES = [
    "Tony Stark", "Natasha Romanoff", "Thor Odinson",
    "Peter Parker", "Bruce Banner", "Steve Rogers",
    "Wanda Maximoff", "Clint Barton", "Scott Lang",
    "T'Challa", "Stephen Strange", "Carol Danvers",
]

PHONE_PATTERNS = [
    r"\b555-[A-Z][-A-Z]*\b",                    # vanity: 555-GOD-OF-THUNDER
    r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b",       # standard 10-digit: 555-867-5309
    r"\b\d{3}[-.\s]?\d{4}\b",                    # short 7-digit: 555-0101
    r"\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b",          # parenthetical: (555) 555-0101
]
```

**Function signature:**
```python
def redact_pii(raw_text: str, metadata: dict | None = None) -> RedactionResult:
```

**RedactionResult dataclass:**
- `redacted_text: str`
- `redacted_metadata: dict` -- copy of metadata with hero_alias and secure_contact replaced with "[REDACTED]"
- `original_hash: str` -- SHA-256 hex digest of original raw_text
- `patterns_matched: list[str]` -- e.g. `["hero_alias:Tony Stark", "phone:555-0101"]`

**Pipeline steps:**
1. Compute SHA-256 hash of raw_text
2. If metadata has `hero_alias`, replace all occurrences in text with `[REDACTED-NAME]`, log pattern
3. Apply each PHONE_PATTERN regex to text, replace matches with `[REDACTED-PHONE]`, log each match
4. Scan text for each name in KNOWN_HEROES list, replace with `[REDACTED-NAME]`, log each match
5. Build redacted_metadata: copy metadata, replace `hero_alias` value with `[REDACTED]`, replace `secure_contact` value with `[REDACTED]`
6. Return RedactionResult

**Important:** Apply hero_alias from metadata FIRST (step 2) before the KNOWN_HEROES sweep (step 4). This ensures the metadata-provided alias is caught even if it is not in the static roster.

**Important:** Phone pattern order matters. Apply vanity pattern (`555-[A-Z][-A-Z]*`) before numeric patterns to avoid partial matches on the `555` prefix.

#### app/schemas/report.py
- `ReportSubmitRequest`: `raw_text: str`, `metadata: dict | None = None`, `priority: str = "Routine"`
  - Validate priority is one of: "Routine", "High", "Avengers Level Threat"
- `ReportSubmitResponse`: `report_id: str (UUID)`, `status: str`, `message: str`
- `ReportResponse`: `report_id, timestamp, priority, status, redacted_text, extracted_entities, created_at`
- `ReportListResponse`: `data: list[ReportResponse]`, `total: int`, `limit: int`, `offset: int`

#### app/routers/reports.py (partial -- Story 3 adds LLM background task)
- `POST /api/v1/reports/submit`:
  1. Run `redact_pii(raw_text, metadata)`
  2. Create `intel_report` row: raw_text, redacted_text, metadata_json=metadata, priority, status="processing", timestamp=now()
  3. Create `redaction_log` row: report_id, original_text_hash, redacted_text, patterns_matched
  4. Return 202 with `{"report_id": ..., "status": "processing", "message": "Report accepted. Processing will complete asynchronously."}`
  5. (Story 3 will add the BackgroundTask for LLM extraction here)

#### Redaction of metadata fields
The `secure_contact` field in metadata often contains phone numbers with descriptive text like `"555-0101 (Iron Line)"`. The phone regex must match the numeric portion. The parenthetical text `(Iron Line)` is not PII and does not need redaction, but for simplicity the entire `secure_contact` value is replaced with `[REDACTED]` in the redacted_metadata output.

### Test Requirements

**tests/test_shield.py (unit tests -- no DB needed):**
- `test_redact_hero_alias_from_text`: Text containing "Tony Stark" + metadata with hero_alias="Tony Stark" -> text has "[REDACTED-NAME]", patterns_matched includes "hero_alias:Tony Stark"
- `test_redact_standard_phone`: Text containing "555-867-5309" -> "[REDACTED-PHONE]"
- `test_redact_vanity_phone`: Text containing "555-GOD-OF-THUNDER" -> "[REDACTED-PHONE]"
- `test_redact_short_phone`: Text containing "555-0101" -> "[REDACTED-PHONE]"
- `test_redact_known_hero_inline`: Text containing "Bruce Banner" (not in metadata) -> caught by KNOWN_HEROES sweep
- `test_metadata_redacted`: metadata hero_alias and secure_contact replaced with "[REDACTED]" in output
- `test_sha256_hash_computed`: original_hash is a valid 64-char hex string
- `test_no_pii_in_output`: After redaction, assert that none of the original PII strings appear anywhere in redacted_text or redacted_metadata
- `test_no_metadata_returns_clean`: When metadata is None, function still works and returns unmodified text (no hero alias to redact)

**tests/test_reports_router.py (integration test):**
- `test_submit_report_returns_202`: POST with valid body -> 202, response has report_id and status="processing"
- `test_submit_report_creates_redaction_log`: After POST, query redaction_log table -> row exists with correct hash and patterns

## Estimated Scope
M (Medium)
