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


import asyncio
from pathlib import Path
from agent_stream.recorder import AgentStreamRecorder
from agent_stream.emitter import AgentStreamEmitter


async def _fake_stream():
    """Yields two SSE events like a real agent generator."""
    emitter = AgentStreamEmitter()
    yield emitter.token("hello")
    yield emitter.token(" world")
    yield emitter.done(num_turns=1)


@pytest.mark.asyncio
async def test_recorder_creates_jsonl(tmp_path):
    out = tmp_path / "stream.jsonl"
    recorder = AgentStreamRecorder(out)
    events = [e async for e in recorder.record(_fake_stream())]
    # passes through all three SSE strings unchanged
    assert len(events) == 3
    assert "event: token" in events[0]
    assert "event: done" in events[2]


@pytest.mark.asyncio
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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_recorder_timestamps_monotonic(tmp_path):
    out = tmp_path / "stream.jsonl"
    recorder = AgentStreamRecorder(out)
    async for _ in recorder.record(_fake_stream()):
        pass
    lines = out.read_text().splitlines()
    times = [json.loads(l)["t"] for l in lines]
    assert times == sorted(times)


@pytest.mark.asyncio
async def test_recorder_context_manager(tmp_path):
    out = tmp_path / "stream.jsonl"
    async with AgentStreamRecorder(out) as recorder:
        async for _ in recorder.record(_fake_stream()):
            pass
    lines = out.read_text().splitlines()
    assert len(lines) == 4


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_recorder_append_mode(tmp_path):
    out = tmp_path / "stream.jsonl"
    # Two separate recording sessions to the same file
    for _ in range(2):
        recorder = AgentStreamRecorder(out)
        async for _ in recorder.record(_fake_stream()):
            pass
    lines = out.read_text().splitlines()
    # 2 sessions * (1 header + 3 events) = 8 lines
    assert len(lines) == 8
    sessions = [json.loads(l)["session"] for l in lines if "session" in json.loads(l)]
    assert len(sessions) == 2
    assert sessions[0] != sessions[1]
