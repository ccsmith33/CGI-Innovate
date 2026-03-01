# Real-Time Systems Innovation Research

> **Researcher**: researcher-realtime
> **Date**: 2026-02-28
> **Scope**: Streaming architecture, event-driven patterns, live data spectacle
> **Project Context**: CGI / Project Sentinel -- FastAPI backend + Next.js 15 frontend + feed-service generating events every 10s

---

## Current Architecture Baseline

| Layer | Current Pattern | Latency | Limitation |
|-------|----------------|---------|------------|
| Feed-service -> Backend | HTTP POST push every 10s cycle | ~10s batch | Events arrive in batches, not individually |
| Backend -> Frontend (resources) | SWR polling every 3s (`refreshInterval: 3000`) | 3-6s | Wastes bandwidth; stale between polls |
| Backend -> Frontend (governor) | SWR polling every 5s (`refreshInterval: 5000`) | 5-10s | Multiple independent polls for related data |
| Backend -> Frontend (forecasts) | SWR polling every 30s | 30-60s | Acceptable for slow-changing data |
| Snap event | POST -> response -> manual poll refresh | 5-15s before visible | No broadcast; only triggering user sees result |

**Key pain points**: No server push. No event stream. No cross-client synchronization. The dashboard _pretends_ to be live but is polling on a timer. Snap events are invisible to other connected users.

---

## Innovation 1: Server-Sent Events (SSE) Event Stream

**Rank: #1 -- Highest Impact, Lowest Friction**

### What it does
Replace all SWR polling with a single persistent SSE connection from each browser tab to the backend. The backend pushes typed events (`resource_update`, `governor_decision`, `snap_alert`, `intel_report`) as they happen.

### Why SSE over WebSockets
- **Unidirectional fit**: Our data flow is server -> client (the client already has REST endpoints for commands like snap/override). No need for bidirectional framing overhead.
- **Auto-reconnection**: The `EventSource` API handles reconnection with `Last-Event-ID` natively. WebSockets require manual reconnect logic.
- **HTTP/2 multiplexing**: SSE connections share the HTTP/2 multiplexed stream, avoiding the separate TCP connection that WebSockets require.
- **Simpler infrastructure**: No WebSocket upgrade negotiation, no sticky sessions needed on load balancers. Works through CDNs and proxies without special config.
- **FastAPI/Starlette native**: `sse-starlette` library provides `EventSourceResponse` that plugs directly into FastAPI async generators.

### Architecture Pattern

```
Feed-Service                    Backend (FastAPI)                     Frontend (Next.js)
    |                                |                                     |
    |-- POST /feed/push (events) --> |                                     |
    |                                |-- asyncio.Queue per client -------> |
    |                                |   via GET /api/v1/stream (SSE)      |
    |                                |                                     |
    |                                |   Event types:                      |
    |                                |   - resource_update                 |
    |                                |   - governor_decision               |
    |                                |   - snap_event                      |
    |                                |   - forecast_update                 |
    |                                |   - system_heartbeat (every 5s)     |
    |                                |                                     |
```

### Backend Implementation Sketch

```python
# app/routers/stream.py
from asyncio import Queue
from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

router = APIRouter()
_clients: list[Queue] = []

async def broadcast(event_type: str, data: dict):
    """Push an event to all connected SSE clients."""
    import json
    msg = json.dumps(data)
    dead = []
    for q in _clients:
        try:
            q.put_nowait({"event": event_type, "data": msg})
        except Exception:
            dead.append(q)
    for q in dead:
        _clients.remove(q)

@router.get("/stream")
async def event_stream():
    q: Queue = Queue()
    _clients.append(q)
    async def gen():
        try:
            while True:
                msg = await q.get()
                yield msg
        finally:
            _clients.remove(q)
    return EventSourceResponse(gen())
```

### Frontend Implementation Sketch

