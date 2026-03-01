import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

// Mock SWR to control data fetching
let mockDefconData: { level: number; label: string; color: string } | undefined

jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string, fetcher: () => Promise<unknown>, options?: Record<string, unknown>) => {
    return {
      data: mockDefconData,
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    }
  },
}))

jest.mock('@/lib/api', () => ({
  fetchDefcon: jest.fn(),
}))

import { DefconBadge } from '@/components/hud/defcon-badge'

describe('DefconBadge', () => {
  beforeEach(() => {
    mockDefconData = undefined
  })

  it('renders nothing when data is not available', () => {
    mockDefconData = undefined
    const { container } = render(<DefconBadge />)
    expect(container.innerHTML).toBe('')
  })

  it('renders DEFCON level and label', () => {
    mockDefconData = { level: 5, label: 'NORMAL', color: 'green' }
    render(<DefconBadge />)

    const badge = screen.getByTestId('defcon-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('DEFCON 5 - NORMAL')
    expect(badge).toHaveAttribute('data-level', '5')
  })

  it('applies correct color class for red DEFCON', () => {
    mockDefconData = { level: 2, label: 'CRITICAL', color: 'red' }
    render(<DefconBadge />)

    const badge = screen.getByTestId('defcon-badge')
    expect(badge.className).toContain('text-red-400')
    expect(badge).toHaveTextContent('DEFCON 2 - CRITICAL')
  })

  it('applies correct color class for green DEFCON', () => {
    mockDefconData = { level: 5, label: 'NORMAL', color: 'green' }
    render(<DefconBadge />)

    const badge = screen.getByTestId('defcon-badge')
    expect(badge.className).toContain('text-green-400')
  })

  it('applies correct color class for purple DEFCON', () => {
    mockDefconData = { level: 1, label: 'OMEGA', color: 'purple' }
    render(<DefconBadge />)

    const badge = screen.getByTestId('defcon-badge')
    expect(badge.className).toContain('text-purple-400')
    expect(badge).toHaveTextContent('DEFCON 1 - OMEGA')
  })

  it('has defcon-badge CSS class', () => {
    mockDefconData = { level: 3, label: 'GUARDED', color: 'orange' }
    render(<DefconBadge />)

    const badge = screen.getByTestId('defcon-badge')
    expect(badge.className).toContain('defcon-badge')
  })
})

describe('HUD CSS classes', () => {
  it('hud-card class is applicable to elements', () => {
    render(
      <div className="hud-card" data-testid="hud-test-card">
        <p>Card content</p>
      </div>
    )
    const card = screen.getByTestId('hud-test-card')
    expect(card.className).toContain('hud-card')
  })

  it('hud-scanline class is applicable to elements', () => {
    render(
      <div className="hud-scanline" data-testid="hud-test-scanline">
        <p>Content</p>
      </div>
    )
    const el = screen.getByTestId('hud-test-scanline')
    expect(el.className).toContain('hud-scanline')
  })

  it('status classes are applicable', () => {
    render(
      <>
        <div className="status-critical" data-testid="status-critical">Critical</div>
        <div className="status-warning" data-testid="status-warning">Warning</div>
        <div className="status-stable" data-testid="status-stable">Stable</div>
      </>
    )
    expect(screen.getByTestId('status-critical').className).toContain('status-critical')
    expect(screen.getByTestId('status-warning').className).toContain('status-warning')
    expect(screen.getByTestId('status-stable').className).toContain('status-stable')
  })
})
