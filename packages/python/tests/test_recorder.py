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
