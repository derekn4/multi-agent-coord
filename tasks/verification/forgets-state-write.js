// tasks/verification/forgets-state-write.js
//
// The commonest agent failure: it reports done without doing the work at all.
// Ungated this passes straight through as a completion. Gated, the missing key
// is named back to the agent, which then writes it.

import { call } from '../../src/eval/harness.js';

export default {
  id: 'forgets-state-write',
  title: 'Agent claims done without ever writing the state key',
  criteria: [{ state_key: 'work_done', exists: true }],

  async act({ client, traceId, attempt }) {
    if (attempt === 1) return; // claims done, does nothing
    await call(client, 'set_state', { key: 'work_done', value: 'yes', trace_id: traceId });
  },

  check({ state }) {
    return state.work_done === 'yes';
  },
};
