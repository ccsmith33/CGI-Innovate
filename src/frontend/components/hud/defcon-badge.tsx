'use client'

import useSWR from 'swr'
import { fetchDefcon } from '@/lib/api'
import type { DefconStatus } from '@/lib/api'

const DEFCON_COLOR_MAP: Record<string, string> = {
  green: 'text-green-400 border-green-500/50',
  yellow: 'text-yellow-400 border-yellow-500/50',
  orange: 'text-orange-400 border-orange-500/50',
  red: 'text-red-400 border-red-500/50',
  purple: 'text-purple-400 border-purple-500/50',
}

export function DefconBadge() {
  const { data } = useSWR<DefconStatus>('defcon', fetchDefcon, {
    refreshInterval: 5000,
  })

  if (!data) return null

  const colorClass = DEFCON_COLOR_MAP[data.color] ?? 'text-gray-400 border-gray-500/50'

  return (
    <span
      className={`defcon-badge ${colorClass}`}
      data-testid="defcon-badge"
      data-level={data.level}
    >
      DEFCON {data.level} - {data.label}
    </span>
  )
}
