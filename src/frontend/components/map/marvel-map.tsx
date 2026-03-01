'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Shield,
  Zap,
  Eye,
  Activity,
  Cpu,
} from 'lucide-react'
import type { Forecast, SummaryItem, TimeToZeroEntry, NetStatus } from '@/lib/types'
import { computeNetStatus } from '@/lib/api'

const STATUS_COLORS: Record<NetStatus, string> = {
  STABLE: '#22C55E',
  RECOVERING: '#F97316',
  LOW: '#F97316',
  CRITICAL: '#EF4444',
  DEPLETING: '#EF4444',
  EXHAUSTED: '#7F1D1D',
}

interface SectorConfig {
  name: string
  resource: string
  x: number
  y: number
  icon: 'shield' | 'zap' | 'eye' | 'activity' | 'cpu'
}

const SECTORS: SectorConfig[] = [
  { name: 'Avengers Compound', resource: 'Medical Kits', x: 400, y: 250, icon: 'shield' },
  { name: 'Wakanda', resource: 'Arc Reactor Cores', x: 150, y: 150, icon: 'cpu' },
  { name: 'New Asgard', resource: 'Vibranium (kg)', x: 650, y: 120, icon: 'zap' },
  { name: 'Sanctum Sanctorum', resource: 'Clean Water (L)', x: 200, y: 380, icon: 'eye' },
  { name: 'Sokovia', resource: 'Pym Particles', x: 600, y: 370, icon: 'activity' },
]

function getStatus(ttzEntry: TimeToZeroEntry | undefined): NetStatus {
  if (!ttzEntry) return 'STABLE'
  return computeNetStatus(ttzEntry)
}

function getStockPercent(summary: SummaryItem | undefined): number {
  if (!summary) return 0
  const initialStockEstimates: Record<string, number> = {
    'Medical Kits': 500,
    'Vibranium (kg)': 300,
    'Clean Water (L)': 10000,
    'Pym Particles': 200,
    'Arc Reactor Cores': 100,
  }
  const initial = initialStockEstimates[summary.resource_type] ?? 1000
  return Math.min(100, Math.max(0, (summary.latest_stock_level / initial) * 100))
}

