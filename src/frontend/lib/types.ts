export interface ResourceLog {
  id: number
  timestamp: string
  sector_id: string
  resource_type: string
  stock_level: number
  usage_rate_hourly: number
  snap_event_detected: boolean
}

export interface ResourceListResponse {
  data: ResourceLog[]
  total: number
  limit: number
  offset: number
}

export interface SummaryItem {
  sector_id: string
  resource_type: string
  latest_stock_level: number
  latest_usage_rate: number
  latest_timestamp: string
  snap_event_detected: boolean
}

export interface Forecast {
  id: number
  sector_id: string
  resource_type: string
  predicted_exhaustion_date: string | null
  hours_until_exhaustion: number | null
  confidence: number
  strategy_used: string
  snap_detected: boolean
  computed_at: string
}

export interface RedactionLogItem {
  id: number
  report_id: string
  original_text_hash: string
  redacted_text: string
  patterns_matched: string[]
  redacted_at: string
}

export interface RedactionPreview {
  original: string
  redacted: string
  patterns_matched: string[]
}

export interface IntelReport {
  report_id: string
  timestamp: string
  priority: string
  status: string
  redacted_text: string
  extracted_entities: {
    sector_id: string | null
    resource_type: string | null
    severity: string
    summary: string
    confidence: number
  } | null
  created_at: string
}

export interface GovernorModelInfo {
  confidence: number
  data_points: number
  trained_at: string
}

export interface GovernorAllocation {
  sector_id: string
  resource_type: string
  units_per_cycle: number
  cost_per_cycle: number
}

export interface GovernorStatus {
  champion: GovernorModelInfo
  challenger: GovernorModelInfo
  backup: GovernorModelInfo
  current_allocations: GovernorAllocation[]
  total_budget_used: number
  total_budget: number
}

export interface GovernorDecision {
  timestamp: string
  rationale: string
  sectors_adjusted: string[]
  champion_confidence: number
  total_budget_used: number
  allocations_json: string
}

export interface TimeToZeroRaw {
  sector_id: string
  resource_type: string
  current_stock: number
  hours_to_zero: number | null
  consumption_rate_hourly: number | null
}

export type NetStatus =
  | 'STABLE'
  | 'RECOVERING'
  | 'LOW'
  | 'CRITICAL'
  | 'DEPLETING'
  | 'EXHAUSTED'

export interface TimeToZeroEntry {
  sector_id: string
  resource_type: string
  hours_to_zero: number | null
  current_stock: number
  consumption_rate: number
  snap_detected?: boolean
  /** Governor production rate (units/hour). Populated by enrichment on the frontend. */
  production_rate_hourly?: number
  /** Target stock from resource config. Populated by enrichment on the frontend. */
  target_stock?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface JarvisChatResponse {
  reply: string
  function_calls_made: string[]
}
