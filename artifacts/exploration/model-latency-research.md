# Model Latency Research: Claude Haiku 4.5 vs Fastest OpenAI Models

**Date**: 2026-02-28
**Context**: JARVIS voice interface pipeline (STT -> LLM -> TTS via ElevenLabs)
**Goal**: Determine if switching from Anthropic Claude Haiku to an OpenAI model would meaningfully reduce LLM latency for short conversational responses (50-200 tokens output).

---

## 1. Current Architecture

The codebase uses **two LLM integrations**:

| Component | File | SDK | Model | Purpose |
|-----------|------|-----|-------|---------|
| JARVIS Agent (autonomous loop) | `src/backend/app/services/jarvis_agent.py` | Anthropic (`AsyncAnthropic`) | `claude-haiku-4-5-20251001` | Streaming reasoning via SSE |
| JARVIS Chat (tool-calling) | `src/backend/app/routers/jarvis_chat.py` | OpenAI (`AsyncOpenAI`) | `gpt-4o-mini` | Chat with function calling |
| Intel Extraction | `src/backend/app/services/jarvis_llm.py` | OpenAI (`AsyncOpenAI`) | `gpt-4o-mini` | Structured JSON extraction |

The project already uses **both** SDKs. No SDK migration required for either direction.

---

## 2. Candidate Models Compared

### 2a. Head-to-Head Latency (Artificial Analysis benchmarks, Feb 2026)

| Metric | Claude Haiku 4.5 | GPT-5.2 Instant | GPT-4o mini | GPT-4.1 nano | Gemini 2.5 Flash Lite |
|--------|-------------------|------------------|-------------|--------------|----------------------|
| **TTFT** | 0.49s | 0.55s | 0.56s | 0.37s | 0.25s |
| **Output Speed** | 111 t/s | 76 t/s | ~90 t/s (est.) | 132 t/s | 360 t/s |
| **Input $/1M** | $1.00 | $1.75 | $0.15 | $0.10 | $0.10 |
| **Output $/1M** | $5.00 | $14.00 | $0.60 | $0.40 | $0.40 |

Sources: Artificial Analysis (artificialanalysis.ai), OpenAI API pricing page, Anthropic pricing page, Google AI pricing.

### 2b. Does "GPT-5.2 Instant" Exist?

**Yes.** GPT-5.2 was released December 11, 2025 with three modes:
- **GPT-5.2 Instant** (`gpt-5.2-chat-latest`): Fast, non-reasoning workhorse
- **GPT-5.2 Thinking** (`gpt-5.2`): Deeper reasoning
- **GPT-5.2 Pro** (`gpt-5.2-pro`): Highest quality, highest cost

---

## 3. Analysis for Voice Pipeline

### 3a. Latency Budget

Human conversational response requires 300-500ms total. The voice pipeline breaks down as:

| Stage | Typical Latency | % of Total |
|-------|----------------|------------|
| ASR/STT | 50-100ms | ~10% |
| **LLM (TTFT + generation)** | **350-700ms** | **~70%** |
| TTS (ElevenLabs) | 75-200ms | ~20% |

For a 100-token response at streaming, the user-perceived latency is dominated by **TTFT** (time until speech begins) because TTS can start as soon as the first sentence arrives.

### 3b. TTFT Ranking (lower is better)

1. **Gemini 2.5 Flash Lite**: 0.25s (winner by a wide margin)
2. **GPT-4.1 nano**: 0.37s
3. **Claude Haiku 4.5**: 0.49s (current)
4. **GPT-5.2 Instant**: 0.55s
5. **GPT-4o mini**: 0.56s

### 3c. Output Speed Ranking (higher is better)

1. **Gemini 2.5 Flash Lite**: 360 t/s
2. **GPT-4.1 nano**: 132 t/s
3. **Claude Haiku 4.5**: 111 t/s (current)
4. **GPT-4o mini**: ~90 t/s
5. **GPT-5.2 Instant**: 76 t/s

### 3d. Time to Generate 100 Tokens (TTFT + generation)

| Model | TTFT | 100 tokens gen | Total |
|-------|------|---------------|-------|
| Gemini 2.5 Flash Lite | 0.25s | 0.28s | **0.53s** |
| GPT-4.1 nano | 0.37s | 0.76s | **1.13s** |
| Claude Haiku 4.5 | 0.49s | 0.90s | **1.39s** |
| GPT-5.2 Instant | 0.55s | 1.32s | **1.87s** |

---

## 4. Integration Complexity

### 4a. Switching Agent from Anthropic to OpenAI

The autonomous agent (`jarvis_agent.py`) uses Anthropic's streaming API:

```python
from anthropic import AsyncAnthropic
client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
async with client.messages.stream(...) as stream:
    async for text in stream.text_stream:
        ...
```

Equivalent OpenAI streaming:

```python
from openai import AsyncOpenAI
client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
stream = await client.chat.completions.create(..., stream=True)
async for chunk in stream:
    text = chunk.choices[0].delta.content or ""
    ...
```

**Migration effort**: Low. The project already has the OpenAI SDK installed and configured. The streaming pattern is similar. Estimated 1-2 hours of work to swap the agent to use OpenAI.

