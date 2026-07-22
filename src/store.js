// src/store.js
//
// The persistence layer that solves the cross-process state isolation problem.
//
// Each Claude Code session spawns its OWN child process of this MCP server, so
// anything kept in an in-memory object is invisible to the other session. The
// fix is to make a single JSON file on disk the source of truth: every mutation
// writes it, every read loads it. This module owns that file and the two
// correctness guarantees around it:
//
//   1. Atomic writes  -> a reader never sees a half-written file.
//   2. A cross-process lock -> two writers never clobber each other.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

import { evaluateCriteria } from './criteria.js';

// The empty shape of our persisted document. `messages` is an append-only log;
// `state` is a flat key/value bag shared across sessions.
const EMPTY = { messages: [], state: {} };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Paths are resolved lazily (per call) rather than at import time so that tests
// can point COORDINATOR_STATE_DIR at a throwaway temp directory before calling.
// The default is a stable absolute path in the user's home dir so that two
// sessions launched from *different projects* still share one state file.
function paths() {
  const dir =
    process.env.COORDINATOR_STATE_DIR || join(os.homedir(), '.multi-agent-coord');
  return {
    dir,
    stateFile: join(dir, 'state.json'),
    lockDir: join(dir, 'state.lock'),
  };
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Read the whole document from disk. Safe to call without the lock: because all
// writes go through writeAtomic (temp file + rename), a reader always observes a
// complete file — either the old contents or the new ones, never a torn write.
export function readAll() {
  const { dir, stateFile } = paths();
  ensureDir(dir);
  if (!existsSync(stateFile)) return structuredClone(EMPTY);
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch (err) {
    // With atomic writes this should be unreachable. If it ever fires, fail
    // loudly instead of silently returning empty state and hiding data loss.
    throw new Error(`Corrupt coordinator state file at ${stateFile}: ${err.message}`);
  }
}

// Durable, atomic replace: write a uniquely-named temp file in the same
// directory, then rename it over the target. rename() within one filesystem is
// atomic, so concurrent readers flip from old to new in a single step.
function writeAtomic(data) {
  const { dir, stateFile } = paths();
  ensureDir(dir);
  const tmp = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, stateFile);
}

// Mutual exclusion across processes, built on mkdir(): creating a directory is
// atomic and fails with EEXIST if it already exists, so exactly one process can
// hold the lock at a time. A crashed holder can't deadlock everyone forever —
// a lock older than staleMs is treated as abandoned and reclaimed.
async function withLock(fn, { retries = 200, delayMs = 25, staleMs = 15000 } = {}) {
  const { dir, lockDir } = paths();
  ensureDir(dir);

  let held = false;
  for (let attempt = 0; attempt < retries && !held; attempt++) {
    try {
      mkdirSync(lockDir); // atomic: throws EEXIST if another process holds it
      held = true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Someone holds the lock. Reclaim it if it looks abandoned, else wait.
      try {
        const ageMs = Date.now() - statSync(lockDir).mtimeMs;
        if (ageMs > staleMs) {
          rmdirSync(lockDir);
          continue; // retry immediately after clearing the stale lock
        }
      } catch {
        // Lock vanished between our checks — just retry.
      }
      await sleep(delayMs);
    }
  }

  if (!held) throw new Error('Could not acquire coordinator state lock (timed out)');

  try {
    return await fn();
  } finally {
    try {
      rmdirSync(lockDir);
    } catch {
      // Already released or reclaimed as stale; nothing to do.
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — the four operations the MCP tools are thin wrappers around.
// ---------------------------------------------------------------------------

// Append a message to the shared log. Returns the stored record (with id + ts).
// The id is assigned inside the lock, so ids stay unique under concurrency.
export async function appendMessage({ from, to, body, trace_id }) {
  return withLock(() => {
    const data = readAll();
    const record = {
      id: data.messages.length + 1,
      ts: new Date().toISOString(),
      from,
      to,
      body,
      trace_id: trace_id ?? null,
    };
    data.messages.push(record);
    writeAtomic(data);
    return record;
  });
}

// Read messages addressed to `to` (or broadcast to 'all'). `since` is an
// exclusive ISO-timestamp cursor so a caller can poll for only what's new.
// Pure read — no lock needed.
export function readMessages({ to, since } = {}) {
  const { messages } = readAll();
  return messages.filter((m) => {
    if (to && m.to !== to && m.to !== 'all') return false;
    if (since && m.ts <= since) return false;
    return true;
  });
}

// Set a shared state key. Read-modify-write, so it runs under the lock.
export async function setState(key, value) {
  return withLock(() => {
    const data = readAll();
    data.state[key] = value;
    writeAtomic(data);
    return { key, value };
  });
}

// Get one shared state key, or the whole state bag when key is omitted.
export function getState(key) {
  const { state } = readAll();
  return key === undefined ? state : state[key];
}

// Verify an agent's claimed completion and record the verdict — the Phase 3 gate.
//
// Everything happens in ONE locked read-modify-write, and the criteria are graded
// against the same in-lock snapshot the counter is written from. Evaluating
// outside the lock would let two concurrent callers both observe attempts:1 and
// both be granted a further try, so the bound would leak under exactly the
// concurrency the multi-process test already proves this store sees.
//
// Both terminal states are sticky and return BEFORE incrementing:
//   verified  -> idempotent, so a retry storm cannot burn attempts
//   escalated -> a human has been paged; the agent does not get to un-page them
export async function completeTask({ task_id, criteria, maxAttempts = 2 }) {
  return withLock(() => {
    const data = readAll();
    const key = `task:${task_id}`;
    const prior = data.state[key];

    if (prior?.status === 'verified' || prior?.status === 'escalated') return prior;

    const attempts = (prior?.attempts ?? 0) + 1;
    const failures = evaluateCriteria(criteria, data);
    const status =
      failures.length === 0 ? 'verified' : attempts >= maxAttempts ? 'escalated' : 'pending';

    const record = { status, attempts, last_failures: failures };
    data.state[key] = record;
    writeAtomic(data);
    return record;
  });
}
