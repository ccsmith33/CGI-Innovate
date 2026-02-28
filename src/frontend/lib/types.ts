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
