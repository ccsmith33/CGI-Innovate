'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Brush,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { ResourceLog, Forecast } from '@/lib/types'

interface ResourceChartProps {
  data: ResourceLog[]
  forecast: Forecast | null
  sector: string | null
  resource: string | null
}

function formatTimestamp(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number; name: string; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-md p-3 text-sm shadow-lg">
      <p className="text-gray-300 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {entry.value?.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

export function ResourceChart({
  data,
  forecast,
  sector,
  resource,
}: ResourceChartProps) {
  const filtered = data.filter(
    (d) =>
      (!sector || d.sector_id === sector) &&
      (!resource || d.resource_type === resource)
  )

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 text-gray-500">
        No resource data available for the selected filters.
      </div>
    )
  }

  const chartData = filtered
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((d) => ({
      time: formatTimestamp(d.timestamp),
      stock_level: d.stock_level,
      usage_rate: d.usage_rate_hourly,
      rawTime: d.timestamp,
    }))

  const exhaustionDate = forecast?.predicted_exhaustion_date
    ? formatTimestamp(forecast.predicted_exhaustion_date)
    : null

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="time"
          stroke="#9CA3AF"
          tick={{ fill: '#9CA3AF', fontSize: 12 }}
          interval="preserveStartEnd"
        />
        <YAxis stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="stock_level"
          name="Stock Level"
          stroke="#3B82F6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#3B82F6' }}
        />
        <Line
          type="monotone"
          dataKey="usage_rate"
          name="Usage Rate/hr"
          stroke="#8B5CF6"
          strokeWidth={1}
          strokeDasharray="5 5"
          dot={false}
        />
        {exhaustionDate && (
          <ReferenceLine
            x={exhaustionDate}
            stroke="#EF4444"
            strokeDasharray="3 3"
            label={{
              value: `Exhaustion: ${exhaustionDate}`,
              position: 'top',
              fill: '#EF4444',
              fontSize: 12,
            }}
          />
        )}
        <Brush
          dataKey="time"
          height={30}
          stroke="#4B5563"
          fill="#1F2937"
          travellerWidth={8}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
