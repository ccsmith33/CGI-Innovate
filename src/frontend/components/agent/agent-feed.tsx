'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useSSE } from '@/lib/use-sse'
import { pauseAgent, resumeAgent, fetchAgentStatus } from '@/lib/api'
import { Cpu, ChevronDown, ChevronUp, AlertTriangle, AlertCircle, Info, Pause, Play } from 'lucide-react'

type Phase = 'observing' | 'reasoning' | 'planning' | 'acting' | 'idle'
type Severity = 'critical' | 'warning' | 'info'

interface ThinkingEvent {
  id: number
  phase: Phase
  message?: string
  partial?: string
  timestamp: string
}

interface DecisionEvent {
  id: number
  situation: string
  threat: string | null
  actions_taken: number
  reasoning_chain: string[]
  timestamp: string
}

interface AlertEvent {
  id: number
  message: string
  severity: Severity
  confidence: number
  timestamp: string
}

type FeedEntry =
  | { type: 'thinking'; data: ThinkingEvent }
  | { type: 'decision'; data: DecisionEvent }
  | { type: 'alert'; data: AlertEvent }

const SEVERITY_CONFIG: Record<Severity, { icon: typeof AlertTriangle; color: string; border: string; bg: string; label: string }> = {
  critical: {
    icon: AlertTriangle,
    color: 'text-red-400',
    border: 'border-red-500/50',
    bg: 'bg-red-500/10',
    label: 'CRITICAL',
  },
  warning: {
    icon: AlertCircle,
    color: 'text-amber-400',
    border: 'border-amber-500/50',
    bg: 'bg-amber-500/10',
    label: 'WARNING',
  },
  info: {
    icon: Info,
    color: 'text-blue-400',
    border: 'border-blue-500/50',
    bg: 'bg-blue-500/10',
    label: 'INFO',
  },
}

const PHASE_ORDER: Phase[] = ['observing', 'reasoning', 'planning', 'acting']
const PHASE_LABELS: Record<Phase, string> = {
  observing: 'OBSERVING',
  reasoning: 'REASONING',
  planning: 'PLANNING',
  acting: 'ACTING',
  idle: 'IDLE',
}

