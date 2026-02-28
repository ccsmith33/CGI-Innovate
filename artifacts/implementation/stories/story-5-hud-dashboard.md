# Story 5: HUD Dashboard (Frontend)

## Status
Ready for Development

## Dependencies
- Stories 1 and 4 API contracts exist (can start development from architecture.md API specs)
- Backend does not need to be running -- use SWR with error handling for graceful degradation

## Objective
Scaffold the Next.js 15 frontend application with shadcn/ui, build the main analytics dashboard page with interactive Recharts visualizations (historical resource charts, forecast overlay with Time-to-Zero annotation, sector summary bar chart), implement sector and resource type filter controls, and set up SWR polling for live data refresh.

## D-ID References
- D-007: Next.js 15 App Router for frontend
- D-008: Recharts for chart visualization
- D-010: Docker + docker-compose for local dev

## Acceptance Criteria
- [ ] Next.js app scaffolded in `src/frontend/` with TypeScript, Tailwind, App Router
- [ ] shadcn/ui initialized with button, card, table, input, select, badge, separator, textarea components
- [ ] Dashboard page shows historical resource line charts after `docker-compose up` (data from GET /api/v1/resources)
- [ ] Sector and resource type filter dropdowns work without page refresh (client-side state -> SWR refetch)
- [ ] Forecast overlay renders as a dashed line with a Time-to-Zero label/annotation on the chart
- [ ] Sector summary bar chart shows current stock levels per sector (data from GET /api/v1/resources/summary)
- [ ] Charts have hover tooltips showing exact values
- [ ] Charts have Recharts Brush component for time-range zoom
- [ ] SWR auto-refreshes data every 5 seconds
- [ ] Sidebar navigation with "Analytics" (dashboard) and "Field Intel" (reports) links
- [ ] Dark theme applied globally
- [ ] `next.config.ts` has `output: 'standalone'` for Docker builds
- [ ] Frontend Dockerfile produces working container

## Dev Notes

### File Paths
Create inside `src/frontend/`:

```
src/frontend/
  package.json                    # via create-next-app
  tsconfig.json                   # via create-next-app
  next.config.ts                  # modify: add output: 'standalone'
  tailwind.config.ts              # via create-next-app + shadcn
  postcss.config.mjs              # via create-next-app
  Dockerfile                      # NEW: multi-stage Node build
  components.json                 # via shadcn init
  app/
    layout.tsx                    # Root layout: sidebar + dark theme
    page.tsx                      # Redirect to /dashboard
    globals.css                   # Tailwind base + shadcn theme vars
    dashboard/
      page.tsx                    # Main dashboard: charts + filters
    reports/
      page.tsx                    # Placeholder (Story 6)
  components/
    ui/                           # shadcn/ui components (auto-generated)
      button.tsx
      card.tsx
      table.tsx
      input.tsx
      select.tsx
      badge.tsx
      separator.tsx
      textarea.tsx
    charts/
      resource-chart.tsx          # NEW: Recharts LineChart for stock levels
      forecast-overlay.tsx        # NEW: dashed forecast line + Time-to-Zero pin
      sector-summary.tsx          # NEW: Recharts BarChart for sector stock snapshot
    layout/
      sidebar.tsx                 # NEW: branded sidebar navigation
  lib/
    api.ts                        # NEW: typed fetch wrappers
    types.ts                      # NEW: TypeScript interfaces
    utils.ts                      # shadcn cn() utility
```

Update root:
```
docker-compose.yml                # Update frontend service to build from src/frontend/
```

### Key Implementation Details

#### Project Init
```bash
cd src/frontend
npx create-next-app@latest . --typescript --tailwind --app --import-alias="@/*"
```

#### Dependencies
```bash
npm install recharts swr lucide-react clsx tailwind-merge class-variance-authority
npx shadcn@latest init
npx shadcn@latest add button card table input select badge separator textarea
```

#### lib/types.ts
```typescript
export interface ResourceLog {
  id: number;
  timestamp: string;
  sector_id: string;
  resource_type: string;
  stock_level: number;
  usage_rate_hourly: number;
  snap_event_detected: boolean;
}

export interface ResourceListResponse {
  data: ResourceLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface SummaryItem {
  sector_id: string;
  resource_type: string;
  latest_stock_level: number;
  latest_usage_rate: number;
  latest_timestamp: string;
  snap_event_detected: boolean;
}

export interface Forecast {
  id: number;
  sector_id: string;
  resource_type: string;
  predicted_exhaustion_date: string | null;
  hours_until_exhaustion: number | null;
  confidence: number;
  strategy_used: string;
  snap_detected: boolean;
  computed_at: string;
}

export interface IntelReport {
  report_id: string;
  timestamp: string;
  priority: string;
  status: string;
  redacted_text: string;
  extracted_entities: {
    sector_id: string | null;
    resource_type: string | null;
    severity: string;
    summary: string;
    confidence: number;
  } | null;
  created_at: string;
}
```

