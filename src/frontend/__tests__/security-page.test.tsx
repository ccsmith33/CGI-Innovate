import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const mockFetchRedactionLog = jest.fn()

jest.mock('@/lib/api', () => ({
  fetchRedactionLog: (...args: unknown[]) => mockFetchRedactionLog(...args),
}))

jest.mock('lucide-react', () => ({
  ShieldCheck: ({ className }: { className?: string }) => (
    <span data-testid="shield-check-icon" className={className}>ShieldCheck</span>
  ),
  Loader2: () => <span>loader</span>,
  AlertCircle: () => <span>alert</span>,
  CheckCircle2: () => <span>check</span>,
  ChevronLeft: () => <span>left</span>,
  ChevronRight: () => <span>right</span>,
}))

// Mock SWR to call fetcher synchronously
jest.mock('swr', () => {
  return {
    __esModule: true,
    default: (key: unknown, fetcher: () => Promise<unknown>, _opts?: unknown) => {
      const [data, setData] = React.useState<unknown>(null)
      const [error, setError] = React.useState<unknown>(null)
      const [isLoading, setIsLoading] = React.useState(true)

      React.useEffect(() => {
        let cancelled = false
        fetcher()
          .then((result) => {
            if (!cancelled) {
              setData(result)
              setIsLoading(false)
            }
          })
          .catch((err) => {
            if (!cancelled) {
              setError(err)
              setIsLoading(false)
            }
          })
        return () => { cancelled = true }
      }, [JSON.stringify(key)])

      return { data, error, isLoading, mutate: jest.fn() }
    },
  }
})

import SecurityPage from '@/app/security/page'

const mockItems = [
  {
    id: 1,
    report_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    original_text_hash: 'The quick brown fox jumps over',
    redacted_text: 'The [REDACTED] fox jumps',
    patterns_matched: ['HERO_NAME', 'PHONE_NUMBER'],
    redacted_at: '2026-02-28T10:30:00Z',
  },
  {
    id: 2,
    report_id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    original_text_hash: 'Contact email is test@example.com',
    redacted_text: 'Contact email is [REDACTED]',
    patterns_matched: ['EMAIL'],
    redacted_at: '2026-02-28T09:15:00Z',
  },
]

describe('Security Page', () => {
  beforeEach(() => {
    mockFetchRedactionLog.mockReset()
  })

  it('renders the page with title and subtitle', async () => {
    mockFetchRedactionLog.mockResolvedValue({ items: mockItems, total: 2 })

    await act(async () => {
      render(<SecurityPage />)
    })

    await waitFor(() => {
      expect(screen.getByText('Security Operations')).toBeInTheDocument()
      expect(screen.getByText('PII Redaction Audit Log — Privacy by Design')).toBeInTheDocument()
    })
  })

  it('renders the stat bar with total counts', async () => {
    mockFetchRedactionLog.mockResolvedValue({ items: mockItems, total: 2 })

    await act(async () => {
      render(<SecurityPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('stat-bar')).toBeInTheDocument()
      expect(screen.getByTestId('stat-total-reports')).toHaveTextContent('2')
      expect(screen.getByTestId('stat-pii-instances')).toHaveTextContent('3')
      expect(screen.getByText('All data sanitized before LLM transmission')).toBeInTheDocument()
    })
  })

  it('renders table with all 6 columns', async () => {
    mockFetchRedactionLog.mockResolvedValue({ items: mockItems, total: 2 })

    await act(async () => {
      render(<SecurityPage />)
    })

    await waitFor(() => {
      expect(screen.getByText('Report ID')).toBeInTheDocument()
      expect(screen.getByText('Timestamp')).toBeInTheDocument()
      expect(screen.getByText('Original Length')).toBeInTheDocument()
      expect(screen.getByText('Redacted Length')).toBeInTheDocument()
      expect(screen.getByText('Data Removed')).toBeInTheDocument()
      expect(screen.getByText('Patterns Matched')).toBeInTheDocument()
    })
  })

  it('renders truncated report IDs in monospace', async () => {
    mockFetchRedactionLog.mockResolvedValue({ items: mockItems, total: 2 })

    await act(async () => {
      render(<SecurityPage />)
    })

    await waitFor(() => {
      expect(screen.getByText('a1b2c3d4')).toBeInTheDocument()
      expect(screen.getByText('b2c3d4e5')).toBeInTheDocument()
    })
  })

  it('renders pattern badges with correct text', async () => {
    mockFetchRedactionLog.mockResolvedValue({ items: mockItems, total: 2 })

    await act(async () => {
      render(<SecurityPage />)
    })

    await waitFor(() => {
      expect(screen.getByText('HERO_NAME')).toBeInTheDocument()
      expect(screen.getByText('PHONE_NUMBER')).toBeInTheDocument()
      expect(screen.getByText('EMAIL')).toBeInTheDocument()
    })
  })

  it('renders pagination controls', async () => {
    mockFetchRedactionLog.mockResolvedValue({ items: mockItems, total: 2 })

    await act(async () => {
      render(<SecurityPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('pagination')).toBeInTheDocument()
      expect(screen.getByTestId('prev-page')).toBeInTheDocument()
      expect(screen.getByTestId('next-page')).toBeInTheDocument()
    })
  })

  it('disables prev button on first page', async () => {
    mockFetchRedactionLog.mockResolvedValue({ items: mockItems, total: 2 })

    await act(async () => {
      render(<SecurityPage />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('prev-page')).toBeDisabled()
    })
  })

  it('shows ShieldCheck icon', async () => {
    mockFetchRedactionLog.mockResolvedValue({ items: mockItems, total: 2 })

    await act(async () => {
      render(<SecurityPage />)
    })

    await waitFor(() => {
      const icons = screen.getAllByTestId('shield-check-icon')
      expect(icons.length).toBeGreaterThanOrEqual(1)
    })
  })
})
