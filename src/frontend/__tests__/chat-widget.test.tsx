import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// jsdom does not implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
})

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Send: (props: React.HTMLAttributes<HTMLSpanElement>) => <span data-testid="send-icon" {...props} />,
  X: (props: React.HTMLAttributes<HTMLSpanElement>) => <span data-testid="x-icon" {...props} />,
  Minimize2: (props: React.HTMLAttributes<HTMLSpanElement>) => <span data-testid="minimize-icon" {...props} />,
  Cpu: (props: React.HTMLAttributes<HTMLSpanElement>) => <span data-testid="cpu-icon" {...props} />,
}))

// Mock the API module
const mockSendJarvisMessage = jest.fn()
jest.mock('@/lib/api', () => ({
  sendJarvisMessage: (...args: unknown[]) => mockSendJarvisMessage(...args),
}))

import { ChatWidget } from '@/components/jarvis/chat-widget'

describe('ChatWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the toggle button in minimized state by default', () => {
    render(<ChatWidget />)
    const toggle = screen.getByTestId('jarvis-toggle')
    expect(toggle).toBeInTheDocument()
    // Panel should NOT be visible
    expect(screen.queryByTestId('jarvis-panel')).not.toBeInTheDocument()
  })

  it('opens the panel when the toggle button is clicked', () => {
    render(<ChatWidget />)
    fireEvent.click(screen.getByTestId('jarvis-toggle'))
    expect(screen.getByTestId('jarvis-panel')).toBeInTheDocument()
    expect(screen.getByText('JARVIS')).toBeInTheDocument()
    expect(screen.getByText('Command Intelligence')).toBeInTheDocument()
  })

  it('closes the panel when minimize is clicked', () => {
    render(<ChatWidget />)
    // Open
    fireEvent.click(screen.getByTestId('jarvis-toggle'))
    expect(screen.getByTestId('jarvis-panel')).toBeInTheDocument()
    // Minimize
    fireEvent.click(screen.getByTestId('jarvis-minimize'))
    expect(screen.queryByTestId('jarvis-panel')).not.toBeInTheDocument()
  })

  it('shows starter prompts when the conversation is empty', () => {
    render(<ChatWidget />)
    fireEvent.click(screen.getByTestId('jarvis-toggle'))
    const prompts = screen.getAllByTestId('starter-prompt')
    expect(prompts).toHaveLength(4)
    expect(prompts[0]).toHaveTextContent('Which sector runs out first?')
  })

  it('sends a message when the send button is clicked', async () => {
    mockSendJarvisMessage.mockResolvedValue({
      reply: 'All systems operational.',
      function_calls_made: [],
    })

    render(<ChatWidget />)
    fireEvent.click(screen.getByTestId('jarvis-toggle'))

    const input = screen.getByTestId('jarvis-input')
    fireEvent.change(input, { target: { value: 'Status report' } })
    fireEvent.click(screen.getByTestId('jarvis-send'))

    // User message should appear
    expect(screen.getByText('Status report')).toBeInTheDocument()

    // Wait for Jarvis response
    await waitFor(() => {
      expect(screen.getByText('All systems operational.')).toBeInTheDocument()
    })

    expect(mockSendJarvisMessage).toHaveBeenCalledWith('Status report', [])
  })

  it('sends a message when Enter is pressed', async () => {
    mockSendJarvisMessage.mockResolvedValue({
      reply: 'Acknowledged.',
      function_calls_made: ['get_all_forecasts'],
    })

    render(<ChatWidget />)
    fireEvent.click(screen.getByTestId('jarvis-toggle'))

    const input = screen.getByTestId('jarvis-input')
    fireEvent.change(input, { target: { value: 'Which sector runs out first?' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByText('Acknowledged.')).toBeInTheDocument()
    })

    // Function call chip should be visible
    expect(screen.getByText(/get_all_forecasts/)).toBeInTheDocument()
  })

  it('sends a starter prompt when clicked', async () => {
    mockSendJarvisMessage.mockResolvedValue({
      reply: 'Wakanda Vibranium is running low.',
      function_calls_made: ['get_all_forecasts'],
    })

    render(<ChatWidget />)
    fireEvent.click(screen.getByTestId('jarvis-toggle'))

    const prompts = screen.getAllByTestId('starter-prompt')
    fireEvent.click(prompts[0]) // "Which sector runs out first?"

    await waitFor(() => {
      expect(screen.getByText('Wakanda Vibranium is running low.')).toBeInTheDocument()
    })

    expect(mockSendJarvisMessage).toHaveBeenCalledWith(
      'Which sector runs out first?',
      []
    )
  })

  it('shows typing indicator while loading', async () => {
    let resolvePromise: (value: unknown) => void
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve
    })
    mockSendJarvisMessage.mockReturnValue(pendingPromise)

    render(<ChatWidget />)
    fireEvent.click(screen.getByTestId('jarvis-toggle'))

    const input = screen.getByTestId('jarvis-input')
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByTestId('jarvis-send'))

    // Typing indicator should be visible
    await waitFor(() => {
      expect(screen.getByTestId('typing-indicator')).toBeInTheDocument()
    })

    // Resolve the promise to finish loading
    resolvePromise!({ reply: 'Hi!', function_calls_made: [] })

    await waitFor(() => {
      expect(screen.queryByTestId('typing-indicator')).not.toBeInTheDocument()
    })
  })
})
