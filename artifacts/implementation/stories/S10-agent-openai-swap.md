# S10: Switch Autonomous Agent from Anthropic to OpenAI

**Type**: maintain
**Priority**: High (agent is completely offline — no Anthropic key configured)
**Effort**: 1-2h
**Files**: `src/backend/app/services/jarvis_agent.py`, `src/backend/tests/test_jarvis_agent.py`

---

## Context

The autonomous JARVIS planning agent (`jarvis_agent.py`) currently uses Anthropic `claude-haiku-4-5-20251001` via the Anthropic SDK. No `ANTHROPIC_API_KEY` is configured, so every agent cycle returns immediately with "Agent offline — no API key configured". The agent feed panel on the dashboard is permanently empty.

The project already has the OpenAI SDK installed and configured (`OPENAI_API_KEY` is set — verified by the working `/api/v1/jarvis/chat` endpoint). Switch the agent to use `gpt-4.1-nano` via the OpenAI SDK.

Research confirms `gpt-4.1-nano` (0.37s TTFT, 132 t/s) is faster than Claude Haiku 4.5 (0.49s TTFT, 111 t/s) and uses the already-installed SDK.

---

## Acceptance Criteria

### AC1: Agent uses OpenAI SDK
In `jarvis_agent.py`, replace the Anthropic import and client with OpenAI:

**Remove:**
```python
from anthropic import AsyncAnthropic
# ...
client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
async with client.messages.stream(
    model="claude-haiku-4-5-20251001",
    max_tokens=800,
    system=AGENT_SYSTEM_PROMPT,
    messages=[{"role": "user", "content": json.dumps(observation)}],
) as stream:
    async for text in stream.text_stream:
        full_response += text
        await broadcast(...)
```

**Replace with:**
```python
from openai import AsyncOpenAI
# ...
client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
stream = await client.chat.completions.create(
    model="gpt-4.1-nano",
    max_tokens=800,
    messages=[
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(observation)},
    ],
    response_format={"type": "json_object"},
    stream=True,
)
async for chunk in stream:
    text = chunk.choices[0].delta.content or "" if chunk.choices else ""
    if text:
        full_response += text
        await broadcast("agent_thinking", {
            "phase": "reasoning",
            "partial": text,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
```

### AC2: API key guard updated
Change the key check from `ANTHROPIC_API_KEY` to `OPENAI_API_KEY`:

```python
if not settings.OPENAI_API_KEY:
    logger.warning("Agent cycle skipped: no OPENAI_API_KEY")
    await broadcast("agent_decision", {
        "situation": "Agent offline — no API key configured",
        ...
    })
    return
```

### AC3: Settings verified
Check `src/backend/app/config.py` — confirm `OPENAI_API_KEY` is already declared (it is, since `/jarvis/chat` uses it). No changes to config needed unless `OPENAI_API_KEY` is missing from `Settings`.

### AC4: Tests updated
In `test_jarvis_agent.py`, update any mocks that patch `anthropic.AsyncAnthropic` to patch `openai.AsyncOpenAI` instead. The streaming mock needs to match the OpenAI streaming response shape:
- `chunk.choices[0].delta.content` (not `stream.text_stream`)
- Test that `run_agent_cycle` still broadcasts `agent_thinking` and `agent_decision` events

### AC5: Tests pass
All tests in `test_jarvis_agent.py` must pass with the new implementation.

---

## Dev Notes

- File: `src/backend/app/services/jarvis_agent.py`
- Tests: `src/backend/tests/test_jarvis_agent.py`
- The OpenAI SDK is already installed in `requirements.txt` — no new dependencies needed
- `response_format={"type": "json_object"}` ensures the model always returns valid JSON, which is required since the agent response is `json.loads()`'d
- The `AGENT_SYSTEM_PROMPT` does not need to change — it already specifies JSON-only output
- OpenAI streaming `AsyncStream` is iterated with `async for chunk in stream`, where each chunk is a `ChatCompletionChunk`
- Do NOT use `gpt-4o-mini` — use `gpt-4.1-nano` specifically (faster TTFT and throughput per research)
- Do NOT change the broadcast event structure, agent loop timing, or `_execute_actions` logic