```typescript
// hooks/use-event-stream.ts
function useEventStream() {
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/v1/stream`);
    es.addEventListener('resource_update', (e) => {
      mutate('resources-all', JSON.parse(e.data), { revalidate: false });
    });
    es.addEventListener('governor_decision', (e) => {
      mutate('governor-decisions', ...);
    });
    es.addEventListener('snap_event', (e) => {
      // Trigger full-screen snap animation for ALL connected users
    });
    return () => es.close();
  }, []);
}
```

### Libraries
- `sse-starlette` (Python, backend SSE response)
- Native `EventSource` API (browser, zero dependencies)
- Optional: `eventsource-parser` for edge/Node.js SSE parsing

### Demo Impact
- **Perceived latency drops from 3-10s to <100ms** for resource updates
- Dashboard transitions from "refreshes periodically" to "data appears as it happens"
- Snap events simultaneously visible to all connected users
- Single connection replaces 4+ independent polling intervals

---

## Innovation 2: Cascading Snap Event Broadcast

**Rank: #2 -- Maximum Spectacle**

### What it does
When any user triggers the Snap Protocol, every connected client receives a real-time broadcast via the SSE stream. Instead of an instant flash, the snap _propagates_ sector by sector with staggered timing, showing resources crashing in sequence like dominoes falling.

### Architecture Pattern

```
User clicks SNAP
    |
    v
POST /governor/snap --> Feed-service halves stocks
    |
    v
Backend computes per-sector deltas
    |
    v
SSE broadcast: snap_cascade event
    {
      "phase": "initiation",
      "sectors": [
        { "id": "Wakanda", "delay_ms": 0, "delta_pct": -50 },
        { "id": "New Asgard", "delay_ms": 400, "delta_pct": -50 },
        { "id": "Sokovia", "delay_ms": 800, "delta_pct": -50 },
        { "id": "Avengers Compound", "delay_ms": 1200, "delta_pct": -50 },
        { "id": "Sanctum Sanctorum", "delay_ms": 1600, "delta_pct": -50 }
      ]
    }
    |
    v
All connected clients receive simultaneously
    |
    v
Frontend renders staggered animations:
  - Full-screen purple pulse overlay
  - Sector cards flash and dim one by one
  - Chart lines dive downward with staggered keyframe animations
  - Resource numbers count down rapidly (odometer effect)
  - Governor "RECALIBRATING" banner with particle effects
  - Sound cue (optional): low rumble with rising pitch
```

### Frontend Animation Sketch

```typescript
function SnapCascade({ sectors }: { sectors: CascadeSector[] }) {
  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Purple shockwave ring expanding from center */}
      <motion.div
        className="absolute inset-0 rounded-full border-4 border-purple-500"
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: 3, opacity: 0 }}
        transition={{ duration: 2, ease: "easeOut" }}
      />
      {/* Per-sector impact markers with staggered delays */}
      {sectors.map((s) => (
        <motion.div
          key={s.id}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: s.delay_ms / 1000 }}
          className="absolute text-red-500 font-bold text-xl"
          style={{ left: sectorPosition(s.id).x, top: sectorPosition(s.id).y }}
        >
          -{s.delta_pct}%
        </motion.div>
      ))}
    </div>
  );
}
```

### Libraries
- `framer-motion` (staggered animation orchestration)
- SSE broadcast (from Innovation 1)
- CSS `@keyframes` for particle effects

### Demo Impact
- **Every user in the room sees the snap simultaneously** -- judges, teammates, audience
- The 2-3 second cascade creates dramatic tension
- Chart lines visibly diving in sequence is immediately comprehensible
- Transforms a button click into a cinematic moment

---

## Innovation 3: Live Event Stream Log with Virtualized Scrolling

**Rank: #3 -- Operational Immersion**

### What it does
A real-time scrolling event log that shows every simulation event as it happens: production ticks, consumption events, random incidents, governor decisions, snap impacts. Events stream in from the SSE connection and auto-scroll with the latest at the top. The log is virtualized to handle thousands of events without DOM bloat.

### Architecture Pattern

```
SSE stream --> useEventStream hook --> event buffer (ring buffer, max 2000 events)
                                          |
                                          v
                                   TanStack Virtual
                                   (renders only ~20 visible rows)
                                          |
                                          v
                                   Live-scrolling event log panel
                                   - Color-coded by event type
                                   - Expandable detail rows
                                   - Pause/resume auto-scroll
                                   - Filter by sector/type
