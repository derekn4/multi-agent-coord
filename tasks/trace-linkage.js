// tasks/trace-linkage.js
//
// TASK 9 — one trace id stitches two sessions' events into a single timeline.
//
// This is the Phase 1 observability claim as a pass/fail check: "I can
// reconstruct any multi-agent run after the fact." That only works if a trace id
// minted by agent A survives the hop through a message and shows up on agent B's
// own tool calls — otherwise you have two unrelated piles of events.
//
// Scenario: A (process 1) sends a message carrying traceId. B (process 2) reads
// its mailbox and records status, threading the SAME traceId through its calls.
// Then read the JSONL event log back and assert the trace spans both sessions.
//
// Two processes matter: coordinator.js stamps each event with a per-process
// SESSION_ID, so distinct session ids in one trace is exactly the cross-session
// linkage being claimed. One process would trivially share a session id.
//
// Control: A also sends an UNTRACED message. It must NOT land in the filtered
// trace — otherwise the filter is vacuous and this task would pass on anything.

import { call } from '../src/eval/harness.js';
import { readEvents } from '../src/trace.js';

export default {
  id: 'trace-linkage',
  title: 'a trace id links events across two coordinator sessions',

  async run({ connect, traceId }) {
    // ── Session A: one traced send, one untraced control send.
    const a = await connect();
    try {
      await call(a.client, 'send_message', {
        from: 'agentA',
        to: 'agentB',
        body: 'do-step-1',
        trace_id: traceId,
      });
      await call(a.client, 'send_message', {
        from: 'agentA',
        to: 'agentB',
        body: 'untraced-noise',
      });
    } finally {
      await a.close();
    }

    // ── Session B: acts on the message, carrying A's trace id forward.
    const b = await connect();
    try {
      await call(b.client, 'read_messages', { to: 'agentB', trace_id: traceId });
      await call(b.client, 'set_state', {
        key: 'step1_status',
        value: 'done',
        trace_id: traceId,
      });
    } finally {
      await b.close();
    }

    // The runner points COORDINATOR_STATE_DIR at this run's dir, so readEvents()
    // reads exactly the log those two child processes just wrote.
    const events = readEvents();
    return {
      traced: events.filter((e) => e.trace_id === traceId),
      untraced: events.filter((e) => e.trace_id !== traceId),
    };
  },

  check({ traced, untraced }) {
    // Three traced tool calls: A's send, B's read, B's set_state.
    if (traced.length !== 3) return false;

    // They must span two distinct sessions — that is the cross-session link.
    const sessions = new Set(traced.map((e) => e.session_id));
    if (sessions.size !== 2) return false;

    // The tools that actually ran, in order.
    const tools = traced.map((e) => e.tool);
    const orderOk =
      tools[0] === 'send_message' &&
      tools[1] === 'read_messages' &&
      tools[2] === 'set_state';

    // Control: the untraced send exists and stayed out of the trace.
    const controlExcluded = untraced.some(
      (e) => e.tool === 'send_message' && e.input?.body === 'untraced-noise',
    );

    return orderOk && controlExcluded && traced.every((e) => e.ok === true);
  },
};
