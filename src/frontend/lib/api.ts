import type { SummaryItem, Forecast, IntelReport, RedactionLogItem, RedactionPreview, ChatMessage, JarvisChatResponse, GovernorStatus, GovernorDecision, GovernorModelInfo, GovernorAllocation, TimeToZeroEntry, NetStatus } from './types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const V1 = `${API_BASE}/api/v1`

export async function fetchResources(params?: {
  sector?: string
  resource_type?: string
  limit?: number
  offset?: number
}) {
  const qs = new URLSearchParams()
  if (params?.sector) qs.set('sector', params.sector)
  if (params?.resource_type) qs.set('resource_type', params.resource_type)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const query = qs.toString()
  const res = await fetch(`${V1}/resources${query ? `?${query}` : ''}`)
  if (!res.ok) throw new Error(`Failed to fetch resources: ${res.status}`)
  return res.json()
}

export async function fetchSectors(): Promise<{ sectors: string[] }> {
  const res = await fetch(`${V1}/resources/sectors`)
  if (!res.ok) throw new Error(`Failed to fetch sectors: ${res.status}`)
  return res.json()
}

export async function fetchSummary(): Promise<{ data: SummaryItem[] }> {
  const res = await fetch(`${V1}/resources/summary`)
  if (!res.ok) throw new Error(`Failed to fetch summary: ${res.status}`)
  return res.json()
}

export async function fetchForecasts(): Promise<{ data: Forecast[] }> {
  const res = await fetch(`${V1}/forecasts`)
  if (!res.ok) throw new Error(`Failed to fetch forecasts: ${res.status}`)
  return res.json()
}

export async function fetchForecast(
  sector: string,
  resourceType: string
): Promise<Forecast> {
  const res = await fetch(
    `${V1}/forecasts/${encodeURIComponent(sector)}/${encodeURIComponent(resourceType)}`
  )
  if (!res.ok) throw new Error(`Failed to fetch forecast: ${res.status}`)
  return res.json()
}

export async function submitReport(body: {
  raw_text: string
  metadata?: { hero_alias?: string; secure_contact?: string }
  priority?: string
}): Promise<{ report_id: string; status: string }> {
  const res = await fetch(`${V1}/reports/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Failed to submit report: ${res.status}`)
  return res.json()
}

export async function fetchReports(params?: {
  limit?: number
  offset?: number
}): Promise<{ data: IntelReport[] }> {
  const qs = new URLSearchParams()
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const query = qs.toString()
  const res = await fetch(`${V1}/reports${query ? `?${query}` : ''}`)
  if (!res.ok) throw new Error(`Failed to fetch reports: ${res.status}`)
  return res.json()
}

export async function fetchReport(reportId: string): Promise<IntelReport> {
  const res = await fetch(`${V1}/reports/${encodeURIComponent(reportId)}`)
  if (!res.ok) throw new Error(`Failed to fetch report: ${res.status}`)
  return res.json()
}

export async function processAllPendingReports(): Promise<{ queued: number; message: string }> {
  const res = await fetch(`${V1}/reports/process-pending`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to process pending reports: ${res.status}`)
  return res.json()
}

export async function refreshForecasts(): Promise<{ message: string; strategy: string }> {
  const res = await fetch(`${V1}/forecasts/refresh`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to refresh forecasts: ${res.status}`)
  return res.json()
}

export async function fetchRedactionPreview(text: string): Promise<RedactionPreview> {
  const res = await fetch(`${V1}/reports/preview-redaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`Failed to fetch redaction preview: ${res.status}`)
  return res.json()
}

export async function sendJarvisMessage(
  message: string,
  history: ChatMessage[]
): Promise<JarvisChatResponse> {
  const res = await fetch(`${V1}/jarvis/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversation_history: history }),
  })
  if (!res.ok) throw new Error(`Failed to send Jarvis message: ${res.status}`)
  return res.json()
}

// Cost-per-unit lookup matching backend resource_config.py
const COST_PER_UNIT: Record<string, number> = {
  'Avengers Compound|Medical Kits': 1750,
  'New Asgard|Vibranium (kg)': 4000,
  'Sanctum Sanctorum|Clean Water (L)': 1000,
  'Sokovia|Pym Particles': 4500,
  'Wakanda|Arc Reactor Cores': 5000,
}

