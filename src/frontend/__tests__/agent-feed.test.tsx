/**
 * Agent Feed tests.
 *
 * Validates:
 *  1. Component renders with correct structure
 *  2. Phase indicator shows all 4 phases
 *  3. Waiting message shown when no entries
 *  4. Thinking entries render correctly via SSE callback
 *  5. Decision entries render with reasoning chain
 *  6. Collapsing hides the log
 */

import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

// Capture the SSE handler to simulate events
let capturedSSEHandler: ((type: string, data: unknown) => void) | null = null

jest.mock('@/lib/use-sse', () => ({
  useSSE: (handler: (type: string, data: unknown) => void) => {
    capturedSSEHandler = handler
  },
}))

const mockPauseAgent = jest.fn().mockResolvedValue(undefined)
const mockResumeAgent = jest.fn().mockResolvedValue(undefined)
const mockFetchAgentStatus = jest.fn().mockResolvedValue({ paused: false })

jest.mock('@/lib/api', () => ({
  pauseAgent: (...args: unknown[]) => mockPauseAgent(...args),
  resumeAgent: (...args: unknown[]) => mockResumeAgent(...args),
  fetchAgentStatus: (...args: unknown[]) => mockFetchAgentStatus(...args),
}))

jest.mock('lucide-react', () => ({
  Cpu: () => <span>cpu</span>,
  ChevronDown: () => <span>chevron-down</span>,
  ChevronUp: () => <span>chevron-up</span>,
  AlertTriangle: () => <span data-testid="icon-alert-triangle">alert-triangle</span>,
  AlertCircle: () => <span data-testid="icon-alert-circle">alert-circle</span>,
  Info: () => <span data-testid="icon-info">info</span>,
  Pause: () => <span data-testid="icon-pause">pause</span>,
  Play: () => <span data-testid="icon-play">play</span>,
}))

import { AgentFeed } from '@/components/agent/agent-feed'

