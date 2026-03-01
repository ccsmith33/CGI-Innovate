/**
 * Simulation page tests.
 *
 * Verifies:
 *  1. The page renders with controls (resource selector, inputs, buttons)
 *  2. The Snap button halves the stock value
 *  3. The simulation increments time correctly via setInterval
 *  4. Exhaustion alert appears when stock hits 0
 */

import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

// ---------- Mocks ----------

// Mock SWR to return summary data for pre-filling controls
jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn((...args: [string, ...unknown[]]) => {
    const key = args[0]
    if (key === 'summary') {
      return {
        data: {
          data: [
            {
              sector_id: 'Wakanda',
              resource_type: 'Arc Reactor Cores',
              latest_stock_level: 1000,
              latest_usage_rate: 10,
              latest_timestamp: '2026-01-01T00:00:00Z',
              snap_event_detected: false,
            },
            {
              sector_id: 'Sokovia',
              resource_type: 'Pym Particles',
              latest_stock_level: 500,
              latest_usage_rate: 5,
              latest_timestamp: '2026-01-01T00:00:00Z',
              snap_event_detected: false,
            },
          ],
        },
        error: null,
        isLoading: false,
      }
    }
    return { data: null, error: null, isLoading: false }
  }),
}))

// Mock API module
jest.mock('@/lib/api', () => ({
  fetchSummary: jest.fn().mockResolvedValue({
    data: [
      {
        sector_id: 'Wakanda',
        resource_type: 'Arc Reactor Cores',
        latest_stock_level: 1000,
        latest_usage_rate: 10,
        latest_timestamp: '2026-01-01T00:00:00Z',
        snap_event_detected: false,
      },
    ],
  }),
}))

// Mock Radix UI Select with native HTML elements for testability
const SelectContext = React.createContext<{
  value: string
  onValueChange: (v: string) => void
}>({ value: '', onValueChange: () => {} })

jest.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <SelectContext.Provider value={{ value, onValueChange }}>
      <div>{children}</div>
    </SelectContext.Provider>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => {
    const { value, onValueChange } = React.useContext(SelectContext)
    return (
      <select
        data-testid="sim-select"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onValueChange(e.target.value)}
      >
        {children}
      </select>
    )
  },
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

// Mock Recharts to avoid jsdom rendering issues
jest.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReferenceLine: ({ label }: { label?: { value?: string } }) => (
    <div data-testid="reference-line">{label?.value}</div>
  ),
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Play: () => <span>play</span>,
  RotateCcw: () => <span>reset</span>,
  Zap: () => <span>zap</span>,
  AlertTriangle: () => <span>alert</span>,
  Package: () => <span>package</span>,
  Flame: () => <span>flame</span>,
}))

// Mock Badge component
jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <span {...props}>{children}</span>
  ),
}))

// Mock the Input component to use a standard input
jest.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

import SimulationPage from '@/app/simulation/page'

