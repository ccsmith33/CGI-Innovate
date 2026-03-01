'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { Loader2 } from 'lucide-react'
import {
  fetchForecasts,
  fetchSummary,
  fetchTimeToZero,
  fetchGovernorStatus,
  fetchDefcon,
  computeNetStatus,
  TARGET_STOCK,
} from '@/lib/api'
import type { DefconStatus } from '@/lib/api'
import { MarvelMap } from '@/components/map/marvel-map'
import { TacticalGlobe } from '@/components/globe/tactical-globe'
import { useSSE } from '@/lib/use-sse'
import type { Forecast, SummaryItem, TimeToZeroEntry, NetStatus } from '@/lib/types'

const SECTOR_CONFIG = [
  { name: 'Avengers Compound', resource: 'Medical Kits' },
  { name: 'Wakanda', resource: 'Arc Reactor Cores' },
  { name: 'New Asgard', resource: 'Vibranium (kg)' },
  { name: 'Sanctum Sanctorum', resource: 'Clean Water (L)' },
  { name: 'Sokovia', resource: 'Pym Particles' },
]

const STATUS_COLORS: Record<NetStatus, string> = {
  STABLE: '#22C55E',
  OPTIMAL: '#34D399',
  RECOVERING: '#F97316',
  LOW: '#F97316',
  CRITICAL: '#EF4444',
  DEPLETING: '#EF4444',
  EXHAUSTED: '#7F1D1D',
}

function getDefconColor(level: number): string {
  if (level <= 2) return 'text-red-500'
  if (level === 3) return 'text-orange-400'
  if (level === 4) return 'text-yellow-400'
  return 'text-green-400'
}

function getDefconGlow(level: number): string {
  if (level <= 2) return 'drop-shadow-[0_0_20px_rgba(239,68,68,0.6)]'
  if (level === 3) return 'drop-shadow-[0_0_20px_rgba(251,146,60,0.6)]'
  if (level === 4) return 'drop-shadow-[0_0_20px_rgba(250,204,21,0.6)]'
  return 'drop-shadow-[0_0_20px_rgba(34,197,94,0.6)]'
}

function getDefconLabel(level: number): string {
  const labels: Record<number, string> = {
    1: 'MAXIMUM FORCE READY',
    2: 'ARMED FORCES READY',
    3: 'INCREASE READINESS',
    4: 'ABOVE NORMAL',
    5: 'NORMAL READINESS',
  }
  return labels[level] ?? 'UNKNOWN'
}

function getHealthBarColor(pct: number): string {
  if (pct > 70) return 'bg-green-500'
  if (pct >= 40) return 'bg-yellow-500'
  return 'bg-red-500'
}

interface DecisionEntry {
  id: number
  timestamp: string
  summary: string
}

