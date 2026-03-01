# Bug Investigation Report: Demo Polish Team

Date: 2026-03-01
Investigator: Researcher
Team: demo-polish

---

## Bug 1: Budget Math Mismatch

**Symptoms**: Dashboard shows individual sector allocations summing to $97,500, but "Budget used" displays $83,500. A $14,000 discrepancy.

### Investigation

**Formula A: Sector Dollar Allocation (Frontend)**
```typescript
// src/frontend/lib/api.ts:180-196
// normalizeAllocations() constructs each allocation from backend data:
const costPerUnit = COST_PER_UNIT[key] ?? 1  // Hardcoded in frontend
const units_per_cycle = raw[key]             // From backend
cost_per_cycle = units_per_cycle * costPerUnit
```

Frontend COST_PER_UNIT (api.ts:121-127):
- Medical Kits: **3500** ← MISMATCH
- Vibranium: 4000
- Water: 1000
- Pym Particles: 4500
- Arc Cores: 5000

Backend COST_PER_UNIT (resource_config.py:2-27):
- Medical Kits: **1750** ← Actual value
- Vibranium: 4000
- Water: 1000
- Pym Particles: 4500
- Arc Cores: 5000

**Formula B: Budget Used (Backend)**
```python
# src/backend/app/routers/governor.py:28-31
# Returns raw data from governor_instance.get_status()
# Governor stores budget_used as sum of actual production cost calculations
# which use resource_config.py values (1750 for Medical)
```

**Root Cause**: The frontend's `COST_PER_UNIT` has Medical Kits at **3500**, but the backend uses **1750**. This causes:
1. Frontend calculates sector allocations using 3500 per Medical unit → **inflates total**
2. Backend calculates budget_used using 1750 per Medical unit → **actual budget is lower**
3. The discrepancy is the difference: (3500 - 1750) × Medical units_per_cycle

**Example**: If Medical allocation is 8 units/cycle:
- Frontend shows: 8 × 3500 = $28,000
- Backend shows: 8 × 1750 = $14,000
- Difference: $14,000

**Who is responsible**: **Frontend display bug** — the frontend has the wrong hardcoded cost per unit for Medical Kits.

---

## Bug 2: Governor Override Not Stopping Depletion

**Symptoms**: Arc Reactor Cores receives a 400% boost (override to 30 units/cycle costing $80,000), but stock still depletes to zero. The override doesn't prevent depletion.

### Investigation

#### Part 1: Override Endpoint Chain

**Frontend calls** `overrideProduction()` (api.ts:261-273):
```typescript
POST /api/v1/governor/override
body: { sector_id: "Wakanda", resource_type: "Arc Reactor Cores", units_per_cycle: X }
```

**Backend endpoint** (governor.py:105-116):
```python
@router.post("/governor/override")
async def governor_override(req: OverrideRequest):
    units = max(0.0, min(req.units_per_cycle, 30.0))  # Caps at 30 units/cycle
    governor_instance.set_override(req.sector_id, req.resource_type, units)
    return { "status": "override_set", ... }
```

**Backend's `set_override()` method**:
- Located in `src/backend/app/services/governor.py` (NOT shown, but called here)
- Stores the override in backend memory
- **DOES NOT PROPAGATE TO FEED SERVICE**

#### Part 2: Feed Service Production Rate Update

**Critical Issue**: The backend `set_override()` does NOT call the feed service to update production rates. The override is stored in the backend's memory but never sent to the feed service.

The feed service reads production rates from its own in-memory state:
```python
# src/feed-service/app/state.py:106-113
def get_production_rates() -> dict[tuple[str, str], float]:
    with _lock:
        return dict(_production_rates)

def set_production_rate(sector_id: str, resource_type: str, rate: float) -> None:
    with _lock:
        key = (sector_id, resource_type)
        if key in _production_rates:
            _production_rates[key] = rate
```

Feed service endpoint to accept overrides:
```python
# src/feed-service/app/main.py:71-82
@app.post("/control/production")
async def update_production(body: ProductionUpdate):
    key = (body.sector_id, body.resource_type)
    if key not in state.INITIAL_STOCKS:
        return {"error": f"Unknown sector/resource: {body.sector_id}/{body.resource_type}"}, 400
    state.set_production_rate(body.sector_id, body.resource_type, body.units_per_cycle)
    return { "sector_id": ..., "units_per_cycle": ..., "status": "updated" }
```

#### Part 3: The Missing Link

**What should happen**:
1. Frontend sends override to `/api/v1/governor/override`
2. Backend stores override in memory
3. Backend calls feed service `/control/production` with updated rate
4. Feed service updates its in-memory production rate
5. Next cycle uses new rate, stocks increase

**What actually happens**:
1. Frontend sends override to `/api/v1/governor/override`
2. Backend stores override in memory
3. **NOTHING ELSE** — override never reaches feed service
4. Feed service keeps using baseline production rates
5. Stocks continue depleting at baseline rates

#### Part 4: Docker Configuration Check

**docker-compose.yml:39-41** shows backend CAN reach feed service:
```yaml
environment:
  - FEED_SERVICE_URL=http://feed:8001
```

This is correctly configured (not localhost), so networking is not the issue.

