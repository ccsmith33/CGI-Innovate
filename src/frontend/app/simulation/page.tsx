'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { fetchSummary } from '@/lib/api'
import type { SummaryItem } from '@/lib/types'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { Play, RotateCcw, Zap, AlertTriangle, Package, Flame } from 'lucide-react'

const SECTOR_RESOURCE_MAP: Record<string, string> = {
  'Avengers Compound': 'Medical Kits',
  'New Asgard': 'Vibranium (kg)',
  'Sanctum Sanctorum': 'Clean Water (L)',
  'Sokovia': 'Pym Particles',
  'Wakanda': 'Arc Reactor Cores',
}

const SPEED_OPTIONS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '5x', value: 5 },
]

interface AnomalyEvent {
  hour: number
  type: 'resupply' | 'consumption'
  delta: number
  label: string
}

const ANOMALY_EVENTS: AnomalyEvent[] = [
  { hour: 12, type: 'resupply', delta: 150, label: 'Emergency resupply' },
  { hour: 25, type: 'consumption', delta: -80, label: 'Combat event' },
  { hour: 40, type: 'resupply', delta: 200, label: 'Allied supply drop' },
  { hour: 55, type: 'consumption', delta: -120, label: 'Sector breach' },
  { hour: 70, type: 'resupply', delta: 100, label: 'Field medic delivery' },
  { hour: 85, type: 'consumption', delta: -60, label: 'Equipment malfunction' },
]

interface FiredEvent extends AnomalyEvent {
  stockAfter: number
}

interface SimDataPoint {
  hour: number
  stock?: number
  projected?: number
}

interface ResourceSimState {
  sector: string
  resource: string
  initialStock: number
  currentStock: number
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number; name: string; color: string }>
  label?: number
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-md p-3 text-sm shadow-lg">
      <p className="text-gray-300 mb-1">Hour {label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {entry.value?.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </p>
      ))}
    </div>
  )
}