#### lib/api.ts
- `const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"`
- Typed fetch wrappers:
  - `fetchResources(params?: { sector?: string; resource_type?: string; limit?: number; offset?: number }): Promise<ResourceListResponse>`
  - `fetchSectors(): Promise<{ sectors: string[] }>`
  - `fetchResourceTypes(): Promise<{ resource_types: string[] }>`
  - `fetchSummary(): Promise<{ data: SummaryItem[] }>`
  - `fetchForecasts(): Promise<{ data: Forecast[] }>`
  - `fetchForecast(sector: string, resourceType: string): Promise<Forecast>`
  - `submitReport(body: { raw_text: string; metadata?: object; priority?: string }): Promise<{ report_id: string; status: string }>`
  - `fetchReports(params?: { limit?: number; offset?: number }): Promise<{ data: IntelReport[] }>`
- Each wrapper builds the URL with query params and calls `fetch()` with appropriate headers

#### app/layout.tsx
- Import `globals.css`
- Apply dark theme: `<html className="dark">` or via CSS variables
- Two-column layout: sidebar (fixed width ~240px) + main content area
- Render `<Sidebar />` + `{children}`

#### components/layout/sidebar.tsx
- Project branding: "Project Sentinel" title with shield icon (lucide-react `Shield` icon)
- Nav links using Next.js `Link`:
  - "Analytics" -> `/dashboard` (with `BarChart3` icon)
  - "Field Intel" -> `/reports` (with `FileText` icon)
- Active link highlighting based on `usePathname()`
- Dark background (zinc-900 or similar)

#### app/page.tsx
- Simple redirect to `/dashboard` using `redirect()` from next/navigation

#### app/dashboard/page.tsx
- `"use client"` directive (needs SWR + state)
- State: `selectedSector: string | null`, `selectedResourceType: string | null`
- SWR hooks:
  - `useSWR("/resources/sectors", fetchSectors)`
  - `useSWR("/resources/types", fetchResourceTypes)`
  - `useSWR(resourceKey, fetchResources, { refreshInterval: 5000 })` where resourceKey includes current filters
  - `useSWR("/resources/summary", fetchSummary, { refreshInterval: 5000 })`
  - `useSWR("/forecasts", fetchForecasts, { refreshInterval: 5000 })`
- Layout:
  1. Top row: Sector dropdown (Select) + Resource Type dropdown (Select) + "Clear Filters" button
  2. Main chart area: `<ResourceChart data={resources} />` with `<ForecastOverlay forecast={matchingForecast} />`
  3. Bottom row: `<SectorSummary data={summary} />`

#### components/charts/resource-chart.tsx
- Recharts `ResponsiveContainer` + `LineChart`
- X-axis: timestamp (formatted as date/time)
- Y-axis: stock_level
- `<Line>` for stock_level, stroke color per resource type or sector
- `<Tooltip>` with custom content showing timestamp, stock_level, usage_rate
- `<Brush>` for time-range zoom (Recharts built-in)
- Props: `data: ResourceLog[]`

#### components/charts/forecast-overlay.tsx
- Receives forecast data and renders on top of the resource chart
- Dashed line (`strokeDasharray="5 5"`) showing predicted trend from current to exhaustion
- `<ReferenceLine>` or custom annotation at the Time-to-Zero point with label showing predicted date
- If `predicted_exhaustion_date` is null, don't render overlay
- Props: `forecast: Forecast | null`, integrated into the same `LineChart` as resource-chart

#### components/charts/sector-summary.tsx
- Recharts `BarChart` showing latest stock per sector
- X-axis: sector_id
- Y-axis: latest_stock_level
- Color-coded bars per resource type
- Tooltip with exact values
- Props: `data: SummaryItem[]`

#### Dockerfile (src/frontend/)
Multi-stage build:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

#### next.config.ts
```typescript
const nextConfig = {
  output: 'standalone',
};
export default nextConfig;
```

### Test Requirements
Frontend testing is optional for the hackathon scope but the following are recommended if time allows:
- Verify dashboard page renders without crashing (smoke test)
- Verify filter state changes trigger SWR refetch
- Verify chart components accept required props without errors

## Estimated Scope
L (Large) -- full frontend scaffold + 3 chart components + data layer + styling
