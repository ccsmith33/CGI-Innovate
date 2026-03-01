# Jarvis Audio Pipeline Investigation

## Executive Summary

The Jarvis voice system is **PERMANENTLY MUTED by default** in the sonification engine, and there is **NO MECHANISM in the JarvisVoice component itself to unmute it**. Audio cannot play unless the mute state is explicitly toggled. Two separate audio systems exist: (1) **sonification** (ambient sound based on resource levels), which is hard-muted at initialization, and (2) **speech synthesis** (voice responses), which works but requires API configuration.

The mute button on the dashboard controls only the sonification engine, not the speech responses from Jarvis Chat. The speech synthesis fallback and ElevenLabs TTS pathways are correctly implemented.

---

## Detailed Findings

### 1. TTS Mechanism

**Multiple TTS pathways exist:**

- **Primary (if API key present)**: ElevenLabs REST API (`https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`)
  - **File**: `src/frontend/components/voice/jarvis-voice.tsx:34-62`
  - Requires `NEXT_PUBLIC_ELEVENLABS_API_KEY` environment variable
  - Uses voice ID from `NEXT_PUBLIC_ELEVENLABS_VOICE_ID` (default: `'nPczCjzI2devNBz1zQrb'`)
  - Model: `eleven_turbo_v2`

- **Fallback (if no API key)**: Browser Web Speech Synthesis API
  - **File**: `src/frontend/components/voice/jarvis-voice.tsx:21-29`
  - Uses native `window.speechSynthesis.speak()`
  - Sets rate=0.9, pitch=0.8

- **Sonification (ambient)**: Web Audio API oscillators
  - **File**: `src/frontend/lib/sonification.ts:20-122`
  - Creates pentatonic tones per sector using sine wave oscillators
  - **ALWAYS STARTS MUTED** (critical finding below)

**Code snippet (ElevenLabs path)**:
```typescript
// jarvis-voice.tsx:18-62
async function speak(text: string): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY
  if (!apiKey) {
    // Fallback: browser TTS
    return new Promise<void>((resolve) => {
      const utt = new SpeechSynthesisUtterance(text)
      utt.rate = 0.9
      utt.pitch = 0.8
      utt.onend = () => resolve()
      utt.onerror = () => resolve()
      window.speechSynthesis.speak(utt)
    })
  }

  // ElevenLabs REST API
  const voiceId = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb'
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
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  return new Promise<void>((resolve) => {
    const audio = new Audio(url)
    audio.onended = () => { /* ... */ resolve() }
    audio.onerror = () => { /* ... */ resolve() }
    audio.play().catch(() => { /* ... */ resolve() })
  })
}
```

---

### 2. Default Mute/Unmute State on Mount

**CRITICAL FINDING**: The sonification engine **DEFAULTS TO MUTED** and is initialized muted on every page load.

**Sonification initialization** (the ambient sound system):
- **File**: `src/frontend/lib/sonification.ts:18`
- **Line 18**: `let isMuted = true`
- **Line 20-43**: `initSonification()` creates oscillators and starts them with volume 0
  - Line 30: `gain.gain.setValueAtTime(0, audioContext.currentTime)` — starts completely silent

**Code snippet**:
```typescript
// sonification.ts:18, 20-43
let isMuted = true

export function initSonification(): () => void {
  try {
    audioContext = new AudioContext()

    for (const [sector, freq] of Object.entries(SECTOR_FREQUENCIES)) {
      const osc = audioContext.createOscillator()
      const gain = audioContext.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, audioContext.currentTime)
      gain.gain.setValueAtTime(0, audioContext.currentTime) // start silent ← MUTED
```

**Dashboard component** (where sonification is initialized):
- **File**: `src/frontend/app/dashboard/page.tsx:121`
- **Line 121**: `const [muted, setMutedState] = useState(true)` — React state defaults to muted
- **Line 124-127**: Calls `initSonification()` on mount with no override

**Code snippet**:
```typescript
// dashboard/page.tsx:119-133
export default function DashboardPage() {
  const [snapActive, setSnapActive] = useState(false)
  const [muted, setMutedState] = useState(true)  // ← DEFAULTS TO TRUE (MUTED)

  // Initialize sonification engine
  useEffect(() => {
    const cleanup = initSonification()
    return cleanup
  }, [])

  function toggleMute() {
    const next = !muted
    setMutedState(next)
    setMuted(next)  // Calls sonification.ts:setMuted()
  }
```

**JarvisVoice component has NO mute state**:
- **File**: `src/frontend/components/voice/jarvis-voice.tsx:70-409`
- The component itself has no mute button, no mute state for speech synthesis
- It only listens for `jarvis-alert` custom events and speaks (no muting)

