import { TextEncoder, TextDecoder } from 'util'
Object.assign(global, { TextEncoder, TextDecoder })

import { ReadableStream } from 'stream/web'
if (typeof globalThis.ReadableStream === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ReadableStream = ReadableStream
}

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Mock lucide-react
jest.mock('lucide-react', () => ({
  Mic: (props: Record<string, unknown>) => <svg data-testid="icon-mic" {...props} />,
  MicOff: (props: Record<string, unknown>) => <svg data-testid="icon-mic-off" {...props} />,
  Loader2: (props: Record<string, unknown>) => <svg data-testid="icon-loader" {...props} />,
  Square: (props: Record<string, unknown>) => <svg data-testid="icon-square" {...props} />,
}))

// Mock sonification module (playAudioBlob is now imported by jarvis-voice)
const mockStopCurrentAudio = jest.fn()
jest.mock('@/lib/sonification', () => ({
  resumeAudioContext: jest.fn(),
  playAudioBlob: jest.fn(() => Promise.resolve()),
  stopCurrentAudio: (...args: unknown[]) => mockStopCurrentAudio(...args),
}))

// No longer need to mock sendJarvisMessage — streaming uses fetch directly

// Mock SpeechRecognition
let mockRecognitionInstance: {
  continuous: boolean
  lang: string
  interimResults: boolean
  onresult: ((e: unknown) => void) | null
  onerror: ((e: unknown) => void) | null
  onend: (() => void) | null
  start: jest.Mock
  stop: jest.Mock
}

const MockSpeechRecognition = jest.fn(() => {
  mockRecognitionInstance = {
    continuous: false,
    lang: '',
    interimResults: false,
    onresult: null,
    onerror: null,
    onend: null,
    start: jest.fn(),
    stop: jest.fn(),
  }
  return mockRecognitionInstance
})

// Mock speechSynthesis
const mockSpeak = jest.fn()
const mockGetVoices = jest.fn(() => [])
const mockSpeechSynthesisUtterance = jest.fn(() => ({
  rate: 1,
  pitch: 1,
  voice: null as unknown,
  onend: null as (() => void) | null,
  onerror: null as ((e: unknown) => void) | null,
}))

// Setup browser globals before importing component
Object.defineProperty(window, 'SpeechRecognition', {
  value: MockSpeechRecognition,
  writable: true,
})

const mockCancel = jest.fn()
Object.defineProperty(window, 'speechSynthesis', {
  value: { speak: mockSpeak, getVoices: mockGetVoices, cancel: mockCancel },
  writable: true,
})

Object.defineProperty(window, 'SpeechSynthesisUtterance', {
  value: mockSpeechSynthesisUtterance,
  writable: true,
})

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  value: {
    getUserMedia: jest.fn().mockRejectedValue(new Error('Not available in test')),
  },
  writable: true,
})

// Mock URL.createObjectURL and Audio for ElevenLabs TTS path
URL.createObjectURL = jest.fn(() => 'blob:mock-url')
URL.revokeObjectURL = jest.fn()

const mockAudioPlay = jest.fn().mockResolvedValue(undefined)
const mockAudioInstances: Array<{ onended: (() => void) | null; onerror: (() => void) | null; play: jest.Mock }> = []
;(global as unknown as Record<string, unknown>).Audio = jest.fn(() => {
  const instance = {
    play: mockAudioPlay,
    onended: null as (() => void) | null,
    onerror: null as (() => void) | null,
  }
  mockAudioInstances.push(instance)
  // Auto-resolve onended after a tick
  setTimeout(() => instance.onended?.(), 10)
  return instance
})

import { JarvisVoice, speakAlert, stripMarkdown } from '@/components/voice/jarvis-voice'

// Helper: create a mock SSE streaming response for fetch
function createMockStreamResponse(events: Array<{ type: string; text?: string }>) {
  const sseText = events
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join('')
  const encoder = new TextEncoder()
  const encoded = encoder.encode(sseText)

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    },
  })

  return {
    ok: true,
    body: stream,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  }
}

