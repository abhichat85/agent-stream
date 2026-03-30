# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- `AgentStreamRecorder` — drop-in async wrapper that records any SSE generator to a `.jsonl` file with millisecond timestamps. Append-safe; multiple sessions coexist in one file.
- `agent-stream replay <file.jsonl>` CLI — replays recordings as valid SSE to stdout at original speed or adjusted with `--speed N`. `--list` prints a session summary table.
- `.jsonl` recording format: human-readable, greppable, one JSON object per line. Session header + per-event records with relative timestamps (`t` seconds from stream start).

## [0.1.0] — 2026-03-29

### Added

**Python (`agent-event-stream`)**
- `AgentStreamEmitter` — typed emitter for all 9 event types: `token`, `thinking`, `tool_use`, `tool_result`, `turn`, `progress`, `creation`, `done`, `error`
- `TokenBatcher` — 50ms token batching to prevent UI thrash at high emit rates
- `agent_stream_response()` — FastAPI helper (optional dep: `agent-event-stream[fastapi]`)
- Zero external dependencies for core package
- Full test suite (pytest)

**React (`@agent-stream/react`)**
- `useAgentStream` hook — full state management (text, isStreaming, activeTools, progress, error, isDone)
- `AgentStreamClient` — framework-agnostic SSE client
- Cross-chunk SSE event parsing (handles event/data split across `fetch` chunks)
- Exponential backoff reconnect (1s → 2s → 4s, 3 retries; HTTP errors don't retry)
- Synthetic `done` event when server drops connection without emitting one
- `activeTools` array tracks only currently-running tools
- ESM + CJS + TypeScript declarations

**Spec**
- `spec/events.schema.json` — JSON Schema v7 contract for all event types

**Examples**
- `examples/fastapi-anthropic/` — FastAPI server with Anthropic SDK streaming
- `examples/react-vite/` — React demo app with streaming, tool status, progress display

[Unreleased]: https://github.com/abhichat85/agent-stream/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/abhichat85/agent-stream/releases/tag/v0.1.0
