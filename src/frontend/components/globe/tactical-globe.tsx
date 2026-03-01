'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type { SummaryItem, Forecast, TimeToZeroEntry } from '@/lib/types'
import { TARGET_STOCK, computeNetStatus } from '@/lib/api'

import type { GlobeMethods } from 'react-globe.gl'

// Dynamically import Globe to avoid SSR issues (three.js requires window)
const Globe = dynamic(() => import('react-globe.gl').then((m) => m.default), {
  ssr: false,
})

const SECTOR_LOCATIONS = [
  { id: 'Avengers Compound', lat: 41.05, lng: -73.52, resource: 'Medical Kits', color: '#00ff88' },
  { id: 'New Asgard', lat: 59.33, lng: 18.07, resource: 'Vibranium (kg)', color: '#a0d8ef' },
  { id: 'Sanctum Sanctorum', lat: 40.73, lng: -74.0, resource: 'Clean Water (L)', color: '#00bfff' },
  { id: 'Sokovia', lat: 49.75, lng: 13.38, resource: 'Pym Particles', color: '#ffa500' },
  { id: 'Wakanda', lat: 9.02, lng: 38.74, resource: 'Arc Reactor Cores', color: '#e0b840' },
]

// Supply dependency arcs: source → destination
const SUPPLY_ARCS = [
  { srcId: 'New Asgard', dstId: 'Wakanda' },       // Vibranium → Arc Reactors
  { srcId: 'Wakanda', dstId: 'Avengers Compound' }, // Arc Reactors → Medical Kits
  { srcId: 'Avengers Compound', dstId: 'Sanctum Sanctorum' }, // Medical → Clean Water
  { srcId: 'Sokovia', dstId: 'Avengers Compound' }, // Pym Particles → Medical
]

function getStockHealth(sectorId: string, resource: string, sectors: SummaryItem[]): string {
  const item = sectors.find((s) => s.sector_id === sectorId && s.resource_type === resource)
  if (!item) return '#888888'

  const key = `${sectorId}|${resource}`
  const target = TARGET_STOCK[key] ?? 500
  const pct = item.latest_stock_level / target

  if (pct >= 0.7) return '#22c55e'  // green
  if (pct >= 0.3) return '#eab308'  // yellow
  return '#ef4444'                   // red
}

interface TacticalGlobeProps {
  sectors: SummaryItem[]
  forecasts?: Forecast[]
  timeToZero?: TimeToZeroEntry[]
  snapActive?: boolean
  pointRadius?: number
  arcStroke?: number
  atmosphereAltitude?: number
  autoRotateSpeed?: number
}

