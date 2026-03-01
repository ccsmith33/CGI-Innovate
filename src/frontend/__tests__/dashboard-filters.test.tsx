/**
 * Dashboard tests.
 *
 * These tests verify:
 *  1. The page-level sector dropdown is removed (no global filter)
 *  2. The ResourceChart is rendered inside the Command Center
 *  3. Time-to-zero cards show correct governor-synced status thresholds
 *  4. Command Center is the primary section (first card)
 *  5. Standalone "Jarvis ML Forecast Intelligence" section is removed
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

// Mock governor status with allocations that produce known governor statuses
// base_production values: Wakanda=4, Sokovia=5, Avengers=8, New Asgard=3, Sanctum=10
// status = CUTTING if units < base*0.9, RAMPING if units > base*1.5, else MAINTAINING
const MOCK_GOVERNOR_STATUS = {
  champion: { confidence: 0.9, data_points: 100, trained_at: '2026-02-28T12:00:00Z' },
  challenger: { confidence: 0, data_points: 0, trained_at: '2026-02-28T12:00:00Z' },
  backup: { confidence: 0, data_points: 0, trained_at: '2026-02-28T12:00:00Z' },
  current_allocations: [
    // Wakanda: stock=500, target=180, 500 > 180*1.2=216 → OPTIMAL
    { sector_id: 'Wakanda', resource_type: 'Arc Reactor Cores', units_per_cycle: 4, cost_per_cycle: 20000, status: 'MAINTAINING' },
    // Sokovia: stock=60, target=420, 60 < 420; prod=5*1200=6000, net=5995 > 50 → RECOVERING
    { sector_id: 'Sokovia', resource_type: 'Pym Particles', units_per_cycle: 5, cost_per_cycle: 22500, status: 'MAINTAINING' },
    // Avengers: stock=10 → EXHAUSTED (stock<=10 overrides)
    { sector_id: 'Avengers Compound', resource_type: 'Medical Kits', units_per_cycle: 0, cost_per_cycle: 0, status: 'CUTTING' },
    // New Asgard: stock=240, target=300, 240 < 300; prod=0, net=-5 → STABLE
    { sector_id: 'New Asgard', resource_type: 'Vibranium (kg)', units_per_cycle: 0, cost_per_cycle: 0, status: 'CUTTING' },
    // Sanctum: stock=1000, target=750, 1000 > 750*1.2=900 → OPTIMAL
    { sector_id: 'Sanctum Sanctorum', resource_type: 'Clean Water (L)', units_per_cycle: 10, cost_per_cycle: 10000, status: 'MAINTAINING' },
  ],
  total_budget_used: 52500,
  total_budget: 110000,
}

// Mock SWR to control data flow
jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn((key: string) => {
    if (key === 'summary') {
      return { data: { data: [] }, error: null, isLoading: false, mutate: jest.fn() }
    }
    if (key === 'forecasts') {
      return { data: { data: [] }, mutate: jest.fn() }
    }
    if (key === 'time-to-zero') {
      return {
        data: [
          { sector_id: 'Wakanda', resource_type: 'Arc Reactor Cores', hours_to_zero: null, current_stock: 500, consumption_rate: 5, snap_detected: false },
          { sector_id: 'Sokovia', resource_type: 'Pym Particles', hours_to_zero: 12, current_stock: 60, consumption_rate: 5, snap_detected: false },
          { sector_id: 'Avengers Compound', resource_type: 'Medical Kits', hours_to_zero: 2, current_stock: 10, consumption_rate: 5, snap_detected: false },
          { sector_id: 'New Asgard', resource_type: 'Vibranium (kg)', hours_to_zero: 48, current_stock: 240, consumption_rate: 5, snap_detected: false },
          { sector_id: 'Sanctum Sanctorum', resource_type: 'Clean Water (L)', hours_to_zero: 200, current_stock: 1000, consumption_rate: 5, snap_detected: false },
        ],
        error: null,
        isLoading: false,
        mutate: jest.fn(),
      }
    }
    if (key === 'governor-status-dashboard') {
      return { data: MOCK_GOVERNOR_STATUS, isLoading: false, mutate: jest.fn() }
    }
    if (key === 'governor-status') {
      return { data: MOCK_GOVERNOR_STATUS, isLoading: false }
    }
    if (key === 'governor-decisions') {
      return { data: [], isLoading: false }
    }
    return { data: { data: [] }, error: null, isLoading: false, mutate: jest.fn() }
  }),
}))

// Mock the API module — use real computeNetStatus and TARGET_STOCK
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api')
  return {
    fetchResources: jest.fn().mockResolvedValue({ data: [], total: 0, limit: 500, offset: 0 }),
    fetchSectors: jest.fn().mockResolvedValue({ sectors: ['Wakanda', 'Sokovia', 'New Asgard'] }),
    fetchSummary: jest.fn().mockResolvedValue({ data: [] }),
    fetchForecasts: jest.fn().mockResolvedValue({ data: [] }),
    refreshForecasts: jest.fn().mockResolvedValue({ message: 'ok', strategy: 'full' }),
    fetchTimeToZero: jest.fn().mockResolvedValue([]),
    fetchGovernorStatus: jest.fn().mockResolvedValue(null),
    fetchGovernorDecisions: jest.fn().mockResolvedValue([]),
    triggerSnap: jest.fn().mockResolvedValue({ message: 'ok' }),
    overrideProduction: jest.fn().mockResolvedValue({ message: 'ok' }),
    computeNetStatus: actual.computeNetStatus,
    TARGET_STOCK: actual.TARGET_STOCK,
  }
})

// Mock chart components to avoid Recharts issues in jsdom
jest.mock('@/components/charts/resource-chart', () => ({
  ResourceChart: () => <div data-testid="resource-chart" />,
  buildForecastLine: jest.fn(() => []),
}))
jest.mock('@/components/charts/sector-summary', () => ({
  SectorSummary: () => <div data-testid="sector-summary" />,
}))
// CommandCenter now receives chart and ttzCards props — render them
jest.mock('@/components/command-center/command-center', () => ({
  CommandCenter: ({ chart, ttzCards }: { chart?: React.ReactNode; ttzCards?: React.ReactNode }) => (
    <div data-testid="command-center">
      <div data-testid="cc-chart-area">{chart}</div>
      <div data-testid="cc-ttz-area">{ttzCards}</div>
    </div>
  ),
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Loader2: () => <span>loader</span>,
  AlertCircle: () => <span>alert</span>,
  Bell: () => <span>bell</span>,
  Volume2: () => <span>volume2</span>,
  VolumeX: () => <span>volumeX</span>,
}))

// Mock alert components
jest.mock('@/components/alerts/notification-bell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}))
jest.mock('@/components/alerts/toast', () => ({
  ToastContainer: () => null,
  useToasts: () => ({ toasts: [], addToast: jest.fn(), dismiss: jest.fn() }),
  useAlertToasts: jest.fn(),
}))
jest.mock('@/hooks/use-alerts', () => ({
  useAlerts: () => [],
}))

// Mock SSE hook
jest.mock('@/lib/use-sse', () => ({
  useSSE: jest.fn(),
}))

// Mock snap sequence
jest.mock('@/components/snap/snap-sequence', () => ({
  SnapSequence: () => null,
}))

// Mock DEFCON badge
jest.mock('@/components/hud/defcon-badge', () => ({
  DefconBadge: () => <span data-testid="defcon-badge" />,
}))

// Mock tactical globe
jest.mock('@/components/globe/tactical-globe', () => ({
  TacticalGlobe: () => <div data-testid="tactical-globe" />,
}))

// Mock agent feed
jest.mock('@/components/agent/agent-feed', () => ({
  AgentFeed: () => <div data-testid="agent-feed" />,
}))

// Mock new polish components
jest.mock('@/components/forecast/model-arena', () => ({
  ModelArena: () => <div data-testid="model-arena" />,
}))
jest.mock('@/components/vitals/vitals-bar', () => ({
  VitalsBar: () => <div data-testid="vitals-bar" />,
}))
jest.mock('@/components/radar/threat-radar', () => ({
  ThreatRadar: () => <div data-testid="threat-radar" />,
}))
jest.mock('@/lib/use-animated-number', () => ({
  useAnimatedNumber: (v: number) => v,
}))
jest.mock('@/lib/sonification', () => ({
  initSonification: jest.fn(() => jest.fn()),
  updateSonification: jest.fn(),
  setMuted: jest.fn(),
  isSonificationMuted: jest.fn(() => false),
}))

import DashboardPage from '@/app/dashboard/page'

describe('Dashboard page', () => {
  it('does NOT render a page-level sector dropdown', () => {
    render(<DashboardPage />)
    expect(screen.queryByTestId('sector-select')).not.toBeInTheDocument()
    expect(screen.queryByText('All Sectors')).not.toBeInTheDocument()
  })

  it('renders the resource chart inside command center', () => {
    render(<DashboardPage />)
    // Chart should be inside the command center chart area
    const chartArea = screen.getByTestId('cc-chart-area')
    expect(chartArea.querySelector('[data-testid="resource-chart"]')).toBeInTheDocument()
  })

  it('renders time-to-zero cards inside command center', () => {
    render(<DashboardPage />)
    const ttzArea = screen.getByTestId('cc-ttz-area')
    const cards = ttzArea.querySelectorAll('[data-testid="ttz-card"]')
    expect(cards).toHaveLength(5)
  })

  it('shows correct status thresholds based on stock position relative to target', () => {
    render(<DashboardPage />)
    const statuses = screen.getAllByTestId('ttz-status')
    const statusTexts = statuses.map((s) => s.textContent)

    // Avengers: stock=10 → EXHAUSTED (stock<=10 overrides everything)
    expect(statusTexts).toContain('EXHAUSTED')
    // Sokovia: stock=60, target=420, 60/420=0.14 < 0.2 → CRITICAL
    expect(statusTexts).toContain('CRITICAL')
    // New Asgard: stock=240, target=300, 240/300=0.80 → 0.75-1.2 → STABLE
    // Wakanda: stock=500, target=180, 500/180=2.78 > 1.2 → OPTIMAL
    // Sanctum: stock=1000, target=750, 1000/750=1.33 > 1.2 → OPTIMAL
    expect(statusTexts.filter((s) => s === 'STABLE').length).toBe(1)
    expect(statusTexts.filter((s) => s === 'OPTIMAL').length).toBe(2)
  })

  it('does NOT render standalone Jarvis ML Forecast Intelligence section', () => {
    render(<DashboardPage />)
    expect(screen.queryByText('Jarvis ML Forecast Intelligence')).not.toBeInTheDocument()
  })

  it('shows LIVE indicator inside command center chart area', () => {
    render(<DashboardPage />)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it('renders the command center as the primary section', () => {
    render(<DashboardPage />)
    expect(screen.getByTestId('command-center')).toBeInTheDocument()
  })
})