describe('JarvisVoice', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    originalFetch = global.fetch
    // Reset env var
    delete process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('renders in IDLE state by default', () => {
    render(<JarvisVoice />)

    expect(screen.getByTestId('jarvis-voice')).toBeInTheDocument()
    expect(screen.getByTestId('voice-state-label')).toHaveTextContent('Voice')
    expect(screen.getByTestId('voice-waveform')).toHaveAttribute('data-state', 'IDLE')
    expect(screen.getByTestId('voice-mic-button')).toBeInTheDocument()
  })

  it('clicking mic button transitions to LISTENING state', () => {
    render(<JarvisVoice />)

    fireEvent.click(screen.getByTestId('voice-mic-button'))

    expect(screen.getByTestId('voice-state-label')).toHaveTextContent('Listening...')
    expect(screen.getByTestId('voice-waveform')).toHaveAttribute('data-state', 'LISTENING')
    expect(MockSpeechRecognition).toHaveBeenCalled()
    expect(mockRecognitionInstance.start).toHaveBeenCalled()
  })

  it('shows live transcript while listening', () => {
    render(<JarvisVoice />)

    fireEvent.click(screen.getByTestId('voice-mic-button'))

    // Simulate interim result
    act(() => {
      mockRecognitionInstance.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: {
            isFinal: false,
            0: { transcript: 'Hello JARVIS' },
            length: 1,
          },
        },
      })
    })

    expect(screen.getByTestId('voice-transcript')).toHaveTextContent('Hello JARVIS')
  })

  it('calls streaming endpoint when speech ends with a transcript', async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      createMockStreamResponse([
        { type: 'chunk', text: 'Hello commander.' },
        { type: 'done' },
      ])
    )
    global.fetch = mockFetch

    render(<JarvisVoice />)

    fireEvent.click(screen.getByTestId('voice-mic-button'))

    // Simulate final result
    act(() => {
      mockRecognitionInstance.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: {
            isFinal: true,
            0: { transcript: 'status report' },
            length: 1,
          },
        },
      })
    })

    // Simulate recognition end
    act(() => {
      mockRecognitionInstance.onend?.()
    })

    await waitFor(() => {
      const fetchCalls = mockFetch.mock.calls
      const streamCall = fetchCalls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('/jarvis/chat-stream')
      )
      expect(streamCall).toBeDefined()
      expect(JSON.parse(streamCall[1].body)).toEqual({
        message: 'status report',
        conversation_history: [],
      })
    })
  })

  it('transitions PROCESSING -> SPEAKING -> IDLE during streaming', async () => {
    // Make browser TTS auto-resolve onend so speak() promises complete
    mockSpeak.mockImplementation((utt: { onend?: (() => void) | null }) => {
      setTimeout(() => utt.onend?.(), 5)
    })

    const mockFetch = jest.fn().mockResolvedValue(
      createMockStreamResponse([
        { type: 'chunk', text: 'First sentence. ' },
        { type: 'chunk', text: 'Second sentence.' },
        { type: 'done' },
      ])
    )
    global.fetch = mockFetch

    render(<JarvisVoice />)

    fireEvent.click(screen.getByTestId('voice-mic-button'))

    // Simulate final result + end
    act(() => {
      mockRecognitionInstance.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: {
            isFinal: true,
            0: { transcript: 'test' },
            length: 1,
          },
        },
      })
    })

    act(() => {
      mockRecognitionInstance.onend?.()
    })

    // Should transition to PROCESSING first
    await waitFor(() => {
      expect(screen.getByTestId('voice-waveform')).toHaveAttribute('data-state', 'PROCESSING')
    })

    // Eventually transitions through SPEAKING and back to IDLE
    await waitFor(
      () => {
        expect(screen.getByTestId('voice-waveform')).toHaveAttribute('data-state', 'IDLE')
      },
      { timeout: 5000 }
    )
  })

  it('speak function falls back to speechSynthesis when ElevenLabs key not set', () => {
    delete process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY
    render(<JarvisVoice />)

    // Trigger a jarvis-alert to test the speak path
    act(() => {
      window.dispatchEvent(new CustomEvent('jarvis-alert', { detail: { message: 'Alert test' } }))
    })

    expect(mockSpeechSynthesisUtterance).toHaveBeenCalledWith('Alert test')
    expect(mockSpeak).toHaveBeenCalled()
  })

  it('speak function calls ElevenLabs when API key is present', async () => {
    process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY = 'test-key'

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' })),
    })
    global.fetch = mockFetch

    render(<JarvisVoice />)

    act(() => {
      window.dispatchEvent(new CustomEvent('jarvis-alert', { detail: { message: 'ElevenLabs test' } }))
    })

    await waitFor(() => {
      // Check that fetch was called with ElevenLabs URL
      const fetchCalls = mockFetch.mock.calls
      const elevenLabsCall = fetchCalls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('api.elevenlabs.io')
      )
      expect(elevenLabsCall).toBeDefined()
      expect(elevenLabsCall[1].headers['xi-api-key']).toBe('test-key')
    })
  })

  it('falls back to browser TTS when ElevenLabs returns non-200', async () => {
    process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY = 'test-key'

    // Mock fetch to return a 401 error for ElevenLabs
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })
    global.fetch = mockFetch

    // Make browser TTS auto-resolve onend so speak() completes
    mockSpeak.mockImplementation((utt: { onend?: (() => void) | null }) => {
      setTimeout(() => utt.onend?.(), 5)
    })

    render(<JarvisVoice />)

    act(() => {
      window.dispatchEvent(new CustomEvent('jarvis-alert', { detail: { message: 'Fallback test' } }))
    })

    // Should eventually fall back to browser TTS
    await waitFor(() => {
      expect(mockSpeechSynthesisUtterance).toHaveBeenCalledWith('Fallback test')
      expect(mockSpeak).toHaveBeenCalled()
    })

    // Should return to IDLE after TTS completes
    await waitFor(() => {
      expect(screen.getByTestId('voice-waveform')).toHaveAttribute('data-state', 'IDLE')
    }, { timeout: 3000 })
  })

  it('jarvis-alert event triggers speak', () => {
    delete process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY
    render(<JarvisVoice />)

    act(() => {
      window.dispatchEvent(new CustomEvent('jarvis-alert', { detail: { message: 'Snap detected!' } }))
    })

    expect(screen.getByTestId('voice-state-label')).toHaveTextContent('Speaking...')
    expect(mockSpeechSynthesisUtterance).toHaveBeenCalledWith('Snap detected!')
    expect(mockSpeak).toHaveBeenCalled()
  })

  it('speakAlert utility dispatches jarvis-alert event', () => {
    const handler = jest.fn()
    window.addEventListener('jarvis-alert', handler)

    speakAlert('Test alert')

    expect(handler).toHaveBeenCalled()
    const event = handler.mock.calls[0][0] as CustomEvent
    expect(event.detail.message).toBe('Test alert')

    window.removeEventListener('jarvis-alert', handler)
  })

  it('shows error state when speech recognition fails', () => {
    render(<JarvisVoice />)

    fireEvent.click(screen.getByTestId('voice-mic-button'))

    act(() => {
      mockRecognitionInstance.onerror?.({ error: 'no-speech' })
    })

    expect(screen.getByTestId('voice-state-label')).toHaveTextContent('Voice')
  })

  it('shows stop button during SPEAKING state and clicking it stops speech', () => {
    delete process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY
    render(<JarvisVoice />)

    // Trigger speak to enter SPEAKING state
    act(() => {
      window.dispatchEvent(new CustomEvent('jarvis-alert', { detail: { message: 'Test' } }))
    })

    expect(screen.getByTestId('voice-waveform')).toHaveAttribute('data-state', 'SPEAKING')
    // Button should be enabled (not disabled) so user can stop
    expect(screen.getByTestId('voice-mic-button')).not.toBeDisabled()
    // Should show stop icon (Square)
    expect(screen.getByTestId('icon-square')).toBeInTheDocument()
  })

  it('clicking stop button during SPEAKING calls stopCurrentAudio and returns to IDLE', () => {
    delete process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY
    render(<JarvisVoice />)

    // Trigger speak to enter SPEAKING state
    act(() => {
      window.dispatchEvent(new CustomEvent('jarvis-alert', { detail: { message: 'Long message' } }))
    })

    expect(screen.getByTestId('voice-waveform')).toHaveAttribute('data-state', 'SPEAKING')

    // Click the stop button
    act(() => {
      fireEvent.click(screen.getByTestId('voice-mic-button'))
    })

    expect(mockStopCurrentAudio).toHaveBeenCalled()
    expect(screen.getByTestId('voice-waveform')).toHaveAttribute('data-state', 'IDLE')
  })

  it('disables mic button during PROCESSING state', () => {
    const mockFetch = jest.fn().mockReturnValue(new Promise(() => {})) // never resolves
    global.fetch = mockFetch

    render(<JarvisVoice />)

    fireEvent.click(screen.getByTestId('voice-mic-button'))

    // Simulate final result + end to trigger PROCESSING
    act(() => {
      mockRecognitionInstance.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: {
            isFinal: true,
            0: { transcript: 'test query' },
            length: 1,
          },
        },
      })
    })

    act(() => {
      mockRecognitionInstance.onend?.()
    })

    expect(screen.getByTestId('voice-waveform')).toHaveAttribute('data-state', 'PROCESSING')
    expect(screen.getByTestId('voice-mic-button')).toBeDisabled()
  })

  it('strips markdown before passing text to browser TTS', () => {
    delete process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY
    render(<JarvisVoice />)

    act(() => {
      window.dispatchEvent(
        new CustomEvent('jarvis-alert', { detail: { message: '**Bold** and *italic* text' } })
      )
    })

    // stripMarkdown should have removed ** and * wrappers
    expect(mockSpeechSynthesisUtterance).toHaveBeenCalledWith('Bold and italic text')
  })
})