function PhaseIndicator({ current }: { current: Phase }) {
  return (
    <div className="flex items-center gap-1 text-xs font-mono" data-testid="phase-indicator">
      {PHASE_ORDER.map((phase, i) => {
        const isActive = phase === current
        const isPast = PHASE_ORDER.indexOf(current) > i
        return (
          <span key={phase} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-600">&rarr;</span>}
            <span
              className={`px-1.5 py-0.5 rounded ${
                isActive
                  ? 'bg-green-500/20 text-green-400 animate-pulse'
                  : isPast
                    ? 'bg-green-500/10 text-green-600'
                    : 'bg-gray-800 text-gray-600'
              }`}
              data-testid={`phase-${phase}`}
              data-active={isActive}
            >
              {PHASE_LABELS[phase]}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function AgentFeed() {
  const [entries, setEntries] = useState<FeedEntry[]>([])
  const [currentPhase, setCurrentPhase] = useState<Phase>('idle')
  const [collapsed, setCollapsed] = useState(false)
  const [reasoningBuffer, setReasoningBuffer] = useState('')
  const [paused, setPaused] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)

  // Fetch initial pause state on mount
  useEffect(() => {
    fetchAgentStatus().then((s) => setPaused(s.paused)).catch(() => {})
  }, [])

  // Auto-scroll to bottom when new entries appear
  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, collapsed])

  const handleSSE = useCallback((type: string, data: unknown) => {
    const payload = data as Record<string, unknown>

    if (type === 'agent_thinking') {
      const phase = (payload.phase as Phase) || 'reasoning'
      setCurrentPhase(phase)

      if (payload.partial) {
        // Streaming text — append to reasoning buffer
        setReasoningBuffer((prev) => prev + (payload.partial as string))
      } else if (payload.message) {
        // Phase transition message
        setReasoningBuffer('')
        setEntries((prev) => [
          ...prev.slice(-50), // keep last 50 entries
          {
            type: 'thinking',
            data: {
              id: ++idRef.current,
              phase,
              message: payload.message as string,
              timestamp: (payload.timestamp as string) || new Date().toISOString(),
            },
          },
        ])
      }
    } else if (type === 'agent_decision') {
      setCurrentPhase('idle')
      setReasoningBuffer('')
      setEntries((prev) => [
        ...prev.slice(-50),
        {
          type: 'decision',
          data: {
            id: ++idRef.current,
            situation: (payload.situation as string) || '',
            threat: (payload.threat as string | null) || null,
            actions_taken: (payload.actions_taken as number) || 0,
            reasoning_chain: (payload.reasoning_chain as string[]) || [],
            timestamp: (payload.timestamp as string) || new Date().toISOString(),
          },
        },
      ])
    } else if (type === 'agent_status') {
      const statusPayload = payload as { paused?: boolean }
      if (typeof statusPayload.paused === 'boolean') {
        setPaused(statusPayload.paused)
      }
    } else if (type === 'agent_alert') {
      setEntries((prev) => [
        ...prev.slice(-50),
        {
          type: 'alert',
          data: {
            id: ++idRef.current,
            message: (payload.message as string) || '',
            severity: (payload.severity as Severity) || 'info',
            confidence: (payload.confidence as number) || 0,
            timestamp: (payload.timestamp as string) || new Date().toISOString(),
          },
        },
      ])
    }
  }, [])

  useSSE(handleSSE)

  const handleTogglePause = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation() // prevent collapse toggle
    try {
      if (paused) {
        await resumeAgent()
      } else {
        await pauseAgent()
      }
    } catch {
      // SSE will sync the real state
    }
  }, [paused])

  return (
    <Card className="bg-gray-950 border-gray-800" data-testid="agent-feed">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setCollapsed((c) => !c)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <Cpu className="w-5 h-5 text-green-400" />
            JARVIS Autonomous Agent
            {paused && (
              <Badge
                variant="outline"
                className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs"
                data-testid="paused-badge"
              >
                PAUSED
              </Badge>
            )}
            {!paused && currentPhase !== 'idle' && (
              <Badge
                variant="outline"
                className="bg-green-500/20 text-green-400 border-green-500/30 text-xs animate-pulse"
              >
                ACTIVE
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-3">
            <PhaseIndicator current={currentPhase} />
            <button
              onClick={handleTogglePause}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors ${
                paused
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
              }`}
              data-testid="pause-toggle"
            >
              {paused ? (
                <>
                  <Play className="w-3 h-3" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="w-3 h-3" />
                  Pause
                </>
              )}
            </button>
            {collapsed ? (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronUp className="w-4 h-4 text-gray-500" />
            )}
          </div>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent>
          <div
            ref={scrollRef}
            className="font-mono text-xs space-y-1 max-h-64 overflow-y-auto bg-black/50 rounded-lg p-3 border border-gray-800"
            data-testid="agent-log"
          >
            {entries.length === 0 && !reasoningBuffer && (
              <div className="text-gray-600 italic">
                Waiting for JARVIS agent cycle...
              </div>
            )}

            {entries.map((entry) => {
              if (entry.type === 'thinking') {
                return (
                  <div key={entry.data.id} className="text-green-500" data-testid="agent-thinking-entry">
                    <span className="text-gray-600">
                      [{new Date(entry.data.timestamp).toLocaleTimeString()}]
                    </span>{' '}
                    <span className="text-green-600">[{PHASE_LABELS[entry.data.phase]}]</span>{' '}
                    {entry.data.message}
                  </div>
                )
              }

              if (entry.type === 'alert') {
                const sev = SEVERITY_CONFIG[entry.data.severity] || SEVERITY_CONFIG.info
                const SevIcon = sev.icon
                const isCritical = entry.data.severity === 'critical'
                return (
                  <div
                    key={entry.data.id}
                    className={`border rounded p-3 my-2 ${sev.border} ${sev.bg} ${isCritical ? 'animate-pulse' : ''}`}
                    data-testid="agent-alert-entry"
                    data-severity={entry.data.severity}
                  >
                    <div className="flex items-center gap-2">
                      <SevIcon className={`w-5 h-5 ${sev.color} flex-shrink-0`} data-testid="alert-icon" />
                      <span className={`font-bold text-sm ${sev.color}`}>{sev.label}</span>
                      <span className="text-gray-600 text-xs ml-auto">
                        {new Date(entry.data.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className={`mt-1 text-sm ${sev.color}`}>{entry.data.message}</div>
                  </div>
                )
              }

              // Decision card — visually prominent
              return (
                <div
                  key={entry.data.id}
                  className="border border-green-500/30 rounded p-3 my-2 bg-green-500/5"
                  data-testid="agent-decision-entry"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-green-400 font-bold text-sm">DECISION</span>
                    <span className="text-gray-600 text-xs">
                      {new Date(entry.data.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Primary visual indicators row */}
                  <div className="flex items-center gap-3 mb-2">
                    {/* Threat badge — large, bold, high contrast */}
                    {entry.data.threat && (
                      <span
                        className="inline-block px-3 py-1 rounded-full bg-red-600 text-white font-bold text-base tracking-wide"
                        data-testid="threat-badge"
                      >
                        {entry.data.threat}
                      </span>
                    )}

                    {/* Actions taken — large number, color-coded */}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-lg font-bold ${
                        entry.data.actions_taken > 0
                          ? 'text-green-400 bg-green-500/10'
                          : 'text-gray-500 bg-gray-800'
                      }`}
                      data-testid="actions-taken"
                    >
                      {entry.data.actions_taken}
                      <span className="text-xs font-normal uppercase tracking-wider">
                        actions taken
                      </span>
                    </span>
                  </div>

                  {/* Situation — secondary text, smaller */}
                  <div className="text-gray-400 text-xs mt-1" data-testid="decision-situation">{entry.data.situation}</div>

                  {entry.data.reasoning_chain.length > 0 && (
                    <div className="mt-1 text-gray-500 text-xs">
                      {entry.data.reasoning_chain.map((step, i) => (
                        <div key={i} data-testid="reasoning-step">
                          {step}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Live streaming reasoning text */}
            {reasoningBuffer && (
              <div className="text-green-400 animate-pulse" data-testid="reasoning-stream">
                {reasoningBuffer}
                <span className="inline-block w-1.5 h-3 bg-green-400 ml-0.5 animate-pulse" />
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