```

### Event Row Design

```
[14:32:05.123] [PRODUCTION]  Wakanda    Arc Reactor Cores  +4.0  -> 487.2   MAINTAINING
[14:32:05.123] [CONSUMPTION] Sokovia    Pym Particles      -4.2  -> 312.8   BASE DRAIN
[14:32:05.124] [RANDOM]      New Asgard Vibranium (kg)     -1.2  -> 389.1   Combat patrol
[14:32:05.500] [GOVERNOR]    --         Budget rebalanced   --    --        confidence: 87.2%
[14:32:15.001] [SNAP]        ALL        ALL RESOURCES      -50%  -> varies  THANOS SNAP DETECTED
```

Each row is color-coded:
- Green: production events
- Orange: consumption / drain
- Yellow: random events
- Blue: governor decisions
- Red/Purple: snap events (full-width highlight, pulsing)

### Implementation Sketch

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function LiveEventLog({ events }: { events: SimEvent[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (autoScroll) virtualizer.scrollToIndex(0);
  }, [events.length]);

  return (
    <div ref={parentRef} className="h-[400px] overflow-auto font-mono text-xs">
      <div style={{ height: virtualizer.getTotalSize() }} className="relative">
        {virtualizer.getVirtualItems().map((vi) => {
          const event = events[vi.index];
          return (
            <div
              key={vi.key}
              ref={virtualizer.measureElement}
              className={`absolute w-full ${eventRowColor(event.event_type)}`}
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <EventRow event={event} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### Libraries
- `@tanstack/react-virtual` (virtualization, handles 10k+ rows at 60fps)
- SSE stream (from Innovation 1)

### Demo Impact
- Makes the simulation feel like watching a real operations center
- Judges can see the heartbeat of the system -- events flowing every second
- Snap events create a dramatic burst of red/purple entries flooding the log
- Pause button lets users freeze and inspect specific events

---

## Innovation 4: Causal Event Chain Visualization (Event DAG)

**Rank: #4 -- Deepest Technical Impression**

### What it does
Visualize the causal chain of events as an interactive directed acyclic graph (DAG). When a snap event occurs, show the cascade: Snap -> stock halved in Sector X -> governor detects critical -> emergency reallocation -> budget shift -> production ramped in Sector Y -> recovery begins. Users can click any node to see details and trace cause/effect.

### Architecture Pattern

The backend tags each event with a `caused_by` field linking it to its parent event ID. The frontend consumes these tagged events and renders them as a flowing graph.

```
Event model extension:
{
  "id": "evt-123",
  "caused_by": "evt-100",        // parent event that triggered this one
  "event_type": "governor_decision",
  "causal_depth": 2,             // how many hops from root cause
  "causal_chain_id": "snap-001"  // groups related events into a chain
}
```

### Frontend Graph Rendering

```
[Snap Triggered]
     |
     +---> [Wakanda: Arc Reactors -50%]
     |          |
     |          +---> [Governor: CRITICAL detected]
     |                     |
     |                     +---> [Budget reallocation: +$15,000 to Wakanda]
     |                                |
     |                                +---> [Production ramped: 4.0 -> 12.0 u/cycle]
     |
     +---> [Sokovia: Pym Particles -50%]
     |          |
     |          +---> [Governor: CRITICAL detected]
     |                     |
     |                     +---> [Emergency resupply triggered]
     ...
```

### Implementation Sketch

```typescript
import ReactFlow, { Background, Controls } from '@xyflow/react';

