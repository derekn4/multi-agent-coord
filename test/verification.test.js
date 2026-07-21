// test/verification.test.js
//
// completeTask is the gate. These tests pin the three behaviors that make it a
// real guardrail rather than a suggestion: it grades against what is ACTUALLY
// on disk, it enforces the attempt bound itself, and both terminal states are
// sticky so a retrying agent cannot walk back a verdict.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let DATA_DIR;
before(() => {
  DATA_DIR = mkdtempSync(join(tmpdir(), 'coord-verify-'));
  process.env.COORDINATOR_STATE_DIR = DATA_DIR;
});
beforeEach(() => {
  if (DATA_DIR && existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
});

const storeModule = () => import('../src/store.js');

test('criteria that hold produce a verified record on attempt 1', async () => {
  const { setState, completeTask } = await storeModule();
  await setState('step1_status', 'done');

  const r = await completeTask({
    task_id: 'step1',
    criteria: [{ state_key: 'step1_status', equals: 'done' }],
  });

  assert.equal(r.status, 'verified');
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.last_failures, []);
});

test('criteria that fail produce pending with an actionable reason', async () => {
  const { setState, completeTask } = await storeModule();
  await setState('step1_status', 'pending');

  const r = await completeTask({
    task_id: 'step1',
    criteria: [{ state_key: 'step1_status', equals: 'done' }],
  });

  assert.equal(r.status, 'pending');
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.last_failures, [
    "state_key step1_status: expected 'done', got 'pending'",
  ]);
});

test('the record is written into shared state, readable by any session', async () => {
  const { completeTask, getState } = await storeModule();
  await completeTask({ task_id: 'step1', criteria: [{ state_key: 'x', exists: true }] });

  const record = await getState('task:step1');
  assert.equal(record.status, 'pending');
  assert.equal(record.attempts, 1);
});

test('a repaired second attempt verifies', async () => {
  const { setState, completeTask } = await storeModule();
  const criteria = [{ state_key: 'step1_status', equals: 'done' }];

  await setState('step1_status', 'pending');
  const first = await completeTask({ task_id: 'step1', criteria });
  assert.equal(first.status, 'pending');

  await setState('step1_status', 'done'); // the agent repairs
  const second = await completeTask({ task_id: 'step1', criteria });
  assert.equal(second.status, 'verified');
  assert.equal(second.attempts, 2);
});

test('two failed attempts escalate rather than granting a third', async () => {
  const { setState, completeTask } = await storeModule();
  const criteria = [{ state_key: 'step1_status', equals: 'done' }];
  await setState('step1_status', 'broken');

  const first = await completeTask({ task_id: 'step1', criteria });
  const second = await completeTask({ task_id: 'step1', criteria });

  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'escalated');
  assert.equal(second.attempts, 2);
});

test('escalated is sticky: further attempts do not increment or re-grade', async () => {
  const { setState, completeTask } = await storeModule();
  const criteria = [{ state_key: 'step1_status', equals: 'done' }];
  await setState('step1_status', 'broken');

  await completeTask({ task_id: 'step1', criteria });
  await completeTask({ task_id: 'step1', criteria });

  // Even after the agent "fixes" it, an escalated task stays escalated --
  // a human has been paged; the agent does not get to un-page them.
  await setState('step1_status', 'done');
  const third = await completeTask({ task_id: 'step1', criteria });

  assert.equal(third.status, 'escalated');
  assert.equal(third.attempts, 2, 'attempts must not increment past the bound');
});

test('verified is sticky and idempotent', async () => {
  const { setState, completeTask } = await storeModule();
  const criteria = [{ state_key: 'step1_status', equals: 'done' }];
  await setState('step1_status', 'done');

  const first = await completeTask({ task_id: 'step1', criteria });
  const again = await completeTask({ task_id: 'step1', criteria });

  assert.equal(first.status, 'verified');
  assert.equal(again.status, 'verified');
  assert.equal(again.attempts, 1, 'a repeat call must not burn an attempt');
});

test('independent task_ids keep independent attempt counters', async () => {
  const { completeTask } = await storeModule();
  const criteria = [{ state_key: 'nope', exists: true }];

  await completeTask({ task_id: 'alpha', criteria });
  const beta = await completeTask({ task_id: 'beta', criteria });

  assert.equal(beta.attempts, 1);
});

test('concurrent MULTI-PROCESS attempts cannot both slip past the bound', async () => {
  const { completeTask, getState } = await storeModule();
  const writer = fileURLToPath(new URL('../test-helpers/complete-task-writer.mjs', import.meta.url));

  // Four processes race to grade the same failing task at once. If evaluation
  // happened outside the lock they could all read attempts:0, all write 1, and
  // the task would never reach the bound.
  await Promise.all(
    Array.from({ length: 4 }, () =>
      execFileAsync(process.execPath, [writer, DATA_DIR, 'raced'], {
        env: { ...process.env, COORDINATOR_STATE_DIR: DATA_DIR },
      }),
    ),
  );

  const record = await getState('task:raced');
  assert.equal(record.status, 'escalated', 'four failing attempts must reach the bound');
  assert.equal(record.attempts, 2, 'attempts must stop at the bound, not count every caller');

  // And the terminal state genuinely refuses more work.
  const after = await completeTask({
    task_id: 'raced',
    criteria: [{ state_key: 'never_written', exists: true }],
  });
  assert.equal(after.attempts, 2);
});
