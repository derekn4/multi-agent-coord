// src/trace.js
//
// The observability layer: a JSONL event log that every coordinator tool call
// and agent-side hook writes to. One JSON object per line, append-only. This is
// deliberately plain (JSONL + append) rather than OpenTelemetry — the story is
// reliability engineering, not infrastructure tourism. See the roadmap in the
// README for why traces matter (reconstructing any multi-agent run after it ran).

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

// Keep a single line small enough that a lone append syscall stays atomic across
// processes (POSIX guarantees atomicity for O_APPEND writes under PIPE_BUF). If
// input/output push a line past this, we drop the bulky `output` field rather
// than risk interleaved, corrupt lines in the log.
const MAX_LINE = 4000;

function paths() {
  const dir =
    process.env.COORDINATOR_STATE_DIR || join(os.homedir(), '.multi-agent-coord');
  return { dir, eventsFile: join(dir, 'events.jsonl') };
}

// A trace id follows one logical task across sessions. Agent A mints it, sends
// it on a message; agent B reads it and threads it through its own tool calls,
// so both sides' events share the id.
export function newTraceId() {
  return `t-${randomUUID()}`;
}

// Append one event. Stamps `ts` (ISO 8601 UTC). Never throws into the caller —
// logging must not break a tool call or a hook.
export function logEvent(event) {
  try {
    const { dir, eventsFile } = paths();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const full = { ts: new Date().toISOString(), ...event };
    let line = JSON.stringify(full);
    if (line.length > MAX_LINE) {
      delete full.output;
      delete full.input;
      full.payload_truncated = true;
      line = JSON.stringify(full);
    }
    appendFileSync(eventsFile, line + '\n');
    return full;
  } catch (err) {
    process.stderr.write(`trace.logEvent failed: ${err.message}\n`);
    return null;
  }
}

// Read the whole event log back as parsed objects. Bad lines are skipped rather
// than aborting a viewer or a test over one malformed entry.
export function readEvents() {
  const { eventsFile } = paths();
  if (!existsSync(eventsFile)) return [];
  return readFileSync(eventsFile, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
