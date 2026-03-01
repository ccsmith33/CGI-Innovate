import React from 'react'
import { render, screen, act } from '@testing-library/react'

// Mock SWR
jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    data: { data: [] },
    error: null,
    isLoading: false,
    mutate: jest.fn(),
  })),
}))

// Mock the API module
jest.mock('@/lib/api', () => ({
  fetchReports: jest.fn().mockResolvedValue({ data: [] }),
  processAllPendingReports: jest.fn().mockResolvedValue({ queued: 0, message: 'ok' }),
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Loader2: () => <span>loader</span>,
  AlertCircle: () => <span>alert</span>,
  ChevronDown: () => <span data-testid="chevron-down">v</span>,
  ChevronRight: () => <span data-testid="chevron-right">&gt;</span>,
  ShieldCheck: () => <span>shield</span>,
  Cpu: () => <span>cpu</span>,
}))

// Mock UI components
jest.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }: { children: React.ReactNode; colSpan?: number }) => <td {...props}>{children}</td>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void }) => <tr onClick={onClick} {...props}>{children}</tr>,
}))

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => <button {...props}>{children}</button>,
}))

jest.mock('@/components/reports/status-badge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}))

import useSWR from 'swr'
import type { IntelReport } from '@/lib/types'

const mockUseSWR = useSWR as jest.Mock

function makeReport(overrides: Partial<IntelReport> = {}): IntelReport {
  return {
    report_id: 'r-1',
    timestamp: '2026-01-01T00:00:00Z',
    priority: 'Routine',
    status: 'processed',
    redacted_text: 'Test report text',
    extracted_entities: {
      sector_id: 'Wakanda',
      resource_type: 'Vibranium (kg)',
      severity: 'critical',
      summary: 'Stock critically low',
      confidence: 0.93,
    },
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// Import after mocks
import { IntelTable } from '@/components/reports/intel-table'

describe('ExtractedEntitiesDisplay', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders structured fields when extracted_entities is a valid object', () => {
    const report = makeReport()
    mockUseSWR.mockReturnValue({
      data: { data: [report] },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<IntelTable />)

    // Click to expand the row
    const rows = screen.getAllByRole('row')
    act(() => {
      rows[1].click()
    })

    // Verify structured display
    const structured = screen.getByTestId('entities-structured')
    expect(structured).toBeInTheDocument()
    expect(structured.textContent).toContain('Wakanda')
    expect(structured.textContent).toContain('Vibranium (kg)')
    expect(structured.textContent).toContain('critical')
    expect(structured.textContent).toContain('Stock critically low')
    expect(structured.textContent).toContain('93%')
  })

  it('shows "Processing..." when extracted_entities is null', () => {
    const report = makeReport({ extracted_entities: null })
    mockUseSWR.mockReturnValue({
      data: { data: [report] },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<IntelTable />)

    // Click to expand the row
    const rows = screen.getAllByRole('row')
    act(() => {
      rows[1].click()
    })

    expect(screen.getByTestId('entities-pending')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('applies severity color coding for high severity', () => {
    const report = makeReport({
      extracted_entities: {
        sector_id: 'Sokovia',
        resource_type: 'Water',
        severity: 'high',
        summary: 'Rising usage',
        confidence: 0.85,
      },
    })
    mockUseSWR.mockReturnValue({
      data: { data: [report] },
      error: null,
      isLoading: false,
      mutate: jest.fn(),
    })

    render(<IntelTable />)

    const rows = screen.getAllByRole('row')
    act(() => {
      rows[1].click()
    })

    // The structured display should exist
    const structured = screen.getByTestId('entities-structured')
    expect(structured).toBeInTheDocument()

    // Find the severity text inside the structured view
    // "high" appears in the table row AND in the expanded view
    // Look for the one with the orange class inside the structured div
    const severityElements = screen.getAllByText('high')
    const orangeEl = severityElements.find(
      (el) => el.className && el.className.includes('text-orange-400')
    )
    expect(orangeEl).toBeTruthy()
  })
})
