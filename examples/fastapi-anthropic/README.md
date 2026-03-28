# FastAPI + Anthropic Example

Minimal server showing `agent-stream` with FastAPI and the Anthropic Python SDK.

## Setup

```bash
pip install fastapi uvicorn anthropic "agent-stream[fastapi]"
```

## Run

```bash
ANTHROPIC_API_KEY=sk-... uvicorn main:app --reload
```

## Test

```bash
curl -N -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Say hello in 3 words"}'
```

You'll see SSE events stream in your terminal:

```
event: token
data: {"text": "Hello"}

event: token
data: {"text": " world"}

event: done
data: {"message_id": "", "num_turns": 0, "tool_count": 0, "duration_ms": 312, "model": "claude-haiku-4-5-20251001", "total_cost_usd": 0.0}
```

## Key patterns

**Token batching:** `TokenBatcher(interval_ms=50)` accumulates tokens and flushes every 50ms — prevents excessive SSE events and React re-renders.

**Always flush:** After the stream ends, call `batcher.flush()` to emit any buffered tokens before the `done` event.

**`done` carries metadata:** Duration, model, cost — useful for logging and observability.
