import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Forecast, SummaryItem, TimeToZeroEntry } from '@/lib/types'

// Polyfill ResizeObserver for JSDOM
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof globalThis.ResizeObserver

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

// Use real computeNetStatus from api module
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api')
  return {
    ...actual,
    fetchTimeToZero: jest.fn(),
    fetchGovernorStatus: jest.fn(),
  }
})

// Mock react-globe.gl
const mockGlobeRef = { current: null }
jest.mock('react-globe.gl', () => {
  const React = require('react')
  const MockGlobe = React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      controls: () => ({ autoRotate: false, autoRotateSpeed: 0 }),
    }))
    const points = (props.pointsData as Array<Record<string, unknown>>) ?? []
    const arcs = (props.arcsData as Array<Record<string, unknown>>) ?? []
    return (
      <div data-testid="mock-globe">
        <div data-testid="globe-points-count">{points.length}</div>
        <div data-testid="globe-arcs-count">{arcs.length}</div>
        {points.map((p: Record<string, unknown>, i: number) => (
          <div
            key={i}
            data-testid={`globe-point-${i}`}
            data-color={p.color as string}
            data-label={p.label as string}
            onClick={() => {
              const onClick = props.onPointClick as ((point: Record<string, unknown>) => void) | undefined
              if (onClick) onClick(p)
            }}
          />
        ))}
      </div>
    )
  })
  MockGlobe.displayName = 'MockGlobe'
  return { __esModule: true, default: MockGlobe }
})

// Mock next/dynamic to pass through the factory
jest.mock('next/dynamic', () => {
  return (factory: () => Promise<{ default: React.ComponentType }>) => {
    const mod = require('react-globe.gl')
    return mod.default
  }
})

import { MarvelMap } from '@/components/map/marvel-map'
import { TacticalGlobe } from '@/components/globe/tactical-globe'

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

// TTZ entries enriched with production_rate_hourly and target_stock
const MOCK_TTZ: TimeToZeroEntry[] = [
  {
    sector_id: 'Avengers Compound',
    resource_type: 'Medical Kits',
    hours_to_zero: null,
    current_stock: 350,
    consumption_rate: 2.5,
    snap_detected: false,
    production_rate_hourly: 960, // 8 * 120 = 960 > 2.5, stock 350 < 600*0.9=540
    target_stock: 600,
  },
  {
    sector_id: 'Wakanda',
    resource_type: 'Arc Reactor Cores',
    hours_to_zero: 30,
    current_stock: 15,
    consumption_rate: 0.5,
    snap_detected: false,
    production_rate_hourly: 0,
    target_stock: 180,
    governor_status: 'CUTTING' as const, // stock < 20% of target → CRITICAL overrides
  },
  {
    sector_id: 'New Asgard',
    resource_type: 'Vibranium (kg)',
    hours_to_zero: null,
    current_stock: 250,
    consumption_rate: 1.0,
    snap_detected: false,
    production_rate_hourly: 360, // net=359 > 50 → RECOVERING
    target_stock: 300,
  },
  {
    sector_id: 'Sanctum Sanctorum',
    resource_type: 'Clean Water (L)',
    hours_to_zero: null,
    current_stock: 5, // stock <= 10 → EXHAUSTED
    consumption_rate: 50.0,
    snap_detected: true,
    production_rate_hourly: 0,
    target_stock: 750,
  },
  {
    sector_id: 'Sokovia',
    resource_type: 'Pym Particles',
    hours_to_zero: 100,
    current_stock: 100,
    consumption_rate: 0.8,
    snap_detected: false,
    production_rate_hourly: 600,
    target_stock: 420,
    governor_status: 'RAMPING' as const, // stock=100 > 420*0.2=84, governor RAMPING → RECOVERING
  },
]