// Base production units_per_cycle matching backend resource_config.py
const BASE_PRODUCTION: Record<string, number> = {
  'Avengers Compound|Medical Kits': 8.0,
  'New Asgard|Vibranium (kg)': 3.0,
  'Sanctum Sanctorum|Clean Water (L)': 10.0,
  'Sokovia|Pym Particles': 5.0,
  'Wakanda|Arc Reactor Cores': 4.0,
}

// Target stock per sector|resource matching backend resource_config.py
export const TARGET_STOCK: Record<string, number> = {
  'Avengers Compound|Medical Kits': 600,
  'New Asgard|Vibranium (kg)': 300,
  'Sanctum Sanctorum|Clean Water (L)': 750,
  'Sokovia|Pym Particles': 420,
  'Wakanda|Arc Reactor Cores': 180,
}

/**
 * Compute the status badge from stock position relative to target.
 *
 * Priority:
 *   1. EXHAUSTED: stock <= 10
 *   2. CRITICAL: stock < 20% of target
 *   3. RECOVERING: stock < 75% of target (governor is ramping to close gap)
 *   4. OPTIMAL: stock > 120% of target (governor is cutting back surplus)
 *   5. STABLE: stock within 75-120% of target (near target, holding steady)
 */
export function computeNetStatus(entry: TimeToZeroEntry): NetStatus {
  const stock = entry.current_stock
  const target = entry.target_stock

  if (stock <= 10) return 'EXHAUSTED'

  if (target != null && target > 0) {
    const pct = stock / target
    if (pct < 0.2) return 'CRITICAL'
    if (pct < 0.75) return 'RECOVERING'
    if (pct > 1.2) return 'OPTIMAL'
  }

  return 'STABLE'
}

function normalizeModelInfo(raw: Record<string, unknown> | null): GovernorModelInfo {
  if (!raw) return { confidence: 0, data_points: 0, trained_at: new Date().toISOString() }
  return {
    confidence: (raw.overall_confidence as number) ?? (raw.confidence as number) ?? 0,
    data_points: (raw.data_points as number) ?? 0,
    trained_at: (raw.trained_at as string) ?? new Date().toISOString(),
  }
}

function normalizeAllocations(raw: Record<string, number> | null | undefined): GovernorAllocation[] {
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw).map(([key, units]) => {
    const [sector_id, resource_type] = key.split('|', 2)
    const costPerUnit = COST_PER_UNIT[key] ?? 1
    const baseProd = BASE_PRODUCTION[key] ?? 5.0
    let status: GovernorAllocation['status'] = 'MAINTAINING'
    if (units < baseProd * 0.9) status = 'CUTTING'
    else if (units > baseProd * 1.5) status = 'RAMPING'
    return {
      sector_id: sector_id ?? key,
      resource_type: resource_type ?? '',
      units_per_cycle: units,
      cost_per_cycle: units * costPerUnit,
      status,
    }
  })
}

