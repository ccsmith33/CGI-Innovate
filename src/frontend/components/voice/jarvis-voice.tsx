'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, Loader2, Square } from 'lucide-react'
import { playAudioBlob, stopCurrentAudio } from '@/lib/sonification'

type VoiceState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING'

// Extend Window for webkit prefix
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')      // **bold** -> bold
    .replace(/\*(.+?)\*/g, '$1')           // *italic* -> italic
    .replace(/#{1,6}\s/g, '')              // ## heading -> heading
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1') // `code` -> code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) -> link
    .replace(/^\s*[-*+]\s/gm, '')          // - bullet -> bullet
    .replace(/^\s*\d+\.\s/gm, '')         // 1. item -> item
    .replace(/\n{2,}/g, '. ')             // double newlines -> sentence break
    .replace(/\n/g, ' ')                  // single newlines -> space
    .trim()
}

let _cachedVoice: SpeechSynthesisVoice | null = null

function browserTtsFallback(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    console.warn('[JarvisVoice] Falling back to browser TTS')
    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = 1.0
    utt.pitch = 0.85
    // Select and cache preferred voice on first use
    if (!_cachedVoice) {
      const voices = window.speechSynthesis.getVoices()
      _cachedVoice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('male'))
        || voices.find(v => v.lang.startsWith('en') && (
            v.name.toLowerCase().includes('david') ||
            v.name.toLowerCase().includes('mark') ||
            v.name.toLowerCase().includes('james') ||
            v.name.toLowerCase().includes('guy')
          ))
        || voices.find(v => v.lang === 'en-US' && !v.localService)
        || voices.find(v => v.lang.startsWith('en'))
        || null
    }
    if (_cachedVoice) utt.voice = _cachedVoice
    utt.onend = () => { console.log('[JarvisVoice] Browser TTS ended'); resolve() }
    utt.onerror = (e) => { console.error('[JarvisVoice] Browser TTS error:', e); resolve() }
    window.speechSynthesis.speak(utt)
  })
}

async function speak(rawText: string): Promise<void> {
  const text = stripMarkdown(rawText)
  const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY
  if (!apiKey) {
    console.warn('[JarvisVoice] ElevenLabs API key not set — using browser Web Speech API fallback')
    return browserTtsFallback(text)
  }

  // ElevenLabs REST API
  const voiceId = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb'
  console.log('[JarvisVoice] Calling ElevenLabs API, voiceId:', voiceId)
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    console.error('[JarvisVoice] ElevenLabs API error:', response.status, errText)
    throw new Error(`ElevenLabs API error: ${response.status}`)
  }

  const blob = await response.blob()
  console.log('[JarvisVoice] Audio blob size:', blob.size)
  console.log('[JarvisVoice] Calling playAudioBlob')
  await playAudioBlob(blob)
  console.log('[JarvisVoice] playAudioBlob completed')
}

// Export for other components to trigger proactive alerts
export function speakAlert(message: string) {
  window.dispatchEvent(new CustomEvent('jarvis-alert', { detail: { message } }))
}

const SHOW_AUDIO_DEBUG =
  process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_AUDIO_DEBUG === 'true'

