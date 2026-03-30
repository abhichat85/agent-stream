# AgentStreamRecorder + CLI Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `AgentStreamRecorder` — a drop-in async wrapper that records any live SSE stream to a `.jsonl` file — and an `agent-stream replay` CLI that plays it back at original or adjusted speed.

**Architecture:** Three new files in `packages/python/agent_stream/`: `recorder.py` (the recorder class), `cli.py` (thin CLI entry point), and `_sse_parser.py` (shared SSE string → (event, data) parser used by both recorder and CLI). The recorder wraps an async generator transparently; the CLI is a stdlib `argparse` script registered as a console entry point in `pyproject.toml`. All stdlib — zero new dependencies.

**Tech Stack:** Python 3.11+, `asyncio`, `json`, `uuid`, `time`, `pathlib`, `argparse`, `pytest-asyncio` (new dev dep for async tests).

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `packages/python/agent_stream/_sse_parser.py` | **Create** | Parse SSE string → `(event_type, data_dict)`. Shared by recorder + tests. |
| `packages/python/agent_stream/recorder.py` | **Create** | `AgentStreamRecorder` class — records stream to `.jsonl`. |
| `packages/python/agent_stream/cli.py` | **Create** | `main()` entry point — `agent-stream replay` command. |
| `packages/python/agent_stream/__init__.py` | **Modify** | Export `AgentStreamRecorder`. |
| `packages/python/pyproject.toml` | **Modify** | Add `pytest-asyncio` dev dep + `[project.scripts]` entry point. |
| `packages/python/tests/test_recorder.py` | **Create** | Tests for recorder (async, uses `tmp_path`). |
| `packages/python/tests/test_cli.py` | **Create** | Tests for CLI replay logic (sync, uses `tmp_path`). |

---

## Task 1: SSE parser utility + pyproject.toml changes

**Files:**
- Create: `packages/python/agent_stream/_sse_parser.py`
- Modify: `packages/python/pyproject.toml`

This parser is 12 lines and underpins everything else. Do it first so later tasks can import it cleanly.

- [ ] **Step 1: Add pytest-asyncio to dev deps in pyproject.toml**

Open `packages/python/pyproject.toml`. Change the `dev` optional dep line from:
```toml
dev = ["pytest>=8", "fastapi>=0.100", "httpx>=0.27"]
```
to:
```toml
dev = ["pytest>=8", "pytest-asyncio>=0.23", "fastapi>=0.100", "httpx>=0.27"]
```

Also add the asyncio mode config at the bottom of the file:
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```
(Replace the existing `[tool.pytest.ini_options]` block — just add `asyncio_mode = "auto"` to it.)

- [ ] **Step 2: Install updated dev deps**

```bash
cd packages/python
pip install -e ".[dev]"
```

Expected: `Successfully installed pytest-asyncio-0.23.x` (or similar).

- [ ] **Step 3: Write the failing test for `parse_sse`**

Create `packages/python/tests/test_recorder.py`:

```python
import json
import pytest
from agent_stream._sse_parser import parse_sse


def test_parse_sse_token():
    sse = "event: token\ndata: {\"text\": \"hello\"}\n\n"
    event, data = parse_sse(sse)
    assert event == "token"
    assert data == {"text": "hello"}


def test_parse_sse_done():
    sse = "event: done\ndata: {\"num_turns\": 2}\n\n"
    event, data = parse_sse(sse)
    assert event == "done"
    assert data["num_turns"] == 2


def test_parse_sse_invalid_raises():
    with pytest.raises(ValueError, match="not a valid SSE string"):
        parse_sse("garbage\n")
```

- [ ] **Step 4: Run test to confirm it fails**

```bash
cd packages/python
python -m pytest tests/test_recorder.py::test_parse_sse_token -v
```

Expected: `ERROR` — `ModuleNotFoundError: No module named 'agent_stream._sse_parser'`

- [ ] **Step 5: Implement `_sse_parser.py`**

Create `packages/python/agent_stream/_sse_parser.py`:

```python
"""Parse a single SSE string into (event_type, data_dict).

Handles the wire format produced by AgentStreamEmitter:
    event: <type>\\ndata: <json>\\n\\n
"""
from __future__ import annotations

