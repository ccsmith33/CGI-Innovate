"""SSE streaming endpoint for real-time event updates to frontend clients."""

import asyncio

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.services.event_bus import subscribe, unsubscribe

router = APIRouter()


@router.get("/stream")
async def event_stream(request: Request):
    q = await subscribe()

    async def generator():
        try:
            # Send initial heartbeat
            yield {"event": "heartbeat", "data": "connected"}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield {"data": payload}
                except asyncio.TimeoutError:
                    yield {"event": "heartbeat", "data": "ping"}
        finally:
            await unsubscribe(q)

    return EventSourceResponse(generator())
