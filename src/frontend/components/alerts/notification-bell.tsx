'use client'

import { useState, useRef, useEffect } from 'react'
import { Bell } from 'lucide-react'
import type { ForecastAlert, AlertLevel } from '@/hooks/use-alerts'

const levelStyles: Record<AlertLevel, { bg: string; text: string; border: string }> = {
  EXHAUSTED: { bg: 'bg-red-900/40', text: 'text-red-300', border: 'border-red-500/40' },
  CRITICAL: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  WARNING: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
}

function AlertItem({ alert }: { alert: ForecastAlert }) {
  const style = levelStyles[alert.level]
  return (
    <div
      className={`p-3 rounded-md border ${style.bg} ${style.border} space-y-1`}
      data-testid="alert-item"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{alert.sector_id}</span>
        <span className={`text-xs font-bold ${style.text}`}>{alert.level}</span>
      </div>
      <p className="text-sm text-gray-300">{alert.resource_type}</p>
      <p className="text-xs text-gray-500">
        {alert.hours_remaining <= 0
          ? 'Already exhausted'
          : `${alert.hours_remaining.toFixed(0)}h remaining`}
      </p>
    </div>
  )
}

export function NotificationBell({ alerts }: { alerts: ForecastAlert[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        aria-label="Notifications"
        data-testid="notification-bell"
      >
        <Bell className="w-5 h-5" />
        {alerts.length > 0 && (
          <span
            className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center"
            data-testid="alert-badge"
          >
            {alerts.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50"
          data-testid="alert-dropdown"
        >
          <div className="p-3 border-b border-gray-700">
            <h3 className="text-sm font-semibold text-white">
              Active Alerts ({alerts.length})
            </h3>
          </div>
          <div className="p-2 space-y-2">
            {alerts.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">
                No active alerts
              </p>
            ) : (
              alerts.map((alert) => (
                <AlertItem
                  key={`${alert.sector_id}-${alert.resource_type}`}
                  alert={alert}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
