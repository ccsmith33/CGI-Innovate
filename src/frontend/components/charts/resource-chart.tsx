'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { fetchResources, fetchTimeToZero } from '@/lib/api'
import type { ResourceLog, TimeToZeroEntry } from '@/lib/types'

/* ── Stock ceiling matching backend feed-service STOCK_CEILING ── */
export const STOCK_CEILING = 1500

/* ── Sector/resource configuration ── */
const SECTOR_RESOURCES: Array<{
  sector: string
  resource: string
  color: string
  label: string
  target: number
}> = [
  { sector: 'Avengers Compound', resource: 'Medical Kits', color: '#3B82F6', label: 'Medical Kits', target: 600 },
  { sector: 'New Asgard', resource: 'Vibranium (kg)', color: '#8B5CF6', label: 'Vibranium', target: 300 },
  { sector: 'Sanctum Sanctorum', resource: 'Clean Water (L)', color: '#06B6D4', label: 'Clean Water', target: 750 },
  { sector: 'Sokovia', resource: 'Pym Particles', color: '#F59E0B', label: 'Pym Particles', target: 420 },
  { sector: 'Wakanda', resource: 'Arc Reactor Cores', color: '#10B981', label: 'Arc Reactors', target: 180 },
]

function formatTime(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/* ── Custom tooltip ── */
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number | null; name: string; color: string; dataKey: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const visible = payload.filter(
    (p) => p.value != null && !p.dataKey.startsWith('proj_')
  )
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-md p-3 text-sm shadow-lg">
      <p className="text-gray-300 mb-1">{label}</p>
      {visible.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {entry.value?.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

/* ── Exported helper for tests ── */
export function buildForecastLine(
  filtered: ResourceLog[],
  forecast: { predicted_exhaustion_date: string | null; hours_until_exhaustion: number | null } | null
): Array<{ time: string; forecast_level: number | null }> {
  if (
    !forecast ||
    !forecast.predicted_exhaustion_date ||
    forecast.hours_until_exhaustion == null ||
    forecast.hours_until_exhaustion <= 0 ||
    filtered.length === 0
  ) {
    return []
  }

  const sorted = [...filtered].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
  const lastPoint = sorted[sorted.length - 1]
  const lastStock = lastPoint.stock_level
  const exhaustionDateStr = forecast.predicted_exhaustion_date

  return [
    { time: formatTime(lastPoint.timestamp), forecast_level: lastStock },
    { time: formatTime(exhaustionDateStr), forecast_level: 0 },
  ]
}

/* ── Main multi-resource chart ── */
export function ResourceChart() {
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const sr of SECTOR_RESOURCES) {
      init[sr.sector] = true
    }
    return init
  })

  // Fetch ALL resources (no sector filter) — backend max limit is 1000
  const { data: resourcesData } = useSWR(
    'resources-all',
    () => fetchResources({ limit: 1000 }),
    { refreshInterval: 3000 }
  )

  // Fetch time-to-zero for depletion projection
  const { data: ttzData } = useSWR('time-to-zero-chart', fetchTimeToZero, {
    refreshInterval: 3000,
  })

  const resources: ResourceLog[] = resourcesData?.data ?? []
  const timeToZero: TimeToZeroEntry[] = Array.isArray(ttzData) ? ttzData : []

  // Filter to last 5 minutes anchored to Date.now(), with stale fallback
  const chartData = useMemo(() => {
    const now = Date.now()
    const cutoff = now - 5 * 60 * 1000

    // Group by 15-second buckets for smooth resolution within a 5-minute window
    const BUCKET_MS = 15000
    const buckets = new Map<number, Record<string, number | null>>()

    for (const entry of resources) {
      const ts = new Date(entry.timestamp).getTime()
      if (ts < cutoff) continue
      const bucket15s = Math.round(ts / BUCKET_MS) * BUCKET_MS
      if (!buckets.has(bucket15s)) {
        buckets.set(bucket15s, {})
      }
      const sectorKey = entry.sector_id
      const bucket = buckets.get(bucket15s)!
      bucket[sectorKey] = entry.stock_level
    }

    // If the 5-min window has no data, fall back to the last 20 data points
    if (buckets.size === 0 && resources.length > 0) {
      const sorted = [...resources].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      const tail = sorted.slice(-20)
      for (const entry of tail) {
        const ts = new Date(entry.timestamp).getTime()
        const bucket15s = Math.round(ts / BUCKET_MS) * BUCKET_MS
        if (!buckets.has(bucket15s)) {
          buckets.set(bucket15s, {})
        }
        const bucket = buckets.get(bucket15s)!
        bucket[entry.sector_id] = entry.stock_level
      }
    }

    // Sort by time
    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0])

    return sorted.map(([ts, values]): { time: string; ts: number; [key: string]: string | number | null } => ({
      time: formatTime(ts),
      ts,
      ...values,
    }))
  }, [resources])

  // X-axis domain: 4 min of history + 1.5 min of future (total 5.5 min window)
  // "now" sits at ~73% across the chart, leaving visible space for projection lines
  const xDomain = useMemo((): [number, number] => {
    const now = Date.now()
    return [now - 4 * 60 * 1000, now + 90 * 1000]
  }, [chartData]) // recompute when chartData changes (every SWR refresh)

  // Build depletion projection lines — capped at 90s into the future for visibility
  const projectionData = useMemo(() => {
    if (chartData.length === 0 || timeToZero.length === 0) return []

    const lastPoint = chartData[chartData.length - 1]
    const nowTs = lastPoint.ts as number
    const PROJ_HORIZON_MS = 90 * 1000 // 90 seconds visible future
    const projPoints: Array<Record<string, number | string | null>> = []

    // Start point: current values
    const startPoint: Record<string, number | string | null> = {
      time: formatTime(nowTs),
      ts: nowTs,
    }

    for (const sr of SECTOR_RESOURCES) {
      if (!visible[sr.sector]) continue
      const ttz = timeToZero.find(
        (t) => t.sector_id === sr.sector && t.resource_type === sr.resource
      )
      if (!ttz || ttz.hours_to_zero == null || ttz.hours_to_zero > 168) continue
      if (ttz.consumption_rate <= 0) continue

      const currentStock = lastPoint[sr.sector] as number | undefined
      if (currentStock == null) continue

      startPoint[`proj_${sr.sector}`] = Math.max(0, currentStock)
    }
    projPoints.push(startPoint)

    // End points: capped at 90s horizon so projection lines stay visible on chart
    for (const sr of SECTOR_RESOURCES) {
      if (!visible[sr.sector]) continue
      const ttz = timeToZero.find(
        (t) => t.sector_id === sr.sector && t.resource_type === sr.resource
      )
      if (!ttz || ttz.hours_to_zero == null || ttz.hours_to_zero > 168) continue
      if (ttz.consumption_rate <= 0) continue

      const currentStock = lastPoint[sr.sector] as number | undefined
      if (currentStock == null) continue

      const fullDurationMs = ttz.hours_to_zero * 60 * 60 * 1000
      const clampedDuration = Math.min(fullDurationMs, PROJ_HORIZON_MS)
      const endTs = nowTs + clampedDuration
      // Interpolate stock level at the clamped time
      const projectedStock = Math.max(0, currentStock * (1 - clampedDuration / fullDurationMs))

      const endPoint: Record<string, number | string | null> = {
        time: formatTime(endTs),
        ts: endTs,
      }
      endPoint[`proj_${sr.sector}`] = projectedStock
      projPoints.push(endPoint)
    }

    return projPoints
  }, [chartData, timeToZero, visible])

  // Compute dynamic Y-axis domain from visible data, projection data, and target reference lines
  const yDomain = useMemo((): [number, number] => {
    if (chartData.length === 0) return [0, 800]
    const allValues: number[] = []
    for (const point of chartData) {
      for (const sr of SECTOR_RESOURCES) {
        if (!visible[sr.sector]) continue
        const v = point[sr.sector]
        if (typeof v === 'number') allValues.push(v)
      }
    }
    // Include projection data values so forecast lines are never clipped
    for (const pp of projectionData) {
      for (const sr of SECTOR_RESOURCES) {
        if (!visible[sr.sector]) continue
        const v = pp[`proj_${sr.sector}`]
        if (typeof v === 'number') allValues.push(v)
      }
    }
    // Include target stock values so reference lines are always visible
    for (const sr of SECTOR_RESOURCES) {
      if (visible[sr.sector]) allValues.push(sr.target)
    }
    if (allValues.length === 0) return [0, 800]
    const max = Math.max(...allValues)
    return [0, Math.ceil(max * 1.1)]
  }, [chartData, visible, projectionData])

  // Merge chart data with projection data for a single unified dataset
  const mergedData = useMemo(() => {
    // Index chart points by ts for fast lookup
    const byTs = new Map<number, Record<string, string | number | null>>()
    const allPoints = chartData.map((p) => {
      const copy = { ...p }
      byTs.set(copy.ts as number, copy)
      return copy
    })

    for (const pp of projectionData) {
      const ppTs = pp.ts as number
      const existing = byTs.get(ppTs)
      if (existing) {
        // Merge projection keys into the existing chart point
        for (const [k, v] of Object.entries(pp)) {
          if (k !== 'time' && k !== 'ts') {
            existing[k] = v
          }
        }
      } else {
        const newPoint = {
          time: pp.time as string,
          ts: ppTs,
          ...pp,
        }
        allPoints.push(newPoint)
        byTs.set(ppTs, newPoint)
      }
    }

    // Sort by ts
    allPoints.sort((a, b) => (a.ts as number) - (b.ts as number))
    return allPoints
  }, [chartData, projectionData])

  function toggleSector(sector: string) {
    setVisible((prev) => ({ ...prev, [sector]: !prev[sector] }))
  }

  return (
    <div className="space-y-3">
      {/* Toggle buttons */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="chart-toggles">
        {SECTOR_RESOURCES.map((sr) => (
          <button
            key={sr.sector}
            onClick={() => toggleSector(sr.sector)}
            data-testid={`toggle-${sr.sector}`}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
              visible[sr.sector]
                ? 'border-gray-600 bg-gray-800 text-gray-200'
                : 'border-gray-800 bg-gray-950 text-gray-600'
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{
                backgroundColor: sr.color,
                opacity: visible[sr.sector] ? 1 : 0.3,
              }}
            />
            {sr.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={mergedData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={(ts: number) => formatTime(ts)}
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            domain={yDomain}
            allowDataOverflow={false}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Target stock reference lines */}
          {SECTOR_RESOURCES.map((sr) =>
            visible[sr.sector] ? (
              <ReferenceLine
                key={`target-${sr.sector}`}
                y={sr.target}
                stroke={sr.color}
                strokeWidth={2}
                opacity={0.8}
                ifOverflow="extendDomain"
                label={{
                  value: `TARGET: ${sr.target}`,
                  position: 'right',
                  fill: sr.color,
                  fontSize: 10,
                  opacity: 0.85,
                }}
              />
            ) : null
          )}

          {/* Actual stock lines */}
          {SECTOR_RESOURCES.map((sr) =>
            visible[sr.sector] ? (
              <Line
                key={sr.sector}
                type="monotone"
                dataKey={sr.sector}
                name={sr.label}
                stroke={sr.color}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4, fill: sr.color }}
                connectNulls={false}
                isAnimationActive={true}
                animationDuration={300}
              />
            ) : null
          )}

          {/* Depletion projection lines (dashed, subtle) */}
          {SECTOR_RESOURCES.map((sr) =>
            visible[sr.sector] ? (
              <Line
                key={`proj-${sr.sector}`}
                type="monotone"
                dataKey={`proj_${sr.sector}`}
                name={`${sr.label} (depletion)`}
                stroke={sr.color}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                strokeOpacity={0.35}
                dot={false}
                connectNulls
                legendType="none"
                isAnimationActive={true}
                animationDuration={300}
              />
            ) : null
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
