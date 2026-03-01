import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Forecast, SummaryItem } from '@/lib/types'

// Track router.push calls
const pushMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/map',
}))

// Mock lucide-react icons to render simple SVG elements
jest.mock('lucide-react', () => ({
  Shield: (props: Record<string, unknown>) => <svg data-testid="icon-shield" {...props} />,
  Zap: (props: Record<string, unknown>) => <svg data-testid="icon-zap" {...props} />,
  Eye: (props: Record<string, unknown>) => <svg data-testid="icon-eye" {...props} />,
  Activity: (props: Record<string, unknown>) => <svg data-testid="icon-activity" {...props} />,
  Cpu: (props: Record<string, unknown>) => <svg data-testid="icon-cpu" {...props} />,
  Loader2: () => <span>loader</span>,
  Globe: () => <span>globe</span>,
}))

import { MarvelMap } from '@/components/map/marvel-map'

const MOCK_FORECASTS: Forecast[] = [
  {
    id: 1,
    sector_id: 'Avengers Compound',
    resource_type: 'Medical Kits',
    predicted_exhaustion_date: null,
    hours_until_exhaustion: null,
    confidence: 0.92,
    strategy_used: 'linear',
    snap_detected: false,
    computed_at: '2026-02-28T12:00:00Z',
  },
  {
    id: 2,
    sector_id: 'Wakanda',
    resource_type: 'Arc Reactor Cores',
    predicted_exhaustion_date: '2026-03-05T00:00:00Z',
    hours_until_exhaustion: 30,
    confidence: 0.87,
    strategy_used: 'linear',
    snap_detected: false,
    computed_at: '2026-02-28T12:00:00Z',
  },
  {
    id: 3,
    sector_id: 'New Asgard',
    resource_type: 'Vibranium (kg)',
    predicted_exhaustion_date: null,
    hours_until_exhaustion: null,
    confidence: 0.95,
    strategy_used: 'linear',
    snap_detected: false,
    computed_at: '2026-02-28T12:00:00Z',
  },
  {
    id: 4,
    sector_id: 'Sanctum Sanctorum',
    resource_type: 'Clean Water (L)',
    predicted_exhaustion_date: '2026-03-01T00:00:00Z',
    hours_until_exhaustion: -5,
    confidence: 0.78,
    strategy_used: 'linear',
    snap_detected: true,
    computed_at: '2026-02-28T12:00:00Z',
  },
  {
    id: 5,
    sector_id: 'Sokovia',
    resource_type: 'Pym Particles',
    predicted_exhaustion_date: '2026-03-10T00:00:00Z',
    hours_until_exhaustion: 100,
    confidence: 0.91,
    strategy_used: 'linear',
    snap_detected: false,
    computed_at: '2026-02-28T12:00:00Z',
  },
]

const MOCK_SUMMARY: SummaryItem[] = [
  {
    sector_id: 'Avengers Compound',
    resource_type: 'Medical Kits',
    latest_stock_level: 350,
    latest_usage_rate: 2.5,
    latest_timestamp: '2026-02-28T12:00:00Z',
    snap_event_detected: false,
  },
  {
    sector_id: 'Wakanda',
    resource_type: 'Arc Reactor Cores',
    latest_stock_level: 15,
    latest_usage_rate: 0.5,
    latest_timestamp: '2026-02-28T12:00:00Z',
    snap_event_detected: false,
  },
  {
    sector_id: 'New Asgard',
    resource_type: 'Vibranium (kg)',
    latest_stock_level: 250,
    latest_usage_rate: 1.0,
    latest_timestamp: '2026-02-28T12:00:00Z',
    snap_event_detected: false,
  },
  {
    sector_id: 'Sanctum Sanctorum',
    resource_type: 'Clean Water (L)',
    latest_stock_level: 0,
    latest_usage_rate: 50.0,
    latest_timestamp: '2026-02-28T12:00:00Z',
    snap_event_detected: true,
  },
  {
    sector_id: 'Sokovia',
    resource_type: 'Pym Particles',
    latest_stock_level: 80,
    latest_usage_rate: 0.8,
    latest_timestamp: '2026-02-28T12:00:00Z',
    snap_event_detected: false,
  },
]

describe('MarvelMap', () => {
  beforeEach(() => {
    pushMock.mockClear()
  })

  it('renders all 5 sector nodes', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} />)

    expect(screen.getByTestId('sector-node-Avengers Compound')).toBeInTheDocument()
    expect(screen.getByTestId('sector-node-Wakanda')).toBeInTheDocument()
    expect(screen.getByTestId('sector-node-New Asgard')).toBeInTheDocument()
    expect(screen.getByTestId('sector-node-Sanctum Sanctorum')).toBeInTheDocument()
    expect(screen.getByTestId('sector-node-Sokovia')).toBeInTheDocument()
  })

  it('applies CRITICAL status to Wakanda (hours < 48)', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} />)

    const wakandaNode = screen.getByTestId('sector-node-Wakanda')
    expect(wakandaNode).toHaveAttribute('data-status', 'CRITICAL')
  })

  it('applies EXHAUSTED status to Sanctum Sanctorum (hours <= 0)', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} />)

    const sanctumNode = screen.getByTestId('sector-node-Sanctum Sanctorum')
    expect(sanctumNode).toHaveAttribute('data-status', 'EXHAUSTED')
  })

  it('clicking a node triggers navigation to dashboard with sector param', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} />)

    const wakandaNode = screen.getByTestId('sector-node-Wakanda')
    fireEvent.click(wakandaNode)

    expect(pushMock).toHaveBeenCalledWith('/dashboard?sector=Wakanda')
  })

  it('shows tooltip on hover with sector details', async () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} />)

    // Tooltip should not be visible initially
    expect(screen.queryByTestId('map-tooltip')).not.toBeInTheDocument()

    const wakandaNode = screen.getByTestId('sector-node-Wakanda')
    fireEvent.mouseEnter(wakandaNode)

    // Tooltip should now appear
    const tooltip = screen.getByTestId('map-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Wakanda')
    expect(tooltip).toHaveTextContent('Arc Reactor Cores')

    // Hide tooltip on mouse leave
    fireEvent.mouseLeave(wakandaNode)
    expect(screen.queryByTestId('map-tooltip')).not.toBeInTheDocument()
  })

  it('renders the title and live badge', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} />)

    expect(screen.getByText('Global Operations Theater')).toBeInTheDocument()
    expect(screen.getByText('Sentinel Tactical Overview')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
  })
})
