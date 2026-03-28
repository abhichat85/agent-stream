"""TokenBatcher — accumulates text tokens and flushes every `interval_ms` milliseconds.

Prevents excessive SSE emissions (and client re-renders) by batching
tokens that arrive faster than the flush interval.

Usage::

    batcher = TokenBatcher(interval_ms=50)

    for chunk in llm_stream:
        if batched := batcher.add(chunk.text):
            yield emitter.token(batched)

    # Always flush at end of stream
    if remaining := batcher.flush():
        yield emitter.token(remaining)
"""
from __future__ import annotations

import time


class TokenBatcher:
    """Accumulates text tokens and flushes every `interval_ms` milliseconds."""

    def __init__(self, interval_ms: int = 50) -> None:
        self._buffer: list[str] = []
        self._interval = interval_ms / 1000.0
        self._last_flush = time.monotonic()

    def add(self, text: str) -> str | None:
        """Add a token. Returns flushed text if interval elapsed, else None."""
        self._buffer.append(text)
        if time.monotonic() - self._last_flush >= self._interval:
            return self.flush()
        return None

    def flush(self) -> str | None:
        """Flush buffer and return accumulated text, or None if empty."""
        if not self._buffer:
            return None
        text = "".join(self._buffer)
        self._buffer.clear()
        self._last_flush = time.monotonic()
        return text

    @property
    def has_content(self) -> bool:
        """True if there are buffered tokens not yet flushed."""
        return bool(self._buffer)
