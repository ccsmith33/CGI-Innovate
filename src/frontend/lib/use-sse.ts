import { useEffect, useRef } from 'react'

type SSEHandler = (type: string, data: unknown) => void

export function useSSE(handler: SSEHandler) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/stream`
    const es = new EventSource(url)

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data)
        handlerRef.current(parsed.type, parsed.data)
      } catch {
        // Ignore malformed messages
      }
    }

    es.addEventListener('heartbeat', () => {
      // Keep alive - no action needed
    })

    es.onerror = () => {
      // EventSource auto-reconnects; no action needed
    }

    return () => es.close()
  }, []) // intentionally empty — handler updated via ref
}
