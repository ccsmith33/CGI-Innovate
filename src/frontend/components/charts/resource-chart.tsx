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
} from 'recharts'
import { fetchResources, fetchTimeToZero } from '@/lib/api'
import type { ResourceLog, TimeToZeroEntry } from '@/lib/types'

/* ── Sector/resource configuration ── */
const SECTOR_RESOURCES: Array<{
  sector: string
  resource: string
  color: string
  label: string
}> = [
  { sector: 'Avengers Compound', resource: 'Medical Kits', color: '#3B82F6', label: 'Medical Kits' },
  { sector: 'New Asgard', resource: 'Vibranium (kg)', color: '#8B5CF6', label: 'Vibranium' },
  { sector: 'Sanctum Sanctorum', resource: 'Clean Water (L)', color: '#06B6D4', label: 'Clean Water' },
  { sector: 'Sokovia', resource: 'Pym Particles', color: '#F59E0B', label: 'Pym Particles' },
  { sector: 'Wakanda', resource: 'Arc Reactor Cores', color: '#10B981', label: 'Arc Reactors' },
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
    { refreshInterval: 5000 }
  )

  // Fetch time-to-zero for depletion projection
  const { data: ttzData } = useSWR('time-to-zero-chart', fetchTimeToZero, {
    refreshInterval: 5000,
  })

  const resources: ResourceLog[] = resourcesData?.data ?? []
  const timeToZero: TimeToZeroEntry[] = Array.isArray(ttzData) ? ttzData : []

  // Filter to last 4 hours and build chart data (fall back to all data if window is empty)
  const chartData = useMemo(() => {
    const cutoff = Date.now() - 4 * 60 * 60 * 1000
    const withinWindow = resources.filter(
      (d) => new Date(d.timestamp).getTime() >= cutoff
    )
    const recent = withinWindow.length > 0 ? withinWindow : resources

    // Group by timestamp bucket (round to minute)
    const buckets = new Map<number, Record<string, number | null>>()

    for (const entry of recent) {
      const ts = new Date(entry.timestamp).getTime()
      const minuteBucket = Math.round(ts / 60000) * 60000
      if (!buckets.has(minuteBucket)) {
        buckets.set(minuteBucket, {})
      }
      const sectorKey = entry.sector_id
      const bucket = buckets.get(minuteBucket)!
      bucket[sectorKey] = entry.stock_level
    }

    // Sort by time
    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0])

    return sorted.map(([ts, values]): { time: string; ts: number; [key: string]: string | number | null } => ({
      time: formatTime(ts),
      ts,
      ...values,
    }))
  }, [resources])

  // Build depletion projection lines
  const projectionData = useMemo(() => {
    if (chartData.length === 0 || timeToZero.length === 0) return []

    const lastPoint = chartData[chartData.length - 1]
    const nowTs = lastPoint.ts as number
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

      startPoint[`proj_${sr.sector}`] = currentStock
    }
    projPoints.push(startPoint)

    // End points: where each resource hits zero
    for (const sr of SECTOR_RESOURCES) {
      if (!visible[sr.sector]) continue
      const ttz = timeToZero.find(
        (t) => t.sector_id === sr.sector && t.resource_type === sr.resource
      )
      if (!ttz || ttz.hours_to_zero == null || ttz.hours_to_zero > 168) continue
      if (ttz.consumption_rate <= 0) continue

      const endTs = nowTs + ttz.hours_to_zero * 60 * 60 * 1000
      const endPoint: Record<string, number | string | null> = {
        time: formatTime(endTs),
        ts: endTs,
      }
      endPoint[`proj_${sr.sector}`] = 0
      projPoints.push(endPoint)
    }

    return projPoints
  }, [chartData, timeToZero, visible])

  // Merge chart data with projection data for a single unified dataset
  const mergedData = useMemo(() => {
    const allPoints = [...chartData]

    for (const pp of projectionData) {
      allPoints.push({
        time: pp.time as string,
        ts: pp.ts as number,
        ...pp,
      })
    }

    // Sort by ts and dedupe
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
            dataKey="time"
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
          <Tooltip content={<CustomTooltip />} />

          {/* Actual stock lines */}
          {SECTOR_RESOURCES.map((sr) =>
            visible[sr.sector] ? (
              <Line
                key={sr.sector}
                type="monotone"
                dataKey={sr.sector}
                name={sr.label}
                stroke={sr.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: sr.color }}
                connectNulls={false}
              />
            ) : null
          )}

          {/* Depletion projection lines (dashed, 50% opacity) */}
          {SECTOR_RESOURCES.map((sr) =>
            visible[sr.sector] ? (
              <Line
                key={`proj-${sr.sector}`}
                type="monotone"
                dataKey={`proj_${sr.sector}`}
                name={`${sr.label} (depletion)`}
                stroke={sr.color}
                strokeWidth={2}
                strokeDasharray="5 5"
                strokeOpacity={0.5}
                dot={false}
                connectNulls
                legendType="none"
              />
            ) : null
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
