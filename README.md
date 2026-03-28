# agent-stream

The SSE event protocol for AI agents.

---

`token` · `thinking` · `tool_use` · `tool_result` · `turn` · `progress` · `creation` · `done` · `error`

---

You started with token streaming.
Then you needed tool call status. Then thinking blocks. Then progress.
Then your event names started diverging from your teammate's. Then your
frontend broke at chunk boundaries. Then you wrote reconnect logic.

We shipped 36 agent tools across thousands of production runs before
we extracted this. It's not clever — it's just complete.

---

## Install

**Python** (server / emitter):
```bash
pip install agent-stream
# With FastAPI helper:
pip install "agent-stream[fastapi]"
```

**React** (client hook):
```bash
npm install @agent-stream/react
```

---

## Quick start

### Python emitter (any async source)

```python
from agent_stream import AgentStreamEmitter, TokenBatcher
from agent_stream.fastapi import agent_stream_response

@app.post("/api/chat")
async def chat(req: ChatRequest):
    async def generate():
        emitter = AgentStreamEmitter()
        batcher = TokenBatcher()

        async for chunk in your_llm_stream(req.message):
            if batched := batcher.add(chunk.text):
                yield emitter.token(batched)

        if remaining := batcher.flush():
            yield emitter.token(remaining)

        yield emitter.done(model="claude-sonnet-4-6")

    return agent_stream_response(generate())
```

### React hook

```tsx
import { useAgentStream } from "@agent-stream/react";

function Chat() {
  const { text, isStreaming, startStream, stop } = useAgentStream({
    getToken: () => yourAuth.getToken(),
  });

  return (
    <>
      <button onClick={() => startStream("/api/chat", { message: "Hello" })}>
        Send
      </button>
      <pre>{text}{isStreaming && "▌"}</pre>
    </>
  );
}
```

---

## Event schema

See [`spec/events.schema.json`](spec/events.schema.json) for the full JSON Schema.

| Event | When |
|---|---|
| `token` | Incremental text chunk |
| `thinking` | Chain-of-thought / extended reasoning block |
| `tool_use` | Tool invocation started |
| `tool_result` | Tool execution completed (includes duration) |
| `turn` | Agentic turn boundary |
| `progress` | Pipeline step progress (0–100%) |
| `creation` | Agent created a persistent artifact |
| `error` | Structured error |
| `done` | Stream complete — always the last event |

---

## Hard-won production details

**Token batching** — the Python `TokenBatcher` accumulates chunks and flushes every 50ms.
Without this, a fast model emits 30–40 SSE events/second and React re-renders on every one.

**Cross-chunk event parsing** — SSE `event:` and `data:` lines can arrive in different
fetch chunks. The client persists `currentEventType` across chunk boundaries.
This bug breaks every hand-rolled SSE parser eventually.

**Synthetic done event** — if the server drops the connection without emitting `done`
(proxy timeout, crash), the client emits a synthetic done so your UI never hangs
in a loading state.

---

## Examples

- [`examples/fastapi-anthropic/`](examples/fastapi-anthropic/) — Minimal FastAPI + Anthropic SDK server
- [`examples/react-vite/`](examples/react-vite/) — Minimal React frontend consuming it

---

## License

MIT
