'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSSE } from '@/lib/use-sse'

export function VitalsBar() {
  const [connected, setConnected] = useState(false)
  const [heartbeat, setHeartbeat] = useState(false)
  const [eventsPerMin, setEventsPerMin] = useState(0)
  const [governorCountdown, setGovernorCountdown] = useState(30)
  const [clock, setClock] = useState('')
  const [cycleNumber, setCycleNumber] = useState(0)
  const eventTimestampsRef = useRef<number[]>([])

  // SSE handler
  const handleSSE = useCallback((type: string) => {
    setConnected(true)

    // Record event timestamp for throughput
    const now = Date.now()
    eventTimestampsRef.current.push(now)

    // Flash heartbeat
    setHeartbeat(true)
    setTimeout(() => setHeartbeat(false), 300)
  }, [])

  useSSE(handleSSE)

  // Mark connected on mount (SSE will reconnect automatically)
  useEffect(() => {
    setConnected(true)
  }, [])

  // Clock + governor countdown + throughput ticker
  useEffect(() => {
    const interval = setInterval(() => {
      // UTC clock
      setClock(new Date().toISOString().slice(11, 19))

      // Governor countdown (30s cycle)
      setGovernorCountdown((prev) => {
        if (prev <= 1) {
          setCycleNumber((c) => c + 1)
          return 30
        }
        return prev - 1
      })

      // Compute events per minute (rolling 60s window)
      const now = Date.now()
      const cutoff = now - 60000
      eventTimestampsRef.current = eventTimestampsRef.current.filter((t) => t > cutoff)
      setEventsPerMin(eventTimestampsRef.current.length)
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 bg-gray-950/95 border-t border-gray-800 px-4 py-1.5 flex items-center gap-6 text-[10px] uppercase tracking-wider font-mono"
      data-testid="vitals-bar"
    >
      {/* Connection status */}
      <div className="flex items-center gap-1.5" data-testid="vitals-connection">
        <span
          className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
          data-testid="connection-dot"
        />
        <span className={connected ? 'text-green-400' : 'text-red-400'}>
          {connected ? 'SSE CONNECTED' : 'RECONNECTING'}
        </span>
      </div>

      {/* Heartbeat */}
      <div className="flex items-center gap-1.5" data-testid="vitals-heartbeat">
        <span
          className={`w-2 h-2 rounded-full transition-all duration-150 ${
            heartbeat ? 'bg-cyan-400 scale-125' : 'bg-gray-600'
          }`}
        />
        <span className="text-gray-500">HB</span>
      </div>

      {/* Event throughput */}
      <div className="flex items-center gap-1.5" data-testid="vitals-throughput">
        <span className="text-gray-500">EVT/MIN</span>
        <span className="text-cyan-400">{eventsPerMin}</span>
      </div>

      {/* Governor cycle countdown */}
      <div className="flex items-center gap-1.5" data-testid="vitals-governor">
        <span className="text-gray-500">GOV CYCLE</span>
        <span className={`${governorCountdown <= 5 ? 'text-yellow-400' : 'text-gray-300'}`}>
          {governorCountdown}s
        </span>
      </div>

      {/* Sim clock */}
      <div className="flex items-center gap-1.5 ml-auto" data-testid="vitals-clock">
        <span className="text-gray-500">UTC</span>
        <span className="text-gray-300">{clock}</span>
        <span className="text-gray-600">C{cycleNumber}</span>
      </div>
    </div>
  )
}