describe('AgentFeed', () => {
  beforeEach(() => {
    capturedSSEHandler = null
    mockPauseAgent.mockClear()
    mockResumeAgent.mockClear()
    mockFetchAgentStatus.mockClear()
    mockFetchAgentStatus.mockResolvedValue({ paused: false })
  })

  it('renders the agent feed container', () => {
    render(<AgentFeed />)
    expect(screen.getByTestId('agent-feed')).toBeInTheDocument()
    expect(screen.getByText('JARVIS Autonomous Agent')).toBeInTheDocument()
  })

  it('renders phase indicator with all 4 phases', () => {
    render(<AgentFeed />)
    expect(screen.getByTestId('phase-indicator')).toBeInTheDocument()
    expect(screen.getByTestId('phase-observing')).toBeInTheDocument()
    expect(screen.getByTestId('phase-reasoning')).toBeInTheDocument()
    expect(screen.getByTestId('phase-planning')).toBeInTheDocument()
    expect(screen.getByTestId('phase-acting')).toBeInTheDocument()
  })

  it('shows waiting message when no entries', () => {
    render(<AgentFeed />)
    expect(screen.getByText(/Waiting for JARVIS agent cycle/)).toBeInTheDocument()
  })

  it('renders thinking entry when agent_thinking SSE event fires', () => {
    render(<AgentFeed />)
    expect(capturedSSEHandler).not.toBeNull()

    act(() => {
      capturedSSEHandler!('agent_thinking', {
        phase: 'observing',
        message: 'Scanning all sector resource levels...',
        timestamp: '2026-02-28T10:00:00Z',
      })
    })

    expect(screen.getByTestId('agent-thinking-entry')).toBeInTheDocument()
    expect(screen.getByText(/Scanning all sector resource levels/)).toBeInTheDocument()
  })

  it('highlights active phase in indicator', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_thinking', {
        phase: 'reasoning',
        message: 'Analyzing resource trends...',
        timestamp: '2026-02-28T10:00:00Z',
      })
    })

    const reasoningPhase = screen.getByTestId('phase-reasoning')
    expect(reasoningPhase.getAttribute('data-active')).toBe('true')

    const observingPhase = screen.getByTestId('phase-observing')
    expect(observingPhase.getAttribute('data-active')).toBe('false')
  })

  it('renders decision entry with reasoning chain', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_decision', {
        situation: 'All sectors stable',
        threat: null,
        actions_taken: 0,
        reasoning_chain: ['Step 1: Checked stocks', 'Step 2: All nominal'],
        timestamp: '2026-02-28T10:01:00Z',
      })
    })

    expect(screen.getByTestId('agent-decision-entry')).toBeInTheDocument()
    expect(screen.getByTestId('decision-situation')).toHaveTextContent('All sectors stable')
    expect(screen.getByText('DECISION')).toBeInTheDocument()

    // Actions taken indicator — 0 actions, gray
    const actionsTaken = screen.getByTestId('actions-taken')
    expect(actionsTaken).toHaveTextContent('0')
    expect(actionsTaken).toHaveTextContent('actions taken')

    const steps = screen.getAllByTestId('reasoning-step')
    expect(steps).toHaveLength(2)
    expect(steps[0]).toHaveTextContent('Step 1: Checked stocks')
    expect(steps[1]).toHaveTextContent('Step 2: All nominal')
  })

  it('renders decision with threat highlighted', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_decision', {
        situation: 'Wakanda under pressure',
        threat: 'Vibranium reserves critically low',
        actions_taken: 1,
        reasoning_chain: ['Detected low stocks'],
        timestamp: '2026-02-28T10:01:00Z',
      })
    })

    const threatBadge = screen.getByTestId('threat-badge')
    expect(threatBadge).toBeInTheDocument()
    expect(threatBadge).toHaveTextContent('Vibranium reserves critically low')
  })

  it('shows streaming reasoning text', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_thinking', {
        phase: 'reasoning',
        partial: 'Analyzing ',
        timestamp: '2026-02-28T10:00:00Z',
      })
    })

    act(() => {
      capturedSSEHandler!('agent_thinking', {
        phase: 'reasoning',
        partial: 'sector data...',
        timestamp: '2026-02-28T10:00:01Z',
      })
    })

    expect(screen.getByTestId('reasoning-stream')).toBeInTheDocument()
    expect(screen.getByTestId('reasoning-stream')).toHaveTextContent('Analyzing sector data...')
  })

  it('collapsing hides the agent log', () => {
    render(<AgentFeed />)

    // Log should be visible
    expect(screen.getByTestId('agent-log')).toBeInTheDocument()

    // Click the header to collapse
    fireEvent.click(screen.getByText('JARVIS Autonomous Agent'))

    // Log should be hidden
    expect(screen.queryByTestId('agent-log')).not.toBeInTheDocument()

    // Click again to expand
    fireEvent.click(screen.getByText('JARVIS Autonomous Agent'))
    expect(screen.getByTestId('agent-log')).toBeInTheDocument()
  })

  it('clears reasoning buffer on decision', () => {
    render(<AgentFeed />)

    // Send a partial reasoning
    act(() => {
      capturedSSEHandler!('agent_thinking', {
        phase: 'reasoning',
        partial: 'Thinking...',
        timestamp: '2026-02-28T10:00:00Z',
      })
    })

    expect(screen.getByTestId('reasoning-stream')).toBeInTheDocument()

    // Send a decision
    act(() => {
      capturedSSEHandler!('agent_decision', {
        situation: 'Done',
        threat: null,
        actions_taken: 0,
        reasoning_chain: [],
        timestamp: '2026-02-28T10:01:00Z',
      })
    })

    // Reasoning stream should be gone
    expect(screen.queryByTestId('reasoning-stream')).not.toBeInTheDocument()
  })

  it('renders agent_alert with severity icon and color', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_alert', {
        message: 'Vibranium critically low',
        severity: 'critical',
        confidence: 0.95,
        timestamp: '2026-02-28T10:02:00Z',
      })
    })

    const alertEntry = screen.getByTestId('agent-alert-entry')
    expect(alertEntry).toBeInTheDocument()
    expect(alertEntry.getAttribute('data-severity')).toBe('critical')
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
    expect(screen.getByText('Vibranium critically low')).toBeInTheDocument()
    expect(screen.getByTestId('icon-alert-triangle')).toBeInTheDocument()
  })

  it('renders critical alert with pulse animation', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_alert', {
        message: 'Sector under attack',
        severity: 'critical',
        confidence: 0.9,
        timestamp: '2026-02-28T10:03:00Z',
      })
    })

    const alertEntry = screen.getByTestId('agent-alert-entry')
    expect(alertEntry.className).toContain('animate-pulse')
  })

  it('renders warning alert without pulse', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_alert', {
        message: 'Water reserves declining',
        severity: 'warning',
        confidence: 0.7,
        timestamp: '2026-02-28T10:04:00Z',
      })
    })

    const alertEntry = screen.getByTestId('agent-alert-entry')
    expect(alertEntry.getAttribute('data-severity')).toBe('warning')
    expect(alertEntry.className).not.toContain('animate-pulse')
    expect(screen.getByText('WARNING')).toBeInTheDocument()
  })

  it('renders info alert', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_alert', {
        message: 'Routine scan complete',
        severity: 'info',
        confidence: 0.5,
        timestamp: '2026-02-28T10:05:00Z',
      })
    })

    const alertEntry = screen.getByTestId('agent-alert-entry')
    expect(alertEntry.getAttribute('data-severity')).toBe('info')
    expect(screen.getByText('INFO')).toBeInTheDocument()
  })

  it('shows actions_taken with green color when > 0', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_decision', {
        situation: 'Adjusting allocations',
        threat: 'Medical supply shortage',
        actions_taken: 3,
        reasoning_chain: [],
        timestamp: '2026-02-28T10:06:00Z',
      })
    })

    const actionsTaken = screen.getByTestId('actions-taken')
    expect(actionsTaken).toHaveTextContent('3')
    expect(actionsTaken.className).toContain('text-green-400')
  })

  it('shows actions_taken with gray color when 0', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_decision', {
        situation: 'No action needed',
        threat: null,
        actions_taken: 0,
        reasoning_chain: [],
        timestamp: '2026-02-28T10:07:00Z',
      })
    })

    const actionsTaken = screen.getByTestId('actions-taken')
    expect(actionsTaken).toHaveTextContent('0')
    expect(actionsTaken.className).toContain('text-gray-500')
  })

  it('shows threat in large prominent badge', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_decision', {
        situation: 'Crisis detected',
        threat: 'Arc Reactor failing',
        actions_taken: 2,
        reasoning_chain: [],
        timestamp: '2026-02-28T10:08:00Z',
      })
    })

    const threatBadge = screen.getByTestId('threat-badge')
    expect(threatBadge).toHaveTextContent('Arc Reactor failing')
    expect(threatBadge.className).toContain('bg-red-600')
    expect(threatBadge.className).toContain('text-white')
    expect(threatBadge.className).toContain('font-bold')
  })

  it('does not show threat badge when threat is null', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_decision', {
        situation: 'All clear',
        threat: null,
        actions_taken: 0,
        reasoning_chain: [],
        timestamp: '2026-02-28T10:09:00Z',
      })
    })

    expect(screen.queryByTestId('threat-badge')).not.toBeInTheDocument()
  })

  it('renders pause toggle button', () => {
    render(<AgentFeed />)
    const toggle = screen.getByTestId('pause-toggle')
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveTextContent('Pause')
  })

  it('calls pauseAgent when clicking pause', async () => {
    render(<AgentFeed />)
    const toggle = screen.getByTestId('pause-toggle')

    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(mockPauseAgent).toHaveBeenCalledTimes(1)
  })

  it('calls resumeAgent when clicking resume while paused', async () => {
    render(<AgentFeed />)

    // Simulate SSE paused event
    act(() => {
      capturedSSEHandler!('agent_status', { paused: true })
    })

    const toggle = screen.getByTestId('pause-toggle')
    expect(toggle).toHaveTextContent('Resume')

    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(mockResumeAgent).toHaveBeenCalledTimes(1)
  })

  it('shows PAUSED badge when agent is paused via SSE', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_status', { paused: true })
    })

    expect(screen.getByTestId('paused-badge')).toBeInTheDocument()
    expect(screen.getByTestId('paused-badge')).toHaveTextContent('PAUSED')
  })

  it('hides PAUSED badge when agent is resumed via SSE', () => {
    render(<AgentFeed />)

    act(() => {
      capturedSSEHandler!('agent_status', { paused: true })
    })
    expect(screen.getByTestId('paused-badge')).toBeInTheDocument()

    act(() => {
      capturedSSEHandler!('agent_status', { paused: false })
    })
    expect(screen.queryByTestId('paused-badge')).not.toBeInTheDocument()
  })

  it('fetches initial agent status on mount', () => {
    render(<AgentFeed />)
    expect(mockFetchAgentStatus).toHaveBeenCalledTimes(1)
  })

  it('shows resume button when initially paused', async () => {
    mockFetchAgentStatus.mockResolvedValue({ paused: true })
    await act(async () => {
      render(<AgentFeed />)
    })
    const toggle = screen.getByTestId('pause-toggle')
    expect(toggle).toHaveTextContent('Resume')
  })
})
