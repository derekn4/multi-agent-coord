// test/trace.test.js
//
// Unit tests for the observability layer (src/trace.js): events append as valid
// JSONL, read back intact, trace ids are well-formed, and oversized payloads are
// truncated rather than risking a corrupt (interleaved) log line.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let DATA_DIR;
before(() => {
  DATA_DIR = mkdtempSync(join(tmpdir(), 'coord-trace-'));
  process.env.COORDINATOR_STATE_DIR = DATA_DIR;
});

beforeEach(() => {
  if (DATA_DIR && existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
});

const traceModule = () => import('../src/trace.js');

test('logEvent appends a stamped, parseable JSONL line; readEvents returns it', async () => {
  const { logEvent, readEvents } = await traceModule();
  logEvent({ event: 'tool_call', tool: 'send_message', ok: true, trace_id: 't-1' });

  const events = readEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].tool, 'send_message');
  assert.equal(events[0].trace_id, 't-1');
  assert.match(events[0].ts, /^\d{4}-\d{2}-\d{2}T/); // ISO 8601 stamp added
});

test('newTraceId is unique and prefixed', async () => {
  const { newTraceId } = await traceModule();
  const a = newTraceId();
  const b = newTraceId();
  assert.match(a, /^t-/);
  assert.notEqual(a, b);
});

test('oversized events drop the bulky payload but stay valid JSON', async () => {
  const { logEvent, readEvents } = await traceModule();
  logEvent({ event: 'tool_call', tool: 'set_state', ok: true, output: { blob: 'x'.repeat(9000) } });

  const events = readEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].payload_truncated, true);
  assert.equal(events[0].output, undefined);
});

test('multiple events accumulate in order', async () => {
  const { logEvent, readEvents } = await traceModule();
  logEvent({ event: 'session_start', session_id: 's1' });
  logEvent({ event: 'tool_call', tool: 'get_state', ok: true });
  const events = readEvents();
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'session_start');
  assert.equal(events[1].tool, 'get_state');
});
