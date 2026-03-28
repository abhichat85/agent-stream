import json
import pytest
from agent_stream.emitter import AgentStreamEmitter


@pytest.fixture
def emitter():
    return AgentStreamEmitter()


def _parse(sse: str) -> tuple[str, dict]:
    """Parse 'event: X\ndata: {...}\n\n' into (event_type, data)."""
    lines = sse.strip().splitlines()
    event_type = lines[0].removeprefix("event: ")
    data = json.loads(lines[1].removeprefix("data: "))
    return event_type, data


def test_token(emitter):
    ev, data = _parse(emitter.token("hello"))
    assert ev == "token"
    assert data["text"] == "hello"


def test_thinking(emitter):
    ev, data = _parse(emitter.thinking("step 1: consider X"))
    assert ev == "thinking"
    assert data["text"] == "step 1: consider X"


def test_tool_use(emitter):
    ev, data = _parse(emitter.tool_use("search", "tu_123", "query=foo"))
    assert ev == "tool_use"
    assert data["tool_name"] == "search"
    assert data["tool_use_id"] == "tu_123"
    assert data["input_summary"] == "query=foo"
    assert data["status"] == "running"


def test_tool_result_success(emitter):
    ev, data = _parse(emitter.tool_result("search", "tu_123", "3 results", 42))
    assert ev == "tool_result"
    assert data["status"] == "done"
    assert data["duration_ms"] == 42


def test_tool_result_error(emitter):
    ev, data = _parse(emitter.tool_result("search", "tu_123", is_error=True))
    assert ev == "tool_result"
    assert data["status"] == "error"


def test_turn(emitter):
    ev, data = _parse(emitter.turn(2, total_tools=5))
    assert ev == "turn"
    assert data["turn_number"] == 2
    assert data["total_tools"] == 5


def test_progress(emitter):
    ev, data = _parse(emitter.progress("synthesis", 40, "Extracting insights"))
    assert ev == "progress"
    assert data["percentage"] == 40


def test_progress_with_sub(emitter):
    ev, data = _parse(emitter.progress(
        "synthesis", 50, "Processing",
        sub_progress={"current": 3, "total": 10, "item_title": "Interview 3"}
    ))
    assert data["sub_progress"]["current"] == 3


def test_creation(emitter):
    ev, data = _parse(emitter.creation("insights", 5, tool_use_id="tu_abc"))
    assert ev == "creation"
    assert data["count"] == 5


def test_error(emitter):
    ev, data = _parse(emitter.error("timeout", "Request timed out"))
    assert ev == "error"
    assert data["error_type"] == "timeout"


def test_done(emitter):
    ev, data = _parse(emitter.done(
        message_id="msg_1", num_turns=3, tool_count=7,
        duration_ms=4200, model="claude-sonnet-4-6"
    ))
    assert ev == "done"
    assert data["num_turns"] == 3
    assert data["model"] == "claude-sonnet-4-6"


def test_sse_format_ends_with_double_newline(emitter):
    assert emitter.token("x").endswith("\n\n")
