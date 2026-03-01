'use client'

import useSWR from 'swr'
import { Loader2 } from 'lucide-react'
import { fetchForecasts, fetchSummary, fetchTimeToZero, fetchGovernorStatus, TARGET_STOCK } from '@/lib/api'
import { MarvelMap } from '@/components/map/marvel-map'
import type { Forecast, SummaryItem, TimeToZeroEntry } from '@/lib/types'

export default function MapPage() {
  const { data: forecastsData, isLoading: forecastsLoading } = useSWR(
    'forecasts',
    fetchForecasts,
    { refreshInterval: 5000 }
  )

  const { data: summaryData, isLoading: summaryLoading } = useSWR(
    'summary',
    fetchSummary,
    { refreshInterval: 5000 }
  )

  const { data: ttzData } = useSWR('time-to-zero-map', fetchTimeToZero, {
    refreshInterval: 5000,
  })

  const { data: govData } = useSWR('governor-status-map', fetchGovernorStatus, {
    refreshInterval: 5000,
  })

  const forecasts: Forecast[] = forecastsData?.data ?? []
  const summary: SummaryItem[] = summaryData?.data ?? []
  const rawTTZ: TimeToZeroEntry[] = Array.isArray(ttzData) ? ttzData : []

  // Enrich TTZ entries with production rate from governor allocations
  const timeToZero: TimeToZeroEntry[] = rawTTZ.map((entry) => {
    const key = `${entry.sector_id}|${entry.resource_type}`
    const alloc = govData?.current_allocations?.find(
      (a) => a.sector_id === entry.sector_id && a.resource_type === entry.resource_type
    )
    const productionRateHourly = alloc ? alloc.units_per_cycle * 120 : 0
    return {
      ...entry,
      production_rate_hourly: productionRateHourly,
      target_stock: TARGET_STOCK[key],
    }
  })

  if (forecastsLoading || summaryLoading) {
    return (
      <div className="flex items-center justify-center h-screen gap-2 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span>Initializing tactical map...</span>
      </div>
    )
  }

  return (
    <div className="p-6">
      <MarvelMap forecasts={forecasts} summary={summary} timeToZero={timeToZero} />
    </div>
  )
}
