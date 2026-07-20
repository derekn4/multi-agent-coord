#!/usr/bin/env node
// src/eval/runner.js
//
// Phase 2 eval harness runner. For every task it:
//   1. makes a fresh, isolated state dir,
//   2. runs the task against the REAL coordinator (spawned per run over stdio),
//   3. records pass/fail + wall-clock latency,
// then prints a scorecard and manages the saved baseline.
//
// Runs are sequential (not parallel) so each task's traces stay clean and the
// per-run state dir is never shared.
//
// Usage:
//   node src/eval/runner.js                  run all tasks, print scorecard, diff vs baseline
//   node src/eval/runner.js --n 10           set runs per task (default 5)
//   node src/eval/runner.js --save-baseline  (re)establish baseline.json explicitly

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

import { tasks } from '../../tasks/index.js';
import { connectServer, freshDataDir, removeDataDir } from './harness.js';
import { newTraceId } from '../trace.js';
import { buildScorecard, formatScorecard } from './scorecard.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(__dir, 'baseline.json');

function flagValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const N = Number(flagValue('--n', 5));
const SAVE_BASELINE = process.argv.includes('--save-baseline');

// Run one task once in its own state dir. A thrown error counts as a failure —
// the harness never lets a task crash the whole run.
async function runOnce(task) {
  const dataDir = freshDataDir();
  process.env.COORDINATOR_STATE_DIR = dataDir; // so trace.readEvents() reads THIS run's log
  const traceId = newTraceId();
  const start = performance.now();
  let ctx;
  let pass;
  try {
    ctx = await task.run({ dataDir, connect: () => connectServer(dataDir), traceId });
    pass = Boolean(task.check(ctx));
  } catch (err) {
    pass = false;
    ctx = { error: err.message };
  }
  const latencyMs = Number((performance.now() - start).toFixed(2));
  removeDataDir(dataDir);
  return { taskId: task.id, title: task.title, pass, latencyMs, ctx };
}

async function main() {
  const runs = [];
  for (const task of tasks) {
    for (let i = 0; i < N; i++) {
      const r = await runOnce(task);
      runs.push(r);
      if (!r.pass) {
        process.stderr.write(`FAIL ${task.id} run ${i + 1}: ${r.ctx?.error ?? 'check returned false'}\n`);
      }
    }
  }

  const sc = buildScorecard(runs, { n: N });
  console.log(formatScorecard(sc));

  if (SAVE_BASELINE || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, JSON.stringify(sc, null, 2));
    console.log(`\n[baseline ${SAVE_BASELINE ? 'overwritten' : 'established'}] -> ${BASELINE}`);
  } else {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const was = Math.round((base.overall.passRate ?? 0) * 100);
    const now = Math.round((sc.overall.passRate ?? 0) * 100);
    console.log(`\nvs baseline: ${was}% -> ${now}%`);
  }

  // Non-zero exit if anything failed, so this can gate CI later.
  process.exit(sc.overall.passRate === 1 ? 0 : 1);
}

main();
