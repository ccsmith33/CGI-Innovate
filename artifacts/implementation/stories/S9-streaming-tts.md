# S9: Sentence-by-Sentence Streaming TTS for JARVIS Voice

**Type**: feature
**Priority**: High
**Effort**: 4-6h
**Files**:
- `src/backend/app/routers/jarvis_chat.py`
- `src/frontend/components/voice/jarvis-voice.tsx`
- `src/backend/tests/test_jarvis_chat.py`
- `src/frontend/__tests__/jarvis-voice.test.tsx`

---

## Context

Currently the voice pipeline is fully sequential and slow:
1. STT finishes → transcript sent to `/api/v1/jarvis/chat`
2. Backend does tool calls + full LLM response (~1-3s)
3. Full text received → ElevenLabs TTS called with entire text (~300-600ms)
4. Audio starts playing

Total user-perceived latency: **2-4 seconds** from end of speech.

The fix: stream the LLM's final response to the frontend in real time. As soon as each sentence completes in the stream, fire a TTS call for that sentence only. First audio plays within ~400ms of JARVIS generating the first sentence — while JARVIS is still generating the rest.

Most interactions will be "Jarvis, status" or single-sentence commands that produce 1-3 sentence responses. Sentence streaming ensures the first sentence plays as fast as possible.

---

## Architecture

### Backend: Streaming Chat Endpoint

Add `POST /api/v1/jarvis/chat-stream` to `jarvis_chat.py`. This endpoint:

1. Runs the same tool-calling loop as `/chat` (non-streaming — tool calls must complete before final answer)
2. For the final LLM response generation, uses `stream=True`
3. Streams text chunks back as SSE (`text/event-stream`)

Event format:
```
data: {"type": "chunk", "text": "...text fragment..."}\n\n
data: {"type": "done"}\n\n
```

### Frontend: Sentence Streaming Consumer

In `jarvis-voice.tsx`, replace the `processTranscript` function:
1. POST to `/api/v1/jarvis/chat-stream` using `fetch()` + `ReadableStream` (NOT EventSource — EventSource is GET-only)
2. Buffer streaming text, detect sentence boundaries
3. When a sentence completes, add to TTS queue
4. Process TTS queue sequentially (one ElevenLabs call per sentence)
5. On `{"type": "done"}`, flush any remaining buffer text to TTS queue
6. State machine: PROCESSING → SPEAKING (when first sentence starts) → IDLE (when TTS queue empty)

---

## Acceptance Criteria

### AC1: Backend streaming endpoint

Add to `jarvis_chat.py`:

```python
from fastapi.responses import StreamingResponse

@router.post("/chat-stream")
async def jarvis_chat_stream(body: JarvisChatRequest, db: AsyncSession = Depends(get_db)):
    if not settings.OPENAI_API_KEY:
        async def offline():
            yield f'data: {json.dumps({"type": "chunk", "text": "JARVIS is offline. API key not configured."})}\n\n'
            yield f'data: {json.dumps({"type": "done"})}\n\n'
        return StreamingResponse(offline(), media_type="text/event-stream")

    async def generate():
        messages = [{"role": "system", "content": JARVIS_SYSTEM_PROMPT}]
        for msg in body.conversation_history:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": body.message})

        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        # Tool calling rounds (non-streaming)
        for _ in range(5):
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                tools=TOOL_DEFINITIONS,
            )
            choice = response.choices[0]

            if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
                messages.append(choice.message)
                for tool_call in choice.message.tool_calls:
                    fn_name = tool_call.function.name
                    try:
                        fn_args = json.loads(tool_call.function.arguments) if tool_call.function.arguments else {}
                    except json.JSONDecodeError:
                        fn_args = {}
                    handler = FUNCTION_DISPATCH.get(fn_name)
                    result_str = await handler(db, fn_args) if handler else json.dumps({"error": f"Unknown function: {fn_name}"})
                    messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result_str})
            else:
                # Final response — stream it
                stream = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=messages,
                    stream=True,
                )
                async for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta.content:
                        text = chunk.choices[0].delta.content
                        yield f'data: {json.dumps({"type": "chunk", "text": text})}\n\n'
                yield f'data: {json.dumps({"type": "done"})}\n\n'
                return

        # Exhausted loop
        yield f'data: {json.dumps({"type": "chunk", "text": "Could not formulate a response. Please try again."})}\n\n'
        yield f'data: {json.dumps({"type": "done"})}\n\n'

    return StreamingResponse(generate(), media_type="text/event-stream")
```