function CausalChainGraph({ chain }: { chain: CausalEvent[] }) {
  const { nodes, edges } = useMemo(() => {
    const nodes = chain.map((evt) => ({
      id: evt.id,
      position: layoutDAG(evt),  // dagre or elk layout
      data: { event: evt },
      type: eventNodeType(evt.event_type),
    }));
    const edges = chain
      .filter((evt) => evt.caused_by)
      .map((evt) => ({
        id: `${evt.caused_by}-${evt.id}`,
        source: evt.caused_by,
        target: evt.id,
        animated: true,  // flowing dots along the edge
        style: { stroke: causalColor(evt.event_type) },
      }));
    return { nodes, edges };
  }, [chain]);

  return (
    <div style={{ height: 500 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

### Libraries
- `@xyflow/react` (React Flow v12 -- interactive node-based graph)
- `dagre` or `elkjs` (automatic DAG layout algorithms)
- `framer-motion` (node entrance animations)

### Demo Impact
- Judges can _see_ causality flowing through the system
- Animated edges with flowing dots show the propagation in real time
- Click any node to drill into the event detail
- Snap events produce a dramatic tree that grows in real time as consequences cascade
- Demonstrates deep understanding of event-driven architecture

---

## Innovation 5: Living System Vitals Panel

**Rank: #5 -- Operational Credibility**

### What it does
A persistent status bar or panel showing real-time system health metrics that make the dashboard feel like a mission control console: WebSocket/SSE connection status, event throughput counter, system heartbeat indicator, latency measurement, governor cycle timer, and simulation clock.

### Components

| Metric | Visual | Update Frequency |
|--------|--------|-----------------|
| Connection Status | Green dot = connected, red = disconnected, yellow = reconnecting | On SSE state change |
| Event Throughput | "142 events/min" with sparkline | Every 5s (computed client-side) |
| System Heartbeat | Pulsing dot that beats in sync with server heartbeat events | Every 5s from SSE |
| Round-Trip Latency | "RTT: 23ms" measured via heartbeat echo | Every 5s |
| Governor Cycle | Countdown ring "Next cycle: 14s" | Continuous (client-side timer reset on governor_decision events) |
| Simulation Clock | "Cycle #847 -- T+2h 21m" | Every 10s from SSE |
| Active Users | "3 operators online" (from SSE client count) | On connect/disconnect |

### Implementation Sketch

```typescript
function SystemVitals() {
  const { connected, latencyMs, eventRate, lastHeartbeat, cycleCount } = useEventStream();

  return (
    <div className="fixed bottom-0 inset-x-0 h-8 bg-gray-950 border-t border-gray-800
                    flex items-center px-4 gap-6 text-xs font-mono text-gray-400 z-40">
      {/* Connection indicator */}
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${
          connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'
        }`} />
        {connected ? 'CONNECTED' : 'OFFLINE'}
      </span>

      {/* Heartbeat */}
      <span className="flex items-center gap-1.5">
        <HeartbeatIcon className="w-3 h-3 text-red-400 animate-heartbeat" />
        {latencyMs}ms
      </span>

      {/* Throughput */}
      <span>{eventRate} evt/min</span>

      {/* Cycle counter */}
      <span>Cycle #{cycleCount}</span>

      {/* Active operators */}
      <span className="ml-auto">3 operators online</span>
    </div>
  );
}
```

### CSS Heartbeat Animation

```css
@keyframes heartbeat {
  0%, 100% { transform: scale(1); }
  15% { transform: scale(1.3); }
  30% { transform: scale(1); }
  45% { transform: scale(1.15); }
}
.animate-heartbeat { animation: heartbeat 1.5s infinite; }
```

### Libraries
- Pure React + CSS (no additional dependencies)
- SSE heartbeat events (from Innovation 1)

### Demo Impact
- Immediately signals "this is a live system" to anyone looking at the screen
- The heartbeat animation is subtle but viscerally communicates liveness
- Latency counter proves the system is genuinely real-time, not faking it
- Event throughput counter shows the simulation is generating real data volume

---

## Innovation 6: Collaborative Presence & Shared Cursor State

**Rank: #6 -- Multiplayer Wow Factor**

### What it does
Multiple users viewing the dashboard see each other's cursor positions and which sector/panel they're focused on. When one user triggers a snap, all users see a "Commander X triggered SNAP" attribution in real time.

### Architecture Pattern

This requires **bidirectional** communication, so we upgrade to a WebSocket for the presence channel (while keeping SSE for the data stream, or consolidating both into the WebSocket).

```
Client A                    Backend (FastAPI WS)              Client B
   |                              |                              |
   |-- cursor: {x, y, panel} --> |-- broadcast to others -----> |
   |                              |                              |
   |<-- cursor: {x, y, panel} --|<-- cursor: {x, y, panel} --- |
   |                              |                              |
   |-- action: "snap" ---------> |-- broadcast "User A snapped" |
   |                              |                              |
```

### Implementation Sketch

```python
# Backend: WebSocket presence hub
@router.websocket("/ws/presence")
async def presence_ws(ws: WebSocket):
    await ws.accept()
    user_id = str(uuid4())[:8]
    _presence_clients[user_id] = ws
    try:
        while True:
            data = await ws.receive_json()
            # Broadcast cursor position to all other clients
            for uid, client in _presence_clients.items():
                if uid != user_id:
                    await client.send_json({
                        "type": "cursor",
                        "user_id": user_id,
                        "x": data["x"], "y": data["y"],
                        "panel": data.get("panel"),
                    })
    finally:
        del _presence_clients[user_id]
```

```typescript
// Frontend: Render other users' cursors
function CollaborativeCursors() {
  const { cursors } = usePresenceWebSocket();
  return (
    <>
      {Object.entries(cursors).map(([userId, pos]) => (
        <div
          key={userId}
          className="fixed pointer-events-none z-50"
          style={{ left: pos.x, top: pos.y, transition: 'all 50ms linear' }}
        >
          <CursorIcon color={userColor(userId)} />
          <span className="text-xs bg-gray-800 text-white px-1 rounded">
            {userId}
          </span>
        </div>
      ))}
    </>
  );
}
```

### Libraries
- FastAPI native WebSocket support (Starlette)
- `react-use-websocket` (React hook for WebSocket management)
- Alternative: `Liveblocks` (hosted presence service, zero backend code) or `PartyKit` (edge-deployed WebSocket rooms)

### Demo Impact
- If multiple judges or teammates open the dashboard, they see each other
- "User A triggered SNAP" attribution makes the system feel collaborative and alive
- Cursor presence is an immediate "wow" feature that most dashboards lack

---

## Innovation 7: Real-Time Event Burst Particle Visualization

**Rank: #7 -- Visual Spectacle**

### What it does
When events arrive via SSE, render them as animated particles that fly from their source (sector position on a map or chart) to the event log. Different event types have different particle colors and trajectories. During a snap, the particle system goes into overdrive with an explosion of red particles.

### Architecture Pattern

```
SSE event arrives
    |
    v
Particle spawner creates a particle:
  - Color based on event_type (green=production, orange=consumption, red=snap)
  - Origin position: the sector's position on the dashboard
  - Target position: the event log panel
  - Flight path: bezier curve with slight randomization
  - Lifetime: 800ms
    |
    v
Canvas/WebGL renderer draws particles at 60fps
    |
    v
On arrival at target, event row highlights briefly
```

### Implementation Sketch

```typescript
function EventParticles({ events }: { events: SimEvent[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    // Spawn particle for each new event
    const latest = events[events.length - 1];
    if (!latest) return;
    particles.current.push({
      x: sectorOrigin(latest.sector_id).x,
      y: sectorOrigin(latest.sector_id).y,
      targetX: eventLogPosition.x,
      targetY: eventLogPosition.y,
      color: eventColor(latest.event_type),
      progress: 0,
      size: latest.event_type === 'snap' ? 6 : 3,
    });
  }, [events.length]);

  // 60fps render loop
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    let raf: number;
    function draw() {
      ctx?.clearRect(0, 0, width, height);
      for (const p of particles.current) {
        p.progress += 0.02;
        const pos = bezierInterpolate(p, p.progress);
        ctx?.beginPath();
        ctx?.arc(pos.x, pos.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = p.color;
        ctx?.fill();
      }
      particles.current = particles.current.filter(p => p.progress < 1);
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-30" />;
}
```

### Libraries
- HTML5 Canvas API (zero dependencies, maximum performance)
- Alternative: `tsparticles` or `@react-three/fiber` for more complex particle systems

### Demo Impact
- The dashboard becomes visually alive with data flowing as particles
- Normal operation shows a gentle stream of green/orange particles
- Snap events trigger an explosion of red particles -- immediately eye-catching
- Combines beautifully with the event log (Innovation 3) as particles "land" in the log

---

## Recommendations: Top 3

### 1. SSE Event Stream (Innovation 1) -- MUST HAVE

This is the foundational change that enables everything else. It replaces 4+ polling intervals with a single persistent connection, drops perceived latency from seconds to milliseconds, and provides the event delivery mechanism for all other innovations. Implementation effort is moderate (1-2 days) with `sse-starlette` and native `EventSource`.

**Why it wins**: Maximum architectural improvement, minimum complexity. The backend already generates events in the feed-service; we just need to pipe them through SSE instead of having the frontend poll for the result.

### 2. Cascading Snap Broadcast (Innovation 2) -- HIGH IMPACT

This is the showstopper moment in any demo. The snap is already the most dramatic feature in the system. Making it broadcast to all clients and cascade sector-by-sector with staggered animations transforms a button click into a cinematic event. Builds directly on the SSE infrastructure from Innovation 1.

**Why it wins**: Highest demo impact per line of code. Judges remember moments, and a cascading snap that everyone in the room sees simultaneously is unforgettable.

### 3. Living System Vitals (Innovation 5) -- CREDIBILITY MULTIPLIER

The vitals panel is cheap to build (pure React + CSS, no new dependencies) but immediately communicates "this system is real and alive." The heartbeat animation, latency counter, and event throughput display prove the real-time architecture is genuine, not a demo trick. It runs along the bottom of the screen and is always visible.

**Why it wins**: Highest signal-to-effort ratio. Takes 2-4 hours to implement but permanently elevates the perceived quality of the entire dashboard.

---

## Honorable Mentions for Later Phases

- **Causal Event Chain DAG (Innovation 4)**: Technically the most impressive but requires backend event model changes (adding `caused_by` fields). Best saved for a v2 iteration.
- **Collaborative Presence (Innovation 6)**: Amazing wow factor but adds WebSocket complexity on top of SSE. Consider if the demo involves multiple simultaneous users.
- **Event Burst Particles (Innovation 7)**: Pure visual spectacle. Could be a quick win with Canvas API if time permits after the top 3 are solid.

---

## Implementation Priority Order

| Priority | Innovation | Effort | Dependencies |
|----------|-----------|--------|-------------|
| P0 | SSE Event Stream | 1-2 days | `sse-starlette` package |
| P1 | Cascading Snap Broadcast | 0.5-1 day | SSE Stream (P0), `framer-motion` |
| P1 | Living System Vitals | 2-4 hours | SSE Stream (P0) |
| P2 | Live Event Log | 0.5-1 day | SSE Stream (P0), `@tanstack/react-virtual` |
| P2 | Causal Event DAG | 2-3 days | Backend event model changes, `@xyflow/react` |
| P3 | Collaborative Presence | 1-2 days | WebSocket endpoint, `react-use-websocket` |
| P3 | Event Burst Particles | 0.5 day | SSE Stream (P0), Canvas API |
