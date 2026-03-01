import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Mock the API module
const mockFetchRedactionPreview = jest.fn()
jest.mock('@/lib/api', () => ({
  submitReport: jest.fn().mockResolvedValue({ report_id: 'test-123', status: 'processing' }),
  fetchRedactionPreview: (...args: unknown[]) => mockFetchRedactionPreview(...args),
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Loader2: () => <span>loader</span>,
  Send: () => <span>send</span>,
  ShieldCheck: () => <span>shield</span>,
}))

// Mock Radix UI Select with native HTML elements
const SelectContext = React.createContext<{
  value: string
  onValueChange: (v: string) => void
}>({ value: '', onValueChange: () => {} })

jest.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <SelectContext.Provider value={{ value, onValueChange }}>
      <div>{children}</div>
    </SelectContext.Provider>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
  SelectContent: ({ children }: { children: React.ReactNode }) => {
    const { value, onValueChange } = React.useContext(SelectContext)
    return (
      <select
        data-testid="priority-select"
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

// Mock StatusBadge
jest.mock('@/components/reports/status-badge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}))

import { ReportForm } from '@/components/reports/report-form'

describe('PII Redaction Preview', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockFetchRedactionPreview.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('triggers a debounced API call when typing in the form', async () => {
    mockFetchRedactionPreview.mockResolvedValue({
      original: 'Call Tony Stark at 555-0101',
      redacted: 'Call [REDACTED] at [REDACTED]',
      patterns_matched: ['Tony Stark', '555-0101'],
    })

    render(<ReportForm />)
    const textarea = screen.getByTestId('report-textarea')

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Call Tony Stark at 555-0101' } })
    })

    // Should not have been called yet (debounce)
    expect(mockFetchRedactionPreview).not.toHaveBeenCalled()

    // Advance past the 300ms debounce and flush promises
    await act(async () => {
      jest.advanceTimersByTime(350)
    })

    expect(mockFetchRedactionPreview).toHaveBeenCalledWith('Call Tony Stark at 555-0101')
  })

  it('renders the redacted text in the preview pane', async () => {
    mockFetchRedactionPreview.mockResolvedValue({
      original: 'Call Tony Stark at 555-0101',
      redacted: 'Call [REDACTED] at [REDACTED]',
      patterns_matched: ['Tony Stark', '555-0101'],
    })

    render(<ReportForm />)
    const textarea = screen.getByTestId('report-textarea')

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Call Tony Stark at 555-0101' } })
    })

    // Advance debounce timer
    await act(async () => {
      jest.advanceTimersByTime(350)
    })

    // Flush the resolved promise
    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => {
      const redactedSpans = screen.getAllByText('[REDACTED]')
      expect(redactedSpans.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('updates the "X items redacted" count', async () => {
    mockFetchRedactionPreview.mockResolvedValue({
      original: 'Call Tony Stark at 555-0101',
      redacted: 'Call [REDACTED] at [REDACTED]',
      patterns_matched: ['Tony Stark', '555-0101'],
    })

    render(<ReportForm />)
    const textarea = screen.getByTestId('report-textarea')

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Call Tony Stark at 555-0101' } })
    })

    await act(async () => {
      jest.advanceTimersByTime(350)
    })

    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => {
      const countEl = screen.getByTestId('redaction-count')
      expect(countEl.textContent).toBe('2 items redacted')
    })
  })

  it('shows singular "item" for 1 match', async () => {
    mockFetchRedactionPreview.mockResolvedValue({
      original: 'Call Tony Stark',
      redacted: 'Call [REDACTED]',
      patterns_matched: ['Tony Stark'],
    })

    render(<ReportForm />)
    const textarea = screen.getByTestId('report-textarea')

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Call Tony Stark' } })
    })

    await act(async () => {
      jest.advanceTimersByTime(350)
    })

    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => {
      const countEl = screen.getByTestId('redaction-count')
      expect(countEl.textContent).toBe('1 item redacted')
    })
  })
})