### AC2: Frontend sentence streaming

Replace `processTranscript` in `jarvis-voice.tsx`:

```typescript
async function processTranscript(text: string) {
  setState('PROCESSING')

  const ttsQueue: string[] = []
  let ttsPlaying = false

  async function processTtsQueue() {
    if (ttsPlaying || ttsQueue.length === 0) return
    ttsPlaying = true
    setState('SPEAKING')
    while (ttsQueue.length > 0) {
      const sentence = ttsQueue.shift()!
      if (sentence.trim()) {
        await speak(sentence)
      }
    }
    ttsPlaying = false
    setState('IDLE')
    setTranscript('')
  }

  function enqueueSentence(sentence: string) {
    if (sentence.trim()) {
      ttsQueue.push(sentence)
      processTtsQueue()
    }
  }

  try {
    const response = await fetch('/api/v1/jarvis/chat-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, conversation_history: [] }),
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

  } catch {
    setError('Failed to get JARVIS response.')
    setState('IDLE')
    setTranscript('')
  }
}
```

### AC3: State transitions correct
- IDLE → LISTENING (mic click)
- LISTENING → PROCESSING (recognition ends)
- PROCESSING → SPEAKING (first sentence enqueued and TTS starts)
- SPEAKING → IDLE (TTS queue drained)
- Error path → IDLE immediately

### AC4: API route proxied
The frontend calls `/api/v1/jarvis/chat-stream` as a relative URL. Verify `next.config.js` (or equivalent) proxies `/api/**` to the backend. If not, use the full backend URL from env var `NEXT_PUBLIC_BACKEND_URL` or the existing pattern used by `src/frontend/lib/api.ts`.

Check `src/frontend/lib/api.ts` for the `API_BASE` constant and use the same base URL for the streaming fetch call.

### AC5: Backend tests
In `test_jarvis_chat.py`, add tests for the new `/chat-stream` endpoint:
- Test that streaming returns `text/event-stream` content type
- Test that `{"type": "done"}` event is always sent
- Test offline case (no API key) returns the offline chunk + done
- Mock OpenAI client using `unittest.mock.AsyncMock` / `MagicMock` for the async stream

### AC6: Frontend tests
In `__tests__/jarvis-voice.test.tsx`, update or add tests:
- Test that `processTranscript` calls `/api/v1/jarvis/chat-stream` (not the old endpoint)
- Test that the state transitions correctly (PROCESSING → SPEAKING → IDLE)
- Mock `fetch` to return a streaming response with test chunks

---

## Dev Notes

- The frontend `fetch` streaming approach (not EventSource) is required because EventSource only supports GET requests. Use `response.body.getReader()` with the WHATWG Streams API.
- IMPORTANT: The TTS queue must process sequentially. Do not call `speak()` concurrently — sentences must play in order.
- The `SENTENCE_END` regex `/[.!?][\s"')\]]*(?:\s|$)/` handles: `"end."`, `"end! "`, `"end?"`, etc. Adjust if needed but do not over-engineer.
- The waiting loop at the end (`while (ttsPlaying || ttsQueue.length > 0)`) is a pragmatic approach to keep the async function alive while audio plays. It's acceptable here.
- Do NOT remove the existing `/api/v1/jarvis/chat` endpoint — it may be used by other components.
- Check `src/frontend/lib/api.ts` for the `API_BASE` URL pattern. The streaming fetch should use the same base.
- The `speak()` function in `jarvis-voice.tsx` already handles both ElevenLabs and browser TTS fallback — reuse it unchanged.