describe('stripMarkdown', () => {
  it('removes bold markers', () => {
    expect(stripMarkdown('**bold text**')).toBe('bold text')
  })

  it('removes italic markers', () => {
    expect(stripMarkdown('*italic text*')).toBe('italic text')
  })

  it('removes heading prefixes', () => {
    expect(stripMarkdown('## Section Title')).toBe('Section Title')
    expect(stripMarkdown('### Subsection')).toBe('Subsection')
  })

  it('removes inline code backticks', () => {
    expect(stripMarkdown('use `console.log`')).toBe('use console.log')
  })

  it('removes triple backtick code fences', () => {
    expect(stripMarkdown('```const x = 1```')).toBe('const x = 1')
  })

  it('extracts link text from markdown links', () => {
    expect(stripMarkdown('[click here](https://example.com)')).toBe('click here')
  })

  it('removes bullet point prefixes', () => {
    expect(stripMarkdown('- item one\n- item two')).toBe('item one item two')
  })

  it('removes numbered list prefixes', () => {
    expect(stripMarkdown('1. first\n2. second')).toBe('first second')
  })

  it('converts double newlines to sentence breaks', () => {
    expect(stripMarkdown('paragraph one\n\nparagraph two')).toBe('paragraph one. paragraph two')
  })

  it('converts single newlines to spaces', () => {
    expect(stripMarkdown('line one\nline two')).toBe('line one line two')
  })

  it('handles combined markdown', () => {
    const input = '## Status Report\n\n**Medical Kits**: *critical*\n- Stock at `120` units\n1. Deploy reserves'
    const result = stripMarkdown(input)
    expect(result).not.toContain('**')
    expect(result).not.toContain('*')
    expect(result).not.toContain('##')
    expect(result).not.toContain('`')
    expect(result).not.toContain('- ')
  })

  it('trims whitespace from result', () => {
    expect(stripMarkdown('  hello  ')).toBe('hello')
  })

  it('returns empty string for empty input', () => {
    expect(stripMarkdown('')).toBe('')
  })

  it('passes through plain text unchanged', () => {
    expect(stripMarkdown('All systems nominal')).toBe('All systems nominal')
  })
})
