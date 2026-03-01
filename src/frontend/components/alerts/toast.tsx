'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { AlertLevel } from '@/hooks/use-alerts'

interface Toast {
  id: string
  message: string
  level: AlertLevel
}

const levelColors: Record<AlertLevel, string> = {
  EXHAUSTED: 'bg-red-800 border-red-500/50 text-red-200',
  CRITICAL: 'bg-red-900/80 border-red-500/40 text-red-300',
  WARNING: 'bg-orange-900/80 border-orange-500/40 text-orange-300',
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, level: AlertLevel) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, message, level }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, addToast, dismiss }
}

export function useAlertToasts(
  alerts: { sector_id: string; resource_type: string; level: AlertLevel }[],
  addToast: (message: string, level: AlertLevel) => void
) {
  const prevKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentKeys = new Set(
      alerts.map((a) => `${a.sector_id}-${a.resource_type}-${a.level}`)
    )
    for (const alert of alerts) {
      const key = `${alert.sector_id}-${alert.resource_type}-${alert.level}`
      if (!prevKeysRef.current.has(key)) {
        addToast(
          `${alert.level}: ${alert.sector_id} - ${alert.resource_type}`,
          alert.level
        )
      }
    }
    prevKeysRef.current = currentKeys
  }, [alerts, addToast])
}

export function ToastContainer({
  toasts,
  dismiss,
}: {
  toasts: Toast[]
  dismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed top-4 right-4 z-[100] space-y-2 w-80" data-testid="toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`p-3 rounded-md border shadow-lg cursor-pointer transition-all ${levelColors[t.level]}`}
          onClick={() => dismiss(t.id)}
          data-testid="toast"
        >
          <p className="text-sm font-medium">{t.message}</p>
        </div>
      ))}
    </div>
  )
}
