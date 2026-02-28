'use client'

import type { Forecast } from '@/lib/types'

interface ForecastOverlayProps {
  forecast: Forecast | null
}

export function ForecastOverlay({ forecast }: ForecastOverlayProps) {
  if (!forecast) {
    return null
  }

  const exhaustionDate = forecast.predicted_exhaustion_date
    ? new Date(forecast.predicted_exhaustion_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <div className="flex items-center gap-4 text-sm mt-2">
      <div className="flex items-center gap-2">
        <span className="text-gray-400">Strategy:</span>
        <span className="text-blue-400 font-medium">{forecast.strategy_used}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-400">Confidence:</span>
        <span className="text-blue-400 font-medium">
          {(forecast.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-400">Time-to-Zero:</span>
        {exhaustionDate ? (
          <span className="text-red-400 font-medium">{exhaustionDate}</span>
        ) : (
          <span className="text-green-400 font-medium">No depletion predicted</span>
        )}
      </div>
      {forecast.hours_until_exhaustion != null && (
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Hours remaining:</span>
          <span className="text-orange-400 font-medium">
            {forecast.hours_until_exhaustion.toFixed(1)}h
          </span>
        </div>
      )}
      {forecast.snap_detected && (
        <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-xs font-medium">
          SNAP DETECTED
        </span>
      )}
    </div>
  )
}
