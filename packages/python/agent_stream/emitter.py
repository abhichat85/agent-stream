"""AgentStreamEmitter — formats SSE event strings for AI agent streaming.

No external dependencies. Each method returns a ready-to-yield SSE string:

    event: <type>
    data: <json>

    (blank line terminates the event)

Usage::

    from agent_stream import AgentStreamEmitter

    emitter = AgentStreamEmitter()

    async def generate():
        yield emitter.token("Hello")
        yield emitter.tool_use("search", "tu_1", "query=foo")
        yield emitter.tool_result("search", "tu_1", "3 results", 120)
        yield emitter.done(message_id="msg_1", num_turns=1, tool_count=1)
"""
from __future__ import annotations

import json
from typing import Any


def _fmt(event_type: str, data: dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, default=str)}\n\n"


class AgentStreamEmitter:
    """Formats typed SSE events for AI agent streaming."""

    def token(self, text: str) -> str:
        """Incremental text chunk from the agent."""
        return _fmt("token", {"text": text})

    def thinking(self, text: str) -> str:
        """Extended reasoning / chain-of-thought block."""
        return _fmt("thinking", {"text": text})

    def tool_use(
        self,
        tool_name: str,
        tool_use_id: str,
        input_summary: str = "",
    ) -> str:
        """Tool invocation started."""
        return _fmt("tool_use", {
            "tool_name": tool_name,
            "tool_use_id": tool_use_id,
            "input_summary": input_summary,
            "status": "running",
        })

    def tool_result(
        self,
        tool_name: str,
        tool_use_id: str,
        output_summary: str = "",
        duration_ms: int = 0,
        is_error: bool = False,
    ) -> str:
        """Tool execution completed."""
        return _fmt("tool_result", {
            "tool_name": tool_name,
            "tool_use_id": tool_use_id,
            "output_summary": output_summary,
            "duration_ms": duration_ms,
            "status": "error" if is_error else "done",
        })

    def turn(self, turn_number: int, total_tools: int = 0) -> str:
        """Agentic turn boundary."""
        return _fmt("turn", {"turn_number": turn_number, "total_tools": total_tools})

    def progress(
        self,
        step: str,
        percentage: int,
        message: str,
        sub_progress: dict[str, Any] | None = None,
    ) -> str:
        """Pipeline step progress update."""
        data: dict[str, Any] = {"step": step, "percentage": percentage, "message": message}
        if sub_progress:
            data["sub_progress"] = sub_progress
        return _fmt("progress", data)

    def creation(
        self,
        creation_type: str,
        count: int,
        tool_use_id: str = "",
        items: list[dict[str, Any]] | None = None,
    ) -> str:
        """Agent created a persistent artifact."""
        return _fmt("creation", {
            "creation_type": creation_type,
            "count": count,
            "tool_use_id": tool_use_id,
            "items": items or [],
        })

    def error(
        self,
        error_type: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> str:
        """Structured error during execution."""
        return _fmt("error", {
            "error_type": error_type,
            "message": message,
            "details": details or {},
        })

    def done(
        self,
        message_id: str = "",
        num_turns: int = 0,
        tool_count: int = 0,
        duration_ms: int = 0,
        model: str = "",
        total_cost_usd: float = 0.0,
    ) -> str:
        """Stream complete — always the last event emitted."""
        return _fmt("done", {
            "message_id": message_id,
            "num_turns": num_turns,
            "tool_count": tool_count,
            "duration_ms": duration_ms,
            "model": model,
            "total_cost_usd": total_cost_usd,
        })
