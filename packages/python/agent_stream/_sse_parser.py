"""Parse a single SSE string into (event_type, data_dict).

Handles the wire format produced by AgentStreamEmitter:
    event: <type>\\ndata: <json>\\n\\n
"""
from __future__ import annotations

import json


def parse_sse(sse: str) -> tuple[str, dict]:
    """Parse one SSE event string into (event_type, data).

    Args:
        sse: A string in the format ``event: X\\ndata: {...}\\n\\n``.

    Returns:
        Tuple of (event_type_str, data_dict).

    Raises:
        ValueError: If the string is not a valid two-line SSE event.
    """
    lines = [l for l in sse.splitlines() if l.strip()]
    if len(lines) < 2 or not lines[0].startswith("event: ") or not lines[1].startswith("data: "):
        raise ValueError(f"not a valid SSE string: {sse!r}")
    event_type = lines[0].removeprefix("event: ").strip()
    data = json.loads(lines[1].removeprefix("data: "))
    return event_type, data
