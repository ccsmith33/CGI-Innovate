# ADR-004: Server-Side PII Redaction Before LLM Calls

**Status**: Approved
**Date**: 2026-02-28
**D-ID**: D-004

## Context

Field intel reports contain PII: hero aliases (e.g., "Tony Stark") and secure contact info (e.g., "555-0101 (Iron Line)"). This PII must NEVER be sent to the OpenAI LLM API. The challenge explicitly requires a "Privacy-by-Design" middleware approach.

Alternatives considered:
- Client-side redaction in the frontend
- LLM-based redaction (use the LLM to identify and strip PII)
- Server-side regex redaction

## Decision

Implement server-side Python regex redaction that runs in the FastAPI backend BEFORE any LLM call.

## Rationale

1. **Zero-trust guarantee.** Server-side redaction means PII removal does not depend on client behavior. Even if the frontend sends raw PII, the backend strips it before forwarding to OpenAI.
2. **Deterministic and auditable.** Regex patterns produce consistent, reproducible results. Every redaction is logged with the matched patterns and a SHA-256 hash of the original text.
3. **No additional API calls.** LLM-based redaction would require sending the PII to the LLM to identify it -- defeating the purpose.
4. **Low latency.** Regex runs in microseconds vs. seconds for an LLM call.
5. **Demonstrable in the presentation.** The redaction log provides concrete proof for judges that PII was stripped. Server logs show the redacted text that was actually sent to OpenAI.

## Pipeline

1. Extract `hero_alias` from report metadata; regex-replace in `raw_text`.
2. Match phone number patterns; replace with `[REDACTED-PHONE]`.
3. Match against known hero name roster (defense-in-depth); replace with `[REDACTED-NAME]`.
4. Write audit entry to `redaction_log` table.
5. Pass `redacted_text` (only) to the LLM service.

## Consequences

- Regex may miss novel PII patterns not covered by the static rules. Acceptable for this challenge because the PII types are known and fixed (hero aliases, phone numbers).
- The `metadata` object (containing raw PII) is stored server-side but is NEVER included in API responses or sent to the LLM.