import json


def parse_sse(sse: str) -> tuple[str, dict]:
    """Parse one SSE event string into (event_type, data).

    Args:
        sse: A string in the format ``event: X\\ndata: {...}\\n\\n``.

    Returns:
        Tuple of (event_type_str, data_dict).

    Raises:
        ValueError: If the string is not a valid two-line SSE event.
    """
    lines = [l for l in sse.splitlines() if l.strip()]
    if len(lines) < 2 or not lines[0].startswith("event: ") or not lines[1].startswith("data: "):
        raise ValueError(f"not a valid SSE string: {sse!r}")
    event_type = lines[0].removeprefix("event: ").strip()
    data = json.loads(lines[1].removeprefix("data: "))
    return event_type, data
```

- [ ] **Step 6: Run all three parser tests**

```bash
cd packages/python
python -m pytest tests/test_recorder.py::test_parse_sse_token tests/test_recorder.py::test_parse_sse_done tests/test_recorder.py::test_parse_sse_invalid_raises -v
```

Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
cd packages/python
git add agent_stream/_sse_parser.py tests/test_recorder.py pyproject.toml
git commit -m "feat(recorder): add SSE parser utility + pytest-asyncio dev dep"
```

---

## Task 2: `AgentStreamRecorder` — core record logic

**Files:**
- Create: `packages/python/agent_stream/recorder.py`
- Modify: `packages/python/tests/test_recorder.py` (append tests)

The recorder wraps an async generator, tees each yielded SSE string to a `.jsonl` file, and re-yields the string unchanged — so the existing FastAPI `StreamingResponse` path sees zero change.

- [ ] **Step 1: Write failing tests for the recorder**

Append to `packages/python/tests/test_recorder.py`:

```python
import asyncio
import json
from pathlib import Path
from agent_stream.recorder import AgentStreamRecorder
from agent_stream.emitter import AgentStreamEmitter


async def _fake_stream():
    """Yields two SSE events like a real agent generator."""
    emitter = AgentStreamEmitter()
    yield emitter.token("hello")
    yield emitter.token(" world")
    yield emitter.done(num_turns=1)


async def test_recorder_creates_jsonl(tmp_path):
    out = tmp_path / "stream.jsonl"
    recorder = AgentStreamRecorder(out)
    events = [e async for e in recorder.record(_fake_stream())]
    # passes through all three SSE strings unchanged
    assert len(events) == 3
    assert "event: token" in events[0]
    assert "event: done" in events[2]


async def test_recorder_writes_jsonl(tmp_path):
    out = tmp_path / "stream.jsonl"
    recorder = AgentStreamRecorder(out)
    async for _ in recorder.record(_fake_stream()):
        pass
    lines = out.read_text().splitlines()
    # first line is session header, then 3 event lines
    assert len(lines) == 4
    header = json.loads(lines[0])
    assert "session" in header
    assert "started_at" in header
    assert header["t"] == 0


async def test_recorder_event_fields(tmp_path):
    out = tmp_path / "stream.jsonl"
    recorder = AgentStreamRecorder(out)
    async for _ in recorder.record(_fake_stream()):
        pass
    lines = out.read_text().splitlines()
    first_event = json.loads(lines[1])
    assert first_event["event"] == "token"
    assert first_event["data"]["text"] == "hello"
    assert isinstance(first_event["t"], float)
    assert first_event["t"] >= 0.0


async def test_recorder_timestamps_monotonic(tmp_path):
    out = tmp_path / "stream.jsonl"
    recorder = AgentStreamRecorder(out)
    async for _ in recorder.record(_fake_stream()):
        pass
    lines = out.read_text().splitlines()
    times = [json.loads(l)["t"] for l in lines]
    assert times == sorted(times)


async def test_recorder_context_manager(tmp_path):
    out = tmp_path / "stream.jsonl"
    async with AgentStreamRecorder(out) as recorder:
        async for _ in recorder.record(_fake_stream()):
            pass
    lines = out.read_text().splitlines()
    assert len(lines) == 4


async def test_recorder_exception_still_closes_file(tmp_path):
    out = tmp_path / "stream.jsonl"

    async def bad_stream():
        emitter = AgentStreamEmitter()
        yield emitter.token("before crash")
        raise RuntimeError("upstream died")

    recorder = AgentStreamRecorder(out)
    with pytest.raises(RuntimeError, match="upstream died"):
        async for _ in recorder.record(bad_stream()):
            pass

    # File must exist and have at least header + 1 event
    lines = out.read_text().splitlines()
    assert len(lines) >= 2


async def test_recorder_append_mode(tmp_path):
    out = tmp_path / "stream.jsonl"
    # Two separate recording sessions to the same file
    for _ in range(2):
        recorder = AgentStreamRecorder(out)
        async for _ in recorder.record(_fake_stream()):
            pass
    lines = out.read_text().splitlines()
    # 2 sessions × (1 header + 3 events) = 8 lines
    assert len(lines) == 8
    sessions = [json.loads(l)["session"] for l in lines if "session" in json.loads(l)]
    assert len(sessions) == 2
    assert sessions[0] != sessions[1]
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/python
python -m pytest tests/test_recorder.py -k "not parse_sse" -v
```

