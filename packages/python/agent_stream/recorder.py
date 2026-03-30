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
