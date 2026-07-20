// test/eval.test.js
//
// Proves the eval harness itself is trustworthy — that check() actually fails
// when it should, so a green scorecard means something. Two guards:
//   1. the real reference task passes against the live coordinator, and
//   2. a deliberately-wrong check is reported as a failure, and
//   3. buildScorecard aggregates pass/fail counts correctly.
// A harness that always reports "pass" would be worse than no harness.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectServer, freshDataDir, removeDataDir } from '../src/eval/harness.js';
import { buildScorecard } from '../src/eval/scorecard.js';
import msgRoundTrip from '../tasks/msg-round-trip.js';

// Run a single task once in an isolated state dir, mirroring the runner.
async function runTaskOnce(task) {
  const dataDir = freshDataDir();
  process.env.COORDINATOR_STATE_DIR = dataDir;
  try {
    const ctx = await task.run({ dataDir, connect: () => connectServer(dataDir), traceId: 't-eval-test' });
    return task.check(ctx);
  } finally {
    removeDataDir(dataDir);
  }
}

test('reference task passes against the live coordinator', async () => {
  assert.equal(await runTaskOnce(msgRoundTrip), true);
});

test('a deliberately-wrong check is reported as a failure (harness can fail)', async () => {
  const brokenTask = {
    ...msgRoundTrip,
    check: () => false, // same real run, impossible criteria
  };
  assert.equal(await runTaskOnce(brokenTask), false);
});

test('buildScorecard counts passes and computes overall pass rate', () => {
  const runs = [
    { taskId: 'a', title: 'A', pass: true, latencyMs: 10 },
    { taskId: 'a', title: 'A', pass: false, latencyMs: 30 },
    { taskId: 'b', title: 'B', pass: true, latencyMs: 20 },
  ];
  const sc = buildScorecard(runs, { n: 2 });

  const a = sc.tasks.find((t) => t.taskId === 'a');
  assert.equal(a.passes, 1);
  assert.equal(a.passRate, 0.5);
  assert.equal(a.p50Ms, 10); // nearest-rank over [10, 30]
  assert.equal(sc.overall.totalRuns, 3);
  assert.equal(sc.overall.passRate, round(2 / 3));
  assert.equal(sc.tasks[0].tokenCost, null); // scripted: token cost honestly N/A
});

const round = (n) => Number(n.toFixed(2));