Expected: `ERROR` — `ModuleNotFoundError: No module named 'agent_stream.recorder'`

- [ ] **Step 3: Implement `recorder.py`**

Create `packages/python/agent_stream/recorder.py`:

```python
"""AgentStreamRecorder — records a live SSE stream to a .jsonl file.

Usage (wrapping an async generator)::

    recorder = AgentStreamRecorder("stream.jsonl")

    async def generate():
        async for sse_str in recorder.record(agent_generator()):
            yield sse_str

Usage (as async context manager)::

    async with AgentStreamRecorder("stream.jsonl") as recorder:
        async for sse_str in recorder.record(agent_generator()):
            yield sse_str

File format — one JSON object per line::

    {"session": "<uuid4>", "started_at": "<ISO8601>", "t": 0}
    {"t": 0.0,   "event": "token",  "data": {"text": "Hello"}}
    {"t": 0.052, "event": "token",  "data": {"text": " world"}}
    {"t": 1.204, "event": "done",   "data": {...}}

Multiple sessions append to the same file; each has its own t=0 baseline.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator

from ._sse_parser import parse_sse


class AgentStreamRecorder:
    """Drop-in recorder for agent-stream SSE generators.

    Wraps any async generator that yields SSE strings. Each event is
    written to *path* as a JSONL line with a relative timestamp. The
    original SSE string is re-yielded unchanged.

    Args:
        path: Destination file. Created if absent; appended to if present.
    """

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    async def record(
        self, source: AsyncGenerator[str, None]
    ) -> AsyncGenerator[str, None]:
        """Record *source* to the JSONL file while passing events through.

        Args:
            source: An async generator yielding SSE-formatted strings.

        Yields:
            Each SSE string from *source*, unmodified.

        Raises:
            Any exception raised by *source* — file is closed cleanly first.
        """
        session_id = str(uuid.uuid4())
        started_at = datetime.now(timezone.utc).isoformat()
        t0 = time.monotonic()

        fh = self._path.open("a", encoding="utf-8")
        try:
            # Session header — t=0 marks this session's origin
            header = {"session": session_id, "started_at": started_at, "t": 0}
            fh.write(json.dumps(header) + "\n")
            fh.flush()

            async for sse_str in source:
                t = round(time.monotonic() - t0, 3)
                try:
                    event_type, data = parse_sse(sse_str)
                except ValueError:
                    # Malformed SSE — pass through, don't record
                    yield sse_str
                    continue

                record = {"t": t, "event": event_type, "data": data}
                fh.write(json.dumps(record) + "\n")
                fh.flush()
                yield sse_str
        finally:
            fh.close()

    async def __aenter__(self) -> "AgentStreamRecorder":
        return self

    async def __aexit__(self, *_) -> None:
        pass  # file handle lifecycle is managed inside record()
```

- [ ] **Step 4: Run all recorder tests**

```bash
cd packages/python
python -m pytest tests/test_recorder.py -v
```

Expected: all tests pass (parse_sse tests + 7 recorder tests).

- [ ] **Step 5: Update `__init__.py` to export `AgentStreamRecorder`**