describe('Simulation page', () => {
  let mathRandomSpy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    // Mock Math.random to return 0.5 => fluctuation = 1 + (0.5*0.2 - 0.1) = 1.0 (no variance)
    mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5)
  })

  afterEach(() => {
    jest.useRealTimers()
    mathRandomSpy.mockRestore()
  })

  it('renders the page title and controls without a usage rate input', () => {
    render(<SimulationPage />)
    expect(screen.getByText('Resource Depletion Simulation')).toBeInTheDocument()
    expect(screen.getByText('Simulation Controls')).toBeInTheDocument()
    expect(screen.getByTestId('start-button')).toBeInTheDocument()
    expect(screen.getByTestId('reset-button')).toBeInTheDocument()
    expect(screen.getByTestId('snap-button')).toBeInTheDocument()
    expect(screen.getByTestId('initial-stock-input')).toBeInTheDocument()
    // Usage rate input should NOT exist -- it is now ML-driven and read-only
    expect(screen.queryByTestId('usage-rate-input')).not.toBeInTheDocument()
  })

  it('pre-fills stock and displays ML usage rate when a resource is selected', () => {
    render(<SimulationPage />)
    const selects = screen.getAllByTestId('sim-select')
    // Select Wakanda
    fireEvent.change(selects[0], { target: { value: 'Wakanda' } })

    const stockInput = screen.getByTestId('initial-stock-input') as HTMLInputElement
    expect(Number(stockInput.value)).toBe(1000)

    // Usage rate should be displayed as read-only text from the ML model
    const mlUsageRate = screen.getByTestId('ml-usage-rate')
    expect(mlUsageRate).toBeInTheDocument()
    expect(mlUsageRate).toHaveTextContent('10 units/hr')
    expect(mlUsageRate).toHaveTextContent('ML model')
  })

  it('starts the simulation and increments time correctly', () => {
    render(<SimulationPage />)

    // Select a resource and set values
    const selects = screen.getAllByTestId('sim-select')
    fireEvent.change(selects[0], { target: { value: 'Wakanda' } })

    // Click start
    const startBtn = screen.getByTestId('start-button')
    act(() => {
      fireEvent.click(startBtn)
    })

    // Status should appear
    expect(screen.getByTestId('simulation-status')).toBeInTheDocument()

    // Advance one tick (500ms at 1x speed)
    act(() => {
      jest.advanceTimersByTime(500)
    })

    // After one tick: hour=1, stock=1000-10=990
    expect(screen.getByText('1')).toBeInTheDocument()

    // Advance another tick
    act(() => {
      jest.advanceTimersByTime(500)
    })

    // After two ticks: hour=2, stock=980
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('halves stock when Snap button is clicked', () => {
    render(<SimulationPage />)

    // Select Wakanda (stock=1000, rate=10)
    const selects = screen.getAllByTestId('sim-select')
    fireEvent.change(selects[0], { target: { value: 'Wakanda' } })

    // Start
    act(() => {
      fireEvent.click(screen.getByTestId('start-button'))
    })

    // Advance one tick so stock is 990
    act(() => {
      jest.advanceTimersByTime(500)
    })

    // Click snap
    act(() => {
      fireEvent.click(screen.getByTestId('snap-button'))
    })

    // Stock should be halved from 990 to 495
    expect(screen.getByText('495')).toBeInTheDocument()

    // Snap flash should appear
    expect(screen.getByTestId('snap-flash')).toBeInTheDocument()
    expect(screen.getByText('SNAP DETECTED')).toBeInTheDocument()

    // A SNAP reference line should be in the chart (button also has "SNAP" text)
    const snapTexts = screen.getAllByText('SNAP')
    expect(snapTexts.length).toBeGreaterThanOrEqual(2) // button + reference line
  })

  it('shows exhaustion alert when stock reaches 0', () => {
    render(<SimulationPage />)

    // Select Wakanda to get ML usage rate (10/hr) and stock (1000) from summary mock
    const selects = screen.getAllByTestId('sim-select')
    act(() => {
      fireEvent.change(selects[0], { target: { value: 'Wakanda' } })
    })

    // Start (usageRate=10 from ML, initialStock=1000 from ML)
    act(() => {
      fireEvent.click(screen.getByTestId('start-button'))
    })

    // With anomaly events the net stock change is +190 units (resupply events add more
    // than consumption events remove), so total to deplete = (1000+190)/10 = 119 ticks.
    // Use 60000ms (120 ticks) to be safe, at 500ms per tick.
    act(() => {
      jest.advanceTimersByTime(60000)
    })

    expect(screen.getByTestId('exhaustion-alert')).toBeInTheDocument()
    expect(screen.getByText('EXHAUSTED')).toBeInTheDocument()
  })

  it('resets the simulation when Reset is clicked', () => {
    render(<SimulationPage />)

    const selects = screen.getAllByTestId('sim-select')
    fireEvent.change(selects[0], { target: { value: 'Wakanda' } })

    // Start
    act(() => {
      fireEvent.click(screen.getByTestId('start-button'))
    })

    // Advance a tick
    act(() => {
      jest.advanceTimersByTime(500)
    })

    expect(screen.getByTestId('simulation-status')).toBeInTheDocument()

    // Reset
    act(() => {
      fireEvent.click(screen.getByTestId('reset-button'))
    })

    // Status should be gone, chart empty placeholder should return
    expect(screen.queryByTestId('simulation-status')).not.toBeInTheDocument()
    expect(
      screen.getByText('Select a resource and click Start to begin the depletion simulation.')
    ).toBeInTheDocument()
  })

  it('disables snap button when simulation is not running', () => {
    render(<SimulationPage />)
    const snapBtn = screen.getByTestId('snap-button')
    expect(snapBtn).toBeDisabled()
  })

  it('fires anomaly events and displays them in the event log', () => {
    render(<SimulationPage />)

    // Select Wakanda (stock=1000, rate=10)
    const selects = screen.getAllByTestId('sim-select')
    act(() => {
      fireEvent.change(selects[0], { target: { value: 'Wakanda' } })
    })

    // Start
    act(() => {
      fireEvent.click(screen.getByTestId('start-button'))
    })

    // Advance to hour 12 (first anomaly: Emergency resupply +150)
    // 12 ticks * 500ms = 6000ms
    act(() => {
      jest.advanceTimersByTime(6000)
    })

    // Event log should appear with the first anomaly entry
    expect(screen.getByTestId('event-log')).toBeInTheDocument()
    const entries = screen.getAllByTestId('event-log-entry')
    expect(entries.length).toBe(1)
    expect(entries[0]).toHaveTextContent('Hour 12')
    expect(entries[0]).toHaveTextContent('Emergency resupply')
    expect(entries[0]).toHaveTextContent('+150 units')

    // An anomaly reference line should appear on the chart
    const refLines = screen.getAllByTestId('reference-line')
    const anomalyLine = refLines.find((el) => el.textContent === 'Emergency resupply')
    expect(anomalyLine).toBeDefined()
  })

  it('fires multiple anomaly events as simulation progresses', () => {
    render(<SimulationPage />)

    const selects = screen.getAllByTestId('sim-select')
    act(() => {
      fireEvent.change(selects[0], { target: { value: 'Wakanda' } })
    })

    act(() => {
      fireEvent.click(screen.getByTestId('start-button'))
    })

    // Advance to hour 26 to fire first two anomalies (hour 12 and hour 25)
    // 26 ticks * 500ms = 13000ms
    act(() => {
      jest.advanceTimersByTime(13000)
    })

    const entries = screen.getAllByTestId('event-log-entry')
    expect(entries.length).toBe(2)
    expect(entries[0]).toHaveTextContent('Emergency resupply')
    expect(entries[1]).toHaveTextContent('Combat event')
    expect(entries[1]).toHaveTextContent('-80 units')
  })

  it('applies random fluctuation when Math.random is not 0.5', () => {
    // Restore the default mock and set a different value
    mathRandomSpy.mockReturnValue(0.0)
    // fluctuation = 1 + (0.0 * 0.2 - 0.1) = 0.9 => stock drops by usageRate * 0.9 = 9

    render(<SimulationPage />)

    const selects = screen.getAllByTestId('sim-select')
    act(() => {
      fireEvent.change(selects[0], { target: { value: 'Wakanda' } })
    })

    act(() => {
      fireEvent.click(screen.getByTestId('start-button'))
    })

    // Advance one tick
    act(() => {
      jest.advanceTimersByTime(500)
    })

    // With fluctuation=0.9 and usageRate=10: stock = 1000 - 10*0.9 = 991
    expect(screen.getByText('991')).toBeInTheDocument()
  })

  it('clears event log on reset', () => {
    render(<SimulationPage />)

    const selects = screen.getAllByTestId('sim-select')
    act(() => {
      fireEvent.change(selects[0], { target: { value: 'Wakanda' } })
    })

    act(() => {
      fireEvent.click(screen.getByTestId('start-button'))
    })

    // Advance past hour 12 to fire an event
    act(() => {
      jest.advanceTimersByTime(6000)
    })

    expect(screen.getByTestId('event-log')).toBeInTheDocument()

    // Reset
    act(() => {
      fireEvent.click(screen.getByTestId('reset-button'))
    })

    expect(screen.queryByTestId('event-log')).not.toBeInTheDocument()
  })
})