export function TacticalGlobe({
  sectors,
  forecasts = [],
  timeToZero = [],
  snapActive = false,
  pointRadius = 0.5,
  arcStroke = 0.5,
  atmosphereAltitude = 0.2,
  autoRotateSpeed: autoRotateSpeedProp = 0.3,
}: TacticalGlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ sector: string; resource: string; stock: number } | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  // Responsive sizing via ResizeObserver
  const updateDimensions = useCallback(() => {
    if (containerRef.current) {
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight
      if (w > 0 && h > 0) {
        setDimensions({ width: w, height: h })
      }
    }
  }, [])

  useEffect(() => {
    updateDimensions()
    const obs = new ResizeObserver(updateDimensions)
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [updateDimensions])

  // Configure auto-rotate on mount and when speed changes
  useEffect(() => {
    if (globeRef.current?.controls) {
      const controls = globeRef.current.controls()
      controls.autoRotate = true
      controls.autoRotateSpeed = autoRotateSpeedProp
    }
  }, [autoRotateSpeedProp])

  // Build point data
  const pointsData = useMemo(() => {
    return SECTOR_LOCATIONS.map((loc) => {
      const healthColor = snapActive ? '#a855f7' : getStockHealth(loc.id, loc.resource, sectors)
      return {
        lat: loc.lat,
        lng: loc.lng,
        color: healthColor,
        label: loc.id,
        resource: loc.resource,
        sectorId: loc.id,
      }
    })
  }, [sectors, snapActive])

  // Build supply arc data
  const supplyArcs = useMemo(() => {
    if (snapActive) return []

    return SUPPLY_ARCS.map((arc) => {
      const src = SECTOR_LOCATIONS.find((s) => s.id === arc.srcId)
      const dst = SECTOR_LOCATIONS.find((s) => s.id === arc.dstId)
      if (!src || !dst) return null
      return {
        startLat: src.lat,
        startLng: src.lng,
        endLat: dst.lat,
        endLng: dst.lng,
        color: src.color,
      }
    }).filter((arc): arc is NonNullable<typeof arc> => arc !== null)
  }, [snapActive])

  // Build forecast projection arcs — colored loopback arcs per sector showing ML forecast status
  const forecastArcs = useMemo(() => {
    if (snapActive) return []

    return SECTOR_LOCATIONS.map((loc) => {
      const ttz = timeToZero.find(
        (t) => t.sector_id === loc.id && t.resource_type === loc.resource
      )
      const forecast = forecasts.find(
        (f) => f.sector_id === loc.id && f.resource_type === loc.resource
      )
      if (!ttz && !forecast) return null

      // Determine projection color based on net status and forecast
      let color: string
      if (ttz) {
        const status = computeNetStatus(ttz)
        if (status === 'OPTIMAL' || status === 'STABLE') {
          color = '#22c55e'  // green — healthy/recovering
        } else if (status === 'RECOVERING') {
          color = '#7dd3fc'  // light blue — improving
        } else if (status === 'DEPLETING' || status === 'CRITICAL') {
          color = '#ef4444'  // red — critical
        } else if (status === 'EXHAUSTED') {
          color = '#7f1d1d'  // dark red
        } else {
          color = '#7dd3fc'  // light blue — default/normal
        }
      } else {
        // Forecast only, no ttz — use light blue
        color = '#7dd3fc'
      }

      // Create a short loopback arc near the sector to show the forecast status ring
      // Larger offsets make arcs visually prominent at globe scale
      // Each sector sweeps outward from the point
      const offsetLat = 25
      const offsetLng = 30
      return {
        startLat: loc.lat,
        startLng: loc.lng,
        endLat: loc.lat + offsetLat,
        endLng: loc.lng + offsetLng,
        color,
      }
    }).filter((arc): arc is NonNullable<typeof arc> => arc !== null)
  }, [snapActive, forecasts, timeToZero])

  // Combine all arcs
  const arcsData = useMemo(
    () => [...supplyArcs, ...forecastArcs],
    [supplyArcs, forecastArcs]
  )

  function handlePointClick(point: object) {
    const pt = point as Record<string, unknown>
    const sectorId = pt.sectorId as string
    const resource = pt.resource as string
    const item = sectors.find((s) => s.sector_id === sectorId && s.resource_type === resource)
    setTooltip({
      sector: sectorId,
      resource: resource,
      stock: item?.latest_stock_level ?? 0,
    })
  }

  const ready = dimensions.width > 0 && dimensions.height > 0

  return (
    <div
      ref={containerRef}
      className="globe-container relative w-full h-full overflow-hidden"
      style={{ minHeight: 0 }}
      data-testid="tactical-globe"
    >
      {ready && (
        <Globe
          ref={globeRef}
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          atmosphereColor="#1a3a5c"
          atmosphereAltitude={atmosphereAltitude}
          backgroundColor="rgba(0,0,0,0)"
          pointsData={pointsData}
          pointAltitude={0.06}
          pointRadius={pointRadius}
          pointColor="color"
          pointLabel="label"
          onPointClick={handlePointClick}
          arcsData={arcsData}
          arcColor="color"
          arcDashLength={0.4}
          arcDashGap={0.2}
          arcDashAnimateTime={1500}
          arcStroke={arcStroke}
          width={dimensions.width}
          height={dimensions.height}
        />
      )}

      {tooltip && (
        <div
          data-testid="globe-tooltip"
          className="absolute bottom-4 left-4 bg-gray-900/95 border border-gray-700 rounded-lg p-3 shadow-xl z-10"
        >
          <p className="text-sm font-bold text-white">{tooltip.sector}</p>
          <p className="text-xs text-gray-400">{tooltip.resource}</p>
          <p className="text-xs text-gray-300 mt-1">
            Stock: {tooltip.stock.toLocaleString()}
          </p>
          <button
            className="text-xs text-blue-400 mt-1 hover:text-blue-300"
            onClick={() => setTooltip(null)}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
