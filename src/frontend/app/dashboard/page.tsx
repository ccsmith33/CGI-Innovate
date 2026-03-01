'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ResourceChart } from '@/components/charts/resource-chart'
import { SectorSummary } from '@/components/charts/sector-summary'
import {
  fetchSummary,
  fetchForecasts,
  refreshForecasts,
  fetchTimeToZero,
  fetchGovernorStatus,
  computeNetStatus,
  TARGET_STOCK,
} from '@/lib/api'
import type { SummaryItem, Forecast, TimeToZeroEntry, NetStatus } from '@/lib/types'
import { CommandCenter } from '@/components/command-center/command-center'
import { NotificationBell } from '@/components/alerts/notification-bell'
import { ToastContainer, useToasts, useAlertToasts } from '@/components/alerts/toast'
import { useAlerts } from '@/hooks/use-alerts'
import { Loader2, AlertCircle, Brain } from 'lucide-react'

function formatTimeToZero(hours: number | null): string {
  if (hours === null) return '\u2014'
  if (hours < 1 / 60) return '< 1 min remaining'
  if (hours < 1) return `${Math.round(hours * 60)} min remaining`
  if (hours < 24) return `${hours.toFixed(1)}h remaining`
  return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h remaining`
}

/* ── Status badge styling ── */
const STATUS_BADGE_STYLES: Record<NetStatus, { badgeClass: string; cardClass: string }> = {
  STABLE: {
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
    cardClass: 'border-green-500/40 bg-green-500/5',
  },
  RECOVERING: {
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    cardClass: 'border-amber-500/40 bg-amber-500/5',
  },
  LOW: {
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    cardClass: 'border-amber-500/40 bg-amber-500/5',
  },
  CRITICAL: {
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
    cardClass: 'border-red-500/60 bg-red-500/5',
  },
  DEPLETING: {
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
    cardClass: 'border-red-500/60 bg-red-500/5',
  },
  EXHAUSTED: {
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
    cardClass: 'border-red-500/60 bg-red-500/5',
  },
}

/* ── Time-to-Zero card with net-rate-based status ── */
function TimeToZeroCard({ entry }: { entry: TimeToZeroEntry }) {
  const h = entry.hours_to_zero

  const statusLabel = computeNetStatus(entry)
  const style = STATUS_BADGE_STYLES[statusLabel]
  const statusBadgeClass = style.badgeClass
  const statusColor = style.cardClass
  const flashing = statusLabel === 'DEPLETING'

  return (
    <div className={`rounded-lg border p-4 space-y-2 ${statusColor}`} data-testid="ttz-card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">
            {entry.sector_id}
          </p>
          <p className="text-sm font-medium text-gray-200">{entry.resource_type}</p>
        </div>
        <Badge
          variant="outline"
          className={`text-xs ${statusBadgeClass} ${flashing ? 'animate-pulse' : ''}`}
          data-testid="ttz-status"
        >
          {statusLabel}
        </Badge>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-gray-500">Time to Zero (no production)</p>
        {statusLabel === 'EXHAUSTED' ? (
          <p className="text-sm font-semibold text-red-400">EXHAUSTED</p>
        ) : h != null ? (
          <p className="text-sm font-semibold text-gray-200">
            {formatTimeToZero(h)}
          </p>
        ) : (
          <p className="text-sm font-semibold text-green-400">&mdash;</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-gray-700/50">
        <span className="text-xs text-gray-600">
          Stock: {entry.current_stock.toLocaleString()} | Rate: {Math.round(entry.consumption_rate)} u/hr
        </span>
        {entry.snap_detected === true && (
          <span className="text-xs text-purple-400">Snap detected</span>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const {
    data: summaryData,
    error: summaryError,
    isLoading: summaryLoading,
  } = useSWR('summary', fetchSummary, { refreshInterval: 5000 })

  const summary: SummaryItem[] = summaryData?.data ?? []

  const {
    data: forecastsData,
    mutate: mutateForcasts,
  } = useSWR('forecasts', fetchForecasts, {
    refreshInterval: 30000,
  })

  const {
    data: ttzData,
  } = useSWR('time-to-zero', fetchTimeToZero, {
    refreshInterval: 5000,
  })

  const {
    data: govData,
  } = useSWR('governor-status-dashboard', fetchGovernorStatus, {
    refreshInterval: 5000,
  })

  const rawTimeToZero: TimeToZeroEntry[] = Array.isArray(ttzData) ? ttzData : []
  const forecasts: Forecast[] = forecastsData?.data ?? []

  // Enrich TTZ entries with production rate from governor allocations
  const timeToZero: TimeToZeroEntry[] = rawTimeToZero.map((entry) => {
    const key = `${entry.sector_id}|${entry.resource_type}`
    const alloc = govData?.current_allocations?.find(
      (a) => a.sector_id === entry.sector_id && a.resource_type === entry.resource_type
    )
    // Governor allocations are units_per_cycle (30s cycle) → 120 cycles/hr
    const productionRateHourly = alloc ? alloc.units_per_cycle * 120 : 0
    return {
      ...entry,
      production_rate_hourly: productionRateHourly,
      target_stock: TARGET_STOCK[key],
    }
  })

  const alerts = useAlerts(forecasts)
  const { toasts, addToast, dismiss } = useToasts()
  useAlertToasts(alerts, addToast)

  async function handleRefreshForecasts() {
    await refreshForecasts()
    mutateForcasts()
  }

  // Sort time-to-zero: exhausted/depleting first, then by hours
  const sortedTTZ = [...timeToZero].sort((a, b) => {
    const aH = a.hours_to_zero ?? Infinity
    const bH = b.hours_to_zero ?? Infinity
    // Exhausted (stock <= 10) first
    if (a.current_stock <= 10 && b.current_stock > 10) return -1
    if (b.current_stock <= 10 && a.current_stock > 10) return 1
    return aH - bH
  })

  return (
    <div className="p-6 space-y-6">
      <ToastContainer toasts={toasts} dismiss={dismiss} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Analytics Dashboard</h1>
        <div className="flex items-center gap-3">
          <NotificationBell alerts={alerts} />
        </div>
      </div>

      {/* Time-to-Zero Intelligence Grid */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-400" />
              Jarvis ML Forecast Intelligence
              <span className="text-xs text-gray-500 font-normal ml-1">
                Autonomous Resource Governance · Live Feed · ML-Controlled
              </span>
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshForecasts}
              className="border-gray-700 text-gray-400 hover:bg-gray-800 text-xs"
            >
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {timeToZero.length === 0 ? (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Computing forecasts...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {sortedTTZ.map((entry) => (
                <TimeToZeroCard
                  key={`${entry.sector_id}-${entry.resource_type}`}
                  entry={entry}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Command Center */}
      <CommandCenter />

      {/* Resource Chart — self-contained with toggle buttons */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-lg">
              Resource Stock Levels
            </CardTitle>
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <ResourceChart />
        </CardContent>
      </Card>

      {/* Sector Summary */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">
            Sector Stock Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : summaryError ? (
            <div className="flex items-center justify-center h-64 gap-2 text-red-400">
              <AlertCircle className="w-5 h-5" />
              <span>Failed to load summary data.</span>
            </div>
          ) : (
            <SectorSummary data={summary} selectedResource={null} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
