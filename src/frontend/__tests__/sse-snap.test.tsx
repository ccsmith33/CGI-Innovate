import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'

// Mock GSAP to avoid animation issues in tests
jest.mock('gsap', () => {
  const mockTimeline = {
    to: jest.fn().mockReturnThis(),
    fromTo: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    add: jest.fn().mockReturnThis(),
    kill: jest.fn(),
  }
  return {
    gsap: {
      timeline: jest.fn(() => mockTimeline),
      utils: { random: jest.fn(() => 4) },
    },
  }
})

// Mock EventSource
type EventSourceListener = (event: MessageEvent | Event) => void

let mockEventSourceInstance: {
  onmessage: ((event: MessageEvent) => void) | null
  onerror: (() => void) | null
  addEventListener: jest.Mock
  close: jest.Mock
  readyState: number
}

const MockEventSource = jest.fn(() => {
  mockEventSourceInstance = {
    onmessage: null,
    onerror: null,
    addEventListener: jest.fn(),
    close: jest.fn(),
    readyState: 1,
  }
  return mockEventSourceInstance
})

;(global as unknown as Record<string, unknown>).EventSource = MockEventSource

// Mock AudioContext
;(global as unknown as Record<string, unknown>).AudioContext = jest.fn(() => ({
  createOscillator: jest.fn(() => ({
    connect: jest.fn(),
    frequency: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
    start: jest.fn(),
    stop: jest.fn(),
  })),
  createGain: jest.fn(() => ({
    connect: jest.fn(),
    gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
  })),
  destination: {},
  currentTime: 0,
}))

import { useSSE } from '@/lib/use-sse'
import { SnapSequence } from '@/components/snap/snap-sequence'

describe('useSSE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('opens EventSource connection to /api/v1/stream', () => {
    const handler = jest.fn()
    renderHook(() => useSSE(handler))

    expect(MockEventSource).toHaveBeenCalledWith('http://localhost:8000/api/v1/stream')
  })

  it('calls handler with parsed type and data on message', () => {
    const handler = jest.fn()
    renderHook(() => useSSE(handler))

    const payload = JSON.stringify({ type: 'resource_update', data: { sector: 'Wakanda' } })

    act(() => {
      mockEventSourceInstance.onmessage?.(new MessageEvent('message', { data: payload }))
    })

    expect(handler).toHaveBeenCalledWith('resource_update', { sector: 'Wakanda' })
  })

  it('handles snap_alert event type', () => {
    const handler = jest.fn()
    renderHook(() => useSSE(handler))

    const payload = JSON.stringify({ type: 'snap_alert', data: { message: 'Snap detected' } })

    act(() => {
      mockEventSourceInstance.onmessage?.(new MessageEvent('message', { data: payload }))
    })

    expect(handler).toHaveBeenCalledWith('snap_alert', { message: 'Snap detected' })
  })

  it('handles governor_decision event type', () => {
    const handler = jest.fn()
    renderHook(() => useSSE(handler))

    const payload = JSON.stringify({ type: 'governor_decision', data: { rationale: 'test' } })

    act(() => {
      mockEventSourceInstance.onmessage?.(new MessageEvent('message', { data: payload }))
    })

    expect(handler).toHaveBeenCalledWith('governor_decision', { rationale: 'test' })
  })

  it('ignores malformed messages', () => {
    const handler = jest.fn()
    renderHook(() => useSSE(handler))

    act(() => {
      mockEventSourceInstance.onmessage?.(new MessageEvent('message', { data: 'not json' }))
    })

    expect(handler).not.toHaveBeenCalled()
  })

  it('closes EventSource on unmount', () => {
    const handler = jest.fn()
    const { unmount } = renderHook(() => useSSE(handler))

    unmount()

    expect(mockEventSourceInstance.close).toHaveBeenCalled()
  })

  it('registers heartbeat event listener', () => {
    const handler = jest.fn()
    renderHook(() => useSSE(handler))

    expect(mockEventSourceInstance.addEventListener).toHaveBeenCalledWith(
      'heartbeat',
      expect.any(Function)
    )
  })
})

describe('SnapSequence', () => {
  it('does not render when active is false', () => {
    const { container } = render(<SnapSequence active={false} onComplete={jest.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders snap elements when active is true', () => {
    render(<SnapSequence active={true} onComplete={jest.fn()} />)
    expect(screen.getByTestId('snap-sequence')).toBeInTheDocument()
    expect(screen.getByTestId('snap-text')).toBeInTheDocument()
  })

  it('renders overlay, blast ring, CRT, and text elements', () => {
    render(<SnapSequence active={true} onComplete={jest.fn()} />)

    const sequence = screen.getByTestId('snap-sequence')
    expect(sequence.querySelector('.snap-overlay')).toBeInTheDocument()
    expect(sequence.querySelector('.snap-blast-ring')).toBeInTheDocument()
    expect(sequence.querySelector('.snap-crt')).toBeInTheDocument()
    expect(sequence.querySelector('.snap-text')).toBeInTheDocument()
  })

  it('creates a GSAP timeline when active', () => {
    const { gsap } = require('gsap')
    render(<SnapSequence active={true} onComplete={jest.fn()} />)
    expect(gsap.timeline).toHaveBeenCalled()
  })
})
