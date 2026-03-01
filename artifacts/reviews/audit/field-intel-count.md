# Field Intel Count Discrepancy Audit

**Date**: 2026-02-28
**Auditor**: researcher@cgi-ux

## Summary

The `field_intel_reports.json` source file contains **200 entries**. The Field Intel page in the frontend displays only **50** by default. The root cause is the **API default query limit of 50**, combined with the **frontend not passing a limit or implementing pagination**.

---

## 1. JSON Source Count

- **File**: `Prompt-Resources/challenger_package/challenger_package/field_intel_reports.json`
- **Entries**: **200** (confirmed via programmatic count)
- **Structure**: Array of objects with keys `report_id`, `metadata`, `raw_text`, `timestamp`, `priority`

## 2. Seed Script Analysis

- **File**: `src/backend/scripts/seed_db.py`, function `seed_intel_reports` (lines 69-106)
- **Finding**: The seed script iterates over **all** entries in the JSON file with no limit or filter. All 200 reports are inserted into the database.
- **Verdict**: **Not the bottleneck.** All 200 entries are seeded.

## 3. Backend API Analysis (PRIMARY ROOT CAUSE)

- **File**: `src/backend/app/routers/reports.py`, function `list_reports` (lines 116-146)
- **Finding**: The `GET /api/v1/reports` endpoint has a default `limit` parameter of **50** (line 120):
  ```python
  limit: int = Query(default=50, ge=1, le=1000),
  ```
- The endpoint supports pagination via `limit` and `offset` query parameters, and returns a `total` count in the response body.
- **Verdict**: **This is the primary bottleneck.** When the frontend calls the API without specifying a `limit`, only 50 reports are returned.

## 4. Frontend Analysis (CONTRIBUTING CAUSE)

### `src/frontend/lib/api.ts` (lines 66-77)

- The `fetchReports` function accepts optional `limit` and `offset` parameters.
- However, it only appends them to the query string if they are truthy (`if (params?.limit)`).
- **No default limit is passed.** When called without arguments, no `limit` query param is sent, so the API defaults to 50.

### `src/frontend/components/reports/intel-table.tsx` (line 148)

- The `IntelTable` component calls `fetchReports()` with **no arguments**:
  ```tsx
  useSWR('reports', () => fetchReports(), { refreshInterval: 3000 })
  ```
- There is **no pagination UI** -- no "Load More", no page controls, no infinite scroll.
- The component renders whatever comes back from the API (the first 50) and stops there.
- **Verdict**: The frontend never requests more than the API default of 50, and has no mechanism to paginate through the remaining 150 entries.

## 5. LLM Processing Analysis

- **File**: `src/backend/app/routers/reports.py`, function `process_report_background` (lines 33-57)
- Reports start with `status="pending"` after seeding. LLM processing updates them to `"processed"` or `"error"`.
- If the OpenAI API fails, the report status is set to `"error"` with an error message. The report still exists in the database and is still returned by the API.
- **Verdict**: LLM failures do **not** cause reports to disappear. They remain visible regardless of processing status. This is not a factor in the count discrepancy.

---

## Root Cause Summary

| Layer | File | Line | Issue |
|-------|------|------|-------|
| **Backend API** | `src/backend/app/routers/reports.py` | 120 | Default `limit=50` on `GET /api/v1/reports` |
| **Frontend API client** | `src/frontend/lib/api.ts` | 148 (in intel-table.tsx) | `fetchReports()` called with no `limit` param |
| **Frontend UI** | `src/frontend/components/reports/intel-table.tsx` | 148 | No pagination controls; displays only first page of results |

The seed script and LLM processing are **not** contributing factors. All 200 entries exist in the database.

---

## Recommended Fixes

1. **Frontend: Pass a higher limit or implement pagination** -- Either call `fetchReports({ limit: 500 })` to fetch all reports in one call (acceptable given 200 entries), or implement client-side pagination using the `total`, `limit`, and `offset` values already returned by the API's `ReportListResponse` schema.

2. **Backend (optional): Increase default limit** -- Consider raising the default from 50 to 200 on the `GET /api/v1/reports` endpoint (`src/backend/app/routers/reports.py:120`). This is a quick fix but does not scale; pagination on the frontend is the proper solution.

3. **Frontend: Add pagination controls** -- The API already returns `total`, `limit`, and `offset` in the response. The `IntelTable` component should use these to render page navigation or a "Load More" button, and pass `offset` to subsequent `fetchReports()` calls.