export function JarvisVoice() {
  const [state, setState] = useState<VoiceState>('IDLE')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [audioTestResult, setAudioTestResult] = useState<'pass' | 'fail' | null>(null)
  const recognitionRef = useRef<unknown>(null)
  const processingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const canvasRef = useRef<SVGSVGElement>(null)
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(32) as Uint8Array<ArrayBuffer>)
  const [bars, setBars] = useState<number[]>(new Array(32).fill(0))

  // Listen for jarvis-alert custom events
  useEffect(() => {
    function handleAlert(e: Event) {
      const customEvent = e as CustomEvent<{ message: string }>
      if (customEvent.detail?.message) {
        setState('SPEAKING')
        speak(customEvent.detail.message)
          .catch(() => browserTtsFallback(stripMarkdown(customEvent.detail.message)))
          .then(() => { setState('IDLE') })
      }
    }
    window.addEventListener('jarvis-alert', handleAlert)
    return () => window.removeEventListener('jarvis-alert', handleAlert)
  }, [])

  // Waveform animation loop
  const updateBars = useCallback(() => {
    if (analyserRef.current) {
      analyserRef.current.getByteFrequencyData(frequencyDataRef.current)
      setBars(Array.from(frequencyDataRef.current))
    }
    animFrameRef.current = requestAnimationFrame(updateBars)
  }, [])

  function startListening() {
    setError(null)
    setTranscript('')

    const SpeechRecognition =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition

    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser.')
      return
    }

    const recognition = new (SpeechRecognition as new () => {
      continuous: boolean
      lang: string
      interimResults: boolean
      onresult: ((e: SpeechRecognitionEvent) => void) | null
      onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
      onend: (() => void) | null
      start: () => void
      stop: () => void
    })()
    recognition.continuous = false
    recognition.lang = 'en-US'
    recognition.interimResults = true

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let interimTranscript = ''
      let finalTranscript = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript
        } else {
          interimTranscript += result[0].transcript
        }
      }
      setTranscript(finalTranscript || interimTranscript)
    }

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      setError(`Speech error: ${e.error}`)
      setState('IDLE')
      stopAnalyser()
    }

    recognition.onend = () => {
      // Recognition ended -- process final transcript
      stopAnalyser()
      setTranscript((current) => {
        if (current.trim() && !processingRef.current) {
          processingRef.current = true
          processTranscript(current.trim()).finally(() => {
            processingRef.current = false
          })
        } else if (!current.trim()) {
          setState('IDLE')
        }
        return current
      })
    }

    recognitionRef.current = recognition
    recognition.start()
    setState('LISTENING')

    // Start mic analyser for waveform
    startAnalyser()
  }

  async function startAnalyser() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 64
      source.connect(analyser)
      analyserRef.current = analyser
      frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount)
      animFrameRef.current = requestAnimationFrame(updateBars)
    } catch {
      // If mic access fails, continue without waveform
    }
  }

  function stopAnalyser() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
    analyserRef.current = null
    setBars(new Array(32).fill(0))
  }

  function stopListening() {
    const recognition = recognitionRef.current as { stop: () => void } | null
    if (recognition) {
      recognition.stop()
    }
  }

  function stopSpeaking() {
    stopCurrentAudio()
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setState('IDLE')
    setTranscript('')
  }

  async function processTranscript(text: string) {
    setState('PROCESSING')

    const ttsQueue: string[] = []
    let ttsPlaying = false
    let sentencesSpoken = 0
    const MAX_SENTENCES = 3
    let elevenlabsFailed = false

    async function speakWithConsistentVoice(text: string): Promise<void> {
      if (elevenlabsFailed) {
        return browserTtsFallback(stripMarkdown(text))
      }
      try {
        await speak(text)
      } catch {
        elevenlabsFailed = true
        return browserTtsFallback(stripMarkdown(text))
      }
    }

    async function processTtsQueue() {
      if (ttsPlaying || ttsQueue.length === 0) return
      ttsPlaying = true
      setState('SPEAKING')
      while (ttsQueue.length > 0) {
        const sentence = ttsQueue.shift()!
        if (sentence.trim()) {
          await speakWithConsistentVoice(sentence)
        }
      }
      ttsPlaying = false
      setState('IDLE')
      setTranscript('')
    }

    function enqueueSentence(sentence: string) {
      const cleaned = stripMarkdown(sentence)
      if (cleaned.trim() && sentencesSpoken < MAX_SENTENCES) {
        // Deduplication: skip if exact same text is already queued
        if (ttsQueue.includes(cleaned)) return
        sentencesSpoken++
        ttsQueue.push(cleaned)
        processTtsQueue()
      }
    }

    try {
      abortControllerRef.current = new AbortController()
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const response = await fetch(`${apiBase}/api/v1/jarvis/chat-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_history: [] }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''      // accumulates raw SSE bytes
      let textBuffer = ''  // accumulates LLM text, looking for sentence ends

      const SENTENCE_END = /[.!?][\s"')\]]*(?:\s|$)/

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''  // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'chunk' && event.text) {
              textBuffer += event.text
              // Check for sentence boundary
              const match = SENTENCE_END.exec(textBuffer)
              if (match) {
                const sentenceEnd = match.index + match[0].length
                const sentence = textBuffer.slice(0, sentenceEnd)
                textBuffer = textBuffer.slice(sentenceEnd)
                enqueueSentence(sentence)
              }
            } else if (event.type === 'done') {
              // Flush remaining text
              if (textBuffer.trim()) {
                enqueueSentence(textBuffer.trim())
                textBuffer = ''
              }
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }

      // Wait for TTS queue to drain
      while (ttsPlaying || ttsQueue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User stopped speaking — not an error
        return
      }
      setError('Failed to get JARVIS response.')
      setState('IDLE')
      setTranscript('')
    }
  }

  async function handleAudioTest() {
    setAudioTestResult(null)
    let ttsOk = false
    let oscOk = false

    // Test 1: Browser TTS
    try {
      const utt = new SpeechSynthesisUtterance('Audio test')
      window.speechSynthesis.speak(utt)
      ttsOk = true
      console.log('[AudioTest] Browser TTS: OK')
    } catch (e) {
      console.error('[AudioTest] Browser TTS failed:', e)
    }

    // Test 2: AudioContext oscillator
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.5)
      osc.onended = () => ctx.close()
      oscOk = true
      console.log('[AudioTest] AudioContext oscillator: OK')
    } catch (e) {
      console.error('[AudioTest] AudioContext oscillator failed:', e)
    }

    setAudioTestResult(ttsOk || oscOk ? 'pass' : 'fail')
  }

  function handleMicClick() {
    if (state === 'IDLE') {
      startListening()
    } else if (state === 'LISTENING') {
      stopListening()
    } else if (state === 'SPEAKING') {
      stopSpeaking()
    }
  }

  // State-based ring color
  const ringColor =
    state === 'LISTENING'
      ? '#3b82f6'
      : state === 'SPEAKING'
        ? '#f97316'
        : state === 'PROCESSING'
          ? '#eab308'
          : '#4b5563'

  const pulseClass =
    state === 'LISTENING' || state === 'SPEAKING' ? 'animate-pulse' : ''

  return (
    <div
      className="fixed bottom-6 right-24 z-50 flex flex-col items-center gap-2"
      data-testid="jarvis-voice"
    >
      {/* Transcript display */}
      {transcript && state === 'LISTENING' && (
        <div
          className="bg-gray-900/95 border border-blue-500/50 rounded-lg px-3 py-2 text-xs text-blue-300 max-w-48 text-center"
          data-testid="voice-transcript"
        >
          {transcript}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-900/80 border border-red-500/50 rounded-lg px-3 py-1 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Waveform ring */}
      <div className="relative">
        <svg
          ref={canvasRef}
          width="64"
          height="64"
          viewBox="0 0 64 64"
          className={pulseClass}
          data-testid="voice-waveform"
          data-state={state}
        >
          {/* Background ring */}
          <circle cx="32" cy="32" r="28" fill="none" stroke={ringColor} strokeWidth="2" opacity="0.3" />

          {/* Waveform bars arranged in a circle */}
          {bars.slice(0, 32).map((value, i) => {
            const angle = (i / 32) * Math.PI * 2 - Math.PI / 2
            const innerR = 20
            const barHeight = Math.max(2, (value / 255) * 12)
            const x1 = 32 + innerR * Math.cos(angle)
            const y1 = 32 + innerR * Math.sin(angle)
            const x2 = 32 + (innerR + barHeight) * Math.cos(angle)
            const y2 = 32 + (innerR + barHeight) * Math.sin(angle)
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={ringColor}
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity={0.6 + (value / 255) * 0.4}
              />
            )
          })}
        </svg>

        {/* Mic button centered in the ring */}
        <button
          className="absolute inset-0 flex items-center justify-center"
          onClick={handleMicClick}
          disabled={state === 'PROCESSING'}
          data-testid="voice-mic-button"
          aria-label={state === 'SPEAKING' ? 'Stop speaking' : state === 'LISTENING' ? 'Stop listening' : 'Start listening'}
        >
          {state === 'PROCESSING' ? (
            <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
          ) : state === 'SPEAKING' ? (
            <Square className="w-5 h-5 text-orange-400" />
          ) : state === 'LISTENING' ? (
            <MicOff className="w-5 h-5 text-blue-400" />
          ) : (
            <Mic className="w-5 h-5 text-gray-400 hover:text-white transition-colors" />
          )}
        </button>
      </div>

      {/* Audio test button (dev only) */}
      {SHOW_AUDIO_DEBUG && (
        <div className="flex items-center gap-1">
          <button
            className="text-[9px] text-gray-600 hover:text-gray-400 border border-gray-700 rounded px-1.5 py-0.5"
            onClick={handleAudioTest}
            data-testid="audio-test-button"
          >
            Test Audio
          </button>
          {audioTestResult === 'pass' && <span className="text-[9px] text-green-400" data-testid="audio-test-result">OK</span>}
          {audioTestResult === 'fail' && <span className="text-[9px] text-red-400" data-testid="audio-test-result">FAILED</span>}
        </div>
      )}

      {/* State label */}
      <span className="text-[10px] text-gray-500 uppercase tracking-wider" data-testid="voice-state-label">
        {state === 'IDLE'
          ? 'Voice'
          : state === 'LISTENING'
            ? 'Listening...'
            : state === 'PROCESSING'
              ? 'Thinking...'
              : 'Speaking...'}
      </span>
    </div>
  )
}
