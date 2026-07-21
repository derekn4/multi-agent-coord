// tasks/plan-execute-report.js
//
// The full coordination loop: A plans, B executes step 1 and reports back.
//
// Composes what the other tasks isolate — both message directions, shared state
// as the handoff medium — across three processes, so nothing survives in memory
// between hops. Passes only if the whole round trip closed.

import { call } from '../src/eval/harness.js';

export default {
  id: 'plan-execute-report',
  title: 'A plans, B executes step 1 and reports back, A confirms',

  async run({ connect, traceId }) {
    // ── Process 1 — agent A publishes the plan and dispatches step 1.
    const a1 = await connect();
    try {
      await call(a1.client, 'set_state', {
        key: 'plan',
        value: 'step1:build;step2:verify',
        trace_id: traceId,
      });
      await call(a1.client, 'send_message', {
        from: 'agentA',
        to: 'agentB',
        body: 'execute step1',
        trace_id: traceId,
      });
    } finally {
      await a1.close();
    }

    // ── Process 2 — agent B picks up the work and reports.
    const b = await connect();
    let bInbox;
    let planSeenByB;
    try {
      bInbox = await call(b.client, 'read_messages', { to: 'agentB', trace_id: traceId });
      planSeenByB = await call(b.client, 'get_state', { key: 'plan', trace_id: traceId });

      // B "executes" step 1 by recording its outcome in shared state.
      await call(b.client, 'set_state', {
        key: 'step1_status',
        value: 'done',
        trace_id: traceId,
      });
      await call(b.client, 'send_message', {
        from: 'agentB',
        to: 'agentA',
        body: 'step1 complete',
        trace_id: traceId,
      });
    } finally {
      await b.close();
    }

    // ── Process 3 — agent A confirms the loop closed.
    const a2 = await connect();
    try {
      const aInbox = await call(a2.client, 'read_messages', { to: 'agentA', trace_id: traceId });
      const status = await call(a2.client, 'get_state', {
        key: 'step1_status',
        trace_id: traceId,
      });
      return { bInbox, planSeenByB, aInbox, status };
    } finally {
      await a2.close();
    }
  },

  check({ bInbox, planSeenByB, aInbox, status }) {
    return (
      // B received exactly A's dispatch.
      bInbox.length === 1 &&
      bInbox[0].body === 'execute step1' &&
      bInbox[0].from === 'agentA' &&
      // B read the plan A published, from shared state.
      planSeenByB.value === 'step1:build;step2:verify' &&
      // A received exactly B's report back (and not its own outbound message).
      aInbox.length === 1 &&
      aInbox[0].body === 'step1 complete' &&
      aInbox[0].from === 'agentB' &&
      // The work is recorded as done.
      status.value === 'done'
    );
  },
};
