# S13: Simulation Bug Fixes — Docker Networking + usage_rate_hourly + snap_event_detected

**Type**: bug-fix
**Priority**: CRITICAL (graph shows nothing; all rates wrong)
**Effort**: 2-3h
**Files**:
- `docker-compose.yml`
- `src/backend/app/resource_config.py`
- `src/backend/app/routers/feed.py`
- `src/backend/tests/test_feed.py` (if it exists) or create it

---

## Bug 1: BACKEND_URL — Feed service cannot reach backend in Docker (CRITICAL)

**Root cause**: `generator.py` defaults to `BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")`. In Docker containers, `localhost` refers to the container itself, not other services. The backend service is reachable at `http://backend:8000` (Docker Compose service hostname). This causes every `push_events()` call to fail with "All connection attempts failed", meaning zero stock data ever reaches the database.

**Fix**: Add `BACKEND_URL` environment variable to the `feed` service in `docker-compose.yml`:

```yaml
  feed:
    build:
      context: ./src/feed-service
      dockerfile: Dockerfile
    ports:
      - "8001:8001"
    environment:
      - BACKEND_URL=http://backend:8000
    healthcheck:
      ...
```

Do NOT add `depends_on: backend` — that would create a circular dependency (backend already depends_on feed).

---

## Bug 2: usage_rate_hourly hardcoded to 7.0 for all resources (HIGH)

**Root cause**: `feed.py:76` has `usage_rate_hourly=7.0` regardless of which resource or sector is being processed. This makes the time-to-zero calculation wrong for all resources (only Medical Kits is close to correct at 7.5/cycle).

**Fix step A**: Add `BASE_DRAIN_RATES` to `src/backend/app/resource_config.py`. These match the values in the feed service `generator.py` exactly:

```python
# Drain rate per 10-second cycle, matching feed-service generator.py BASE_DRAIN_RATES
BASE_DRAIN_RATES: dict[str, float] = {
    "Medical Kits": 7.5,
    "Clean Water (L)": 9.5,
    "Vibranium (kg)": 2.2,
    "Pym Particles": 4.2,
    "Arc Reactor Cores": 3.2,
}
CYCLES_PER_HOUR: float = 360.0  # one cycle every 10 seconds = 360/hour
```

**Fix step B**: In `src/backend/app/routers/feed.py`, import `BASE_DRAIN_RATES` and `CYCLES_PER_HOUR` and compute the correct hourly drain rate:

```python
from app.resource_config import BASE_DRAIN_RATES, CYCLES_PER_HOUR

# Inside the feed_push() loop, replace:
#   usage_rate_hourly=7.0,
# with:
drain_per_cycle = BASE_DRAIN_RATES.get(resource_type, 1.0)
usage_rate_hourly = round(drain_per_cycle * CYCLES_PER_HOUR, 2)
```

Correct computed values:
- Medical Kits: 7.5 × 360 = **2700.0 u/hr**
- Clean Water: 9.5 × 360 = **3420.0 u/hr**
- Vibranium: 2.2 × 360 = **792.0 u/hr**
- Pym Particles: 4.2 × 360 = **1512.0 u/hr**
- Arc Reactor Cores: 3.2 × 360 = **1152.0 u/hr**

---

## Bug 3: snap_event_detected always False (MEDIUM)

**Root cause**: `feed.py:77` hardcodes `snap_event_detected=False`. Snaps are never recorded in ResourceLog, so forecast strategies can't detect snap patterns.

**Fix**: Detect snap events from the pushed event data. When a snap occurs, the feed service generates events with a dramatic stock drop. The simplest detection: check if any event in the batch has `event_type == "snap"` OR if the `delta` for a `consumption` event is dramatically large (> 100 units, indicating a snap halving).

Actually, the cleanest approach: look for the event label. Snap events in the feed service use `label = "Snap event"` (or similar). Check the generator.py to confirm. Alternatively, detect by `delta` magnitude.

**Best approach**: In `generator.py` (feed service), the snap handling directly calls `state.set_stock(sector_id, resource_type, level / 2.0)` without generating events. So snap events don't appear in the push payload at all currently.

Instead: detect snap from the `event_type`. When the governor triggers a snap via `POST /governor/snap`, it broadcasts a `snap_alert` SSE event. Add a module-level `_snap_cycle_active` flag to the backend that the snap endpoint sets to True and the feed push endpoint reads (then resets).

**Simpler implementation**:
1. In `src/backend/app/routers/governor.py`, after broadcasting `snap_alert`, set a module-level flag: `_snap_active = True`
2. In `src/backend/app/routers/feed.py`, import and check this flag: `from app.routers.governor import _snap_active` — if True, set `snap_event_detected=True` for all events in this batch, then reset the flag

But cross-module mutable state is fragile. **Even simpler**: add `"is_snap": True` to the snap broadcast payload and have the feed.py check the most recent SSE events.

**Pragmatic fix for now**: In `feed.py`, detect snaps by checking if `stock_after` is approximately half of the previous stock level AND the drop is large (> 50 units). This is heuristic but reliable for the demo.

**Actually, the simplest correct fix**: Have the governor's snap endpoint set a short-lived flag in a shared `app_state` module, and have `feed.py` read it. Implement as follows:

Create `src/backend/app/app_state.py`:
```python
"""Shared mutable application state."""
snap_cycle_active: bool = False
```

In `src/backend/app/routers/governor.py`, after snap is triggered:
```python
from app import app_state
app_state.snap_cycle_active = True
```

In `src/backend/app/routers/feed.py`, in `feed_push()`:
```python
from app import app_state
is_snap = app_state.snap_cycle_active
if is_snap:
    app_state.snap_cycle_active = False  # consume the flag
# Then use: snap_event_detected=is_snap
```

---

## Acceptance Criteria

### AC1: Docker — feed service pushes successfully
After adding `BACKEND_URL=http://backend:8000` to `docker-compose.yml`, rebuild and confirm:
- No more "Push to backend failed" in feed logs
- ResourceLog table contains rows
- Dashboard graph shows live data

### AC2: usage_rate_hourly correct per resource
After fix, `ResourceLog.usage_rate_hourly` should be:
- Medical Kits: 2700.0
- Clean Water: 3420.0
- Vibranium: 792.0
- Pym Particles: 1512.0
- Arc Reactor Cores: 1152.0

### AC3: snap_event_detected set on snap cycles
When snap is triggered, ResourceLog rows created in the next push batch have `snap_event_detected=True`.

### AC4: Tests pass
- If `test_feed.py` exists, update it to verify correct `usage_rate_hourly` values and `snap_event_detected` logic
- If it doesn't exist, create basic tests covering: correct hourly rate per resource, snap flag propagation

### AC5: No regressions
- `python -m pytest tests/ -v` in backend must pass
- No new TypeScript errors in frontend

---

## Dev Notes

- `resource_config.py` is already imported in several places — adding constants there is safe
- The `docker-compose.yml` change is the #1 priority — without it, nothing works in production
- Read `governor.py` to find the snap endpoint before implementing Bug 3 fix
- Do NOT modify `feed_ingester.py` — it's dead code and not in the data path
- Do NOT modify the feed service (`generator.py`, `state.py`) — changes must be backend-only to minimize blast radius
