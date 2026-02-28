# Story 6: HUD Input + Intel Table (Frontend)

## Status
Ready for Development

## Dependencies
- Story 5 (HUD Dashboard) must be complete -- needs layout, sidebar, shadcn/ui components, lib/api.ts, lib/types.ts
- Story 2 (POST /reports/submit API) must be complete for end-to-end functionality

## Objective
Build the Field Intel page with a report submission form and a live intelligence table. The form allows users to submit raw field reports with hero alias and secure contact metadata (clearly labeled as "will be redacted"). The intel table polls for processed reports via SWR and displays status badges, priority color-coding, and expandable rows showing full extracted intelligence JSON.

## D-ID References
- D-004: Server-side PII redaction before LLM (form labels communicate redaction to user)
- D-007: Next.js 15 App Router
- D-008: Recharts (not directly used here, but consistent UI framework)

## Acceptance Criteria
- [ ] Reports page at `/reports` has two-panel layout: form on left, table on right
- [ ] Form has fields: raw_text (textarea), hero_alias (text input), secure_contact (text input), priority (select dropdown)
- [ ] hero_alias and secure_contact inputs are labeled with "(will be redacted)" hint text
- [ ] Priority select offers: "Routine", "High", "Avengers Level Threat"
- [ ] Submit button POSTs to /api/v1/reports/submit and shows report_id + "Processing..." status immediately after success
- [ ] Intel table polls GET /api/v1/reports every 3 seconds via SWR
- [ ] Table columns: time, sector, resource, severity, summary, priority, status
- [ ] Status badge component: pending=yellow, processing=blue, processed=green, error=red
- [ ] Priority badges: Routine=gray, High=orange, Avengers Level Threat=red
- [ ] Clicking a table row expands to show full extracted_entities JSON
- [ ] Sidebar distinguishes "Analytics" (dashboard link) and "Field Intel" (reports link)

## Dev Notes

### File Paths
Create or modify inside `src/frontend/`:

```
app/reports/page.tsx                    # NEW: Field Intel page
components/reports/report-form.tsx      # NEW: report submission form
components/reports/intel-table.tsx      # NEW: live intelligence table
components/reports/status-badge.tsx     # NEW: colored status indicator
```

### Key Implementation Details

#### app/reports/page.tsx
- `"use client"` directive
- Two-panel responsive layout:
  - Left panel (1/3 width on desktop, full on mobile): `<ReportForm />`
  - Right panel (2/3 width on desktop, full on mobile): `<IntelTable />`
- Page title: "Field Intel"

#### components/reports/report-form.tsx
- Controlled form with state for: `rawText`, `heroAlias`, `secureContact`, `priority`
- Fields:
  - **Raw Report Text** (textarea): large, multi-line, placeholder "Enter field report text..."
  - **Hero Alias** (text input): label includes "(will be redacted)" in muted text, placeholder "e.g., Tony Stark"
  - **Secure Contact** (text input): label includes "(will be redacted)" in muted text, placeholder "e.g., 555-0101"
  - **Priority** (shadcn Select): options are "Routine", "High", "Avengers Level Threat", default "Routine"
  - **Submit** button (shadcn Button): "Submit Report"
- On submit:
  1. Set loading state
  2. Call `submitReport({ raw_text: rawText, metadata: { hero_alias: heroAlias, secure_contact: secureContact }, priority })`
  3. On success: show success message with report_id and a processing status badge
  4. Clear form fields
  5. On error: show error message
- Disable submit button while loading or if rawText is empty
- Use shadcn Card component to wrap the form

#### components/reports/status-badge.tsx
- Props: `status: string`
- Uses shadcn Badge component with variant colors:
  - `"pending"` -> yellow/amber background
  - `"processing"` -> blue background
  - `"processed"` -> green background
  - `"error"` -> red background
- Display the status text capitalized inside the badge

#### components/reports/intel-table.tsx
- SWR hook: `useSWR("/reports", fetchReports, { refreshInterval: 3000 })`
- Uses shadcn Table component
- Column headers: Time, Sector, Resource, Severity, Summary, Priority, Status
- Each row maps from `IntelReport`:
  - **Time**: `created_at` formatted as short date/time
  - **Sector**: `extracted_entities?.sector_id || "---"`
  - **Resource**: `extracted_entities?.resource_type || "---"`
  - **Severity**: `extracted_entities?.severity || "---"`
  - **Summary**: `extracted_entities?.summary || "Awaiting processing..."`
  - **Priority**: colored badge
    - "Routine" -> gray
    - "High" -> orange
    - "Avengers Level Threat" -> red (use destructive variant)
  - **Status**: `<StatusBadge status={report.status} />`
- Row click expands/collapses a detail panel:
  - Shows full `extracted_entities` as formatted JSON (`JSON.stringify(entities, null, 2)` in a `<pre>` block)
  - Uses a `<code>` block with monospace font and dark background
- State: `expandedRowId: string | null` -- tracks which row is expanded
- Empty state: "No reports submitted yet" message when data is empty
- Loading state: show skeleton or spinner while SWR is loading

#### Priority badge component (inline or extracted)
Since priority badges use different colors than status badges, implement as either:
- A separate `PriorityBadge` component, OR
- Inline logic in the table using shadcn Badge with computed variant/className

Color mapping:
```typescript
const priorityColors: Record<string, string> = {
  "Routine": "bg-gray-500/20 text-gray-400",
  "High": "bg-orange-500/20 text-orange-400",
  "Avengers Level Threat": "bg-red-500/20 text-red-400",
};
```

#### SWR Configuration
- `refreshInterval: 3000` (3 seconds) for reports table -- faster than dashboard since users want to see processing results quickly
- `revalidateOnFocus: true` (SWR default)
- Handle SWR error state: show "Failed to load reports" message

### Test Requirements
Frontend testing is optional for the hackathon scope but the following are recommended if time allows:
- Verify report form renders all required fields
- Verify submit button is disabled when rawText is empty
- Verify status badge renders correct color for each status
- Verify intel table renders rows from mock data

## Estimated Scope
M (Medium)
