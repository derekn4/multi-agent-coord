// tasks/cross-process-persistence.js
//
// TASK 7 — state survives a coordinator restart.
//
// This is the ORIGIN STORY of the whole project as a pass/fail check. Each
// Claude session spawns its OWN coordinator process, so anything held in memory
// is invisible to the other session and dies with the process. The fix is that
// every mutation goes to disk and every read comes from disk.
//
// Scenario: connect, write state + send a message, then fully close that server
// process. Connect a SECOND time against the same state dir — a genuinely new
// child process with empty memory — and read both back. If the coordinator were
// still in-memory-only, the second process would see nothing and this fails.
//
// `connect()` closes over this run's dataDir, so calling it twice is a real
// restart against the same files (see harness.js connectServer).

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
