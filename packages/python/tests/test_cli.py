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
    # speed=1000 -> sleeps are negligible (0.05/1000 = 0.00005s)
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
