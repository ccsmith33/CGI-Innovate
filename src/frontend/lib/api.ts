import type { SummaryItem, Forecast, IntelReport } from './types'

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

export async function fetchResourceTypes(): Promise<{ resource_types: string[] }> {
  const res = await fetch(`${V1}/resources/types`)
  if (!res.ok) throw new Error(`Failed to fetch resource types: ${res.status}`)
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