Open `packages/python/agent_stream/__init__.py`. Replace entirely:

```python
from .emitter import AgentStreamEmitter
from .batcher import TokenBatcher
from .recorder import AgentStreamRecorder

__all__ = ["AgentStreamEmitter", "TokenBatcher", "AgentStreamRecorder"]
__version__ = "0.1.0"
```

- [ ] **Step 6: Confirm import works**

```bash
cd packages/python
python -c "from agent_stream import AgentStreamRecorder; print('ok')"
```

Expected: `ok`

- [ ] **Step 7: Run full test suite**

```bash
cd packages/python
python -m pytest tests/ -v
```

Expected: all existing tests still pass, plus new recorder tests.

- [ ] **Step 8: Commit**

```bash
git add agent_stream/recorder.py agent_stream/__init__.py tests/test_recorder.py
git commit -m "feat(recorder): AgentStreamRecorder — records SSE stream to .jsonl"
```

---

## Task 3: CLI — `agent-stream replay`

**Files:**
- Create: `packages/python/agent_stream/cli.py`
- Create: `packages/python/tests/test_cli.py`
- Modify: `packages/python/pyproject.toml` (add `[project.scripts]`)

The CLI reads a `.jsonl` file and replays events to stdout as valid SSE, sleeping between events to honour original timing (adjusted by `--speed`). `--list` prints a summary table instead.

- [ ] **Step 1: Write failing tests for the CLI replay logic**

Create `packages/python/tests/test_cli.py`:

```python
import json
import time
import pytest
from pathlib import Path
from agent_stream.cli import load_sessions, replay_session, list_sessions


def _write_jsonl(path: Path, lines: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(l) for l in lines) + "\n")


def _make_session(tmp_path, events: list[tuple[float, str, dict]]) -> Path:
    """Helper: write a single-session .jsonl file."""
    out = tmp_path / "stream.jsonl"
    lines = [{"session": "abc-123", "started_at": "2026-03-31T00:00:00+00:00", "t": 0}]
    for t, event, data in events:
        lines.append({"t": t, "event": event, "data": data})
    _write_jsonl(out, lines)
    return out


def test_load_sessions_single(tmp_path):
    path = _make_session(tmp_path, [
        (0.0, "token", {"text": "hi"}),
        (0.1, "done",  {"num_turns": 1}),
    ])
    sessions = load_sessions(path)
    assert len(sessions) == 1
    assert sessions[0]["session"] == "abc-123"
    assert len(sessions[0]["events"]) == 2


def test_load_sessions_multiple(tmp_path):
    out = tmp_path / "stream.jsonl"
    lines = [
        {"session": "s1", "started_at": "2026-03-31T00:00:00+00:00", "t": 0},
        {"t": 0.0, "event": "token", "data": {"text": "a"}},
        {"session": "s2", "started_at": "2026-03-31T00:01:00+00:00", "t": 0},
        {"t": 0.0, "event": "done",  "data": {"num_turns": 1}},
    ]
    _write_jsonl(out, lines)
    sessions = load_sessions(out)
    assert len(sessions) == 2
    assert sessions[0]["session"] == "s1"
    assert sessions[1]["session"] == "s2"
    assert len(sessions[0]["events"]) == 1
    assert len(sessions[1]["events"]) == 1


def test_list_sessions_returns_summary(tmp_path):
    path = _make_session(tmp_path, [
        (0.0, "token",    {"text": "hi"}),
        (0.5, "tool_use", {"tool_name": "search"}),
        (1.2, "done",     {"num_turns": 1}),
    ])
    sessions = load_sessions(path)
    summary = list_sessions(sessions)
    assert len(summary) == 1
    row = summary[0]
    assert row["session"] == "abc-123"
    assert row["event_count"] == 3
    assert row["duration_s"] == pytest.approx(1.2)
    assert "token" in row["event_types"]
    assert "done" in row["event_types"]


def test_replay_session_output(tmp_path, capsys):
    path = _make_session(tmp_path, [
        (0.0, "token", {"text": "hello"}),
        (0.05, "done", {"num_turns": 1}),
    ])
    sessions = load_sessions(path)
    # speed=1000 → sleeps are negligible (0.05/1000 = 0.00005s)
    replay_session(sessions[0], speed=1000.0, out=None)
    captured = capsys.readouterr()
    assert "event: token" in captured.out
    assert '"text": "hello"' in captured.out
    assert "event: done" in captured.out


def test_replay_session_respects_speed(tmp_path):
    path = _make_session(tmp_path, [
        (0.0,  "token", {"text": "a"}),
        (0.1,  "token", {"text": "b"}),
        (0.2,  "done",  {"num_turns": 1}),
    ])
    sessions = load_sessions(path)
    start = time.monotonic()
    replay_session(sessions[0], speed=100.0, out=None)  # 0.2s / 100 = ~2ms total
    elapsed = time.monotonic() - start
    assert elapsed < 0.1  # well under 100ms


def test_load_sessions_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_sessions(tmp_path / "nonexistent.jsonl")
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/python
python -m pytest tests/test_cli.py -v
```

