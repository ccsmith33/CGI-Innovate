/**
 * Command Center tests.
 *
 * Validates:
 *  1. Budget allocation panel renders with correct total
 *  2. Model intelligence shows inline summary with champion/challenger/backup
 *  3. SNAP button requires confirmation before firing
 *  4. Decision log renders rationale entries with truncation
 *  5. Production controls show 5 sectors
 *  6. Wakanda color is emerald green (not red)
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Mock SWR
jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn((key: string) => {
    if (key === 'governor-status') {
      return {
        data: {
          champion: { confidence: 92.0, data_points: 1500, trained_at: '2026-02-28T10:00:00Z' },
          challenger: { confidence: 87.0, data_points: 800, trained_at: '2026-02-28T09:00:00Z' },
          backup: { confidence: 72.0, data_points: 200, trained_at: '2026-02-27T08:00:00Z' },
          current_allocations: [
            { sector_id: 'Avengers Compound', resource_type: 'Medical Kits', units_per_cycle: 15, cost_per_cycle: 18000, status: 'CRITICAL' },
            { sector_id: 'New Asgard', resource_type: 'Vibranium (kg)', units_per_cycle: 8, cost_per_cycle: 22000, status: 'CRITICAL' },
            { sector_id: 'Sanctum Sanctorum', resource_type: 'Clean Water (L)', units_per_cycle: 25, cost_per_cycle: 12000, status: 'CRITICAL' },
            { sector_id: 'Sokovia', resource_type: 'Pym Particles', units_per_cycle: 3, cost_per_cycle: 30000, status: 'CUTTING' },
            { sector_id: 'Wakanda', resource_type: 'Arc Reactor Cores', units_per_cycle: 10, cost_per_cycle: 18000, status: 'CRITICAL' },
          ],
          total_budget_used: 82000,
          total_budget: 100000,
        },
        isLoading: false,
      }
    }
    if (key === 'governor-decisions') {
      return {
        data: [
          {
            timestamp: '2026-02-28T10:15:00Z',
            rationale: 'Routine rebalancing across sectors based on consumption trends.',
            sectors_adjusted: ['Wakanda', 'Sokovia'],
            champion_confidence: 92.0,
            total_budget_used: 82000,
            allocations_json: '{}',
          },
          {
            timestamp: '2026-02-28T09:50:00Z',
            rationale: 'Emergency reallocation — Sokovia Pym Particles critically low. The governor has determined that immediate action is needed to prevent total resource exhaustion within the next 4 hours based on current consumption trends.',
            sectors_adjusted: ['Sokovia'],
            champion_confidence: 40.0,
            total_budget_used: 85000,
            allocations_json: '{}',
          },
        ],
        isLoading: false,
      }
    }
    if (key === 'scenarios') {
      return {
        data: [
          { id: 'thanos_incursion', name: 'Thanos Incursion', description: 'Multi-sector cascade' },
          { id: 'hydra_sabotage', name: 'HYDRA Sabotage', description: 'Targeted strike' },
          { id: 'pandemic_surge', name: 'Pandemic Surge', description: 'Health crisis' },
        ],
        isLoading: false,
      }
    }
    return { data: null, isLoading: false }
  }),
}))

// Mock API
jest.mock('@/lib/api', () => ({
  fetchGovernorStatus: jest.fn(),
  fetchGovernorDecisions: jest.fn(),
  triggerSnap: jest.fn().mockResolvedValue({ message: 'ok' }),
  fetchScenarios: jest.fn().mockResolvedValue([
    { id: 'thanos_incursion', name: 'Thanos Incursion', description: 'Multi-sector cascade' },
  ]),
  triggerScenario: jest.fn().mockResolvedValue({ message: 'Scenario initiated', steps: 6 }),
}))

// Mock lucide-react
jest.mock('lucide-react', () => ({
  Cpu: () => <span>cpu</span>,
  Loader2: () => <span>loader</span>,
  Zap: () => <span>zap</span>,
  AlertTriangle: () => <span>alert</span>,
}))

import { CommandCenter } from '@/components/command-center/command-center'
import { triggerSnap } from '@/lib/api'

const mockTriggerSnap = triggerSnap as jest.MockedFunction<typeof triggerSnap>

describe('CommandCenter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the command center container', () => {
    render(<CommandCenter chart={<div data-testid="test-chart" />} ttzCards={<div data-testid="test-ttz" />} />)
    expect(screen.getByTestId('command-center')).toBeInTheDocument()
    expect(screen.getByText('Sentinel Command Center')).toBeInTheDocument()
  })

  it('renders the budget allocation panel with correct total', () => {
    render(<CommandCenter />)
    expect(screen.getByTestId('budget-panel')).toBeInTheDocument()
    expect(screen.getByTestId('budget-bar')).toBeInTheDocument()
    // Budget text should contain the total
    expect(screen.getByText(/\$82,000/)).toBeInTheDocument()
    expect(screen.getByText(/\$100,000/)).toBeInTheDocument()
  })

  it('renders inline model intelligence summary', () => {
    render(<CommandCenter />)
    expect(screen.getByTestId('model-panel')).toBeInTheDocument()

    // Check inline summary labels
    expect(screen.getByText('JARVIS-\u03b1')).toBeInTheDocument()
    expect(screen.getByText(/JARVIS-\u03b2 training/)).toBeInTheDocument()
    expect(screen.getByText(/JARVIS-\u03b3/)).toBeInTheDocument()
  })

  it('SNAP button requires confirmation before firing', async () => {
    render(<CommandCenter />)
    const snapBtn = screen.getByTestId('snap-button')

    // First click — should enter confirmation state
    fireEvent.click(snapBtn)
    expect(screen.getByText(/CONFIRM SNAP/)).toBeInTheDocument()
    expect(mockTriggerSnap).not.toHaveBeenCalled()

    // Cancel button should appear
    expect(screen.getByTestId('snap-cancel')).toBeInTheDocument()
  })

  it('SNAP button fires on second click', async () => {
    render(<CommandCenter />)
    const snapBtn = screen.getByTestId('snap-button')

    // First click — confirm
    fireEvent.click(snapBtn)
    // Second click — execute
    await act(async () => {
      fireEvent.click(snapBtn)
    })

    await waitFor(() => {
      expect(mockTriggerSnap).toHaveBeenCalledTimes(1)
    })
  })

  it('SNAP cancel button resets confirmation state', () => {
    render(<CommandCenter />)
    const snapBtn = screen.getByTestId('snap-button')

    fireEvent.click(snapBtn)
    expect(screen.getByText(/CONFIRM SNAP/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('snap-cancel'))
    expect(screen.getByText(/EXECUTE SNAP PROTOCOL/)).toBeInTheDocument()
  })

  it('renders decision log entries with rationale', () => {
    render(<CommandCenter />)
    expect(screen.getByTestId('decision-log')).toBeInTheDocument()

    const entries = screen.getAllByTestId('decision-entry')
    expect(entries).toHaveLength(2)

    expect(
      screen.getByText(/Routine rebalancing across sectors/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Emergency reallocation/)
    ).toBeInTheDocument()
  })

  it('long rationale has a "see more" toggle', () => {
    render(<CommandCenter />)
    // The second decision has a long rationale (>120 chars)
    const expandBtns = screen.getAllByTestId('decision-expand')
    expect(expandBtns.length).toBeGreaterThanOrEqual(1)
    expect(expandBtns[0].textContent).toBe('see more')
  })

  it('renders production controls with 5 sectors', () => {
    render(<CommandCenter />)
    expect(screen.getByTestId('production-controls')).toBeInTheDocument()

    const cards = screen.getAllByTestId('production-card')
    expect(cards).toHaveLength(5)
  })

  it('uses emerald green for Wakanda (not red)', () => {
    render(<CommandCenter />)
    const budgetBar = screen.getByTestId('budget-bar')
    // The Wakanda segment should have emerald green background
    const segments = budgetBar.querySelectorAll('div')
    const wakandaSegment = Array.from(segments).find((el) =>
      el.getAttribute('title')?.includes('Wakanda')
    )
    expect(wakandaSegment).toBeTruthy()
    expect(wakandaSegment?.style.backgroundColor).toBe('rgb(16, 185, 129)')
  })
})
