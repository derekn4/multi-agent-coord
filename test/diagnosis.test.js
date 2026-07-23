// test/diagnosis.test.js
//
// End-to-end through the REAL MCP server: client -> stdio -> server -> corpus
// index -> back. Same full path as smoke.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { connectServer } from '../src/eval/harness.js';
import { CORPUS_DIR } from '../src/rag/corpus.js';

let dataDir;
let s;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'coord-diag-'));
  // Seed this run's event log with a known corrupted-state-file trace, so the
  // server has something to read and we know the right answer.
  copyFileSync(join(CORPUS_DIR, 'corrupted-state-file-B-16.jsonl'), join(dataDir, 'events.jsonl'));
  s = await connectServer(dataDir);
});

after(async () => {
  try { await s.close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
});

async function diagnose(trace_id) {
  const res = await s.client.callTool({ name: 'diagnose_failure', arguments: { trace_id } });
  assert.equal(res.isError, undefined, JSON.stringify(res.content));
  return JSON.parse(res.content[0].text);
}

test('server advertises diagnose_failure', async () => {
  const { tools } = await s.client.listTools();
  assert.ok(tools.map((t) => t.name).includes('diagnose_failure'));
});

test('classifies a held-out trace and returns its remediation', async () => {
  const { readFileSync } = await import('node:fs');
  const first = JSON.parse(readFileSync(join(dataDir, 'events.jsonl'), 'utf8').split('\n')[0]);
  const out = await diagnose(first.trace_id);

  assert.equal(out.predicted_class, 'corrupted-state-file');
  assert.ok(out.confidence > 0);
  assert.equal(out.neighbors.length, 3);
  assert.ok(out.remediation.remediation.length > 0);
  assert.ok(out.remediation.root_cause.length > 0);
});

test('an unknown trace_id returns a clean no-match, not a confident guess', async () => {
  const out = await diagnose('t-does-not-exist');
  assert.equal(out.predicted_class, null);
  assert.deepEqual(out.neighbors, []);
  assert.equal(out.remediation, null);
  assert.match(out.reason, /no events/);
});

test('an out-of-distribution trace is rejected by the confidence floor', async () => {
  // A trace whose shape matches none of the five classes: a lone unrelated event.
  const { appendFileSync } = await import('node:fs');
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event: 'heartbeat',
    trace_id: 't-ood-probe',
    session_id: 'srv-ood',
  });
  appendFileSync(join(dataDir, 'events.jsonl'), line + '\n');

  const out = await diagnose('t-ood-probe');
  assert.equal(out.predicted_class, null, 'must decline rather than guess');
  assert.match(out.reason, /confidence floor|no events/);
});