export default function MapPage() {
  const [decisions, setDecisions] = useState<DecisionEntry[]>([])
  const decisionIdRef = useRef(0)
  const tickerRef = useRef<HTMLDivElement>(null)

  const { data: forecastsData, isLoading: forecastsLoading, mutate: mutateForecasts } = useSWR(
    'forecasts-map',
    fetchForecasts,
    { refreshInterval: 3000 }
  )

  const { data: summaryData, isLoading: summaryLoading, mutate: mutateSummary } = useSWR(
    'summary-map',
    fetchSummary,
    { refreshInterval: 3000 }
  )

  const { data: ttzData, mutate: mutateTtz } = useSWR('time-to-zero-map', fetchTimeToZero, {
    refreshInterval: 3000,
  })

  const { data: govData, mutate: mutateGov } = useSWR('governor-status-map', fetchGovernorStatus, {
    refreshInterval: 3000,
  })

  const { data: defconData } = useSWR<DefconStatus>('defcon-map', fetchDefcon, {
    refreshInterval: 3000,
  })

  // SSE handler for real-time updates
  const handleSSE = useCallback((type: string, data: unknown) => {
    if (type === 'resource_update') {
      mutateSummary()
      mutateTtz()
    } else if (type === 'governor_decision') {
      mutateGov()
      mutateTtz()
    } else if (type === 'agent_decision') {
      const payload = data as Record<string, unknown>
      const situation = (payload.situation as string) || ''
      const threat = (payload.threat as string) || ''
      const actionsTaken = (payload.actions_taken as number) || 0
      const ts = (payload.timestamp as string) || new Date().toISOString()
      const summary = threat
        ? `${threat} - ${actionsTaken} action(s): ${situation}`
        : `${actionsTaken} action(s): ${situation}`
      setDecisions((prev) => [
        { id: ++decisionIdRef.current, timestamp: ts, summary },
        ...prev.slice(0, 9),
      ])
    } else if (type === 'snap_alert') {
      mutateSummary()
      mutateTtz()
      mutateGov()
    }
  }, [mutateSummary, mutateTtz, mutateGov])

  useSSE(handleSSE)

  // Auto-scroll ticker
  useEffect(() => {
    if (tickerRef.current) {
      tickerRef.current.scrollTop = 0
    }
  }, [decisions])

  const forecasts: Forecast[] = forecastsData?.data ?? []
  const summary: SummaryItem[] = summaryData?.data ?? []
  const rawTTZ: TimeToZeroEntry[] = Array.isArray(ttzData) ? ttzData : []

  // Enrich TTZ entries with production rate from governor allocations
  const timeToZero: TimeToZeroEntry[] = rawTTZ.map((entry) => {
    const key = `${entry.sector_id}|${entry.resource_type}`
    const alloc = govData?.current_allocations?.find(
      (a) => a.sector_id === entry.sector_id && a.resource_type === entry.resource_type
    )
    const productionRateHourly = alloc ? alloc.units_per_cycle * 1200 : 0
    return {
      ...entry,
      production_rate_hourly: productionRateHourly,
      target_stock: TARGET_STOCK[key],
      governor_status: alloc?.status,
    }
  })

  if (forecastsLoading || summaryLoading) {
    return (
      <div className="flex items-center justify-center h-screen gap-2 text-gray-400 bg-black">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span>Initializing command display...</span>
      </div>
    )
  }

  const defconLevel = defconData?.level ?? 5

  return (
    <div className="flex h-screen bg-black overflow-hidden" data-testid="ops-map-tv">
      {/* Left panel: Globe (65%) */}
      <div className="w-[65%] h-full relative flex flex-col" data-testid="globe-panel">
        <div className="flex-1 min-h-0">
          <TacticalGlobe
            sectors={summary}
            forecasts={forecasts}
            timeToZero={timeToZero}
            pointRadius={0.8}
            arcStroke={2.0}
            atmosphereAltitude={0.4}
            autoRotateSpeed={0.8}
          />
        </div>
      </div>

      {/* Right sidebar (35%) */}
      <div className="w-[35%] h-full overflow-y-auto border-l border-gray-800 flex flex-col" data-testid="sidebar-panel">

        {/* Section 1: DEFCON Banner */}
        <div className="p-4 border-b border-gray-800 flex-shrink-0" data-testid="defcon-banner">
          <div className={`text-center ${getDefconColor(defconLevel)} ${getDefconGlow(defconLevel)}`}>
            <div className="text-5xl font-bold tracking-wider">
              DEFCON {defconLevel}
            </div>
            <div className="text-lg font-semibold mt-1 tracking-widest uppercase opacity-80">
              {defconData?.label ?? getDefconLabel(defconLevel)}
            </div>
          </div>
        </div>

        {/* Section 2: Sector Status Cards */}
        <div className="p-3 border-b border-gray-800 flex-shrink-0 space-y-2" data-testid="sector-cards">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Sector Status</h3>
          {SECTOR_CONFIG.map((sector) => {
            const key = `${sector.name}|${sector.resource}`
            const target = TARGET_STOCK[key] ?? 500
            const summaryItem = summary.find(
              (s) => s.sector_id === sector.name && s.resource_type === sector.resource
            )
            const ttzEntry = timeToZero.find(
              (t) => t.sector_id === sector.name && t.resource_type === sector.resource
            )
            const stock = ttzEntry?.current_stock ?? summaryItem?.latest_stock_level ?? 0
            const pct = Math.min(100, Math.max(0, (stock / target) * 100))
            const status: NetStatus = ttzEntry ? computeNetStatus(ttzEntry) : 'STABLE'
            const color = STATUS_COLORS[status]
            const hoursToZero = ttzEntry?.hours_to_zero

            let timeText = ''
            if (status === 'EXHAUSTED') {
              timeText = 'EXHAUSTED'
            } else if (hoursToZero != null && hoursToZero > 0) {
              if (hoursToZero < 1) {
                timeText = `${Math.round(hoursToZero * 60)}m`
              } else if (hoursToZero < 24) {
                timeText = `${hoursToZero.toFixed(1)}h`
              } else {
                timeText = `${Math.floor(hoursToZero / 24)}d ${Math.round(hoursToZero % 24)}h`
              }
            } else {
              timeText = 'Safe'
            }

            return (
              <div
                key={sector.name}
                className="bg-gray-900/80 border border-gray-800 rounded-lg px-3 py-2"
                data-testid={`sector-card-${sector.name}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-white">{sector.name}</span>
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${color}20`, color }}
                  >
                    {status}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mb-1.5">{sector.resource}</div>
                {/* Health bar */}
                <div className="w-full h-2.5 bg-gray-800 rounded-full mb-1.5">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getHealthBarColor(pct)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold text-white">
                    {Math.round(stock).toLocaleString()}
                    <span className="text-xs text-gray-500 ml-1">({Math.round(pct)}%)</span>
                  </span>
                  <span className="text-sm" style={{ color }}>
                    {timeText}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Section 3: JARVIS Decision Ticker */}
        <div className="p-3 border-b border-gray-800 flex-shrink-0" data-testid="jarvis-ticker">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">JARVIS Decisions</h3>
          <div
            ref={tickerRef}
            className="space-y-1.5 max-h-36 overflow-y-auto"
          >
            {decisions.length === 0 ? (
              <div className="text-xs text-gray-600 italic">Awaiting JARVIS decisions...</div>
            ) : (
              decisions.slice(0, 4).map((d) => (
                <div key={d.id} className="text-xs bg-gray-900/60 border border-gray-800 rounded px-2 py-1.5">
                  <span className="text-gray-600">
                    [{new Date(d.timestamp).toLocaleTimeString()}]
                  </span>{' '}
                  <span className="text-green-400">{d.summary}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Section 4: Compact 2D Map */}
        <div className="p-3 flex-shrink-0" data-testid="compact-map">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Tactical Overview</h3>
          <div className="h-[250px] overflow-hidden rounded-lg border border-gray-800">
            <MarvelMap forecasts={forecasts} summary={summary} timeToZero={timeToZero} />
          </div>
        </div>
      </div>
    </div>
  )
}
