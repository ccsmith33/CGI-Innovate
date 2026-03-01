# S12: Migrate JARVIS Voice Chat from OpenAI to Anthropic Haiku

**Type**: migrate
**Priority**: High (performance improvement)
**Effort**: 2-4h
**Files**:
- `src/backend/app/routers/jarvis_chat.py`
- `src/backend/tests/test_jarvis_chat.py`

---

## Context

The JARVIS chat endpoint currently uses OpenAI `gpt-4o-mini` with OpenAI's function-calling format. Claude Haiku 4.5 is faster (0.49s TTFT vs 0.56s, 111 t/s vs ~90 t/s) and produces better conversational quality for JARVIS-style tactical briefings. Migrating eliminates the OpenAI dependency entirely.

The existing `/chat` (non-streaming) and `/chat-stream` (SSE streaming, added in S9) both need to be migrated. The frontend (`jarvis-voice.tsx`) does NOT need changes — it just calls the same endpoints.

**IMPORTANT**: `jarvis_llm.py` (intel extraction) also uses OpenAI gpt-4o-mini. Do NOT touch it in this story — it has a separate purpose and will be handled separately if needed.

---

## Anthropic Tool Use API vs OpenAI

The tool definitions and response handling are different between the two SDKs.

### Tool Definitions

**OpenAI format (current):**
```python
{
    "type": "function",
    "function": {
        "name": "get_all_forecasts",
        "description": "...",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": []
        }
    }
}
```

**Anthropic format (target):**
```python
{
    "name": "get_all_forecasts",
    "description": "...",
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": []
    }
}
```

Convert all 7 tool definitions to Anthropic format.

### Tool Call Response Handling

**OpenAI (current):**
```python
choice = response.choices[0]
if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
    for tool_call in choice.message.tool_calls:
        fn_name = tool_call.function.name
        fn_args = json.loads(tool_call.function.arguments)
        # ... call handler ...
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": result_str
        })
```

**Anthropic (target):**
```python
# response.stop_reason == "tool_use"
# response.content is a list of blocks
tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
if response.stop_reason == "tool_use" and tool_use_blocks:
    # Add assistant message with ALL content blocks
    messages.append({"role": "assistant", "content": response.content})
    # Add tool results as a single user message with list of tool_result blocks
    tool_results = []
    for block in tool_use_blocks:
        fn_name = block.name
        fn_args = block.input  # already a dict, not JSON string
        handler = FUNCTION_DISPATCH.get(fn_name)
        result_str = await handler(db, fn_args) if handler else json.dumps({"error": f"Unknown function: {fn_name}"})
        function_calls_made.append(fn_name)
        tool_results.append({
            "type": "tool_result",
            "tool_use_id": block.id,
            "content": result_str
        })
    messages.append({"role": "user", "content": tool_results})
```

### Final Response (non-tool)

**OpenAI:**
```python
reply = choice.message.content or ""
```

**Anthropic:**
```python
# response.stop_reason == "end_turn"
text_blocks = [b for b in response.content if b.type == "text"]
reply = text_blocks[0].text if text_blocks else ""
```

### Streaming (for /chat-stream)

**OpenAI streaming (current S9):**
```python
stream = await client.chat.completions.create(..., stream=True)
async for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        text = chunk.choices[0].delta.content
        yield f'data: {json.dumps({"type": "chunk", "text": text})}\n\n'
```

**Anthropic streaming (target):**
```python
async with client.messages.stream(
    model="claude-haiku-4-5-20251001",
    max_tokens=1024,
    system=JARVIS_SYSTEM_PROMPT,
    messages=messages,
    tools=ANTHROPIC_TOOL_DEFINITIONS,
) as stream:
    async for text in stream.text_stream:
        yield f'data: {json.dumps({"type": "chunk", "text": text})}\n\n'
```

Note: Anthropic's `stream.text_stream` only yields text content (not tool call JSON), so it naturally skips tool use blocks during streaming. This is exactly what we want for the voice TTS use case.

---

## Acceptance Criteria

### AC1: Tool definitions converted
Replace `TOOL_DEFINITIONS` (OpenAI format) with `ANTHROPIC_TOOL_DEFINITIONS` using Anthropic's `input_schema` format. All 7 tools must be converted:
- `get_all_forecasts`
- `get_resource_summary`
- `get_anomalies`
- `get_intel_reports`
- `get_redaction_log`
- `get_forecast_comparison`
- `get_resource_history`

### AC2: Client swapped
- Remove `from openai import AsyncOpenAI`
- Add `from anthropic import AsyncAnthropic`
- All client instances use `AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)`
- Model string: `"claude-haiku-4-5-20251001"`

### AC3: `/chat` endpoint migrated
- Tool-calling loop uses Anthropic response format (`stop_reason == "tool_use"`, `block.type == "tool_use"`, `block.input`)
- Tool results added as `{"role": "user", "content": [{"type": "tool_result", ...}]}`
- Final response extracted from text blocks
- `max_tokens=1024` (Anthropic requires explicit max_tokens)
- System prompt passed as `system=` parameter (not in messages list)

### AC4: `/chat-stream` endpoint migrated
- Tool-calling rounds: same Anthropic non-streaming pattern as AC3
- Final response: use `client.messages.stream(...)` with `async for text in stream.text_stream:`
- SSE format unchanged: `data: {"type": "chunk", "text": "..."}\n\n` and `data: {"type": "done"}\n\n`

### AC5: Offline guard updated
Both endpoints check `settings.ANTHROPIC_API_KEY` (not `OPENAI_API_KEY`).

### AC6: Tests updated
In `test_jarvis_chat.py`:
- Replace all `openai.AsyncOpenAI` mocks with `anthropic.AsyncAnthropic` mocks
- Update response object shapes to match Anthropic API:
  - `response.stop_reason` instead of `choice.finish_reason`
  - `response.content` list with typed blocks instead of `choice.message`
  - Tool blocks: `block.type == "tool_use"`, `block.name`, `block.input`, `block.id`
  - Text blocks: `block.type == "text"`, `block.text`
- Streaming tests: mock `client.messages.stream()` as async context manager with `text_stream` async iterable
- All existing test scenarios must still be covered (simple response, tool calls, streaming, offline)

### AC7: All tests pass
`cd src/backend && python -m pytest tests/test_jarvis_chat.py -v` — all tests pass.

---

## Dev Notes

- `ANTHROPIC_API_KEY` is already declared in `src/backend/app/config.py` (used by jarvis_agent.py)
- `anthropic` package is already in `requirements.txt`
- The `FUNCTION_DISPATCH` dict and all tool implementation functions are unchanged — they take `(db, args)` and return JSON strings
- Key difference: Anthropic's `block.input` is already a Python dict (no `json.loads()` needed)
- Key difference: Anthropic messages list uses `{"role": "assistant", "content": response.content}` — passing the raw content blocks list
- The system prompt moves from the messages list to the `system=` parameter in the API call
- `max_tokens` is required for Anthropic (unlike OpenAI where it's optional)
- Do NOT touch `jarvis_llm.py` or any other file outside `jarvis_chat.py` and `test_jarvis_chat.py`
