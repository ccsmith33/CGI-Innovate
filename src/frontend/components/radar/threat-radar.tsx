'use client'

import { useMemo } from 'react'

interface SectorBlip {
  name: string
  angle: number
  health: number // 0..1 where 1 = full, 0 = empty
  critical: boolean
}

interface ThreatRadarProps {
  stocks: Record<string, number>
  targets: Record<string, number>
}

const SECTOR_ANGLES: Record<string, number> = {
  'Avengers Compound': 45,
  'New Asgard': 135,
  'Sanctum Sanctorum': 180,
  'Sokovia': 225,
  'Wakanda': 315,
}

const CRITICAL_THRESHOLD = 0.25

export function ThreatRadar({ stocks, targets }: ThreatRadarProps) {
  const blips = useMemo<SectorBlip[]>(() => {
    return Object.entries(SECTOR_ANGLES).map(([name, angle]) => {
      const stock = stocks[name] ?? 0
      const target = targets[name] ?? 500
      const health = Math.min(1, Math.max(0, stock / target))
      return {
        name,
        angle,
        health,
        critical: health < CRITICAL_THRESHOLD,
      }
    })
  }, [stocks, targets])

  return (
    <div className="relative" data-testid="threat-radar" style={{ width: 200, height: 200 }}>
      <svg viewBox="0 0 200 200" width={200} height={200} className="block">
        {/* Background rings */}
        <circle cx={100} cy={100} r={90} fill="none" stroke="#1f2937" strokeWidth={0.5} />
        <circle cx={100} cy={100} r={60} fill="none" stroke="#1f2937" strokeWidth={0.5} />
        <circle cx={100} cy={100} r={30} fill="none" stroke="#1f2937" strokeWidth={0.5} />

        {/* Crosshairs */}
        <line x1={100} y1={10} x2={100} y2={190} stroke="#1f2937" strokeWidth={0.5} />
        <line x1={10} y1={100} x2={190} y2={100} stroke="#1f2937" strokeWidth={0.5} />

        {/* Sweep line */}
        <line
          x1={100}
          y1={100}
          x2={100}
          y2={10}
          stroke="rgba(34,211,238,0.6)"
          strokeWidth={1.5}
          className="radar-sweep"
          data-testid="radar-sweep"
        />

        {/* Sweep cone (gradient behind sweep line) */}
        <defs>
          <linearGradient id="sweep-fade" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(34,211,238,0)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0.08)" />
          </linearGradient>
        </defs>

        {/* Sector blips */}
        {blips.map((blip) => {
          const rad = ((blip.angle - 90) * Math.PI) / 180
          const distance = 65 // fixed radius for blips
          const cx = 100 + distance * Math.cos(rad)
          const cy = 100 + distance * Math.sin(rad)
          // Low health = bigger + brighter blip
          const size = 3 + (1 - blip.health) * 5
          const opacity = 0.4 + (1 - blip.health) * 0.6

          return (
            <g key={blip.name} data-testid="radar-blip">
              {/* Blip ripple for critical */}
              {blip.critical && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={size + 4}
                  fill="none"
                  stroke="rgba(239,68,68,0.5)"
                  strokeWidth={1}
                  className="blip-pulse"
                />
              )}
              {/* Blip dot */}
              <circle
                cx={cx}
                cy={cy}
                r={size}
                fill={blip.critical ? '#ef4444' : '#22d3ee'}
                opacity={opacity}
              />
              {/* Label */}
              <text
                x={cx}
                y={cy + size + 10}
                textAnchor="middle"
                fill="#6b7280"
                fontSize={6}
                fontFamily="monospace"
              >
                {blip.name.split(' ')[0]}
              </text>
            </g>
          )
        })}
      </svg>

    </div>
  )
}
