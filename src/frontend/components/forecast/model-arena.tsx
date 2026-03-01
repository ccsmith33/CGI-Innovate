'use client'

import useSWR from 'swr'
import { Badge } from '@/components/ui/badge'

interface LeaderboardModel {
  name: string
  accuracy: number
  rank: number
  champion: boolean
  streak: number
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function fetchLeaderboard(): Promise<{ models: LeaderboardModel[] }> {
  const res = await fetch(`${API_BASE}/api/v1/forecasts/leaderboard`)
  if (!res.ok) throw new Error(`Failed to fetch leaderboard: ${res.status}`)
  return res.json()
}

export function ModelArena() {
  const { data } = useSWR('forecast-leaderboard', fetchLeaderboard, {
    refreshInterval: 30000,
  })

  const models = data?.models ?? []

  return (
    <div className="space-y-2" data-testid="model-arena">
      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
        Model Arena
      </p>
      {models.length === 0 ? (
        <p className="text-sm text-gray-600 py-4 text-center">No models scored yet.</p>
      ) : (
        <div className="space-y-1.5">
          {models.map((model) => (
            <div
              key={model.name}
              className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
                model.champion
                  ? 'border-yellow-500/40 bg-yellow-500/5'
                  : 'border-gray-800 bg-gray-950'
              }`}
              data-testid="model-entry"
            >
              <span className="text-xs font-bold text-gray-500 w-5">
                #{model.rank}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-200 font-medium truncate">
                    {model.name}
                  </span>
                  {model.champion && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-yellow-500/10 text-yellow-400 border-yellow-500/40"
                      data-testid="champion-badge"
                    >
                      CHAMPION
                    </Badge>
                  )}
                  {model.streak > 1 && (
                    <span className="text-[10px] text-orange-400">
                      {model.streak}W
                    </span>
                  )}
                </div>
                {/* Accuracy bar */}
                <div className="mt-1 h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      model.champion ? 'bg-yellow-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${model.accuracy * 100}%` }}
                    data-testid="accuracy-bar"
                  />
                </div>
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {(model.accuracy * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