---

### 3. Is There a Bug Preventing Audio from Playing?

**No critical API bugs, but initialization issues exist:**

- **ElevenLabs path**: Requires valid `NEXT_PUBLIC_ELEVENLABS_API_KEY` environment variable. If missing, falls back to browser TTS (no error).
  - **Test coverage**: `jarvis-voice.test.tsx:291-314` verifies fallback behavior
  - **No endpoint issues**: The ElevenLabs URL is correct and tested

- **Browser TTS path**: Always works (no API required). The `window.speechSynthesis.speak()` API is stable.

- **Speech synthesis in JarvisVoice**: Works correctly
  - **File**: `jarvis-voice.tsx:205-295`
  - SSE stream parsing is correct (line 250-283)
  - TTS queue processing works (line 211-224)
  - Test passes: `jarvis-voice.test.tsx:226-276` validates IDLE → PROCESSING → SPEAKING → IDLE state machine

- **Sonification audio WILL NOT PLAY unless unmuted** because:
  - `isMuted = true` at module load (sonification.ts:18)
  - All updates early-return if muted (sonification.ts:64, 89)
  - Must call `setMuted(false)` via dashboard mute button to activate

**Code snippet (mute gate)**:
```typescript
// sonification.ts:60-86
export function updateSonification(
  stocks: Record<string, number>,
  targets: Record<string, number>
): void {
  if (!audioContext || isMuted) return  // ← EARLY RETURN IF MUTED
  // ... volume/pitch updates only happen if not muted
}

export function playCriticalAlert(sector: string): void {
  if (!audioContext || isMuted) return  // ← EARLY RETURN IF MUTED
  // ... critical alert only plays if not muted
}
```

---

### 4. Where is Mute State Stored?

**Two separate systems, two separate storage locations:**

**A) Sonification (ambient sound) mute state:**
- **Location**: Module-level variable in `src/frontend/lib/sonification.ts:18`
- **Variable**: `let isMuted = true`
- **Storage**: In-memory, module scope (not persisted)
- **Controlled by**: `setMuted(boolean)` function (line 110)
- **Read by**: `isSonificationMuted()` function (line 120)

**B) Dashboard React state**:
- **Location**: `src/frontend/app/dashboard/page.tsx:121`
- **Variable**: `const [muted, setMutedState] = useState(true)`
- **Storage**: React component state (lost on page reload)
- **Controlled by**: `toggleMute()` function (line 129)
- **Displayed as**: Mute button at dashboard/page.tsx:289-297

**C) Speech synthesis (JarvisVoice) - NO MUTE STATE**:
- The `JarvisVoice` component has no mute state for speech
- Speech responses are always played when triggered
- No localStorage or persistent state for speech muting

**Code snippets**:
```typescript
// sonification.ts:110-122
export function setMuted(muted: boolean): void {
  isMuted = muted
  if (muted && audioContext) {
    for (const [, { gain }] of oscillators) {
      gain.gain.setTargetAtTime(0, audioContext.currentTime, 0.05)
    }
  }
}

export function isSonificationMuted(): boolean {
  return isMuted
}
```

```typescript
// dashboard/page.tsx:289-297
<Button
  variant="outline"
  size="sm"
  onClick={toggleMute}
  className="border-gray-700 text-gray-400 hover:bg-gray-800 text-xs"
  data-testid="mute-button"
>
  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
</Button>
```

---

### 5. Does Anything Explicitly Set Muted=True on Mount?

**YES, three places:**

1. **sonification.ts:18** — Module initialization
   ```typescript
   let isMuted = true  // ← Hard-coded true at module load
   ```

2. **dashboard/page.tsx:121** — React state initialization
   ```typescript
   const [muted, setMutedState] = useState(true)  // ← Defaults to true
   ```

3. **No override on mount** — The dashboard doesn't call `setMuted(false)` during initialization
   ```typescript
   // dashboard/page.tsx:124-127
   useEffect(() => {
     const cleanup = initSonification()
     return cleanup
   }, [])  // ← Just calls initSonification(), doesn't change mute state
   ```

Result: **Every page load, sonification starts MUTED. User must manually click the mute button to unmute.**

---

### 6. Browser Autoplay Policy Issues

**No browser autoplay blocking issues detected for the actual speech TTS:**

- **ElevenLabs Audio**: Created with `new Audio()` and `.play()` is called synchronously after user interaction (speech recognizing a command → processing → speak). This **satisfies autoplay policy** because user triggered it.
  - Browser autoplay policy requires user gesture; speech recognition input counts as user interaction.

