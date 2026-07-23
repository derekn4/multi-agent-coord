// test/smoke.test.js
//
// End-to-end proof that the MCP server works: launch src/coordinator.js as a
// real child process, connect over stdio with the MCP client, and call all four
// tools. This is the Phase 0 "confirm the tools work" check — it exercises the
// full path (client -> stdio -> server -> store -> disk -> back).
//
// It also proves the three handlers you typed actually work: if any still
// throws, its callTool result comes back with isError set and the test fails.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readEvents } from '../src/trace.js';

const serverPath = fileURLToPath(new URL('../src/coordinator.js', import.meta.url));

let dataDir;
let client;
let transport;

// Parse a tool result: assert it's not an error, then JSON.parse its text block.
function parseResult(res) {
  assert.ok(!res.isError, `tool returned an error: ${JSON.stringify(res.content)}`);
  return JSON.parse(res.content[0].text);
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'coord-smoke-'));
  process.env.COORDINATOR_STATE_DIR = dataDir; // so readEvents() reads the same log the server writes
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, COORDINATOR_STATE_DIR: dataDir },
  });
  client = new Client({ name: 'smoke-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test('server advertises all six tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'complete_task',
    'diagnose_failure',
    'get_state',
    'read_messages',
    'send_message',
    'set_state',
  ]);
});

test('send_message then read_messages round-trips across the tool boundary', async () => {
  const sent = parseResult(
    await client.callTool({
      name: 'send_message',
      arguments: { from: 'agentA', to: 'agentB', body: 'ping' },
    }),
  );
  assert.equal(sent.body, 'ping');
  assert.equal(sent.id, 1);

  const messages = parseResult(
    await client.callTool({ name: 'read_messages', arguments: { to: 'agentB' } }),
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, 'ping');
});

test('set_state then get_state round-trips', async () => {
  parseResult(
    await client.callTool({
      name: 'set_state',
      arguments: { key: 'task_42_status', value: 'in_progress' },
    }),
  );

  const got = parseResult(
    await client.callTool({ name: 'get_state', arguments: { key: 'task_42_status' } }),
  );
  assert.equal(got.value, 'in_progress');
});

test('every tool call is instrumented into the trace log with latency and trace id', async () => {
  const traceId = 't-smoke-cross-session';
  await client.callTool({
    name: 'send_message',
    arguments: { from: 'A', to: 'B', body: 'traced', trace_id: traceId },
  });
  await client.callTool({
    name: 'read_messages',
    arguments: { to: 'B', trace_id: traceId },
  });

  const traced = readEvents().filter((e) => e.trace_id === traceId);
  assert.ok(traced.length >= 2, 'both calls appear under the same trace id');

  const send = traced.find((e) => e.tool === 'send_message');
  assert.equal(send.ok, true);
  assert.equal(typeof send.latency_ms, 'number');
  assert.equal(send.session_id?.startsWith('srv-'), true);
});

test('complete_task gates a claimed completion and reports the reason', async () => {
  parseResult(
    await client.callTool({
      name: 'set_state',
      arguments: { key: 'deploy_status', value: 'pending' },
    }),
  );

  const criteria = [{ state_key: 'deploy_status', equals: 'done' }];

  const first = parseResult(
    await client.callTool({ name: 'complete_task', arguments: { task_id: 'deploy', criteria } }),
  );
  assert.equal(first.verified, false);
  assert.equal(first.attempts, 1);
  assert.equal(first.escalate, false);
  assert.deepEqual(first.failures, [
    "state_key deploy_status: expected 'done', got 'pending'",
  ]);

  // The agent repairs, then re-claims.
  parseResult(
    await client.callTool({
      name: 'set_state',
      arguments: { key: 'deploy_status', value: 'done' },
    }),
  );
  const second = parseResult(
    await client.callTool({ name: 'complete_task', arguments: { task_id: 'deploy', criteria } }),
  );
  assert.equal(second.verified, true);
  assert.equal(second.attempts, 2);
});

test('the verification outcome lands in the trace log', async () => {
  const events = readEvents().filter((e) => e.event === 'verification');
  assert.ok(events.length >= 2, 'each complete_task call logs one verification event');
  const passed = events.find((e) => e.verified === true);
  assert.equal(passed.task_id, 'deploy');
  assert.equal(typeof passed.attempt, 'number');
});