function HexIcon({ icon, x, y }: { icon: string; x: number; y: number }) {
  const iconProps = { x: x - 10, y: y - 10, width: 20, height: 20, stroke: '#e5e7eb', strokeWidth: 1.5, fill: 'none' }

  switch (icon) {
    case 'shield':
      return <Shield {...iconProps} />
    case 'zap':
      return <Zap {...iconProps} />
    case 'eye':
      return <Eye {...iconProps} />
    case 'activity':
      return <Activity {...iconProps} />
    case 'cpu':
      return <Cpu {...iconProps} />
    default:
      return null
  }
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`)
  }
  return pts.join(' ')
}

interface TooltipData {
  sector: string
  resource: string
  stockLevel: number
  usageRate: number
  hoursRemaining: number | null
  confidence: number
  exhaustionDate: string | null
  x: number
  y: number
}

interface MarvelMapProps {
  forecasts: Forecast[]
  summary: SummaryItem[]
  timeToZero?: TimeToZeroEntry[]
}

export function MarvelMap({ forecasts, summary, timeToZero = [] }: MarvelMapProps) {
  const router = useRouter()
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  function getForecast(sectorName: string, resourceType: string): Forecast | undefined {
    return forecasts.find(
      (f) => f.sector_id === sectorName && f.resource_type === resourceType
    )
  }

  function getSummary(sectorName: string, resourceType: string): SummaryItem | undefined {
    return summary.find(
      (s) => s.sector_id === sectorName && s.resource_type === resourceType
    )
  }

  function getTTZ(sectorName: string, resourceType: string): TimeToZeroEntry | undefined {
    return timeToZero.find(
      (t) => t.sector_id === sectorName && t.resource_type === resourceType
    )
  }

  function handleNodeClick(sectorName: string) {
    router.push(`/dashboard?sector=${encodeURIComponent(sectorName)}`)
  }

  function handleNodeHover(sector: SectorConfig, forecast: Forecast | undefined, summaryItem: SummaryItem | undefined, ttz: TimeToZeroEntry | undefined) {
    setTooltip({
      sector: sector.name,
      resource: sector.resource,
      stockLevel: ttz?.current_stock ?? summaryItem?.latest_stock_level ?? 0,
      usageRate: ttz?.consumption_rate ?? summaryItem?.latest_usage_rate ?? 0,
      hoursRemaining: ttz?.hours_to_zero ?? forecast?.hours_until_exhaustion ?? null,
      confidence: forecast?.confidence ?? 0,
      exhaustionDate: forecast?.predicted_exhaustion_date ?? null,
      x: sector.x,
      y: sector.y,
    })
  }

  // Connection lines between all sectors
  const connections: [number, number][] = []
  for (let i = 0; i < SECTORS.length; i++) {
    for (let j = i + 1; j < SECTORS.length; j++) {
      connections.push([i, j])
    }
  }

  return (
    <div className="relative w-full" data-testid="marvel-map">
      {/* Title area */}
      <div className="text-center mb-4 pt-4">
        <div className="flex items-center justify-center gap-3">
          <h2 className="text-xl font-bold text-white uppercase tracking-widest">
            Global Operations Theater
          </h2>
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/20 border border-green-500/40">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-semibold text-green-400 uppercase">Live</span>
          </span>
        </div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mt-1">
          Sentinel Tactical Overview
        </p>
      </div>

      {/* SVG Map */}
      <svg
        viewBox="0 0 800 500"
        className="w-full h-auto"
        style={{ background: '#0a0a0f' }}
        data-testid="tactical-svg"
      >
        {/* Hex grid pattern background */}
        <defs>
          <pattern id="hex-grid" x="0" y="0" width="30" height="52" patternUnits="userSpaceOnUse">
            <polygon
              points="15,0 30,9 30,26 15,35 0,26 0,9"
              fill="none"
              stroke="#ffffff"
              strokeWidth="0.3"
              opacity="0.08"
            />
            <polygon
              points="15,17 30,26 30,43 15,52 0,43 0,26"
              fill="none"
              stroke="#ffffff"
              strokeWidth="0.3"
              opacity="0.08"
            />
          </pattern>

          {/* Pulse animation via CSS */}
          <style>{`
            @keyframes pulse-ring {
              0% { opacity: 0.6; }
              50% { opacity: 0.2; }
              100% { opacity: 0.6; }
            }
            .pulse-outer {
              animation: pulse-ring 2s ease-in-out infinite;
            }
          `}</style>
        </defs>

        {/* Background with hex grid */}
        <rect width="800" height="500" fill="#0a0a0f" />
        <rect width="800" height="500" fill="url(#hex-grid)" />

        {/* Connection lines */}
        {connections.map(([i, j]) => (
          <line
            key={`${i}-${j}`}
            x1={SECTORS[i].x}
            y1={SECTORS[i].y}
            x2={SECTORS[j].x}
            y2={SECTORS[j].y}
            stroke="#6b7280"
            strokeWidth="0.5"
            strokeDasharray="4 4"
            opacity="0.3"
          />
        ))}

        {/* Sector nodes */}
        {SECTORS.map((sector) => {
          const forecast = getForecast(sector.name, sector.resource)
          const summaryItem = getSummary(sector.name, sector.resource)
          const ttzEntry = getTTZ(sector.name, sector.resource)
          const status = getStatus(ttzEntry)
          const color = STATUS_COLORS[status]
          const stockPercent = getStockPercent(summaryItem)
          const hoursText =
            ttzEntry?.hours_to_zero != null && ttzEntry.hours_to_zero > 0
              ? `${Math.round(ttzEntry.hours_to_zero)}h remaining`
              : status === 'EXHAUSTED'
                ? 'EXHAUSTED'
                : status
          const needsPulse = status === 'DEPLETING' || status === 'CRITICAL' || status === 'EXHAUSTED'

          return (
            <g
              key={sector.name}
              data-testid={`sector-node-${sector.name}`}
              data-status={status}
              className="cursor-pointer"
              onClick={() => handleNodeClick(sector.name)}
              onMouseEnter={() => handleNodeHover(sector, forecast, summaryItem, ttzEntry)}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Outer pulse ring */}
              {needsPulse && (
                <polygon
                  points={hexPoints(sector.x, sector.y, 65)}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  className="pulse-outer"
                />
              )}

              {/* Outer hex ring */}
              <polygon
                points={hexPoints(sector.x, sector.y, 58)}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                opacity="0.6"
              />

              {/* Inner hex fill */}
              <polygon
                points={hexPoints(sector.x, sector.y, 50)}
                fill={color}
                fillOpacity="0.1"
                stroke={color}
                strokeWidth="1"
              />

              {/* Icon */}
              <foreignObject
                x={sector.x - 12}
                y={sector.y - 22}
                width="24"
                height="24"
              >
                <div className="flex items-center justify-center w-full h-full">
                  <HexIcon icon={sector.icon} x={0} y={0} />
                </div>
              </foreignObject>

              {/* Sector name label */}
              <text
                x={sector.x}
                y={sector.y + 70}
                textAnchor="middle"
                className="text-xs font-bold"
                fill="#e5e7eb"
                fontSize="11"
              >
                {sector.name}
              </text>

              {/* Resource type label */}
              <text
                x={sector.x}
                y={sector.y + 84}
                textAnchor="middle"
                fill="#6b7280"
                fontSize="9"
              >
                {sector.resource}
              </text>

              {/* Stock level mini progress bar */}
              <rect
                x={sector.x - 30}
                y={sector.y + 90}
                width="60"
                height="4"
                rx="2"
                fill="#1f2937"
              />
              <rect
                x={sector.x - 30}
                y={sector.y + 90}
                width={Math.max(0, (stockPercent / 100) * 60)}
                height="4"
                rx="2"
                fill={color}
              />

              {/* Hours remaining */}
              <text
                x={sector.x}
                y={sector.y + 106}
                textAnchor="middle"
                fill={color}
                fontSize="9"
                fontWeight="600"
              >
                {hoursText}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Tooltip overlay */}
      {tooltip && (
        <div
          data-testid="map-tooltip"
          className="absolute z-50 pointer-events-none bg-gray-900/95 border border-gray-700 rounded-lg p-3 shadow-xl"
          style={{
            left: `${(tooltip.x / 800) * 100}%`,
            top: `${(tooltip.y / 500) * 100 - 20}%`,
            transform: 'translate(-50%, -100%)',
            minWidth: '200px',
          }}
        >
          <p className="text-sm font-bold text-white">{tooltip.sector}</p>
          <p className="text-xs text-gray-400">{tooltip.resource}</p>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Stock Level</span>
              <span className="text-gray-200">{tooltip.stockLevel.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Usage Rate</span>
              <span className="text-gray-200">{tooltip.usageRate.toFixed(1)}/hr</span>
            </div>
            {tooltip.hoursRemaining != null && (
              <div className="flex justify-between">
                <span className="text-gray-500">Hours Remaining</span>
                <span className="text-orange-400">{Math.round(tooltip.hoursRemaining)}h</span>
              </div>
            )}
            {tooltip.exhaustionDate && (
              <div className="flex justify-between">
                <span className="text-gray-500">Exhaustion</span>
                <span className="text-red-400">
                  {new Date(tooltip.exhaustionDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Confidence</span>
              <span className="text-gray-200">{(tooltip.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