- **Browser TTS**: Uses `window.speechSynthesis.speak()` which is **exempt from autoplay restrictions** by design in modern browsers.

- **Sonification**: Uses Web Audio API oscillators which **do not trigger audio output until unmuted**. Even if muted policy blocked it, it starts silent anyway (gain=0).

- **Test validation**: `jarvis-voice.test.tsx:226-276` confirms state machine works without autoplay errors in test environment.

No autoplay bugs found. The issue is intentional muting, not browser policy.

---

### 7. What Would it Take to Default to Unmuted?

**To make audio audible by default:**

### (A) Default to Unmuted

**Option 1: Simplest — Change sonification default**
```typescript
// sonification.ts:18 (current line)
let isMuted = true

// Change to:
let isMuted = false
```

**Option 2: Change dashboard React state default**
```typescript
// dashboard/page.tsx:121 (current line)
const [muted, setMutedState] = useState(true)

// Change to:
const [muted, setMutedState] = useState(false)
```

**Option 3: Call setMuted(false) on dashboard mount**
```typescript
// dashboard/page.tsx:124-127 (current)
useEffect(() => {
  const cleanup = initSonification()
  return cleanup
}, [])

// Change to:
useEffect(() => {
  const cleanup = initSonification()
  setMuted(false)  // ← Add this line
  return cleanup
}, [])
```

**Impact**: Any ONE of these changes would make the mute button toggle properly and start unmuted. All three approaches are equivalent; pick the clearest one.

---

### (B) Ensure Audio Actually Plays

**Checklist:**

1. ✅ **Environment variables for ElevenLabs** (optional):
   ```bash
   NEXT_PUBLIC_ELEVENLABS_API_KEY=sk-xxxxxxxxxxxxxxxx  # If using ElevenLabs
   NEXT_PUBLIC_ELEVENLABS_VOICE_ID=nPczCjzI2devNBz1zQrb  # Voice ID (has default)
   NEXT_PUBLIC_API_URL=http://localhost:8000  # Backend URL for Jarvis chat (has default)
   ```

2. ✅ **Sonification**: Unmute the module-level flag (see Option 1 above)

3. ✅ **Speech synthesis fallback**: Works without any env vars (uses browser TTS)

4. ✅ **JarvisVoice component**: Already working (tests pass)
   - Listens for `jarvis-alert` events
   - Calls `speak()` function
   - Uses ElevenLabs if API key present, falls back to browser TTS

5. ✅ **Autoplay**: Not an issue (user-triggered via speech recognition)

**Summary**: Set `isMuted = false` in sonification.ts, and audio will play. Speech responses are already functional.

---

## Files Involved

| File | Purpose | Key Lines |
|------|---------|-----------|
| `src/frontend/lib/sonification.ts` | Ambient sound engine (Web Audio API) | 18 (mute default), 64 (mute gate), 110-122 (setMuted) |
| `src/frontend/components/voice/jarvis-voice.tsx` | Speech synthesis UI + SSE streaming | 18-62 (speak function), 70-409 (component), 82-94 (jarvis-alert listener) |
| `src/frontend/app/dashboard/page.tsx` | Dashboard initialization | 121 (mute state default), 124-127 (sonification init), 289-297 (mute button) |
| `src/frontend/__tests__/jarvis-voice.test.tsx` | Voice component tests | 278-314 (ElevenLabs + fallback tests) |
| `src/frontend/components/hud/defcon-badge.tsx` | DEFCON display only (no audio relevance) | N/A |
| `src/frontend/lib/types.ts` | Type definitions | N/A (no audio types) |

---

## Root Cause Analysis

**Why is Jarvis never audible?**

1. **Sonification (ambient background)**: Hard-muted at initialization (`isMuted = true`). Requires user to click mute button to unmute. This is intentional design but not user-friendly.

2. **Speech synthesis (voice responses)**: Works correctly. Uses either ElevenLabs (if API key set) or browser TTS (fallback). No bugs detected.

3. **Why the mute button question?**: The dashboard mute button only controls sonification (ambient sound), not speech responses. Users don't realize there's a "hidden" ambient sound system that defaults to muted.

---

## Recommendations

1. **Change default**: Set `isMuted = false` in sonification.ts:18 so ambient sound plays by default
2. **Clarify mute button UI**: Label it "Ambient Sound" or "Sonification" instead of generic "Mute"
3. **Make it persistent**: Add localStorage for mute state so user preference persists across reloads
4. **Document the dual-system**: Users may not realize there are two audio systems (ambient + speech)

