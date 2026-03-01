'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
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
  fetchDefcon,
  computeNetStatus,
  TARGET_STOCK,
} from '@/lib/api'
import type { DefconStatus } from '@/lib/api'
import type { SummaryItem, Forecast, TimeToZeroEntry, NetStatus } from '@/lib/types'
import { CommandCenter } from '@/components/command-center/command-center'
import { NotificationBell } from '@/components/alerts/notification-bell'
import { ToastContainer, useToasts, useAlertToasts } from '@/components/alerts/toast'
import { useAlerts } from '@/hooks/use-alerts'
import { Loader2, AlertCircle } from 'lucide-react'
import { DefconBadge } from '@/components/hud/defcon-badge'
import { useSSE } from '@/lib/use-sse'
import { SnapSequence } from '@/components/snap/snap-sequence'
import { AgentFeed } from '@/components/agent/agent-feed'
import { ModelArena } from '@/components/forecast/model-arena'
import { VitalsBar } from '@/components/vitals/vitals-bar'
import { ThreatRadar } from '@/components/radar/threat-radar'
import { useAnimatedNumber } from '@/lib/use-animated-number'
import { initSonification, isAudioUnlocked, setDefconLevel, playCriticalAlert, shouldAlertForSector, clearCriticalAlert } from '@/lib/sonification'

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
  OPTIMAL: {
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    cardClass: 'border-emerald-500/40 bg-emerald-500/5',
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

/* ── Compact Time-to-Zero card (for stacked vertical layout inside Command Center) ── */
function TimeToZeroCard({ entry }: { entry: TimeToZeroEntry }) {
  const h = entry.hours_to_zero

  const statusLabel = computeNetStatus(entry)
  const style = STATUS_BADGE_STYLES[statusLabel]
  const statusBadgeClass = style.badgeClass
  const statusColor = style.cardClass
  const flashing = statusLabel === 'DEPLETING'

  const timeText = statusLabel === 'EXHAUSTED'
    ? 'EXHAUSTED'
    : h != null
      ? formatTimeToZero(h)
      : '\u2014'

  return (
    <div className={`rounded-md border px-3 py-2 ${statusColor}`} data-testid="ttz-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-200 truncate">{entry.resource_type}</span>
          <Badge
            variant="outline"
            className={`text-xs px-1.5 py-0.5 shrink-0 ${statusBadgeClass} ${flashing ? 'animate-pulse' : ''}`}
            data-testid="ttz-status"
          >
            {statusLabel}
          </Badge>
          <span className="text-xs text-gray-400 shrink-0">{timeText}</span>
        </div>
        {entry.snap_detected === true && (
          <span className="text-xs text-purple-400 shrink-0">Snap</span>
        )}
      </div>
      <div className="text-xs text-gray-600 mt-0.5">
        {entry.sector_id} · Stock: {entry.current_stock.toLocaleString()} · Rate: {Math.round(entry.consumption_rate)} u/hr
      </div>
    </div>
  )
}

/* ── Animated Stock Display ── */
function AnimatedStock({ value }: { value: number }) {
  const animated = useAnimatedNumber(value)
  return <>{Math.round(animated).toLocaleString()}</>
}

export default function DashboardPage() {
  const [snapActive, setSnapActive] = useState(false)
  const lastSnapTimestampRef = useRef<string | null>(null)
  const [showAudioPrompt, setShowAudioPrompt] = useState(false)

  // Initialize sonification engine
  useEffect(() => {
    const cleanup = initSonification()

    // Check if AudioContext is suspended (browser autoplay policy)
    const checkTimer = setTimeout(() => {
      if (!isAudioUnlocked()) {
        setShowAudioPrompt(true)
      }
    }, 500)

    // Dismiss prompt on first user interaction
    const events = ['click', 'keydown', 'touchstart'] as const
    function dismissPrompt() {
      setShowAudioPrompt(false)
      for (const evt of events) {
        document.removeEventListener(evt, dismissPrompt)
      }
    }
    for (const evt of events) {
      document.addEventListener(evt, dismissPrompt)
    }

    return () => {
      cleanup()
      clearTimeout(checkTimer)
      for (const evt of events) {
        document.removeEventListener(evt, dismissPrompt)
      }
    }
  }, [])

  const {
    data: summaryData,
    error: summaryError,
    isLoading: summaryLoading,
    mutate: mutateSummary,
  } = useSWR('summary', fetchSummary, { revalidateOnFocus: true })

  const summary: SummaryItem[] = summaryData?.data ?? []

  const {
    data: forecastsData,
    mutate: mutateForcasts,
  } = useSWR('forecasts', fetchForecasts, {
    revalidateOnFocus: true,
    refreshInterval: 10000,
  })

  const {
    data: ttzData,
    mutate: mutateTtz,
  } = useSWR('time-to-zero', fetchTimeToZero, {
    revalidateOnFocus: true,
  })

  const {
    data: govData,
    mutate: mutateGov,
  } = useSWR('governor-status-dashboard', fetchGovernorStatus, {
    revalidateOnFocus: true,
  })

  const {
    data: defconData,
    mutate: mutateDefcon,
  } = useSWR<DefconStatus>('defcon-dashboard', fetchDefcon, {
    refreshInterval: 5000,
  })

  // Sync DEFCON level to sonification engine
  useEffect(() => {
    if (defconData?.level != null) {
      setDefconLevel(defconData.level)
    }
  }, [defconData?.level])

  // SSE handler: handle incoming real-time events
  const handleSSE = useCallback((type: string, data: unknown) => {
    switch (type) {
      case 'resource_update':
        // Re-fetch resources to pick up new data
        mutateSummary()
        mutateTtz()
        mutateForcasts()
        break
      case 'defcon_update':
        mutateDefcon()
        break
      case 'snap_alert': {
        const snapData = data as { timestamp?: string } | undefined
        const snapTime = snapData?.timestamp
        if (snapTime && snapTime === lastSnapTimestampRef.current) break
        lastSnapTimestampRef.current = snapTime ?? null
        setSnapActive(true)
        mutateSummary()
        mutateTtz()
        mutateGov()
        break
      }
      case 'governor_decision':
        mutateGov()
        mutateTtz()
        break
      default:
        break
    }
  }, [mutateSummary, mutateTtz, mutateGov, mutateForcasts, mutateDefcon])

  useSSE(handleSSE)

  const rawTimeToZero: TimeToZeroEntry[] = Array.isArray(ttzData) ? ttzData : []
  const forecasts: Forecast[] = forecastsData?.data ?? []

  // Enrich TTZ entries with production rate and governor status from allocations
  const timeToZero: TimeToZeroEntry[] = rawTimeToZero.map((entry) => {
    const key = `${entry.sector_id}|${entry.resource_type}`
    const alloc = govData?.current_allocations?.find(
      (a) => a.sector_id === entry.sector_id && a.resource_type === entry.resource_type
    )
    // Governor allocations are units_per_cycle (3s cycle) → 1200 cycles/hr
    const productionRateHourly = alloc ? alloc.units_per_cycle * 1200 : 0
    return {
      ...entry,
      production_rate_hourly: productionRateHourly,
      target_stock: TARGET_STOCK[key],
      governor_status: alloc?.status,
    }
  })

  // Build stocks + targets maps for radar and sonification
  const sectorStocks: Record<string, number> = {}
  const sectorTargets: Record<string, number> = {}
  for (const item of summary) {
    // Aggregate stock per sector (use first resource as representative)
    if (!sectorStocks[item.sector_id]) {
      sectorStocks[item.sector_id] = item.latest_stock_level
      const key = `${item.sector_id}|${item.resource_type}`
      sectorTargets[item.sector_id] = TARGET_STOCK[key] ?? 500
    }
  }

  // Check for critical stock levels and trigger/clear alerts
  useEffect(() => {
    // Check each sector for critical stock levels and trigger/clear alerts
    for (const sector of Object.keys(sectorStocks)) {
      const stock = sectorStocks[sector] ?? 0
      const target = sectorTargets[sector] ?? 500
      if (shouldAlertForSector(stock, target)) {
        playCriticalAlert(sector)
      } else {
        clearCriticalAlert(sector)
      }
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

  const ttzCardsNode = timeToZero.length === 0 ? (
    <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span>Computing forecasts...</span>
    </div>
  ) : (
    <div className="space-y-2">
      {sortedTTZ.map((entry) => (
        <TimeToZeroCard
          key={`${entry.sector_id}-${entry.resource_type}`}
          entry={entry}
        />
      ))}
    </div>
  )

  const chartNode = (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-300">Resource Stock Levels</p>
        <span className="flex items-center gap-1.5 text-xs text-green-400">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          LIVE
        </span>
      </div>
      <ResourceChart />
    </div>
  )

  return (
    <div className="p-6 space-y-6 dashboard-root">
      <ToastContainer toasts={toasts} dismiss={dismiss} />
      {showAudioPrompt && (
        <div
          className="fixed top-0 left-0 right-0 z-[60] bg-blue-900/90 text-blue-200 text-center text-sm py-1.5 backdrop-blur-sm cursor-pointer"
          data-testid="audio-prompt"
        >
          Click anywhere to enable audio
        </div>
      )}
      <SnapSequence active={snapActive} onComplete={() => setSnapActive(false)} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Analytics Dashboard</h1>
          <DefconBadge />
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell alerts={alerts} />
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshForecasts}
            className="border-gray-700 text-gray-400 hover:bg-gray-800 text-xs"
          >
            Refresh Forecasts
          </Button>
        </div>
      </div>

      {/* Command Center — primary section with chart + TTZ cards inside */}
      <CommandCenter chart={chartNode} ttzCards={ttzCardsNode} />

      {/* JARVIS Autonomous Agent Feed */}
      <AgentFeed />

      {/* Sector Summary */}
      <Card className="bg-gray-900 border-gray-800 hud-card">
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

      {/* Model Arena + Threat Radar side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-gray-900 border-gray-800 hud-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-white text-lg">Forecast Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <ModelArena />
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800 hud-card flex items-center justify-center">
          <CardContent className="py-4">
            <ThreatRadar stocks={sectorStocks} targets={sectorTargets} />
          </CardContent>
        </Card>
      </div>

      {/* Vitals Bar (fixed bottom) */}
      <VitalsBar />
    </div>
  )
}
