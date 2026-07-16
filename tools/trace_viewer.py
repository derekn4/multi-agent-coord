#!/usr/bin/env python3
"""Trace viewer for multi-agent-coord.

Reads the coordinator's JSONL event log and prints a per-trace timeline, so you
can reconstruct any multi-agent run after the fact. Dependency-free (stdlib).

Usage:
    python tools/trace_viewer.py [path/to/events.jsonl] [--failures] [--trace T]

If no path is given, uses $COORDINATOR_STATE_DIR/events.jsonl, else
~/.multi-agent-coord/events.jsonl.
"""

import argparse
import json
import os
import sys
from collections import defaultdict


def default_events_path():
    base = os.environ.get("COORDINATOR_STATE_DIR") or os.path.join(
        os.path.expanduser("~"), ".multi-agent-coord"
    )
    return os.path.join(base, "events.jsonl")


def load_events(path):
    events = []
    if not os.path.exists(path):
        sys.exit(f"No event log at {path}. Run some coordinated tool calls first.")
    with open(path, "r", encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, 1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                events.append(json.loads(raw))
            except json.JSONDecodeError:
                print(f"  (skipped malformed line {lineno})", file=sys.stderr)
    return events


def fmt_event(e):
    ts = e.get("ts", "?")[11:23]  # HH:MM:SS.mmm from the ISO timestamp
    kind = e.get("tool") or e.get("event", "?")
    session = (e.get("session_id") or "?")[:12]
    ok = e.get("ok")
    latency = e.get("latency_ms")

    status = "OK " if ok is True else ("ERR" if ok is False else "-- ")
    lat = f"{latency:>7.2f}ms" if isinstance(latency, (int, float)) else " " * 9
    line = f"    {ts}  [{session:<12}] {status} {lat}  {kind}"
    if ok is False:
        line += f"\n        \\_ {e.get('error_class', 'Error')}: {e.get('error', '')}"
    return line


def main():
    parser = argparse.ArgumentParser(description="Per-trace timeline viewer.")
    parser.add_argument("path", nargs="?", default=default_events_path())
    parser.add_argument("--failures", action="store_true", help="show only traces with a failure")
    parser.add_argument("--trace", help="show only this trace id")
    args = parser.parse_args()

    events = load_events(args.path)

    by_trace = defaultdict(list)
    for e in events:
        by_trace[e.get("trace_id") or "(untraced)"].append(e)

    total_fail = sum(1 for e in events if e.get("ok") is False)
    print(f"\n{len(events)} events across {len(by_trace)} trace(s) - {total_fail} failure(s)\n")

    for trace_id, group in by_trace.items():
        if args.trace and trace_id != args.trace:
            continue
        has_fail = any(e.get("ok") is False for e in group)
        if args.failures and not has_fail:
            continue

        group.sort(key=lambda e: e.get("ts", ""))
        flag = "  (!) has failure" if has_fail else ""
        print(f"trace {trace_id}  ({len(group)} events){flag}")
        for e in group:
            print(fmt_event(e))
        print()


if __name__ == "__main__":
    main()
