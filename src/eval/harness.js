// src/eval/harness.js
//
// Test-harness plumbing shared by the eval runner and the eval tests. It knows
// how to spawn the REAL coordinator as a child process (bound to a throwaway
// state dir) and talk to it over stdio with the MCP client — the exact same
// full path exercised by test/smoke.test.js (client -> stdio -> server -> store
// -> disk -> back). Tasks stay focused on coordination logic; this file owns the
// process/transport boilerplate.

import { mkdtempSync, rmSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = fileURLToPath(new URL('../coordinator.js', import.meta.url));

// Spawn the coordinator bound to `dataDir` and connect a client over stdio.
// Returns { client, transport, kill, close }. A task can call this more than
// once against the same dataDir to simulate a process restart (see the
// persistence task).
//
// `kill` SIGKILLs the child with no clean shutdown — the Phase 4 killed-session
// injector needs the server to die mid-call so its trace ends with no terminal
// event, which is exactly what a crashed session looks like.
export async function connectServer(dataDir) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, COORDINATOR_STATE_DIR: dataDir },
  });
  const client = new Client({ name: 'eval-harness', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport, kill: () => killChild(transport), close: () => client.close() };
}

// The MCP SDK does not promise a stable handle on the child, so reach for the
// documented `pid` first and fall back to the private field. Returns the pid
// killed, or null if no handle was reachable — callers assert on that rather
// than silently recording a trace that was never actually interrupted.
function killChild(transport) {
  const proc = transport.process ?? transport._process ?? null;
  const pid = transport.pid ?? proc?.pid ?? null;
  try {
    if (proc && typeof proc.kill === 'function') {
      proc.kill('SIGKILL');
      return pid;
    }
    if (pid) {
      process.kill(pid, 'SIGKILL');
      return pid;
    }
  } catch {
    // Already dead; that is the outcome we wanted anyway.
    return pid;
  }
  return null;
}

// Call a tool, assert it did not error, and return its parsed JSON payload.
// (For tasks that deliberately expect an error, call client.callTool directly
// and inspect res.isError instead.)
export async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) {
    throw new Error(`tool ${name} returned an error: ${JSON.stringify(res.content)}`);
  }
  return JSON.parse(res.content[0].text);
}

// A throwaway state dir for one task run; the runner removes it afterwards.
export function freshDataDir() {
  return mkdtempSync(join(tmpdir(), 'coord-eval-'));
}

// Best-effort cleanup. On Windows a just-exited child process can still hold a
// handle on the state dir, and rmSync then throws ENOTEMPTY/EPERM. The runner
// calls this outside its per-run try/catch, so an unhandled throw here would
// abort the WHOLE eval run and discard every result already collected — never
// worth that for a temp dir the OS will reclaim anyway.
export function removeDataDir(dir) {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // Leave it behind rather than fail the run.
  }
}

// Copy a run's event log out of its temp state dir before that dir is removed.
//
// Phase 2 shipped without this, so the logs died with the temp dir and nothing
// could be inspected after the fact. Best-effort by the same reasoning as
// removeDataDir: a failed copy of a diagnostic artifact must never take down an
// eval run that already produced real results. A missing log is normal — a task
// that makes no tool calls writes none.
export function retainEvents(dataDir, destDir, label) {
  if (!dataDir) return null;
  try {
    const src = join(dataDir, 'events.jsonl');
    if (!existsSync(src)) return null;
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, `${label}.jsonl`);
    copyFileSync(src, dest);
    return dest;
  } catch {
    return null;
  }
}
