"""Global async event bus for broadcasting typed SSE events to all connected clients."""

import asyncio
import json
from typing import Any

_queues: list[asyncio.Queue] = []
_lock = asyncio.Lock()


async def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    async with _lock:
        _queues.append(q)
    return q


async def unsubscribe(q: asyncio.Queue) -> None:
    async with _lock:
        try:
            _queues.remove(q)
        except ValueError:
            pass


async def broadcast(event_type: str, data: dict[str, Any]) -> None:
    """Broadcast an event to all connected SSE clients."""
    payload = json.dumps({"type": event_type, "data": data})
    async with _lock:
        dead: list[asyncio.Queue] = []
        for q in _queues:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            _queues.remove(q)
