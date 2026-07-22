// test/verification-falsification.test.js
//
// Neuter the gate and confirm the gated arm collapses back onto the ungated one.
//
// This is the test that makes the whole phase's numbers mean something. If the
// gated arm still looks good with a verifier that rubber-stamps everything, the
// gate is theater and the 20% -> 80% story is an artifact of the harness.
//
// The stub replaces the CRITERIA with an empty list -- which can never fail, so
// complete_task always returns verified:true on attempt 1. The agent still runs
// its normal repair-and-retry path; it just never learns it needs to repair.
// That is exactly the "always returns verified:true" mutation the design calls
// for.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verificationTasks } from '../tasks/verification/index.js';
import { connectServer, freshDataDir, removeDataDir } from '../src/eval/harness.js';
import { runArm } from '../src/eval/verification-driver.js';
import { newTraceId } from '../src/trace.js';

async function sweep(arm, { rubberStamp = false } = {}) {
  const results = [];
  for (const task of verificationTasks) {
    const dataDir = freshDataDir();
    process.env.COORDINATOR_STATE_DIR = dataDir;

    const patched = rubberStamp ? { ...task, criteria: [] } : task;

    try {
      results.push(await runArm(patched, arm, {
        connect: () => connectServer(dataDir),
        traceId: newTraceId(),
      }));
    } finally {
      removeDataDir(dataDir);
    }
  }
  return results;
}

const rate = (rs, pred) => Number((rs.filter(pred).length / rs.length).toFixed(2));

test('the real gate lifts pass rate and drives silent failures to zero', async () => {
  const ungated = await sweep('ungated');
  const gated = await sweep('gated');

  assert.equal(rate(ungated, (r) => r.pass), 0.2, 'ungated: only the control passes');
  assert.equal(rate(gated, (r) => r.pass), 0.8, 'gated: all but persistently-broken pass');
  assert.equal(rate(ungated, (r) => r.silentFailure), 0.8);
  assert.equal(rate(gated, (r) => r.silentFailure), 0, 'no bad completion is accepted');
});

test('FALSIFICATION: a rubber-stamping gate collapses back to ungated', async () => {
  const stamped = await sweep('gated', { rubberStamp: true });

  // Every task is "verified" on attempt 1, so no defect is ever repaired and the
  // pass rate falls back to the ungated 20%...
  assert.equal(rate(stamped, (r) => r.verified === true), 1, 'the stub verifies everything');
  assert.equal(rate(stamped, (r) => r.pass), 0.2, 'no repairs happen without real feedback');

  // ...and, worst of all, bad completions are once again accepted as done.
  assert.equal(
    rate(stamped, (r) => r.silentFailure),
    0.8,
    'a rubber-stamp gate reintroduces silent failures -- proving the real gate is load-bearing',
  );
});