export default function SimulationPage() {
  const { data: summaryData } = useSWR('summary', fetchSummary)
  const summary: SummaryItem[] = summaryData?.data ?? []

  // Resource selection
  const [selectedPair, setSelectedPair] = useState<string>('')

  // Simulation parameters
  const [initialStock, setInitialStock] = useState<number>(0)
  const [usageRate, setUsageRate] = useState<number>(0)

  // Simulation state
  const [running, setRunning] = useState(false)
  const [currentHour, setCurrentHour] = useState(0)
  const [currentStock, setCurrentStock] = useState(0)
  const [chartData, setChartData] = useState<SimDataPoint[]>([])
  const [snapEvents, setSnapEvents] = useState<number[]>([])
  const [exhausted, setExhausted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [snapFlash, setSnapFlash] = useState(false)
  const [firedEvents, setFiredEvents] = useState<FiredEvent[]>([])
  const [anomalyHours, setAnomalyHours] = useState<Array<{ hour: number; type: 'resupply' | 'consumption'; label: string }>>([])

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stockRef = useRef(0)
  const hourRef = useRef(0)
  const firedHoursRef = useRef<Set<number>>(new Set())

  // Derive sector/resource from selected pair
  const selectedSector = selectedPair || ''
  const selectedResource = SECTOR_RESOURCE_MAP[selectedSector] ?? ''

  // When user selects a sector+resource, pre-fill stock and usage from summary
  useEffect(() => {
    if (!selectedSector || !selectedResource) return
    const item = summary.find(
      (s) => s.sector_id === selectedSector && s.resource_type === selectedResource
    )
    if (item) {
      setInitialStock(item.latest_stock_level)
      setUsageRate(item.latest_usage_rate)
    }
  }, [selectedSector, selectedResource, summary])

  // Compute projected depletion line (from current state to exhaustion)
  const computeProjection = useCallback(
    (fromHour: number, fromStock: number, rate: number): SimDataPoint[] => {
      if (rate <= 0) return []
      const points: SimDataPoint[] = []
      const hoursToZero = Math.ceil(fromStock / rate)
      const step = Math.max(1, Math.floor(hoursToZero / 50))
      for (let h = 0; h <= hoursToZero; h += step) {
        const stock = Math.max(0, fromStock - rate * h)
        points.push({ hour: fromHour + h, projected: stock })
      }
      // Ensure the final point at zero is included
      if (points[points.length - 1]?.projected !== 0) {
        points.push({ hour: fromHour + hoursToZero, projected: 0 })
      }
      return points
    },
    []
  )

  const handleStart = useCallback(() => {
    if (running) return
    if (initialStock <= 0 || usageRate <= 0) return

    setCurrentHour(0)
    setCurrentStock(initialStock)
    setChartData([{ hour: 0, stock: initialStock }])
    setSnapEvents([])
    setFiredEvents([])
    setAnomalyHours([])
    setExhausted(false)
    setRunning(true)

    stockRef.current = initialStock
    hourRef.current = 0
    firedHoursRef.current = new Set()
  }, [running, initialStock, usageRate])

  const handleReset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setRunning(false)
    setCurrentHour(0)
    setCurrentStock(0)
    setChartData([])
    setSnapEvents([])
    setFiredEvents([])
    setAnomalyHours([])
    setExhausted(false)
    stockRef.current = 0
    hourRef.current = 0
    firedHoursRef.current = new Set()
  }, [])

  const handleSnap = useCallback(() => {
    if (!running || exhausted) return

    const snappedStock = stockRef.current / 2
    stockRef.current = snappedStock
    setCurrentStock(snappedStock)
    setSnapEvents((prev) => [...prev, hourRef.current])
    setChartData((prev) => [...prev, { hour: hourRef.current, stock: snappedStock }])

    // Show snap flash effect
    setSnapFlash(true)
    setTimeout(() => setSnapFlash(false), 2000)

    if (snappedStock <= 0) {
      setExhausted(true)
      setRunning(false)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [running, exhausted])

  // Simulation tick via setInterval
  useEffect(() => {
    if (!running || exhausted) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const tickMs = 500 / speed

    intervalRef.current = setInterval(() => {
      const newHour = hourRef.current + 1

      // Apply random fluctuation: +/-10% of usage rate
      const fluctuation = 1 + (Math.random() * 0.2 - 0.1)
      let newStock = Math.max(0, stockRef.current - usageRate * fluctuation)

      // Check for anomaly events at this hour
      const anomaly = ANOMALY_EVENTS.find(
        (e) => e.hour === newHour && !firedHoursRef.current.has(e.hour)
      )
      if (anomaly) {
        newStock = Math.max(0, newStock + anomaly.delta)
        firedHoursRef.current.add(anomaly.hour)
        setFiredEvents((prev) => [...prev, { ...anomaly, stockAfter: newStock }])
        setAnomalyHours((prev) => [...prev, { hour: anomaly.hour, type: anomaly.type, label: anomaly.label }])
      }

      hourRef.current = newHour
      stockRef.current = newStock

      setCurrentHour(newHour)
      setCurrentStock(newStock)
      setChartData((prev) => [...prev, { hour: newHour, stock: newStock }])

      if (newStock <= 0) {
        setExhausted(true)
        setRunning(false)
      }
    }, tickMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [running, exhausted, usageRate, speed])

  // Build merged data for chart: actual points + projection
  const projection = running && !exhausted
    ? computeProjection(hourRef.current, stockRef.current, usageRate)
    : []

  // Merge chart data and projection into a single dataset
  const mergedData: Array<{ hour: number; stock?: number; projected?: number }> = [
    ...chartData.map((d) => ({ hour: d.hour, stock: d.stock })),
  ]

  // Add projection points that extend beyond existing data
  const lastHour = chartData.length > 0 ? chartData[chartData.length - 1].hour : 0
  for (const p of projection) {
    if (p.hour > lastHour) {
      mergedData.push({ hour: p.hour, projected: p.projected })
    }
  }
  // Bridge: set projected value at the current hour to show continuity
  if (projection.length > 0 && mergedData.length > 0) {
    const bridgeIdx = mergedData.findIndex((d) => d.hour === lastHour)
    if (bridgeIdx >= 0) {
      mergedData[bridgeIdx] = { ...mergedData[bridgeIdx], projected: mergedData[bridgeIdx].stock }
    }
  }

  return (
    <div className="p-6 space-y-6 relative">
      {/* Snap Flash Overlay */}
      {snapFlash && (
        <div
          data-testid="snap-flash"
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        >
          <div className="absolute inset-0 bg-red-600/20 animate-pulse" />
          <span className="text-4xl font-black text-red-500 tracking-widest animate-bounce">
            SNAP DETECTED
          </span>
        </div>
      )}

      <h1 className="text-2xl font-bold text-white">Resource Depletion Simulation</h1>

      {/* Controls */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">Simulation Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Resource Selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Sector / Resource</label>
              <Select value={selectedPair} onValueChange={setSelectedPair}>
                <SelectTrigger className="bg-gray-900 border-gray-700 text-gray-100">
                  <SelectValue placeholder="Select resource" />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  {Object.entries(SECTOR_RESOURCE_MAP).map(([sector, resource]) => (
                    <SelectItem key={sector} value={sector}>
                      {sector} - {resource}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Initial Stock</label>
              <Input
                type="number"
                value={initialStock}
                onChange={(e) => setInitialStock(Number(e.target.value))}
                className="bg-gray-800 border-gray-700 text-gray-100"
                min={0}
                disabled={running}
                data-testid="initial-stock-input"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Speed</label>
              <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
                <SelectTrigger className="bg-gray-900 border-gray-700 text-gray-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  {SPEED_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ML-derived Usage Rate (read-only) */}
          {selectedSector && usageRate > 0 && (
            <div className="flex items-center gap-2 text-sm" data-testid="ml-usage-rate">
              <span className="text-gray-400">Usage Rate:</span>
              <span className="text-white font-mono">{usageRate} units/hr</span>
              <Badge variant="secondary" className="text-xs">ML model</Badge>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleStart}
              disabled={running || initialStock <= 0 || usageRate <= 0}
              className="bg-green-600 hover:bg-green-700 text-white"
              data-testid="start-button"
            >
              <Play className="w-4 h-4 mr-2" />
              Start
            </Button>
            <Button
              onClick={handleReset}
              variant="outline"
              className="border-gray-700 text-gray-300 hover:bg-gray-800"
              data-testid="reset-button"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button
              onClick={handleSnap}
              disabled={!running || exhausted}
              className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-6"
              data-testid="snap-button"
            >
              <Zap className="w-4 h-4 mr-2" />
              SNAP
            </Button>
          </div>

          {/* Status Display */}
          {running && (
            <div className="flex items-center gap-6 text-sm" data-testid="simulation-status">
              <span className="text-gray-400">
                Hour: <span className="text-white font-mono">{currentHour}</span>
              </span>
              <span className="text-gray-400">
                Stock:{' '}
                <span className="text-white font-mono">
                  {currentStock.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </span>
              </span>
              <span className="text-gray-400">
                Rate:{' '}
                <span className="text-white font-mono">{usageRate}/hr</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exhaustion Alert */}
      {exhausted && (
        <div
          data-testid="exhaustion-alert"
          className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/40 text-red-400"
        >
          <AlertTriangle className="w-5 h-5" />
          <span className="font-bold text-lg">EXHAUSTED</span>
          <span className="text-sm">
            {selectedResource} in {selectedSector} depleted at hour {currentHour}
          </span>
        </div>
      )}

      {/* Simulation Chart */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">
            Depletion Timeline
            {selectedSector && (
              <span className="text-sm font-normal ml-2">
                <span className="text-blue-400">{selectedSector}</span>
                <span className="text-gray-500 mx-2">|</span>
                <span className="text-purple-400">{selectedResource}</span>
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mergedData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-80 gap-3 text-gray-500">
              <span className="text-4xl">🧪</span>
              <p className="text-sm">
                Select a resource and click Start to begin the depletion simulation.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart
                data={mergedData}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="hour"
                  stroke="#9CA3AF"
                  tick={{ fill: '#9CA3AF', fontSize: 12 }}
                  label={{ value: 'Hour', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  tick={{ fill: '#9CA3AF', fontSize: 12 }}
                  label={{
                    value: 'Stock Level',
                    angle: -90,
                    position: 'insideLeft',
                    fill: '#9CA3AF',
                  }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="stock"
                  name="Stock Level"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  activeDot={{ r: 4, fill: '#3B82F6' }}
                />
                <Line
                  type="monotone"
                  dataKey="projected"
                  name="Projected"
                  stroke="#EF4444"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  connectNulls={false}
                />
                {snapEvents.map((hour) => (
                  <ReferenceLine
                    key={`snap-${hour}`}
                    x={hour}
                    stroke="#A855F7"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    label={{
                      value: 'SNAP',
                      position: 'top',
                      fill: '#A855F7',
                      fontSize: 12,
                      fontWeight: 'bold',
                    }}
                  />
                ))}
                {anomalyHours.map((evt) => (
                  <ReferenceLine
                    key={`anomaly-${evt.hour}`}
                    x={evt.hour}
                    stroke={evt.type === 'resupply' ? '#22C55E' : '#F97316'}
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    label={{
                      value: evt.label,
                      position: 'top',
                      fill: evt.type === 'resupply' ? '#22C55E' : '#F97316',
                      fontSize: 10,
                      fontWeight: 'bold',
                    }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Event Log */}
      {firedEvents.length > 0 && (
        <Card className="bg-gray-900 border-gray-800" data-testid="event-log">
          <CardHeader>
            <CardTitle className="text-white text-lg">Event Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {firedEvents.map((evt, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 text-sm"
                  data-testid="event-log-entry"
                >
                  {evt.type === 'resupply' ? (
                    <Package className="w-4 h-4 text-green-500 shrink-0" />
                  ) : (
                    <Flame className="w-4 h-4 text-orange-500 shrink-0" />
                  )}
                  <span className="text-gray-400">Hour {evt.hour}:</span>
                  <span className={evt.type === 'resupply' ? 'text-green-400' : 'text-orange-400'}>
                    {evt.label}
                  </span>
                  <span className="text-gray-500 font-mono">
                    {evt.delta > 0 ? '+' : ''}{evt.delta} units
                  </span>
                  <span className="text-gray-600 font-mono text-xs">
                    (stock: {evt.stockAfter.toLocaleString(undefined, { maximumFractionDigits: 1 })})
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
