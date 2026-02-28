'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { SummaryItem } from '@/lib/types'

interface SectorSummaryProps {
  data: SummaryItem[]
  selectedResource: string | null
}

function getBarColor(value: number, maxVal: number) {
  const ratio = maxVal > 0 ? value / maxVal : 0
  if (ratio > 0.5) return '#22C55E'   // green
  if (ratio > 0.2) return '#EAB308'   // yellow
  return '#EF4444'                      // red
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-md p-3 text-sm shadow-lg">
      <p className="text-gray-300 font-medium">{label}</p>
      <p className="text-blue-400">Stock: {payload[0].value?.toLocaleString()}</p>
    </div>
  )
}

export function SectorSummary({ data, selectedResource }: SectorSummaryProps) {
  const filtered = selectedResource
    ? data.filter((d) => d.resource_type === selectedResource)
    : data

  // Aggregate by sector - take the latest stock level per sector
  const bySector = new Map<string, number>()
  for (const item of filtered) {
    const existing = bySector.get(item.sector_id)
    if (existing === undefined || item.latest_stock_level > existing) {
      bySector.set(item.sector_id, item.latest_stock_level)
    }
  }

  const chartData = Array.from(bySector.entries())
    .map(([sector, stock]) => ({ sector, stock }))
    .sort((a, b) => a.sector.localeCompare(b.sector))

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No summary data available.
      </div>
    )
  }

  const maxVal = Math.max(...chartData.map((d) => d.stock))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="sector"
          stroke="#9CA3AF"
          tick={{ fill: '#9CA3AF', fontSize: 12 }}
        />
        <YAxis stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="stock" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={index} fill={getBarColor(entry.stock, maxVal)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
