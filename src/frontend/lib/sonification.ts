/**
 * Data sonification engine using Web Audio API.
 * Each sector has a pentatonic base frequency.
 * Critical alerts beep when stock health drops below threshold.
 */

const SECTOR_FREQUENCIES: Record<string, number> = {
  'Avengers Compound': 261.63,  // C4
  'New Asgard': 293.66,         // D4
  'Sanctum Sanctorum': 329.63,  // E4
  'Sokovia': 392.0,             // G4
  'Wakanda': 440.0,             // A4
}

let audioContext: AudioContext | null = null
let audioUnlocked = false
let activeBufferSource: AudioBufferSourceNode | null = null

/** Track which sectors have already fired a critical alert (throttle re-alerts). */
const criticalAlertTimestamps: Map<string, number> = new Map()
const CRITICAL_ALERT_COOLDOWN_MS = 60_000
const CRITICAL_HEALTH_THRESHOLD = 0.30
const MAX_ACTIVE_ALERT_OSCILLATORS = 2
let activeAlertOscillatorCount = 0
let currentDefconLevel = 5

/** Resume the AudioContext — call on user interaction to satisfy autoplay policy. */
export function resumeAudioContext() {
  if (!audioContext || audioContext.state !== 'suspended') return
  audioContext.resume()
}

/** Play an audio Blob through the shared AudioContext (already unlocked by user gesture). */
export async function playAudioBlob(blob: Blob): Promise<void> {
  console.log('[Audio] playAudioBlob - context state:', audioContext?.state ?? 'null')

  let ctx = audioContext
  if (!ctx || ctx.state === 'closed') {
    console.warn('[Audio] No shared AudioContext — creating temporary one for TTS')
    try {
      ctx = new AudioContext()
    } catch {
      // AudioContext not available, fall back to Audio element
      console.warn('[Audio] AudioContext creation failed, falling back to Audio element')
      return new Promise<void>((resolve) => {
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        console.log('[Audio] Using Audio element fallback')
        audio.onended = () => { URL.revokeObjectURL(url); console.log('[Audio] Audio element playback ended'); resolve() }
        audio.onerror = () => { URL.revokeObjectURL(url); console.error('[Audio] Audio element playback error'); resolve() }
        audio.play().catch((e) => { console.error('[Audio] Audio element play() rejected:', e); resolve() })
      })
    }
  }

  if (ctx.state === 'suspended') {
    console.log('[Audio] Resuming suspended AudioContext')
    await ctx.resume()
  }

  const arrayBuffer = await blob.arrayBuffer()
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    console.log('[Audio] decodeAudioData succeeded, duration:', audioBuffer.duration.toFixed(2), 's')
    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      activeBufferSource = source

      // Boost JARVIS speech — needs to be audible even at moderate system volume
      const speechGain = ctx.createGain()
      speechGain.gain.setValueAtTime(3.0, ctx.currentTime)

      source.connect(speechGain)
      speechGain.connect(ctx.destination)
      source.onended = () => { activeBufferSource = null; console.log('[Audio] BufferSource playback ended'); resolve() }
      console.log('[Audio] BufferSource starting playback')
      source.start()
    })
  } catch (e) {
    console.error('[Audio] decodeAudioData failed:', e)
    // Fallback to Audio element
    console.warn('[Audio] Falling back to Audio element after decode failure')
    return new Promise<void>((resolve) => {
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => { URL.revokeObjectURL(url); console.log('[Audio] Audio element fallback ended'); resolve() }
      audio.onerror = () => { URL.revokeObjectURL(url); console.error('[Audio] Audio element fallback error'); resolve() }
      audio.play().catch((e2) => { console.error('[Audio] Audio element fallback play() rejected:', e2); resolve() })
    })
  }
}

/** One-time listener that resumes AudioContext on first user gesture. */
function installResumeListener() {
  if (typeof document === 'undefined') return

  const events = ['click', 'keydown', 'touchstart'] as const
  function handler() {
    resumeAudioContext()
    audioUnlocked = true
    for (const evt of events) {
      document.removeEventListener(evt, handler)
    }
  }
  for (const evt of events) {
    document.addEventListener(evt, handler, { once: false })
  }
}

export function isAudioUnlocked(): boolean {
  if (!audioContext) return false
  return audioContext.state === 'running'
}

export function initSonification(): () => void {
  try {
    audioContext = new AudioContext()
    resumeAudioContext()
    installResumeListener()
  } catch {
    // AudioContext not available
  }
  return () => {}  // no oscillators to clean up
}

/** Set the current DEFCON level (1-5). Alerts are suppressed at DEFCON 4-5. */
export function setDefconLevel(level: number): void {
  currentDefconLevel = level
}

/**
 * Check whether a sector should trigger a critical alert based on stock health.
 * Returns true only when health < 30% of target.
 */
export function shouldAlertForSector(
  stock: number,
  target: number,
): boolean {
  if (target <= 0) return false
  return stock / target < CRITICAL_HEALTH_THRESHOLD
}

/**
 * Clear the alert throttle for a sector (call when sector recovers above threshold).
 * This allows re-alerting if the sector drops critical again.
 */
export function clearCriticalAlert(sector: string): void {
  criticalAlertTimestamps.delete(sector)
}

export function playCriticalAlert(sector: string): void {
  if (!audioContext) return

  // DEFCON gate: suppress critical alerts at DEFCON 4-5 (normal/low-alert)
  if (currentDefconLevel >= 4) return

  const freq = SECTOR_FREQUENCIES[sector]
  if (!freq) return

  // Throttle: skip if this sector already alerted within the cooldown window
  const now = Date.now()
  const lastAlert = criticalAlertTimestamps.get(sector)
  if (lastAlert && now - lastAlert < CRITICAL_ALERT_COOLDOWN_MS) return

  // Guard: don't stack more than MAX_ACTIVE_ALERT_OSCILLATORS alert oscillators
  if (activeAlertOscillatorCount >= MAX_ACTIVE_ALERT_OSCILLATORS) return

  criticalAlertTimestamps.set(sector, now)
  activeAlertOscillatorCount++

  const osc = audioContext.createOscillator()
  const gain = audioContext.createGain()

  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(freq, audioContext.currentTime)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, audioContext.currentTime + 0.5)

  gain.gain.setValueAtTime(0.08, audioContext.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 1)

  osc.connect(gain)
  gain.connect(audioContext.destination)
  osc.start()
  osc.stop(audioContext.currentTime + 1)

  // Decrement active count when the oscillator ends
  osc.onended = () => {
    activeAlertOscillatorCount = Math.max(0, activeAlertOscillatorCount - 1)
  }
}

export function stopCurrentAudio(): void {
  if (activeBufferSource) {
    try { activeBufferSource.stop() } catch { /* already stopped */ }
    activeBufferSource = null
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
}