Expected: `ERROR` — `ModuleNotFoundError: No module named 'agent_stream.cli'`

- [ ] **Step 3: Implement `cli.py`**

Create `packages/python/agent_stream/cli.py`:

```python
"""agent-stream CLI — replay recorded SSE streams.

Usage::

    agent-stream replay stream.jsonl
    agent-stream replay stream.jsonl --speed 2
    agent-stream replay stream.jsonl --speed 0.5
    agent-stream replay stream.jsonl --list
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import IO


# ── Data loading ──────────────────────────────────────────────────────────────

def load_sessions(path: str | Path) -> list[dict]:
    """Parse a .jsonl file into a list of session dicts.

    Each session dict has the shape::

        {
            "session": "<uuid>",
            "started_at": "<ISO8601>",
            "t": 0,
            "events": [{"t": float, "event": str, "data": dict}, ...]
        }

    Args:
        path: Path to the .jsonl file.

    Returns:
        List of session dicts, in file order.

    Raises:
        FileNotFoundError: If *path* does not exist.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"No such file: {path}")

    sessions: list[dict] = []
    current: dict | None = None

    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        record = json.loads(raw)
        if "session" in record:
            # Session header line
            current = {**record, "events": []}
            sessions.append(current)
        elif current is not None:
            current["events"].append(record)

    return sessions


# ── Summary ───────────────────────────────────────────────────────────────────

def list_sessions(sessions: list[dict]) -> list[dict]:
    """Return a summary row for each session.

    Each row::

        {
            "session": str,
            "started_at": str,
            "event_count": int,
            "duration_s": float,
            "event_types": list[str],  # unique, in order of first appearance
        }
    """
    rows = []
    for s in sessions:
        events = s["events"]
        seen: list[str] = []
        for e in events:
            et = e["event"]
            if et not in seen:
                seen.append(et)
        duration = events[-1]["t"] if events else 0.0
        rows.append({
            "session": s["session"],
            "started_at": s.get("started_at", ""),
            "event_count": len(events),
            "duration_s": duration,
            "event_types": seen,
        })
    return rows


# ── Replay ────────────────────────────────────────────────────────────────────

def replay_session(session: dict, speed: float = 1.0, out: IO[str] | None = None) -> None:
    """Replay one session to *out* (defaults to stdout) at *speed*.

    Sleeps between events to honour original timing divided by *speed*.
    Each event is printed as a valid SSE string::

        event: <type>
        data: <json>
        <blank line>

    Args:
        session: A session dict from :func:`load_sessions`.
        speed: Playback multiplier. 1.0 = real time, 2.0 = 2× faster.
        out: File-like object to write to. Defaults to ``sys.stdout``.
    """
    if out is None:
        out = sys.stdout

    events = session["events"]
    prev_t = 0.0

    for record in events:
        t = record["t"]
        gap = (t - prev_t) / speed
        if gap > 0:
            time.sleep(gap)
        prev_t = t

        sse = f"event: {record['event']}\ndata: {json.dumps(record['data'])}\n\n"
        out.write(sse)
        out.flush()


# ── CLI ───────────────────────────────────────────────────────────────────────

def _cmd_replay(args: argparse.Namespace) -> None:
    try:
        sessions = load_sessions(args.file)
    except FileNotFoundError as exc:
        print(f"agent-stream: {exc}", file=sys.stderr)
        sys.exit(1)

    if not sessions:
        print("agent-stream: no sessions found in file", file=sys.stderr)
        sys.exit(1)

    if args.list:
        summaries = list_sessions(sessions)
        print(f"{'SESSION':<38} {'STARTED':<26} {'EVENTS':>6} {'DURATION':>10}  TYPES")
        print("-" * 100)
        for row in summaries:
            types = " ".join(row["event_types"])
            print(
                f"{row['session']:<38} "
                f"{row['started_at'][:19]:<26} "
                f"{row['event_count']:>6} "
                f"{row['duration_s']:>9.2f}s  "
                f"{types}"
            )
        return

    # Default: replay most recent session (last in file)
    session = sessions[-1]
    try:
        replay_session(session, speed=args.speed)
    except KeyboardInterrupt:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="agent-stream",
        description="agent-stream developer tools",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    replay = sub.add_parser("replay", help="Replay a recorded .jsonl stream as SSE")
    replay.add_argument("file", type=Path, help="Path to .jsonl recording")
    replay.add_argument(
        "--speed",
        type=float,
        default=1.0,
        metavar="N",
        help="Playback speed multiplier (default: 1.0, e.g. --speed 2 for 2×)",
    )
    replay.add_argument(
        "--list",
        action="store_true",
        help="List sessions in the file without replaying",
    )
    replay.set_defaults(func=_cmd_replay)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run CLI tests**

```bash
cd packages/python
python -m pytest tests/test_cli.py -v
```

Expected: all 6 tests pass.

- [ ] **Step 5: Add entry point to pyproject.toml**

Add this block to `packages/python/pyproject.toml` (after `[project.optional-dependencies]`):

```toml
[project.scripts]
agent-stream = "agent_stream.cli:main"
```

- [ ] **Step 6: Reinstall and smoke-test the CLI**

```bash
cd packages/python
pip install -e ".[dev]"
agent-stream --help
```

Expected output:
```
usage: agent-stream [-h] {replay} ...