### 4b. Switching to Gemini

Would require adding the `google-genai` or `google-generativeai` SDK. Different streaming API patterns. Estimated 2-4 hours.

### 4c. OpenAI Realtime API (Alternative Architecture)

OpenAI's Realtime API offers native speech-to-speech with sub-300ms latency via WebSocket/WebRTC. This would eliminate the STT+LLM+TTS pipeline entirely. However:
- Completely different architecture (WebSocket-based)
- Replaces ElevenLabs TTS (may lose voice customization)
- Higher complexity to integrate
- Different pricing model

---

## 5. Cost Comparison (1M requests/month, 100 input + 100 output tokens avg)

| Model | Monthly Input Cost | Monthly Output Cost | **Total** |
|-------|-------------------|--------------------|----|
| GPT-4.1 nano | $0.01 | $0.04 | **$0.05** |
| Gemini 2.5 Flash Lite | $0.01 | $0.04 | **$0.05** |
| GPT-4o mini | $0.015 | $0.06 | **$0.075** |
| Claude Haiku 4.5 | $0.10 | $0.50 | **$0.60** |
| GPT-5.2 Instant | $0.175 | $1.40 | **$1.575** |

At typical voice-assistant scale (short prompts, short responses), all options are extremely cheap. Cost is not a differentiator.

---

## 6. Quality Considerations

For short conversational responses (50-200 tokens), quality differences between these models are minimal. However:

- **GPT-4.1 nano** is explicitly designed for "classification, autocompletion, and extraction" -- may produce less natural conversational responses
- **Claude Haiku 4.5** has strong instruction-following and natural conversation quality
- **GPT-5.2 Instant** is the most capable model in this list but is also the slowest
- **Gemini 2.5 Flash Lite** is the fastest but may sacrifice some conversational quality

For a JARVIS-style voice assistant that needs to sound articulate and tactical, model quality matters. GPT-4.1 nano may feel "thin" for this use case despite its speed advantage.

---

## 7. Verdict and Recommendation

> **Decision criterion**: Speed only. Cost is not a factor.

### Do NOT switch to GPT-5.2 Instant

GPT-5.2 Instant is **slower** than Claude Haiku 4.5 on both TTFT (0.55s vs 0.49s) and output speed (76 t/s vs 111 t/s). Switching to it would make latency worse.

### Speed-Only Ranking

| Rank | Model | TTFT | Output Speed | 100-token total | Integration Effort |
|------|-------|------|-------------|-----------------|-------------------|
| 1 | **Gemini 2.5 Flash Lite** | **0.25s** | **360 t/s** | **0.53s** | New SDK (2-4 hrs) |
| 2 | GPT-4.1 nano | 0.37s | 132 t/s | 1.13s | SDK already installed (~1 hr) |
| 3 | Claude Haiku 4.5 (current) | 0.49s | 111 t/s | 1.39s | No change needed |
| 4 | GPT-5.2 Instant | 0.55s | 76 t/s | 1.87s | SDK already installed |

### Final Recommendation

**Switch to Gemini 2.5 Flash Lite for maximum speed.** It cuts LLM latency from ~1.4s to ~0.5s for a 100-token response -- a 62% reduction. This is the single largest speed gain available.

**Fallback option**: GPT-4.1 nano is the fastest model within the already-installed OpenAI SDK. It gives a ~19% reduction in total LLM time vs Haiku with minimal integration work.

**Do NOT switch to GPT-5.2 Instant.** It is slower than the current setup on every metric.

### Additional speed optimizations (architectural):
- Stream LLM output sentence-by-sentence to ElevenLabs TTS (don't wait for full response)
- Use prompt caching for the system prompt (potential TTFT improvement)
- Consider OpenAI Realtime API to eliminate the STT+LLM+TTS pipeline entirely (sub-300ms but major architectural change)

---

## Sources

- [Artificial Analysis - Claude Haiku 4.5](https://artificialanalysis.ai/models/claude-4-5-haiku)
- [Artificial Analysis - GPT-5.2 Non-reasoning](https://artificialanalysis.ai/models/gpt-5-2-non-reasoning)
- [Artificial Analysis - GPT-4.1 nano](https://artificialanalysis.ai/models/gpt-4-1-nano)
- [Artificial Analysis - GPT-4o mini](https://artificialanalysis.ai/models/gpt-4o-mini)
- [Artificial Analysis - Gemini 2.5 Flash Lite](https://artificialanalysis.ai/models/gemini-2-5-flash-lite)
- [OpenAI - Introducing GPT-5.2](https://openai.com/index/introducing-gpt-5-2/)
- [OpenAI - API Pricing](https://openai.com/api/pricing/)
- [Anthropic - Claude Haiku 4.5](https://www.anthropic.com/claude/haiku)
- [Anthropic - Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [OpenAI - GPT-4o Realtime](https://platform.openai.com/docs/guides/realtime)
- [Voice AI Latency Guide](https://hamming.ai/resources/voice-ai-latency-whats-fast-whats-slow-how-to-fix-it)
- [LLM Latency Benchmark 2026](https://research.aimultiple.com/llm-latency-benchmark/)
