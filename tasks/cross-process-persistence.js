// tasks/cross-process-persistence.js
//
// State survives a coordinator restart — the bug that motivated this project.
//
// Each session spawns its own coordinator, so in-memory state dies with the
// process. Write, close the server, then reconnect against the same dir (a new
// child with empty memory) and read back. An in-memory-only coordinator scores 0.

import { call } from '../src/eval/harness.js';

export default {
  id: 'cross-process-persistence',
  title: 'state and messages survive a coordinator restart',

  async run({ connect, traceId }) {
    // ── Process 1: write, then die.
    const first = await connect();
    try {
      await call(first.client, 'set_state', {
        key: 'plan',
        value: 'step1,step2',
        trace_id: traceId,
      });
      await call(first.client, 'send_message', {
        from: 'agentA',
        to: 'agentB',
        body: 'survive-me',
        trace_id: traceId,
      });
    } finally {
      await first.close();
    }

    // ── Process 2: fresh memory, same disk.
    const second = await connect();
    try {
      const state = await call(second.client, 'get_state', { key: 'plan', trace_id: traceId });
      const inbox = await call(second.client, 'read_messages', {
        to: 'agentB',
        trace_id: traceId,
      });
      return { state, inbox };
    } finally {
      await second.close();
    }
  },

  check({ state, inbox }) {
    return (
      state.value === 'step1,step2' &&
      inbox.length === 1 &&
      inbox[0].body === 'survive-me'
    );
  },
};
