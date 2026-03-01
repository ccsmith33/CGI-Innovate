import { useMemo } from 'react'
import type { Forecast } from '@/lib/types'

export type AlertLevel = 'EXHAUSTED' | 'CRITICAL' | 'WARNING'

export interface ForecastAlert {
  sector_id: string
  resource_type: string
  level: AlertLevel
  hours_remaining: number
}

export function getAlertLevel(hours: number | null): AlertLevel | null {
  if (hours == null) return null
  if (hours <= 0) return 'EXHAUSTED'
  if (hours < 48) return 'CRITICAL'
  if (hours < 120) return 'WARNING'
  return null
}

export function useAlerts(forecasts: Forecast[]): ForecastAlert[] {
  return useMemo(() => {
    const alerts: ForecastAlert[] = []
    for (const f of forecasts) {
      const level = getAlertLevel(f.hours_until_exhaustion)
      if (level) {
        alerts.push({
          sector_id: f.sector_id,
          resource_type: f.resource_type,
          level,
          hours_remaining: f.hours_until_exhaustion ?? 0,
        })
      }
    }
    // Sort: EXHAUSTED first, then CRITICAL, then WARNING
    const order: Record<AlertLevel, number> = { EXHAUSTED: 0, CRITICAL: 1, WARNING: 2 }
    alerts.sort((a, b) => order[a.level] - order[b.level])
    return alerts
  }, [forecasts])
}
