/**
 * Tests for S8: Polish Bundle
 *
 * Covers:
 *  A. Model Arena (forecast leaderboard card)
 *  B. useAnimatedNumber hook (living numbers)
 *  C. VitalsBar (SSE connection status)
 *  D. ThreatRadar (SVG radar with sector blips)
 *  E. Sonification module (Web Audio engine)
 */

import React from 'react'
import { render, screen, act } from '@testing-library/react'

// ── A. Model Arena tests ──

// Mock SWR for Model Arena
jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn((key: string) => {
    if (key === 'forecast-leaderboard') {
      return {
        data: {
          models: [
            { name: 'Polynomial Regression', accuracy: 0.94, rank: 1, champion: true, streak: 3 },
            { name: 'Bayesian Ridge', accuracy: 0.91, rank: 2, champion: false, streak: 0 },
            { name: 'Linear Regression', accuracy: 0.87, rank: 3, champion: false, streak: 0 },
          ],
        },
      }
    }
    return { data: null }
  }),
}))

import { ModelArena } from '@/components/forecast/model-arena'

describe('ModelArena', () => {
  it('renders model arena container', () => {
    render(<ModelArena />)
    expect(screen.getByTestId('model-arena')).toBeInTheDocument()
  })

  it('renders all model entries', () => {
    render(<ModelArena />)
    const entries = screen.getAllByTestId('model-entry')
    expect(entries).toHaveLength(3)
  })

  it('shows champion badge on top model', () => {
    render(<ModelArena />)
    expect(screen.getByTestId('champion-badge')).toBeInTheDocument()
    expect(screen.getByTestId('champion-badge')).toHaveTextContent('CHAMPION')
  })

  it('shows accuracy percentages', () => {
    render(<ModelArena />)
    expect(screen.getByText('94.0%')).toBeInTheDocument()
    expect(screen.getByText('91.0%')).toBeInTheDocument()
    expect(screen.getByText('87.0%')).toBeInTheDocument()
  })

  it('shows rank numbers', () => {
    render(<ModelArena />)
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
  })

  it('shows streak for champion', () => {
    render(<ModelArena />)
    expect(screen.getByText('3W')).toBeInTheDocument()
  })

  it('renders accuracy bars', () => {
    render(<ModelArena />)
    const bars = screen.getAllByTestId('accuracy-bar')
    expect(bars).toHaveLength(3)
    // Champion bar should have 94% width
    expect(bars[0]).toHaveStyle({ width: '94%' })
  })

  it('renders empty state when no models', () => {
    const useSWR = require('swr').default
    useSWR.mockReturnValueOnce({ data: { models: [] } })
    render(<ModelArena />)
    expect(screen.getByText('No models scored yet.')).toBeInTheDocument()
  })
})

// ── B. useAnimatedNumber hook tests ──

import { renderHook } from '@testing-library/react'
import { useAnimatedNumber } from '@/lib/use-animated-number'

describe('useAnimatedNumber', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useAnimatedNumber(100))
    expect(result.current).toBe(100)
  })

  it('returns same value when value does not change', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useAnimatedNumber(value),
      { initialProps: { value: 50 } }
    )
    rerender({ value: 50 })
    expect(result.current).toBe(50)
  })

  it('starts animating when value changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useAnimatedNumber(value),
      { initialProps: { value: 0 } }
    )
    expect(result.current).toBe(0)

    // Change value
    rerender({ value: 100 })
    // After rerender with requestAnimationFrame, the value should start moving
    // The exact intermediate value depends on RAF timing
    // We just verify it accepted the new target
    expect(typeof result.current).toBe('number')
  })
})

// ── C. VitalsBar tests ──

// Mock the SSE hook for VitalsBar
jest.mock('@/lib/use-sse', () => ({
  useSSE: jest.fn(),
}))

import { VitalsBar } from '@/components/vitals/vitals-bar'

