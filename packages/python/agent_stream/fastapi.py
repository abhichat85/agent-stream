"""FastAPI integration for agent-stream.

Optional module — only import if FastAPI is installed.

Usage::

    from agent_stream import AgentStreamEmitter, TokenBatcher
    from agent_stream.fastapi import agent_stream_response

    @app.post("/api/chat")
    async def chat(req: ChatRequest):
        async def generate():
            emitter = AgentStreamEmitter()
            batcher = TokenBatcher()
            async for chunk in your_llm_call(req.message):
                if batched := batcher.add(chunk.text):
                    yield emitter.token(batched)
            if remaining := batcher.flush():
                yield emitter.token(remaining)
            yield emitter.done()

        return agent_stream_response(generate())
"""
from __future__ import annotations

from typing import AsyncGenerator

try:
    from fastapi.responses import StreamingResponse
except ImportError as e:
    raise ImportError(
        "fastapi is required to use agent_stream.fastapi. "
        "Install it with: pip install agent-stream[fastapi]"
    ) from e


def agent_stream_response(
    generator: AsyncGenerator[str, None],
) -> StreamingResponse:
    """Wrap an SSE generator in a FastAPI StreamingResponse.

    Sets the correct content type and disables proxy buffering so events
    reach the client immediately.
    """
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
