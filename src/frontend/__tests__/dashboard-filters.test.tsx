/**
 * Dashboard tests.
 *
 * These tests verify:
 *  1. The page-level sector dropdown is removed (no global filter)
 *  2. The ResourceChart is rendered (self-contained with toggles)
 *  3. Time-to-zero cards show correct thresholds
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

// Mock SWR to control data flow
jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn((key: string) => {
    if (key === 'summary') {
      return { data: { data: [] }, error: null, isLoading: false }
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
      }
    }
    if (key === 'governor-status') {
      return { data: null, isLoading: false }
    }
    if (key === 'governor-decisions') {
      return { data: [], isLoading: false }
    }
    return { data: { data: [] }, error: null, isLoading: false }
  }),
}))

// Mock the API module
jest.mock('@/lib/api', () => ({
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
}))

// Mock chart components to avoid Recharts issues in jsdom
jest.mock('@/components/charts/resource-chart', () => ({
  ResourceChart: () => <div data-testid="resource-chart" />,
  buildForecastLine: jest.fn(() => []),
}))
jest.mock('@/components/charts/sector-summary', () => ({
  SectorSummary: () => <div data-testid="sector-summary" />,
}))
jest.mock('@/components/command-center/command-center', () => ({
  CommandCenter: () => <div data-testid="command-center" />,
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Loader2: () => <span>loader</span>,
  AlertCircle: () => <span>alert</span>,
  Brain: () => <span>brain</span>,
  Bell: () => <span>bell</span>,
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

import DashboardPage from '@/app/dashboard/page'

describe('Dashboard page', () => {
  it('does NOT render a page-level sector dropdown', () => {
    render(<DashboardPage />)
    // No sector select should exist at page level
    expect(screen.queryByTestId('sector-select')).not.toBeInTheDocument()
    expect(screen.queryByText('All Sectors')).not.toBeInTheDocument()
  })

  it('renders the resource chart component', () => {
    render(<DashboardPage />)
    expect(screen.getByTestId('resource-chart')).toBeInTheDocument()
  })

  it('renders time-to-zero cards', () => {
    render(<DashboardPage />)
    const cards = screen.getAllByTestId('ttz-card')
    expect(cards).toHaveLength(5)
  })

  it('shows correct status thresholds for time-to-zero cards', () => {
    render(<DashboardPage />)
    const statuses = screen.getAllByTestId('ttz-status')
    const statusTexts = statuses.map((s) => s.textContent)

    // Wakanda: hours_to_zero=null, stock=500 => STABLE
    expect(statusTexts).toContain('STABLE')
    // Sokovia: hours_to_zero=12, stock=60 => CRITICAL (4-24h)
    expect(statusTexts).toContain('CRITICAL')
    // Avengers: hours_to_zero=2, stock=10 => EXHAUSTED (stock<=10)
    expect(statusTexts).toContain('EXHAUSTED')
    // New Asgard: hours_to_zero=48 => LOW (24-168h)
    expect(statusTexts).toContain('LOW')
  })

  it('shows LIVE indicator on chart card', () => {
    render(<DashboardPage />)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it('renders the command center', () => {
    render(<DashboardPage />)
    expect(screen.getByTestId('command-center')).toBeInTheDocument()
  })
})
