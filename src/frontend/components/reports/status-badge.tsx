'use client'

import { Badge } from '@/components/ui/badge'

const statusStyles: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  processing: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse',
  processed: 'bg-green-500/20 text-green-400 border-green-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
}

interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const style = statusStyles[status] ?? statusStyles.pending

  return (
    <Badge variant="outline" className={style}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}
