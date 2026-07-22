#!/usr/bin/env node
// src/eval/corpus-runner.js
//
// Builds the labeled failure corpus. Each injector runs N times against the
// REAL coordinator in its own throwaway state dir; the run's events.jsonl is
// copied out and named for its class and surface.
//
// Runs 1..SPLIT use surface A and form the retrieval index. Runs SPLIT+1..N use
// surface B -- a disjoint vocabulary -- and are held out. The label lives in the
// filename, so nothing has to stay in sync with a manifest.
//
// Usage:
//   node src/eval/corpus-runner.js            N=20, split=15
//   node src/eval/corpus-runner.js --n 20 --split 15
//   node src/eval/corpus-runner.js --clean    wipe the corpus dir first

import { rmSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { failureInjectors } from '../../tasks/failures/index.js';
import { connectServer, freshDataDir, removeDataDir, retainEvents } from './harness.js';
import { newTraceId } from '../trace.js';

const __dir = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = join(__dir, 'corpus');

function flagValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function runOnce(injector, surface, i) {
  const dataDir = freshDataDir();
  process.env.COORDINATOR_STATE_DIR = dataDir; // so logEvent() writes to THIS run's log
  const traceId = newTraceId();
  try {
    await injector.run({ dataDir, connect: () => connectServer(dataDir), traceId, surface, i });
  } catch (err) {
    // An injector throwing is a bug in the injector, not a failure to record.
    // Surface it loudly rather than silently banking a half-written trace.
    process.stderr.write(`INJECTOR ERROR ${injector.id} ${surface}-${i}: ${err.message}\n`);
  }
  const dest = retainEvents(
    dataDir,
    CORPUS_DIR,
    `${injector.id}-${surface}-${String(i).padStart(2, '0')}`,
  );
  removeDataDir(dataDir);
  if (!dest) process.stderr.write(`NO TRACE ${injector.id} ${surface}-${i}\n`);
  return dest;
}

async function main() {
  const N = Number(flagValue('--n', 20));
  const SPLIT = Number(flagValue('--split', 15));

  if (process.argv.includes('--clean')) rmSync(CORPUS_DIR, { recursive: true, force: true });
  mkdirSync(CORPUS_DIR, { recursive: true });

  for (const injector of failureInjectors) {
    for (let i = 0; i < N; i++) {
      await runOnce(injector, i < SPLIT ? 'A' : 'B', i);
    }
    process.stdout.write(`${injector.id}: ${N} runs\n`);
  }

  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.jsonl'));
  console.log(`\ncorpus: ${files.length} traces in ${CORPUS_DIR}`);
  if (files.length !== failureInjectors.length * N) {
    console.error(`expected ${failureInjectors.length * N}`);
    process.exit(1);
  }
}

main();
