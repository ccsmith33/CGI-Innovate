import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { getAlertLevel, useAlerts } from '@/hooks/use-alerts'
import { NotificationBell } from '@/components/alerts/notification-bell'
import type { Forecast } from '@/lib/types'

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Bell: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <span data-testid="bell-icon" {...props}>{children}</span>
  ),
}))

function makeForecast(overrides: Partial<Forecast> = {}): Forecast {
  return {
    id: 1,
    sector_id: 'Wakanda',
    resource_type: 'Arc Reactor Cores',
    predicted_exhaustion_date: '2026-03-15T00:00:00Z',
    hours_until_exhaustion: 200,
    confidence: 0.85,
    strategy_used: 'linear',
    snap_detected: false,
    computed_at: '2026-02-28T00:00:00Z',
    ...overrides,
  }
}

// Helper component to test the useAlerts hook output
function AlertHookTester({ forecasts }: { forecasts: Forecast[] }) {
  const alerts = useAlerts(forecasts)
  return (
    <div>
      <span data-testid="alert-count">{alerts.length}</span>
      {alerts.map((a, i) => (
        <span key={i} data-testid={`alert-${i}`}>
          {a.level}:{a.sector_id}
        </span>
      ))}
    </div>
  )
}

describe('getAlertLevel', () => {
  it('returns null for null hours', () => {
    expect(getAlertLevel(null)).toBeNull()
  })

  it('returns EXHAUSTED for hours <= 0', () => {
    expect(getAlertLevel(0)).toBe('EXHAUSTED')
    expect(getAlertLevel(-5)).toBe('EXHAUSTED')
  })

  it('returns CRITICAL for hours < 48', () => {
    expect(getAlertLevel(10)).toBe('CRITICAL')
    expect(getAlertLevel(47)).toBe('CRITICAL')
  })

  it('returns WARNING for hours < 120', () => {
    expect(getAlertLevel(48)).toBe('WARNING')
    expect(getAlertLevel(119)).toBe('WARNING')
  })

  it('returns null for stable forecasts (>= 120h)', () => {
    expect(getAlertLevel(120)).toBeNull()
    expect(getAlertLevel(500)).toBeNull()
  })
})

describe('useAlerts hook', () => {
  it('returns alerts for forecasts below 48h threshold', () => {
    const forecasts = [
      makeForecast({ id: 1, sector_id: 'Wakanda', hours_until_exhaustion: 20 }),
      makeForecast({ id: 2, sector_id: 'Sokovia', hours_until_exhaustion: 200 }),
    ]
    render(<AlertHookTester forecasts={forecasts} />)
    expect(screen.getByTestId('alert-count').textContent).toBe('1')
    expect(screen.getByTestId('alert-0').textContent).toBe('CRITICAL:Wakanda')
  })

  it('returns no alerts for stable forecasts (>120h)', () => {
    const forecasts = [
      makeForecast({ id: 1, hours_until_exhaustion: 200 }),
      makeForecast({ id: 2, hours_until_exhaustion: 500 }),
      makeForecast({ id: 3, hours_until_exhaustion: null }),
    ]
    render(<AlertHookTester forecasts={forecasts} />)
    expect(screen.getByTestId('alert-count').textContent).toBe('0')
  })
})

describe('NotificationBell', () => {
  it('shows correct badge count', () => {
    const alerts = [
      { sector_id: 'Wakanda', resource_type: 'Arc Reactor Cores', level: 'CRITICAL' as const, hours_remaining: 20 },
      { sector_id: 'Sokovia', resource_type: 'Pym Particles', level: 'WARNING' as const, hours_remaining: 100 },
    ]
    render(<NotificationBell alerts={alerts} />)
    const badge = screen.getByTestId('alert-badge')
    expect(badge.textContent).toBe('2')
  })

  it('does not show badge when no alerts', () => {
    render(<NotificationBell alerts={[]} />)
    expect(screen.queryByTestId('alert-badge')).not.toBeInTheDocument()
  })

  it('opens dropdown with alert items on click', () => {
    const alerts = [
      { sector_id: 'Wakanda', resource_type: 'Arc Reactor Cores', level: 'CRITICAL' as const, hours_remaining: 20 },
    ]
    render(<NotificationBell alerts={alerts} />)
    expect(screen.queryByTestId('alert-dropdown')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('notification-bell'))
    expect(screen.getByTestId('alert-dropdown')).toBeInTheDocument()

    const items = screen.getAllByTestId('alert-item')
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('Wakanda')
    expect(items[0].textContent).toContain('CRITICAL')
  })

  it('renders alerts for forecasts below 48h threshold', () => {
    const alerts = [
      { sector_id: 'Wakanda', resource_type: 'Arc Reactor Cores', level: 'CRITICAL' as const, hours_remaining: 20 },
      { sector_id: 'Sokovia', resource_type: 'Pym Particles', level: 'EXHAUSTED' as const, hours_remaining: -5 },
    ]
    render(<NotificationBell alerts={alerts} />)
    fireEvent.click(screen.getByTestId('notification-bell'))

    const items = screen.getAllByTestId('alert-item')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Wakanda')
    expect(items[1].textContent).toContain('Sokovia')
  })

  it('does not render alerts for stable forecasts (>120h)', () => {
    // Empty alerts list = no alerts for stable forecasts
    render(<NotificationBell alerts={[]} />)
    fireEvent.click(screen.getByTestId('notification-bell'))
    expect(screen.queryByTestId('alert-item')).not.toBeInTheDocument()
    expect(screen.getByText('No active alerts')).toBeInTheDocument()
  })
})
