'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  fetchGovernorStatus,
  fetchGovernorDecisions,
  triggerSnap,
} from '@/lib/api'
import type {
  GovernorStatus,
  GovernorDecision,
  GovernorAllocation,
} from '@/lib/types'
import { Cpu, Loader2, Zap } from 'lucide-react'

/* ── Sector color palette ── */
const SECTOR_COLORS: Record<string, string> = {
  'Avengers Compound': '#3B82F6',
  'New Asgard': '#8B5CF6',
  'Sanctum Sanctorum': '#06B6D4',
  Sokovia: '#F59E0B',
  Wakanda: '#10B981',
}

/* ── Target stock lookup (mirrors backend resource_config.py) ── */
const TARGET_STOCK: Record<string, number> = {
  'Avengers Compound|Medical Kits': 600,
  'New Asgard|Vibranium (kg)': 450,
  'Sanctum Sanctorum|Clean Water (L)': 700,
  'Sokovia|Pym Particles': 500,
  'Wakanda|Arc Reactor Cores': 500,
}

function sectorColor(sector: string): string {
  return SECTOR_COLORS[sector] ?? '#6b7280'
}

/* ── Budget Allocation Panel ── */
function BudgetAllocationPanel({
  allocations,
  totalBudgetUsed,
  totalBudget,
}: {
  allocations: GovernorAllocation[]
  totalBudgetUsed: number
  totalBudget: number
}) {
  const pct = totalBudget > 0 ? (totalBudgetUsed / totalBudget) * 100 : 0

  // Group costs by sector
  const bySector: Record<string, number> = {}
  for (const a of allocations ?? []) {
    bySector[a.sector_id] = (bySector[a.sector_id] ?? 0) + a.cost_per_cycle
  }

  return (
    <div
      className="bg-gray-950 rounded-lg border border-gray-800 p-4 space-y-3"
      data-testid="budget-panel"
    >
      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
        Production Budget Allocation
      </p>

      {/* Stacked bar */}
      <div className="h-6 w-full rounded-md overflow-hidden flex bg-gray-800" data-testid="budget-bar">
        {Object.entries(bySector).map(([sector, cost]) => {
          const widthPct = totalBudget > 0 ? (cost / totalBudget) * 100 : 0
          return (
            <div
              key={sector}
              title={`${sector}: $${cost.toLocaleString()} (${widthPct.toFixed(1)}%)`}
              style={{ width: `${widthPct}%`, backgroundColor: sectorColor(sector) }}
              className="h-full transition-all duration-500"
            />
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(bySector).map(([sector, cost]) => {
          const widthPct = totalBudget > 0 ? (cost / totalBudget) * 100 : 0
          return (
            <div key={sector} className="flex items-center gap-1.5 text-xs text-gray-400">
              <span
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: sectorColor(sector) }}
              />
              <span>{sector}</span>
              <span className="text-gray-500">
                ${cost.toLocaleString()} ({widthPct.toFixed(0)}%)
              </span>
            </div>
          )
        })}
      </div>

      {/* Progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>
            Budget used: ${totalBudgetUsed.toLocaleString()} / $
            {totalBudget.toLocaleString()}
          </span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${Math.min(pct, 100)}%` }}
            data-testid="budget-progress"
          />
        </div>
      </div>
    </div>
  )
}

/* ── Model Intelligence Panel ── */
function ModelIntelligencePanel({ status }: { status: GovernorStatus }) {
  const models = [
    { key: 'champion' as const, label: 'JARVIS-\u03b1', tier: 'Champion', border: 'border-yellow-500/60', bg: 'bg-yellow-500/5' },
    { key: 'challenger' as const, label: 'JARVIS-\u03b2', tier: 'Challenger', border: 'border-gray-400/40', bg: 'bg-gray-400/5' },
    { key: 'backup' as const, label: 'JARVIS-\u03b3', tier: 'Backup', border: 'border-gray-600/40', bg: 'bg-gray-600/5' },
  ]

  return (
    <div
      className="bg-gray-950 rounded-lg border border-gray-800 p-4 space-y-3"
      data-testid="model-panel"
    >
      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
        Model Intelligence
      </p>

      <div className="space-y-2">
        {models.map((m) => {
          const info = status[m.key] ?? { confidence: 0, data_points: 0, trained_at: new Date().toISOString() }
          const isChallenger = m.key === 'challenger'
          return (
            <div
              key={m.key}
              data-testid={`model-row-${m.key}`}
              className={`rounded-md border p-3 flex items-center justify-between ${m.border} ${m.bg} ${isChallenger ? 'relative' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-200">{m.label}</p>
                  <p className="text-xs text-gray-500">{m.tier}</p>
                </div>
                {isChallenger && (
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span>
                  <strong className="text-gray-200">
                    {info.confidence.toFixed(1)}%
                  </strong>{' '}
                  conf
                </span>
                <span>
                  {info.data_points.toLocaleString()} pts
                </span>
                <span className="text-gray-600">
                  {new Date(info.trained_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Production Controls ── */
function allocationStatus(a: GovernorAllocation): string {
  // Check if current_stock > target_stock => OPTIMAL
  const key = `${a.sector_id}|${a.resource_type}`
  const target = TARGET_STOCK[key]
  if (target != null && a.units_per_cycle > 0) {
    // We can't directly check stock here, so OPTIMAL is checked at render time
    // via the optional currentStocks prop
  }
  if (a.units_per_cycle <= 0) return 'CRITICAL'
  if (a.units_per_cycle < 5) return 'CUTTING'
  if (a.units_per_cycle > 20) return 'RAMPING'
  return 'MAINTAINING'
}

function getProductionStatus(a: GovernorAllocation, currentStock?: number): string {
  const key = `${a.sector_id}|${a.resource_type}`
  const target = TARGET_STOCK[key]
  if (target != null && currentStock != null && currentStock > target) {
    return 'OPTIMAL'
  }
  return allocationStatus(a)
}

const statusColors: Record<string, string> = {
  MAINTAINING: 'bg-green-500/20 text-green-400 border-green-500/30',
  OPTIMAL: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  RAMPING: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CUTTING: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
}

function ProductionControls({
  allocations,
  currentStocks,
}: {
  allocations: GovernorAllocation[]
  currentStocks?: Record<string, number>
}) {
  return (
    <div data-testid="production-controls" className="space-y-2">
      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
        Production Controls
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
        {(allocations ?? []).map((a) => {
          const key = `${a.sector_id}|${a.resource_type}`
          const stock = currentStocks?.[key]
          const st = getProductionStatus(a, stock)
          return (
            <div
              key={key}
              className="bg-gray-950 border border-gray-800 rounded-md p-3 space-y-1.5"
              data-testid="production-card"
            >
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                {a.sector_id}
              </p>
              <p className="text-sm text-gray-300">{a.resource_type}</p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-200">
                  {a.units_per_cycle} u/cycle
                </span>
                <span className="text-xs text-gray-500">
                  ${a.cost_per_cycle.toLocaleString()}
                </span>
              </div>
              <Badge
                variant="outline"
                className={`text-xs ${statusColors[st] ?? statusColors.MAINTAINING}`}
              >
                {st}
              </Badge>
              {/* Sparkline placeholder */}
              <div className="flex items-end gap-px h-4">
                {[0.6, 0.8, 0.5, 0.9, 1.0].map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm"
                    style={{
                      height: `${v * 100}%`,
                      backgroundColor: sectorColor(a.sector_id),
                      opacity: 0.6 + i * 0.08,
                    }}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Decision Log ── */
function decisionColor(rationale: string, confidence: number): string {
  if (confidence < 50 || /emergency|critical/i.test(rationale))
    return 'border-l-red-500'
  if (confidence < 75 || /adjust|shift|rebalance/i.test(rationale))
    return 'border-l-yellow-500'
  return 'border-l-green-500'
}

function DecisionEntry({ d }: { d: GovernorDecision }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={`border-l-4 ${decisionColor(d.rationale, d.champion_confidence)} bg-gray-950 rounded-r-md p-3 flex flex-col gap-1`}
      data-testid="decision-entry"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {new Date(d.timestamp).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
        <div className="flex items-center gap-2">
          {(d.sectors_adjusted ?? []).map((s) => (
            <Badge
              key={s}
              variant="outline"
              className="text-xs bg-gray-800/50 text-gray-400 border-gray-700"
            >
              {s}
            </Badge>
          ))}
          <span className="text-xs text-gray-500">
            {d.champion_confidence.toFixed(0)}%
          </span>
        </div>
      </div>
      <p
        className={`text-sm text-gray-300 ${!expanded ? 'line-clamp-2' : ''}`}
      >
        {d.rationale}
      </p>
      {d.rationale.length > 120 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-400 hover:text-blue-300 self-start"
          data-testid="decision-expand"
        >
          {expanded ? 'show less' : 'see more'}
        </button>
      )}
    </div>
  )
}

function DecisionLog({ decisions }: { decisions: GovernorDecision[] }) {
  return (
    <div data-testid="decision-log" className="space-y-2">
      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
        Jarvis Autonomous Decisions
      </p>
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {decisions.length === 0 ? (
          <p className="text-sm text-gray-600 py-4 text-center">
            No decisions recorded yet.
          </p>
        ) : (
          decisions.map((d, i) => <DecisionEntry key={i} d={d} />)
        )}
      </div>
    </div>
  )
}

/* ── SNAP Button ── */
function SnapButton({ onSnap }: { onSnap: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [flashVisible, setFlashVisible] = useState(false)

  async function handleClick() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    // Second click — execute
    setExecuting(true)
    try {
      await onSnap()
      setFlashVisible(true)
      setTimeout(() => setFlashVisible(false), 3000)
    } finally {
      setExecuting(false)
      setConfirming(false)
    }
  }

  function handleCancel() {
    setConfirming(false)
  }

  return (
    <>
      {flashVisible && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-red-900/40 animate-pulse pointer-events-none"
          data-testid="snap-flash"
        >
          <p className="text-2xl font-bold text-red-300 text-center">
            SNAP EVENT EXECUTED — JARVIS RECALIBRATING
          </p>
        </div>
      )}
      <div className="flex gap-2" data-testid="snap-section">
        <Button
          onClick={handleClick}
          disabled={executing}
          className={`flex-1 font-bold text-sm py-3 transition-colors ${
            confirming
              ? 'bg-red-700 hover:bg-red-800 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
          data-testid="snap-button"
        >
          {executing ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Zap className="w-4 h-4 mr-2" />
          )}
          {confirming
            ? 'CONFIRM SNAP — CLICK AGAIN TO EXECUTE'
            : 'EXECUTE SNAP PROTOCOL'}
        </Button>
        {confirming && (
          <Button
            variant="outline"
            onClick={handleCancel}
            className="border-gray-700 text-gray-400 hover:bg-gray-800"
            data-testid="snap-cancel"
          >
            Cancel
          </Button>
        )}
      </div>
    </>
  )
}

/* ── Main Command Center ── */
export function CommandCenter() {
  const {
    data: status,
    isLoading: statusLoading,
  } = useSWR<GovernorStatus>('governor-status', fetchGovernorStatus, {
    refreshInterval: 5000,
  })

  const {
    data: decisions,
    isLoading: decisionsLoading,
  } = useSWR<GovernorDecision[]>('governor-decisions', () => fetchGovernorDecisions(10), {
    refreshInterval: 5000,
  })

  async function handleSnap() {
    await triggerSnap()
  }

  if (statusLoading || decisionsLoading) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  if (!status) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="flex items-center justify-center py-16 text-gray-500">
          Governor service unavailable.
        </CardContent>
      </Card>
    )
  }

  // Build current stock lookup from time-to-zero data if available
  // This is fetched by the dashboard page; for now we pass empty
  // The production cards will use this to detect OPTIMAL status

  return (
    <Card
      className="bg-gray-900 border-gray-800"
      data-testid="command-center"
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Cpu className="w-5 h-5 text-blue-400" />
          Sentinel Command Center
          <span className="text-xs text-gray-500 font-normal ml-1">
            Autonomous Resource Governance
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top row: Budget + Model Intelligence side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BudgetAllocationPanel
            allocations={status.current_allocations ?? []}
            totalBudgetUsed={status.total_budget_used ?? 0}
            totalBudget={status.total_budget ?? 0}
          />
          <ModelIntelligencePanel status={status} />
        </div>

        {/* Production Controls */}
        <ProductionControls allocations={status.current_allocations ?? []} />

        {/* Decision Log */}
        <DecisionLog decisions={Array.isArray(decisions) ? decisions : []} />

        {/* SNAP */}
        <SnapButton onSnap={handleSnap} />
      </CardContent>
    </Card>
  )
}
