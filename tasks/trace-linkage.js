// tasks/trace-linkage.js
//
// One trace id stitches two sessions' events into a single timeline.
//
// A sends carrying traceId; B reads and records status under the same traceId.
// Two processes on purpose: each coordinator stamps its own SESSION_ID, so two
// session ids under one trace id is the cross-session link being claimed. The
// untraced control message must stay out of the filtered trace.

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
