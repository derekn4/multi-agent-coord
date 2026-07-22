// tasks/verification/reports-before-writing.js
//
// An ordering defect: the agent announces success and claims done in the window
// BEFORE it records the result. The message is genuinely there, so a check that
// only looked at messages would pass. Requiring both is what closes the gap.

import { call } from '../../src/eval/harness.js';

export default {
  id: 'reports-before-writing',
  title: 'Agent reports completion before recording it',
  inboxFor: 'agentA',
  criteria: [
    { message_to: 'agentA', from: 'agentB' },
    { state_key: 'step1_status', equals: 'done' },
  ],

  async act({ client, traceId, attempt }) {
    if (attempt === 1) {
      await call(client, 'send_message', {
        from: 'agentB',
        to: 'agentA',
        body: 'step1 complete',
        trace_id: traceId,
      });
      return; // claims done in the gap
    }
    await call(client, 'set_state', { key: 'step1_status', value: 'done', trace_id: traceId });
  },

  check({ state, inbox }) {
    return state.step1_status === 'done' && inbox.some((m) => m.from === 'agentB');
  },
};
