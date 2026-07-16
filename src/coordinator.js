#!/usr/bin/env node
// src/coordinator.js
//
// The MCP server. It exposes four tools that let concurrent Claude Code
// sessions coordinate. Every tool is a THIN wrapper over src/store.js — the
// interesting correctness work (atomic writes, cross-process lock) already
// lives there, so these handlers just validate input and call the store.
//
// ── PAIR-BUILD NOTE ─────────────────────────────────────────────────────────
// `send_message` below is fully implemented as your reference pattern.
// The other three tools (read_messages, set_state, get_state) are marked
// TODO(you): type the handler bodies yourself so you can whiteboard them later.
// Each one is ~2-4 lines and the exact spec is in the comment above it.
// ────────────────────────────────────────────────────────────────────────────

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  appendMessage,
  readMessages,
  setState,
  getState,
} from './store.js';
import { logEvent } from './trace.js';
import { randomUUID } from 'node:crypto';

// MCP tool results are a list of content blocks. Our tools return data, so we
// serialize it as one JSON text block. This helper keeps every handler tidy.
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

// Each Claude session spawns its own coordinator process, so a per-process id
// effectively identifies the calling session. Override via COORDINATOR_SESSION_ID.
const SESSION_ID = process.env.COORDINATOR_SESSION_ID || `srv-${randomUUID().slice(0, 8)}`;

// Wrap a tool handler so every call appends one event to the trace log:
// timestamp, session, tool, input, output, latency, trace id — and on failure,
// the error and its class. The handler's own logic is untouched.
function instrument(tool, handler) {
  return async (args) => {
    const start = performance.now();
    const trace_id = args?.trace_id ?? null;
    try {
      const result = await handler(args);
      let output;
      try {
        output = JSON.parse(result.content[0].text);
      } catch {
        output = undefined;
      }
      logEvent({
        event: 'tool_call',
        tool,
        session_id: SESSION_ID,
        trace_id,
        input: args,
        output,
        ok: true,
        latency_ms: Number((performance.now() - start).toFixed(2)),
      });
      return result;
    } catch (err) {
      logEvent({
        event: 'tool_call',
        tool,
        session_id: SESSION_ID,
        trace_id,
        input: args,
        ok: false,
        error: err.message,
        error_class: err.name || 'Error',
        latency_ms: Number((performance.now() - start).toFixed(2)),
      });
      throw err;
    }
  };
}

const server = new McpServer({
  name: 'multi-agent-coord',
  version: '0.1.0',
});

// ── Tool 1: send_message ─────────────────────────────────────────────────────
// Append a message to the shared log so another session can read it.
// REFERENCE IMPLEMENTATION — study this, then mirror it for the three below.
server.registerTool(
  'send_message',
  {
    title: 'Send a message to another agent',
    description:
      'Append a message to the shared coordination log. `to` is the recipient ' +
      'agent id, or "all" to broadcast. Returns the stored record with its id and timestamp.',
    inputSchema: {
      from: z.string().describe('This agent\'s id, e.g. "agentA".'),
      to: z.string().describe('Recipient agent id, or "all" to broadcast.'),
      body: z.string().describe('The message text.'),
      trace_id: z
        .string()
        .optional()
        .describe('Optional trace id to correlate a task across sessions (used in Phase 1).'),
    },
  },
  instrument('send_message', async ({ from, to, body, trace_id }) => {
    const record = await appendMessage({ from, to, body, trace_id });
    return ok(record);
  }),
);

// ── Tool 2: read_messages ────────────────────────────────────────────────────
// Return messages addressed to `to` (recipient id), or broadcasts to "all".
// Optional `since` is an exclusive ISO-timestamp cursor for polling only new ones.
// Spec: call readMessages({ to, since }) from the store and wrap it with ok(...).
server.registerTool(
  'read_messages',
  {
    title: 'Read messages addressed to this agent',
    description:
      'Return messages addressed to `to` (or broadcast to "all"). Pass `since` ' +
      '(an ISO timestamp) to get only messages newer than a previous read.',
    inputSchema: {
      to: z.string().describe('This agent\'s id — returns messages sent to it or to "all".'),
      since: z
        .string()
        .optional()
        .describe('Exclusive ISO-timestamp cursor; omit to read the full history.'),
      trace_id: z
        .string()
        .optional()
        .describe('Trace id carried from a received message, to correlate this read.'),
    },
  },
  instrument('read_messages', async ({ to, since }) => {
    const record = await readMessages({ to, since });
    return ok(record);
  }),
);

// ── Tool 3: set_state ────────────────────────────────────────────────────────
// Set one shared key/value that any session can later read.
// Spec: await setState(key, value) and return ok(result).
server.registerTool(
  'set_state',
  {
    title: 'Set a shared state value',
    description: 'Write a key/value into the shared state bag visible to all sessions.',
    inputSchema: {
      key: z.string().describe('State key, e.g. "task_42_status".'),
      value: z.string().describe('Value to store.'),
      trace_id: z
        .string()
        .optional()
        .describe('Optional trace id to correlate this write with a task.'),
    },
  },
  instrument('set_state', async ({ key, value }) => {
    const result = await setState(key, value);
    return ok(result);
  }),
);

// ── Tool 4: get_state ────────────────────────────────────────────────────────
// Read one shared key, or the whole state bag when `key` is omitted.
// Spec: const value = getState(key); return ok({ key, value }).
server.registerTool(
  'get_state',
  {
    title: 'Get a shared state value',
    description:
      'Read a shared state key. Omit `key` to return the entire state object.',
    inputSchema: {
      key: z
        .string()
        .optional()
        .describe('State key to read; omit to return the whole state bag.'),
      trace_id: z
        .string()
        .optional()
        .describe('Optional trace id to correlate this read with a task.'),
    },
  },
  instrument('get_state', async ({ key }) => {
    const value = await getState(key);
    return ok({ key, value });
  }),
);

// Connect over stdio — this is how Claude Code launches and talks to the server.
const transport = new StdioServerTransport();
await server.connect(transport);