export async function fetchGovernorStatus(): Promise<GovernorStatus> {
  const res = await fetch(`${V1}/governor/status`)
  if (!res.ok) throw new Error(`Failed to fetch governor status: ${res.status}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json()
  const champion = normalizeModelInfo(raw.champion)
  const championAllocations = raw.champion?.allocations ?? {}
  return {
    champion,
    challenger: normalizeModelInfo(raw.challenger),
    backup: normalizeModelInfo(raw.backup),
    current_allocations: normalizeAllocations(championAllocations),
    total_budget_used: raw.budget_used ?? raw.total_budget_used ?? 0,
    total_budget: raw.budget_total ?? raw.total_budget ?? 0,
  }
}

export async function fetchGovernorDecisions(limit?: number): Promise<GovernorDecision[]> {
  const qs = limit ? `?limit=${limit}` : ''
  const res = await fetch(`${V1}/governor/decisions${qs}`)
  if (!res.ok) throw new Error(`Failed to fetch governor decisions: ${res.status}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = await res.json()
  if (!Array.isArray(raw)) return []
  return raw.map((d) => ({
    timestamp: d.timestamp ?? '',
    rationale: d.rationale ?? '',
    sectors_adjusted: Array.isArray(d.sectors_adjusted)
      ? d.sectors_adjusted
      : typeof d.sectors_adjusted === 'number'
        ? [`${d.sectors_adjusted} sector(s)`]
        : [],
    champion_confidence: d.champion_confidence ?? 0,
    total_budget_used: d.total_budget_used ?? 0,
    allocations_json: typeof d.allocations === 'string'
      ? d.allocations
      : JSON.stringify(d.allocations ?? d.allocations_json ?? {}),
  }))
}

export async function fetchTimeToZero(): Promise<TimeToZeroEntry[]> {
  const res = await fetch(`${V1}/governor/time-to-zero`)
  if (!res.ok) throw new Error(`Failed to fetch time-to-zero: ${res.status}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json()
  const arr = Array.isArray(raw) ? raw : []
  return arr.map((entry: Record<string, unknown>) => ({
    sector_id: (entry.sector_id as string) ?? '',
    resource_type: (entry.resource_type as string) ?? '',
    hours_to_zero: (entry.hours_to_zero as number | null) ?? null,
    current_stock: (entry.current_stock as number) ?? 0,
    consumption_rate: (entry.consumption_rate_hourly as number) ?? (entry.consumption_rate as number) ?? 0,
    snap_detected: (entry.snap_detected as boolean) ?? false,
  }))
}

export async function triggerSnap(): Promise<{ message: string }> {
  const res = await fetch(`${V1}/governor/snap`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to trigger snap: ${res.status}`)
  return res.json()
}

export async function overrideProduction(
  sector_id: string,
  resource_type: string,
  units_per_cycle: number
): Promise<{ message: string }> {
  const res = await fetch(`${V1}/governor/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sector_id, resource_type, units_per_cycle }),
  })
  if (!res.ok) throw new Error(`Failed to override production: ${res.status}`)
  return res.json()
}

export interface DefconStatus {
  level: number
  label: string
  color: string
}

export async function fetchDefcon(): Promise<DefconStatus> {
  const res = await fetch(`${V1}/feed/defcon`)
  if (!res.ok) throw new Error(`Failed to fetch DEFCON: ${res.status}`)
  return res.json()
}

export interface ImageAnalysis {
  threat_type: string
  affected_sector: string
  severity: string
  resources_at_risk: string[]
  summary: string
  recommended_action: string
}

export async function analyzeImage(file: File): Promise<{ analysis: ImageAnalysis; report_id: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${V1}/reports/analyze-image`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) throw new Error(`Failed to analyze image: ${res.status}`)
  return res.json()
}

export interface ScenarioInfo {
  id: string
  name: string
  description: string
}

export async function fetchScenarios(): Promise<ScenarioInfo[]> {
  const res = await fetch(`${V1}/governor/scenarios`)
  if (!res.ok) throw new Error(`Failed to fetch scenarios: ${res.status}`)
  return res.json()
}

export async function triggerScenario(scenarioId: string): Promise<{ message: string; steps: number }> {
  const res = await fetch(`${V1}/governor/scenario/${encodeURIComponent(scenarioId)}`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Failed to trigger scenario: ${res.status}`)
  return res.json()
}

export async function pauseAgent(): Promise<void> {
  const res = await fetch(`${V1}/agent/pause`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to pause agent: ${res.status}`)
}

export async function resumeAgent(): Promise<void> {
  const res = await fetch(`${V1}/agent/resume`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to resume agent: ${res.status}`)
}

export async function fetchAgentStatus(): Promise<{ paused: boolean }> {
  const res = await fetch(`${V1}/agent/status`)
  if (!res.ok) throw new Error(`Failed to fetch agent status: ${res.status}`)
  return res.json()
}

export async function fetchRedactionLog(params?: {
  limit?: number
  offset?: number
}): Promise<{ total: number; items: RedactionLogItem[] }> {
  const qs = new URLSearchParams()
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const query = qs.toString()
  const res = await fetch(`${V1}/admin/redaction-log${query ? `?${query}` : ''}`)
  if (!res.ok) throw new Error(`Failed to fetch redaction log: ${res.status}`)
  return res.json()
}
