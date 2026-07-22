#!/usr/bin/env node
// src/eval/verification-runner.js
//
// Phase 3 two-arm eval. Every unreliable-agent task runs twice per iteration --
// once with no gate, once through complete_task -- in its own isolated state
// dir, and the run's event log is retained for post-hoc inspection.
//
// The defects are DETERMINISTIC, so the pass rates are exact by construction,
// not sampled. N guards against flakiness and measures latency; it does not
// estimate a rate. Say so when quoting these numbers.
//
// Usage:
//   node src/eval/verification-runner.js            all tasks, both arms, N=5
//   node src/eval/verification-runner.js --n 20     runs per task per arm

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { verificationTasks } from '../../tasks/verification/index.js';
import { connectServer, freshDataDir, removeDataDir, retainEvents } from './harness.js';
import { newTraceId } from '../trace.js';
import { runArm } from './verification-driver.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const TRACE_DIR = join(__dir, 'traces');

function flagValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const N = Number(flagValue('--n', 5));

async function runOnce(task, arm, i) {
  const dataDir = freshDataDir();
  process.env.COORDINATOR_STATE_DIR = dataDir;
  const traceId = newTraceId();
  const start = performance.now();
  let result;
  try {
    result = await runArm(task, arm, { connect: () => connectServer(dataDir), traceId });
  } catch (err) {
    // A crash is a failure, never a silent pass, and never aborts the sweep.
    result = {
      taskId: task.id, title: task.title, arm,
      pass: false, verified: null, attempts: 0, escalated: false, silentFailure: false,
      error: err.message,
    };
  }
  result.latencyMs = Number((performance.now() - start).toFixed(2));
  retainEvents(dataDir, TRACE_DIR, `${task.id}-${arm}-${i + 1}`);
  removeDataDir(dataDir);
  return result;
}

function summarize(runs) {
  const n = runs.length;
  const rate = (pred) => (n ? Number((runs.filter(pred).length / n).toFixed(2)) : null);
  return {
    runs: n,
    passRate: rate((r) => r.pass),
    escalationRate: rate((r) => r.escalated),
    silentFailureRate: rate((r) => r.silentFailure),
  };
}

const pad = (s, w) => (String(s).length >= w ? String(s) : String(s) + ' '.repeat(w - String(s).length));
const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);

async function main() {
  const all = [];
  for (const task of verificationTasks) {
    for (const arm of ['ungated', 'gated']) {
      for (let i = 0; i < N; i++) all.push(await runOnce(task, arm, i));
    }
  }

  const ungated = all.filter((r) => r.arm === 'ungated');
  const gated = all.filter((r) => r.arm === 'gated');
  const u = summarize(ungated);
  const g = summarize(gated);

  const lines = [];
  lines.push(`Verification scorecard  (N=${N} runs/task/arm, defects are deterministic)`);
  lines.push('='.repeat(78));
  lines.push(pad('TASK', 28) + pad('UNGATED', 12) + pad('GATED', 12) + pad('ESCALATED', 12) + 'SILENT');
  lines.push('-'.repeat(78));
  for (const task of verificationTasks) {
    const tu = summarize(ungated.filter((r) => r.taskId === task.id));
    const tg = summarize(gated.filter((r) => r.taskId === task.id));
    lines.push(
      pad(task.id, 28) + pad(pct(tu.passRate), 12) + pad(pct(tg.passRate), 12) +
      pad(pct(tg.escalationRate), 12) + pct(tg.silentFailureRate),
    );
  }
  lines.push('-'.repeat(78));
  lines.push(`PASS RATE   ungated ${pct(u.passRate)} -> gated ${pct(g.passRate)}`);
  lines.push(`ESCALATED   ${pct(g.escalationRate)} of gated runs stopped for a human`);
  lines.push(`SILENT FAIL ${pct(u.silentFailureRate)} -> ${pct(g.silentFailureRate)}  <- the headline`);
  lines.push('');
  lines.push(`Traces retained in ${TRACE_DIR}`);
  console.log(lines.join('\n'));

  // The gate's whole purpose: no bad completion is ever accepted as done.
  if (g.silentFailureRate !== 0) {
    console.error('\nFAIL: a bad completion was accepted as done in the gated arm.');
    process.exit(1);
  }
  process.exit(0);
}

main();