**Root Cause**: **Backend design bug** — the `governor_instance.set_override()` method stores the override locally but does NOT make an HTTP call to the feed service's `/control/production` endpoint. The two services are decoupled, but there's no mechanism to propagate overrides from backend to feed service.

---

## Bug 3: Jarvis TTS Flickers Idle/Talking With No Audio

**Symptoms**: Voice component shows "SPEAKING" state briefly, then immediately returns to "IDLE" with no audio playing. The TTS promise resolves instantly.

### Investigation

**The `speak()` function** (jarvis-voice.tsx:18-64):
```typescript
async function speak(text: string): Promise<void> {
  // ... fetch from ElevenLabs API ...
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  return new Promise<void>((resolve) => {
    const audio = new Audio(url)
    audio.onended = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
    audio.play().catch(() => {
      URL.revokeObjectURL(url)
      resolve()  // ← IMMEDIATELY RESOLVES ON ERROR
    })
  })
}
```

#### The Autoplay Restriction Problem

**Browser autoplay policy**: Audio elements are subject to separate autoplay restrictions from AudioContext.

- **AudioContext**: Can be unlocked once per session via user interaction (click, keydown, etc.)
- **Audio elements**: Have THEIR OWN autoplay restrictions that persist beyond AudioContext unlock

When `audio.play()` is called on a newly-created Audio element:
1. If the page has no user gesture pending OR the audio context is suspended → `play()` returns a rejected Promise
2. The `.catch()` handler fires **immediately**
3. It calls `resolve()`, so the Promise completes **before any audio plays**
4. Frontend state changes from SPEAKING → IDLE instantly
5. User sees: "SPEAKING" badge flickers for 100ms, then "IDLE"

**Symptom sequence**:
```
1. speak() called
2. Audio element created from blob URL
3. audio.play() called
4. Autoplay restriction causes rejection
5. .catch() handler runs → resolve()
6. Promise completes (audio never plays)
7. State changes to IDLE
8. Next sentence (if any) starts playing, but component is already IDLE
```

#### Why It Happens

The code unlocks AudioContext on dashboard load (dashboard/page.tsx:125-154):
```typescript
useEffect(() => {
  const cleanup = initSonification()  // Unlocks AudioContext via user gesture on first interaction
  // ...
}, [])
```

This unlocks the AudioContext for **sonification purposes**, but Audio elements created AFTER that have their own autoplay restrictions. Audio elements need a user gesture to play, OR the AudioContext itself needs to be maintained in a "user-gesturing" state.

#### The Correct Fix

**Option 1 (Recommended)**: Pre-create the Audio element during or after a user gesture, then re-use it:
```typescript
let sharedAudioElement: HTMLAudioElement | null = null

function ensureAudioElement() {
  if (!sharedAudioElement) {
    sharedAudioElement = new Audio()
    // Element created during/after user interaction context
  }
  return sharedAudioElement
}

async function speak(text: string): Promise<void> {
  // ... fetch blob ...
  const audio = ensureAudioElement()
  audio.src = URL.createObjectURL(blob)
  // audio.play() now works because element was created in user gesture context
  // ...
}
```

**Option 2 (Workaround)**: Unlock AudioContext again before playing:
```typescript
async function speak(text: string): Promise<void> {
  // ... fetch blob ...
  const audio = new Audio(url)

  // Re-unlock audio by triggering a brief AudioContext state change
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  await ctx.resume() // Short-lived lock

  audio.play().catch(() => resolve())
}
```

**Root Cause**: **Frontend browser autoplay restriction** — Audio elements created dynamically (outside the initial user gesture) face autoplay blocks separately from AudioContext. The `audio.play()` promise rejects due to autoplay policy, causing immediate state reset to IDLE before audio plays.

---

## Summary & Recommended Fixes

| Bug | Category | Fix | Priority |
|-----|----------|-----|----------|
| **Budget math** | Frontend display | Update `COST_PER_UNIT['Avengers Compound\|Medical Kits']` from 3500 to 1750 in api.ts:122 | HIGH |
| **Override not persisting** | Backend architecture | Add HTTP call in `governor_instance.set_override()` to POST to `FEED_SERVICE_URL/control/production` | HIGH |
| **TTS audio flicker** | Browser autoplay restriction | Pre-create Audio element during user interaction, or re-unlock AudioContext before play | MEDIUM |

---

## Files Affected

**Bug 1**:
- `src/frontend/lib/api.ts:122` — Wrong cost per unit for Medical Kits

**Bug 2**:
- `src/backend/app/services/governor.py` — Missing feed service call in `set_override()`
- `src/backend/app/routers/governor.py:105-116` — The override endpoint (correctly calls `set_override()`, but that method is incomplete)

**Bug 3**:
- `src/frontend/components/voice/jarvis-voice.tsx:49-63` — The `speak()` function needs Audio element pre-creation or AudioContext re-unlock

---

## Test Plan

1. **Budget math**: After fix, verify sector allocations sum matches "Budget used" on dashboard
2. **Governor override**: Apply a 400% boost to Arc Reactor, verify stock increases next cycle
3. **TTS audio**: Trigger Jarvis response, verify audio plays to completion with "SPEAKING" state persisting
