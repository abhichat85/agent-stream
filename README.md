# agent-stream

**The SSE event protocol for AI agents.**

[![PyPI version](https://img.shields.io/pypi/v/agent-event-stream.svg)](https://pypi.org/project/agent-event-stream/)
[![npm version](https://img.shields.io/npm/v/@agent-stream/react.svg)](https://www.npmjs.com/package/@agent-stream/react)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/)

---

`token` · `thinking` · `tool_use` · `tool_result` · `turn` · `progress` · `creation` · `done` · `error`

---

You started with token streaming.
Then you needed tool call status. Then thinking blocks. Then progress updates.
Then your event names started diverging from your teammate's. Then your
frontend broke at chunk boundaries. Then you wrote reconnect logic.

We shipped 36 agent tools across thousands of production runs before
extracting this. It's not clever — it's just complete.

---

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Event schema](#event-schema)
- [API reference](#api-reference)
- [Hard-won production details](#hard-won-production-details)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

---

## Install

**Python** — server / emitter:

```bash
pip install agent-event-stream

# With FastAPI helper:
pip install "agent-event-stream[fastapi]"
```

**React** — client hook:

```bash
npm install @agent-stream/react
```

---

## Quick start

### Python emitter

Works with any async source (Anthropic, OpenAI, Gemini, or any generator):

```python
from agent_stream import AgentStreamEmitter, TokenBatcher
from agent_stream.fastapi import agent_stream_response

@app.post("/api/chat")
async def chat(req: ChatRequest):
    async def generate():
        emitter = AgentStreamEmitter()
        batcher = TokenBatcher()            # 50ms batching

        async for chunk in your_llm_stream(req.message):
            if batched := batcher.add(chunk.text):
                yield emitter.token(batched)

        if remaining := batcher.flush():   # always flush at end
            yield emitter.token(remaining)

        yield emitter.done(model="claude-sonnet-4-6")

    return agent_stream_response(generate())
```

### React hook

```tsx
import { useAgentStream } from "@agent-stream/react";

function Chat() {
  const { text, isStreaming, activeTools, startStream, stop } = useAgentStream({
    getToken: () => auth.getToken(),       // plug in your auth
  });

  return (
    <>
      <button onClick={() => startStream("/api/chat", { message: "Hello" })}>
        Send
      </button>
      {isStreaming && <button onClick={stop}>Stop</button>}
      {activeTools.length > 0 && <div>Running: {activeTools.join(", ")}</div>}
      <pre>{text}{isStreaming && "▌"}</pre>
    </>
  );
}
```

---

## Event schema

Full JSON Schema at [`spec/events.schema.json`](spec/events.schema.json).

| Event | Payload fields | When |
|---|---|---|
| `token` | `text` | Incremental text chunk |
| `thinking` | `text` | Chain-of-thought / extended reasoning |
| `tool_use` | `tool_name`, `tool_use_id`, `input_summary`, `status=running` | Tool invocation started |
| `tool_result` | `tool_name`, `tool_use_id`, `output_summary`, `duration_ms`, `status=done\|error` | Tool completed |
| `turn` | `turn_number`, `total_tools` | Agentic turn boundary |
| `progress` | `step`, `percentage`, `message`, `sub_progress?` | Pipeline step (0–100%) |
| `creation` | `creation_type`, `count`, `tool_use_id`, `items?` | Agent created a persistent artifact |
| `error` | `error_type`, `message`, `details?` | Structured error |
| `done` | `message_id`, `num_turns`, `tool_count`, `duration_ms`, `model`, `total_cost_usd` | Always the last event |

Wire format:

```
event: token
data: {"text": "Hello"}

event: done
data: {"message_id": "msg_1", "num_turns": 3, "tool_count": 7, "duration_ms": 4200, "model": "claude-sonnet-4-6", "total_cost_usd": 0.014}

```

---

## API reference

### Python

#### `AgentStreamEmitter`

```python
from agent_stream import AgentStreamEmitter

emitter = AgentStreamEmitter()

emitter.token("Hello")
emitter.thinking("Step 1: consider X")
emitter.tool_use("search", "tu_1", "query=foo")
emitter.tool_result("search", "tu_1", "3 results", duration_ms=120)
emitter.tool_result("search", "tu_1", is_error=True)
emitter.turn(turn_number=2, total_tools=5)
emitter.progress("synthesis", 40, "Extracting insights")
emitter.progress("synthesis", 50, "Processing", sub_progress={"current": 3, "total": 10, "item_title": "Interview 3"})
emitter.creation("insights", count=5, tool_use_id="tu_1")
emitter.error("timeout", "Request timed out", details={"code": 504})
emitter.done(message_id="msg_1", num_turns=3, tool_count=7, duration_ms=4200, model="claude-sonnet-4-6")
```

Each method returns a formatted SSE string ready to `yield` from your async generator.

#### `TokenBatcher`

```python
from agent_stream import TokenBatcher

batcher = TokenBatcher(interval_ms=50)  # default: 50ms

# In your stream loop:
if batched := batcher.add(chunk.text):
    yield emitter.token(batched)

# At end of stream — always flush:
if remaining := batcher.flush():
    yield emitter.token(remaining)

batcher.has_content  # True if buffer has pending tokens
```

#### `agent_stream_response` (FastAPI)

```python
from agent_stream.fastapi import agent_stream_response

return agent_stream_response(generate())
# Sets: Content-Type: text/event-stream, Cache-Control: no-cache, X-Accel-Buffering: no
```

---

### React / TypeScript

#### `useAgentStream(options?)`

```tsx
const {
  text,           // accumulated text from all token events
  isStreaming,    // true while stream is active
  progress,       // last ProgressEvent or null
  activeTools,    // names of currently running tools (cleared when tools complete)
  error,          // last ErrorEvent or null
  isDone,         // true after done event received
  startStream,    // (endpoint, body, callbacks?) => Promise<void>
  stop,           // () => void — aborts in-flight stream
  reset,          // () => void — clears all state
} = useAgentStream({
  getToken: async () => string | null,  // optional Bearer token
  baseUrl: "",                          // optional URL prefix
});
```

#### `AgentStreamClient` (framework-agnostic)

Use this directly if you're not using React:

```typescript
import { AgentStreamClient } from "@agent-stream/react";

const client = new AgentStreamClient({ getToken: () => auth.getToken() });

await client.start("/api/chat", { message }, {
  onToken: (text) => append(text),
  onThinking: (e) => showThinking(e.text),
  onToolUse: (e) => updateToolStatus(e),   // called for both tool_use and tool_result
  onTurn: (e) => markTurn(e.turnNumber),
  onProgress: (e) => setProgress(e.percentage),
  onCreation: (e) => showResultCard(e),
  onError: (e) => showError(e.message),
  onDone: (e) => console.log(`Done in ${e.durationMs}ms, ${e.numTurns} turns`),
});

client.stop(); // abort
```

---

## Hard-won production details

**Token batching prevents UI thrash.** A fast model emits 30–40 text chunks per second. Without batching, React re-renders on every chunk. `TokenBatcher(interval_ms=50)` accumulates tokens and flushes every 50ms — ~20 renders/second instead of 40.

**Cross-chunk event parsing.** SSE `event:` and `data:` lines can arrive in different `fetch` chunks. The client persists `currentEventType` across chunk boundaries. Every hand-rolled SSE parser hits this bug eventually — usually at 2am in production.

**Synthetic `done` event.** If the server drops the connection without emitting `done` (proxy timeout, crash, nginx buffer limit), the client emits a synthetic done so your UI loading state never hangs indefinitely.

**Exponential backoff reconnect.** Network errors trigger automatic reconnect with delays of 1s → 2s → 4s (3 retries). HTTP errors (4xx/5xx) do not retry — they won't self-resolve.

**`activeTools` tracks in-flight tools only.** When a `tool_result` event arrives, the tool name is removed from `activeTools`. The array reflects what's *currently running*, not everything that has run.

---

## Examples

| Example | What it shows |
|---|---|
| [`examples/fastapi-anthropic/`](examples/fastapi-anthropic/) | FastAPI server streaming from Anthropic SDK with token batching |
| [`examples/react-vite/`](examples/react-vite/) | React demo app with stream control, tool status, progress display |

To run both together:

```bash
# Terminal 1 — backend
cd examples/fastapi-anthropic
pip install fastapi uvicorn anthropic "agent-stream[fastapi]"
ANTHROPIC_API_KEY=sk-... uvicorn main:app --reload

# Terminal 2 — frontend
cd examples/react-vite
npm install ../../packages/react   # use local build
npm run dev
```

---

## Contributing

Issues and PRs are welcome.

```bash
# Python tests
cd packages/python && python -m pytest tests/ -v

# React tests + build
cd packages/react && npm test && npm run build
```

Changes to event types require updating [`spec/events.schema.json`](spec/events.schema.json), the Python emitter (`packages/python/agent_stream/emitter.py`), the TypeScript types (`packages/react/src/types.ts`), and the relevant tests.

---

## License

[MIT](LICENSE)