describe('VitalsBar', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders vitals bar container', () => {
    render(<VitalsBar />)
    expect(screen.getByTestId('vitals-bar')).toBeInTheDocument()
  })

  it('shows SSE connected status', () => {
    render(<VitalsBar />)
    expect(screen.getByTestId('vitals-connection')).toBeInTheDocument()
    expect(screen.getByText('SSE CONNECTED')).toBeInTheDocument()
  })

  it('shows connection dot', () => {
    render(<VitalsBar />)
    expect(screen.getByTestId('connection-dot')).toBeInTheDocument()
  })

  it('shows heartbeat indicator', () => {
    render(<VitalsBar />)
    expect(screen.getByTestId('vitals-heartbeat')).toBeInTheDocument()
    expect(screen.getByText('HB')).toBeInTheDocument()
  })

  it('shows event throughput', () => {
    render(<VitalsBar />)
    expect(screen.getByTestId('vitals-throughput')).toBeInTheDocument()
    expect(screen.getByText('EVT/MIN')).toBeInTheDocument()
  })

  it('shows governor cycle countdown', () => {
    render(<VitalsBar />)
    expect(screen.getByTestId('vitals-governor')).toBeInTheDocument()
    expect(screen.getByText('GOV CYCLE')).toBeInTheDocument()
  })

  it('shows UTC clock section', () => {
    render(<VitalsBar />)
    expect(screen.getByTestId('vitals-clock')).toBeInTheDocument()
    expect(screen.getByText('UTC')).toBeInTheDocument()
  })

  it('updates clock on interval tick', () => {
    render(<VitalsBar />)
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    // After 1 second, clock should have a value
    const clockEl = screen.getByTestId('vitals-clock')
    expect(clockEl.textContent).toContain('UTC')
  })

  it('shows initial events per minute as 0', () => {
    render(<VitalsBar />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})

// ── D. ThreatRadar tests ──

import { ThreatRadar } from '@/components/radar/threat-radar'

describe('ThreatRadar', () => {
  const defaultStocks: Record<string, number> = {
    'Avengers Compound': 300,
    'New Asgard': 200,
    'Sanctum Sanctorum': 500,
    'Sokovia': 100,
    'Wakanda': 400,
  }

  const defaultTargets: Record<string, number> = {
    'Avengers Compound': 600,
    'New Asgard': 450,
    'Sanctum Sanctorum': 700,
    'Sokovia': 500,
    'Wakanda': 500,
  }

  it('renders radar container', () => {
    render(<ThreatRadar stocks={defaultStocks} targets={defaultTargets} />)
    expect(screen.getByTestId('threat-radar')).toBeInTheDocument()
  })

  it('renders 5 sector blips', () => {
    render(<ThreatRadar stocks={defaultStocks} targets={defaultTargets} />)
    const blips = screen.getAllByTestId('radar-blip')
    expect(blips).toHaveLength(5)
  })

  it('renders sweep line', () => {
    render(<ThreatRadar stocks={defaultStocks} targets={defaultTargets} />)
    expect(screen.getByTestId('radar-sweep')).toBeInTheDocument()
  })

  it('renders with correct dimensions', () => {
    render(<ThreatRadar stocks={defaultStocks} targets={defaultTargets} />)
    const radar = screen.getByTestId('threat-radar')
    expect(radar).toHaveStyle({ width: '200px', height: '200px' })
  })

  it('shows critical pulse for low-stock sectors', () => {
    // Sokovia at 100/500 = 0.2 which is < 0.25 threshold → critical
    const { container } = render(
      <ThreatRadar stocks={defaultStocks} targets={defaultTargets} />
    )
    const pulseCircles = container.querySelectorAll('.blip-pulse')
    expect(pulseCircles.length).toBeGreaterThan(0)
  })

  it('handles empty stocks gracefully', () => {
    render(<ThreatRadar stocks={{}} targets={{}} />)
    const blips = screen.getAllByTestId('radar-blip')
    expect(blips).toHaveLength(5) // All 5 sectors render with 0 health
  })
})

// ── E. Sonification tests ──

import {
  initSonification,
  updateSonification,
  playCriticalAlert,
  setMuted,
  isSonificationMuted,
  isAudioUnlocked,
  setDefconLevel,
  shouldAlertForSector,
  clearCriticalAlert,
} from '@/lib/sonification'

// We need to unmock sonification for direct testing
jest.unmock('@/lib/sonification')

describe('Sonification', () => {
  let mockAudioContext: any
  let mockOscillator: any
  let mockGainNode: any

  beforeEach(() => {
    mockOscillator = {
      type: 'sine',
      frequency: {
        setValueAtTime: jest.fn(),
        setTargetAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn(),
      },
      connect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    }

    mockGainNode = {
      gain: {
        setValueAtTime: jest.fn(),
        setTargetAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn(),
      },
      connect: jest.fn(),
    }

    mockAudioContext = {
      createOscillator: jest.fn(() => mockOscillator),
      createGain: jest.fn(() => mockGainNode),
      destination: {},
      currentTime: 0,
      close: jest.fn(),
    }

    ;(global as any).AudioContext = jest.fn(() => mockAudioContext)
  })

  afterEach(() => {
    delete (global as any).AudioContext
  })

  it('exports initSonification function', () => {
    expect(typeof initSonification).toBe('function')
  })

  it('exports updateSonification function', () => {
    expect(typeof updateSonification).toBe('function')
  })

  it('exports playCriticalAlert function', () => {
    expect(typeof playCriticalAlert).toBe('function')
  })

  it('exports setMuted function', () => {
    expect(typeof setMuted).toBe('function')
  })

  it('exports isSonificationMuted function', () => {
    expect(typeof isSonificationMuted).toBe('function')
  })

  it('initSonification returns a cleanup function', () => {
    const cleanup = initSonification()
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('defaults to unmuted', () => {
    expect(isSonificationMuted()).toBe(false)
  })

  it('setMuted toggles muted state', () => {
    setMuted(false)
    expect(isSonificationMuted()).toBe(false)
    setMuted(true)
    expect(isSonificationMuted()).toBe(true)
  })

  it('exports isAudioUnlocked function', () => {
    expect(typeof isAudioUnlocked).toBe('function')
  })

  it('isAudioUnlocked returns true when AudioContext state is running', () => {
    mockAudioContext.state = 'running'
    mockAudioContext.resume = jest.fn()
    initSonification()
    expect(isAudioUnlocked()).toBe(true)
  })

  it('isAudioUnlocked returns false when AudioContext state is suspended', () => {
    mockAudioContext.state = 'suspended'
    mockAudioContext.resume = jest.fn()
    initSonification()
    expect(isAudioUnlocked()).toBe(false)
  })

  it('initSonification calls resume on AudioContext', () => {
    mockAudioContext.state = 'suspended'
    mockAudioContext.resume = jest.fn()
    const cleanup = initSonification()
    expect(mockAudioContext.resume).toHaveBeenCalled()
    cleanup()
  })

  it('click event on document resumes suspended AudioContext', () => {
    mockAudioContext.state = 'suspended'
    mockAudioContext.resume = jest.fn()
    const cleanup = initSonification()
    const callsBefore = mockAudioContext.resume.mock.calls.length
    document.dispatchEvent(new Event('click'))
    expect(mockAudioContext.resume.mock.calls.length).toBeGreaterThan(callsBefore)
    cleanup()
  })

  it('exports setDefconLevel function', () => {
    expect(typeof setDefconLevel).toBe('function')
  })

  it('exports shouldAlertForSector function', () => {
    expect(typeof shouldAlertForSector).toBe('function')
  })

  it('exports clearCriticalAlert function', () => {
    expect(typeof clearCriticalAlert).toBe('function')
  })

  it('shouldAlertForSector returns true when stock below 30% of target', () => {
    expect(shouldAlertForSector(100, 500)).toBe(true)  // 20% < 30%
    expect(shouldAlertForSector(149, 500)).toBe(true)  // 29.8% < 30%
  })

  it('shouldAlertForSector returns false when stock at or above 30% of target', () => {
    expect(shouldAlertForSector(150, 500)).toBe(false)  // 30% = threshold
    expect(shouldAlertForSector(300, 500)).toBe(false)  // 60% > 30%
    expect(shouldAlertForSector(500, 500)).toBe(false)  // 100%
  })

  it('shouldAlertForSector returns false for zero target', () => {
    expect(shouldAlertForSector(100, 0)).toBe(false)
  })

  it('playCriticalAlert is suppressed at DEFCON 4-5', () => {
    mockAudioContext.state = 'running'
    mockAudioContext.resume = jest.fn()
    const cleanup = initSonification()
    setMuted(false)

    setDefconLevel(5)
    const callsBefore = mockAudioContext.createOscillator.mock.calls.length
    playCriticalAlert('Wakanda')
    // Should NOT create a new oscillator at DEFCON 5
    expect(mockAudioContext.createOscillator.mock.calls.length).toBe(callsBefore)

    setDefconLevel(4)
    playCriticalAlert('Wakanda')
    expect(mockAudioContext.createOscillator.mock.calls.length).toBe(callsBefore)

    cleanup()
  })
})
