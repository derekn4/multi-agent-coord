// test/store.test.js
//
// Proves the two persistence guarantees Phase 0 claims:
//   1. State survives a process restart (it lives on disk, not in RAM).
//   2. Concurrent writers — including separate OS processes — never corrupt
//      the file or lose updates.
//
// Uses only the built-in node:test runner, no extra deps.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Point the store at a throwaway temp dir BEFORE importing it, so real state in
// ~/.multi-agent-coord is never touched by the tests.
let DATA_DIR;
before(() => {
  DATA_DIR = mkdtempSync(join(tmpdir(), 'coord-test-'));
  process.env.COORDINATOR_STATE_DIR = DATA_DIR;
});

// Fresh state dir per test for isolation.
beforeEach(() => {
  if (DATA_DIR && existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
});

const storeModule = () => import('../src/store.js');

test('state persists across a simulated restart (survives on disk)', async () => {
  const { setState } = await storeModule();
  await setState('task_42_status', 'in_progress');

  // Simulate a restart by reading the file back in a brand-new Node process.
  // If state lived in RAM, this child would see nothing.
  const reader = fileURLToPath(new URL('../test-helpers/read-state.mjs', import.meta.url));
  const out = execFileSync(process.execPath, [reader, 'task_42_status'], {
    env: { ...process.env, COORDINATOR_STATE_DIR: DATA_DIR },
    encoding: 'utf8',
  }).trim();

  assert.equal(out, 'in_progress');
});

test('messages round-trip and honor to/since filtering', async () => {
  const { appendMessage, readMessages } = await storeModule();
  const first = await appendMessage({ from: 'A', to: 'B', body: 'hello' });
  await appendMessage({ from: 'A', to: 'all', body: 'broadcast' });
  await appendMessage({ from: 'A', to: 'C', body: 'not for B' });

  const forB = readMessages({ to: 'B' });
  assert.deepEqual(forB.map((m) => m.body), ['hello', 'broadcast']);

  const afterFirst = readMessages({ to: 'B', since: first.ts });
  assert.deepEqual(afterFirst.map((m) => m.body), ['broadcast']);
});

test('concurrent in-process appends keep unique ids and valid JSON', async () => {
  const { appendMessage, readAll } = await storeModule();
  const N = 50;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      appendMessage({ from: 'A', to: 'B', body: `msg-${i}` }),
    ),
  );
  const { messages } = readAll();
  assert.equal(messages.length, N);
  const ids = new Set(messages.map((m) => m.id));
  assert.equal(ids.size, N, 'all message ids must be unique');
});

test('concurrent MULTI-PROCESS appends never corrupt or lose writes', async () => {
  // The real test of the cross-process lock: spawn several separate Node
  // processes that all hammer the same state file at once.
  const { readAll } = await storeModule();
  const writer = fileURLToPath(new URL('../test-helpers/append-writer.mjs', import.meta.url));

  const PROCS = 5;
  const PER_PROC = 10;
  const children = Array.from({ length: PROCS }, (_, p) =>
    new Promise((resolve, reject) => {
      try {
        execFileSync(process.execPath, [writer, String(p), String(PER_PROC)], {
          env: { ...process.env, COORDINATOR_STATE_DIR: DATA_DIR },
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    }),
  );
  await Promise.all(children);

  const { messages } = readAll(); // throws if the file is corrupt JSON
  assert.equal(messages.length, PROCS * PER_PROC, 'no writes lost to races');
  const ids = new Set(messages.map((m) => m.id));
  assert.equal(ids.size, PROCS * PER_PROC, 'ids stayed unique across processes');
});
