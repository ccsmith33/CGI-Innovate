import type { ResourceLog } from '@/lib/types'
import { buildForecastLine } from '@/components/charts/resource-chart'

function makeLog(overrides: Partial<ResourceLog> = {}): ResourceLog {
  return {
    id: 1,
    timestamp: '2026-01-01T10:00:00Z',
    sector_id: 'Wakanda',
    resource_type: 'Vibranium (kg)',
    stock_level: 100,
    usage_rate_hourly: 5,
    snap_event_detected: false,
    ...overrides,
  }
}

function makeForecast(overrides: Partial<{
  predicted_exhaustion_date: string | null
  hours_until_exhaustion: number | null
}> = {}) {
  return {
    predicted_exhaustion_date: '2026-01-02T10:00:00Z' as string | null,
    hours_until_exhaustion: 24 as number | null,
    ...overrides,
  }
}

describe('buildForecastLine', () => {
  it('returns two points when forecast has valid exhaustion data', () => {
    const logs = [
      makeLog({ timestamp: '2026-01-01T08:00:00Z', stock_level: 150 }),
      makeLog({ timestamp: '2026-01-01T10:00:00Z', stock_level: 100 }),
    ]
    const forecast = makeForecast()

    const result = buildForecastLine(logs, forecast)

    expect(result).toHaveLength(2)
    // First point should match the last historical stock level
    expect(result[0].forecast_level).toBe(100)
    // Second point should be at 0 (exhaustion)
    expect(result[1].forecast_level).toBe(0)
  })

  it('returns empty array when forecast is null', () => {
    const logs = [makeLog()]
    const result = buildForecastLine(logs, null)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when no exhaustion date', () => {
    const logs = [makeLog()]
    const forecast = makeForecast({
      predicted_exhaustion_date: null,
      hours_until_exhaustion: null,
    })

    const result = buildForecastLine(logs, forecast)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when hours_until_exhaustion is zero or negative', () => {
    const logs = [makeLog()]
    const forecast = makeForecast({ hours_until_exhaustion: 0 })

    const result = buildForecastLine(logs, forecast)
    expect(result).toHaveLength(0)
  })

  it('returns empty array when no data points', () => {
    const forecast = makeForecast()
    const result = buildForecastLine([], forecast)
    expect(result).toHaveLength(0)
  })

  it('uses the last data point by timestamp for the start of the projection', () => {
    const logs = [
      makeLog({ timestamp: '2026-01-01T12:00:00Z', stock_level: 50 }),
      makeLog({ timestamp: '2026-01-01T08:00:00Z', stock_level: 200 }),
      makeLog({ timestamp: '2026-01-01T10:00:00Z', stock_level: 100 }),
    ]
    const forecast = makeForecast()

    const result = buildForecastLine(logs, forecast)

    // Should use the point with the latest timestamp (12:00, stock=50)
    expect(result[0].forecast_level).toBe(50)
  })
})