describe('MarvelMap', () => {
  beforeEach(() => {
    pushMock.mockClear()
  })

  it('renders all 5 sector nodes', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} timeToZero={MOCK_TTZ} />)

    expect(screen.getByTestId('sector-node-Avengers Compound')).toBeInTheDocument()
    expect(screen.getByTestId('sector-node-Wakanda')).toBeInTheDocument()
    expect(screen.getByTestId('sector-node-New Asgard')).toBeInTheDocument()
    expect(screen.getByTestId('sector-node-Sanctum Sanctorum')).toBeInTheDocument()
    expect(screen.getByTestId('sector-node-Sokovia')).toBeInTheDocument()
  })

  it('applies CRITICAL status to Wakanda (stock=15, below 20% of target=180)', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} timeToZero={MOCK_TTZ} />)

    // Wakanda: stock=15, target=180, 15/180=0.083 < 0.2 → CRITICAL
    const wakandaNode = screen.getByTestId('sector-node-Wakanda')
    expect(wakandaNode).toHaveAttribute('data-status', 'CRITICAL')
  })

  it('applies EXHAUSTED status to Sanctum Sanctorum (stock <= 10)', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} timeToZero={MOCK_TTZ} />)

    const sanctumNode = screen.getByTestId('sector-node-Sanctum Sanctorum')
    expect(sanctumNode).toHaveAttribute('data-status', 'EXHAUSTED')
  })

  it('applies RECOVERING status when stock is between 20-90% of target', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} timeToZero={MOCK_TTZ} />)

    // Sokovia: stock=100, target=420, 100/420=0.24 → between 0.2 and 0.75 → RECOVERING
    const sokoviaNode = screen.getByTestId('sector-node-Sokovia')
    expect(sokoviaNode).toHaveAttribute('data-status', 'RECOVERING')
  })

  it('clicking a node triggers navigation to dashboard with sector param', () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} timeToZero={MOCK_TTZ} />)

    const wakandaNode = screen.getByTestId('sector-node-Wakanda')
    fireEvent.click(wakandaNode)

    expect(pushMock).toHaveBeenCalledWith('/dashboard?sector=Wakanda')
  })

  it('shows tooltip on hover with sector details', async () => {
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} timeToZero={MOCK_TTZ} />)

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
    render(<MarvelMap forecasts={MOCK_FORECASTS} summary={MOCK_SUMMARY} timeToZero={MOCK_TTZ} />)

    expect(screen.getByText('Global Operations Theater')).toBeInTheDocument()
    expect(screen.getByText('Sentinel Tactical Overview')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
  })
})

describe('TacticalGlobe', () => {
  it('renders with 5 sector points', () => {
    render(<TacticalGlobe sectors={MOCK_SUMMARY} />)

    expect(screen.getByTestId('tactical-globe')).toBeInTheDocument()
    expect(screen.getByTestId('globe-points-count')).toHaveTextContent('5')
  })

  it('renders supply arcs when snap is not active', () => {
    render(<TacticalGlobe sectors={MOCK_SUMMARY} />)

    expect(screen.getByTestId('globe-arcs-count')).toHaveTextContent('4')
  })

  it('snap mode turns all points purple and removes arcs', () => {
    render(<TacticalGlobe sectors={MOCK_SUMMARY} snapActive={true} />)

    // All points should be purple
    const point0 = screen.getByTestId('globe-point-0')
    expect(point0).toHaveAttribute('data-color', '#a855f7')

    const point1 = screen.getByTestId('globe-point-1')
    expect(point1).toHaveAttribute('data-color', '#a855f7')

    const point2 = screen.getByTestId('globe-point-2')
    expect(point2).toHaveAttribute('data-color', '#a855f7')

    const point3 = screen.getByTestId('globe-point-3')
    expect(point3).toHaveAttribute('data-color', '#a855f7')

    const point4 = screen.getByTestId('globe-point-4')
    expect(point4).toHaveAttribute('data-color', '#a855f7')

    // Arcs should be empty
    expect(screen.getByTestId('globe-arcs-count')).toHaveTextContent('0')
  })

  it('points color-code based on stock health', () => {
    render(<TacticalGlobe sectors={MOCK_SUMMARY} />)

    // Avengers Compound: 350/600 = 58% -> yellow (#eab308)
    const point0 = screen.getByTestId('globe-point-0')
    expect(point0).toHaveAttribute('data-color', '#eab308')

    // Wakanda: 15/500 = 3% -> red (#ef4444)
    const point4 = screen.getByTestId('globe-point-4')
    expect(point4).toHaveAttribute('data-color', '#ef4444')
  })

  it('shows tooltip on point click', () => {
    render(<TacticalGlobe sectors={MOCK_SUMMARY} />)

    // Click first point
    fireEvent.click(screen.getByTestId('globe-point-0'))

    const tooltip = screen.getByTestId('globe-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Avengers Compound')
    expect(tooltip).toHaveTextContent('Medical Kits')
  })
})
