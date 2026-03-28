import pytest

pytest.importorskip("fastapi")  # Skip if FastAPI not installed

from fastapi.responses import StreamingResponse
from agent_stream.fastapi import agent_stream_response


async def mock_generator():
    yield "event: token\ndata: {\"text\": \"hi\"}\n\n"


def test_returns_streaming_response():
    response = agent_stream_response(mock_generator())
    assert isinstance(response, StreamingResponse)


def test_content_type_is_event_stream():
    response = agent_stream_response(mock_generator())
    assert response.media_type == "text/event-stream"


def test_no_cache_header():
    response = agent_stream_response(mock_generator())
    assert response.headers.get("Cache-Control") == "no-cache"


def test_no_buffering_header():
    response = agent_stream_response(mock_generator())
    assert response.headers.get("X-Accel-Buffering") == "no"