agent-stream developer tools

positional arguments:
  {replay}
    replay    Replay a recorded .jsonl stream as SSE

options:
  -h, --help  show this help message and exit
```

- [ ] **Step 7: Run full test suite**

```bash
cd packages/python
python -m pytest tests/ -v
```

Expected: all tests pass (existing + recorder + CLI).

- [ ] **Step 8: Commit**

```bash
git add agent_stream/cli.py tests/test_cli.py pyproject.toml
git commit -m "feat(cli): agent-stream replay — play back .jsonl recordings as SSE"
```

---

## Task 4: End-to-end smoke test + CHANGELOG + README update

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

Wire everything together with a real end-to-end test — record a fake stream, then replay it through the CLI — to prove the two components integrate correctly.

- [ ] **Step 1: Write the end-to-end test**

Append to `packages/python/tests/test_cli.py`:

```python
import asyncio
import subprocess
import sys
from agent_stream.recorder import AgentStreamRecorder
from agent_stream.emitter import AgentStreamEmitter


async def _run_and_record(path: Path) -> None:
    emitter = AgentStreamEmitter()

    async def stream():
        yield emitter.token("hello")
        yield emitter.tool_use("search", "tu_1", "query=test")
        yield emitter.tool_result("search", "tu_1", "3 results", 100)
        yield emitter.done(num_turns=1, tool_count=1)

    recorder = AgentStreamRecorder(path)
    async for _ in recorder.record(stream()):
        pass


