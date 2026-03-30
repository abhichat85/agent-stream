"""agent-stream CLI — replay recorded SSE streams.

Usage::

    agent-stream replay stream.jsonl
    agent-stream replay stream.jsonl --speed 2
    agent-stream replay stream.jsonl --speed 0.5
    agent-stream replay stream.jsonl --list
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import IO


# -- Data loading --------------------------------------------------------------

def load_sessions(path: str | Path) -> list[dict]:
    """Parse a .jsonl file into a list of session dicts.

    Each session dict has the shape::

        {
            "session": "<uuid>",
            "started_at": "<ISO8601>",
            "t": 0,
            "events": [{"t": float, "event": str, "data": dict}, ...]
        }

    Args:
        path: Path to the .jsonl file.

    Returns:
        List of session dicts, in file order.

    Raises:
        FileNotFoundError: If *path* does not exist.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"No such file: {path}")

    sessions: list[dict] = []
    current: dict | None = None

    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        record = json.loads(raw)
        if "session" in record:
            # Session header line
            current = {**record, "events": []}
            sessions.append(current)
        elif current is not None:
            current["events"].append(record)

    return sessions


# -- Summary -------------------------------------------------------------------

def list_sessions(sessions: list[dict]) -> list[dict]:
    """Return a summary row for each session.

    Each row::

        {
            "session": str,
            "started_at": str,
            "event_count": int,
            "duration_s": float,
            "event_types": list[str],  # unique, in order of first appearance
        }
    """
    rows = []
    for s in sessions:
        events = s["events"]
        seen: list[str] = []
        for e in events:
            et = e["event"]
            if et not in seen:
                seen.append(et)
        duration = events[-1]["t"] if events else 0.0
        rows.append({
            "session": s["session"],
            "started_at": s.get("started_at", ""),
            "event_count": len(events),
            "duration_s": duration,
            "event_types": seen,
        })
    return rows


# -- Replay --------------------------------------------------------------------

def replay_session(session: dict, speed: float = 1.0, out: IO[str] | None = None) -> None:
    """Replay one session to *out* (defaults to stdout) at *speed*.

    Sleeps between events to honour original timing divided by *speed*.
    Each event is printed as a valid SSE string::

        event: <type>
        data: <json>
        <blank line>

    Args:
        session: A session dict from :func:`load_sessions`.
        speed: Playback multiplier. 1.0 = real time, 2.0 = 2x faster.
        out: File-like object to write to. Defaults to ``sys.stdout``.
    """
    if out is None:
        out = sys.stdout

    events = session["events"]
    prev_t = 0.0

    for record in events:
        t = record["t"]
        gap = (t - prev_t) / speed
        if gap > 0:
            time.sleep(gap)
        prev_t = t

        sse = f"event: {record['event']}\ndata: {json.dumps(record['data'])}\n\n"
        out.write(sse)
        out.flush()


# -- CLI -----------------------------------------------------------------------

def _cmd_replay(args: argparse.Namespace) -> None:
    try:
        sessions = load_sessions(args.file)
    except FileNotFoundError as exc:
        print(f"agent-stream: {exc}", file=sys.stderr)
        sys.exit(1)

    if not sessions:
        print("agent-stream: no sessions found in file", file=sys.stderr)
        sys.exit(1)

    if args.list:
        summaries = list_sessions(sessions)
        print(f"{'SESSION':<38} {'STARTED':<26} {'EVENTS':>6} {'DURATION':>10}  TYPES")
        print("-" * 100)
        for row in summaries:
            types = " ".join(row["event_types"])
            print(
                f"{row['session']:<38} "
                f"{row['started_at'][:19]:<26} "
                f"{row['event_count']:>6} "
                f"{row['duration_s']:>9.2f}s  "
                f"{types}"
            )
        return

    # Default: replay most recent session (last in file)
    session = sessions[-1]
    try:
        replay_session(session, speed=args.speed)
    except KeyboardInterrupt:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="agent-stream",
        description="agent-stream developer tools",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    replay = sub.add_parser("replay", help="Replay a recorded .jsonl stream as SSE")
    replay.add_argument("file", type=Path, help="Path to .jsonl recording")
    replay.add_argument(
        "--speed",
        type=float,
        default=1.0,
        metavar="N",
        help="Playback speed multiplier (default: 1.0, e.g. --speed 2 for 2x)",
    )
    replay.add_argument(
        "--list",
        action="store_true",
        help="List sessions in the file without replaying",
    )
    replay.set_defaults(func=_cmd_replay)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
