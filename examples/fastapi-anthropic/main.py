"""Minimal FastAPI + Anthropic example for agent-stream.

Install:
    pip install fastapi uvicorn anthropic "agent-stream[fastapi]"

Run:
    ANTHROPIC_API_KEY=sk-... uvicorn main:app --reload

Then POST to http://localhost:8000/chat with {"message": "Hello"}
and consume the SSE stream.
"""
import os
import time
import anthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agent_stream import AgentStreamEmitter, TokenBatcher
from agent_stream.fastapi import agent_stream_response

app = FastAPI(title="agent-stream demo")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))


class ChatRequest(BaseModel):
    message: str


@app.post("/chat")
async def chat(req: ChatRequest):
    async def generate():
        emitter = AgentStreamEmitter()
        batcher = TokenBatcher(interval_ms=50)
        start = time.monotonic()

        with client.messages.stream(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{"role": "user", "content": req.message}],
        ) as stream:
            for text in stream.text_stream:
                if batched := batcher.add(text):
                    yield emitter.token(batched)

        # Always flush remaining tokens at end
        if remaining := batcher.flush():
            yield emitter.token(remaining)

        yield emitter.done(
            duration_ms=int((time.monotonic() - start) * 1000),
            model="claude-haiku-4-5-20251001",
        )

    return agent_stream_response(generate())


@app.get("/health")
async def health():
    return {"status": "ok"}