def test_end_to_end_record_then_replay(tmp_path):
    out = tmp_path / "stream.jsonl"
    asyncio.run(_run_and_record(out))

    # Replay via CLI subprocess at max speed
    result = subprocess.run(
        [sys.executable, "-m", "agent_stream.cli", "replay", str(out), "--speed", "10000"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "event: token" in result.stdout
    assert "event: tool_use" in result.stdout
    assert "event: tool_result" in result.stdout
    assert "event: done" in result.stdout
    assert '"text": "hello"' in result.stdout


def test_end_to_end_list(tmp_path):
    out = tmp_path / "stream.jsonl"
    asyncio.run(_run_and_record(out))

    result = subprocess.run(
        [sys.executable, "-m", "agent_stream.cli", "replay", str(out), "--list"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "SESSION" in result.stdout
    assert "token" in result.stdout
    assert "done" in result.stdout
```

- [ ] **Step 2: Run end-to-end tests**

```bash
cd packages/python
python -m pytest tests/test_cli.py::test_end_to_end_record_then_replay tests/test_cli.py::test_end_to_end_list -v
```

Expected: both pass.

- [ ] **Step 3: Run the full suite one final time**

```bash
cd packages/python
python -m pytest tests/ -v
```

Expected: all tests pass, zero warnings.

- [ ] **Step 4: Update CHANGELOG.md**

Open `/Users/abhishek/Einstein-Labs/agent-stream/CHANGELOG.md`. Under `## [Unreleased]`, add:

```markdown
## [Unreleased]

### Added

- `AgentStreamRecorder` — drop-in async wrapper that records any SSE generator to a `.jsonl` file with millisecond timestamps. Append-safe; multiple sessions coexist in one file.
- `agent-stream replay <file.jsonl>` CLI — replays recordings as valid SSE to stdout at original speed or adjusted with `--speed N`. `--list` prints a session summary table.
- `.jsonl` recording format: human-readable, greppable, one JSON object per line. Session header + per-event records with relative timestamps (`t` seconds from stream start).
```

- [ ] **Step 5: Update README.md — add Recorder section**

In `/Users/abhishek/Einstein-Labs/agent-stream/README.md`, find the `## API reference` section and add a new subsection after the existing Python API entries:

````markdown
### `AgentStreamRecorder` (Python)

Records any live SSE stream to a `.jsonl` file for offline replay and debugging.

```python
from agent_stream.recorder import AgentStreamRecorder

recorder = AgentStreamRecorder("session.jsonl")

async def generate():
    async for sse_str in recorder.record(agent_generator()):
        yield sse_str  # passes through unchanged to StreamingResponse
```

**Replay recorded streams:**

```bash
# List sessions in a recording
agent-stream replay session.jsonl --list

# Replay at original speed
agent-stream replay session.jsonl

# Replay at 2× speed
agent-stream replay session.jsonl --speed 2
```

**`.jsonl` format** — human-readable, greppable:

```jsonl
{"session": "a1b2c3...", "started_at": "2026-03-31T02:14:00+00:00", "t": 0}
{"t": 0.0,   "event": "token",      "data": {"text": "Hello"}}
{"t": 0.052, "event": "tool_use",   "data": {"tool_name": "search", ...}}
{"t": 0.894, "event": "tool_result","data": {"duration_ms": 842, ...}}
{"t": 1.204, "event": "done",       "data": {"num_turns": 1, ...}}
```
````

- [ ] **Step 6: Final commit**

```bash
cd /Users/abhishek/Einstein-Labs/agent-stream
git add packages/python/tests/test_cli.py CHANGELOG.md README.md
git commit -m "feat(recorder): end-to-end tests, CHANGELOG, README docs"
git push origin main
```

---

## Spec coverage check

| Requirement | Task |
|---|---|
| `AgentStreamRecorder` wraps async generator transparently | Task 2 |
| `.jsonl` format: `{"t", "event", "data"}` | Task 2 |
| `t` is relative to stream start, millisecond precision | Task 2 |
| Session header line with uuid + ISO8601 | Task 2 |
| Append-safe — multiple sessions in one file | Task 2 (`test_recorder_append_mode`) |
| Exception mid-stream closes file cleanly | Task 2 (`test_recorder_exception_still_closes_file`) |
| Context manager (`async with`) | Task 2 (`test_recorder_context_manager`) |
| `agent-stream replay <file>` CLI | Task 3 |
| `--speed N` flag | Task 3 |
| `--list` flag | Task 3 |
| Entry point via `pyproject.toml` | Task 3 |
| `load_sessions` handles multiple sessions | Task 3 |
| Zero external dependencies | All tasks (stdlib only) |
| End-to-end record → replay | Task 4 |
| CHANGELOG + README updated | Task 4 |
