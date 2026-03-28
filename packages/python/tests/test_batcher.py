import time
import pytest
from agent_stream.batcher import TokenBatcher


def test_add_below_interval_returns_none():
    batcher = TokenBatcher(interval_ms=200)
    result = batcher.add("hello")
    assert result is None


def test_add_above_interval_returns_batched():
    batcher = TokenBatcher(interval_ms=0)  # 0ms = always flush
    result = batcher.add("hello")
    assert result == "hello"


def test_flush_returns_accumulated_text():
    batcher = TokenBatcher(interval_ms=200)
    batcher.add("foo")
    batcher.add("bar")
    result = batcher.flush()
    assert result == "foobar"


def test_flush_empty_returns_none():
    batcher = TokenBatcher()
    assert batcher.flush() is None


def test_flush_clears_buffer():
    batcher = TokenBatcher(interval_ms=200)
    batcher.add("x")
    batcher.flush()
    assert batcher.flush() is None


def test_has_content_false_when_empty():
    batcher = TokenBatcher()
    assert batcher.has_content is False


def test_has_content_true_after_add():
    batcher = TokenBatcher(interval_ms=200)
    batcher.add("x")
    assert batcher.has_content is True


def test_multiple_adds_batched():
    batcher = TokenBatcher(interval_ms=200)
    for ch in ["a", "b", "c"]:
        batcher.add(ch)
    assert batcher.flush() == "abc"
