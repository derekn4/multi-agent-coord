// tasks/verification/honest-agent.js
//
// The false-positive guard, and it matters as much as the defects: a gate that
// rejects correct work is worse than no gate at all. This agent does everything
// right and MUST verify on attempt 1 -- if it ever needs a retry, the criteria
// are wrong, not the agent.

import { call } from '../../src/eval/harness.js';

export default {
  id: 'honest-agent',
  title: 'Control: a correct agent verifies on the first attempt',
  inboxFor: 'agentA',
  criteria: [
    { state_key: 'report_status', equals: 'filed' },
    { message_to: 'agentA', body_contains: 'report filed' },
  ],

  async act({ client, traceId }) {
    await call(client, 'set_state', { key: 'report_status', value: 'filed', trace_id: traceId });
    await call(client, 'send_message', {
      from: 'agentB',
      to: 'agentA',
      body: 'report filed',
      trace_id: traceId,
    });
  },

  check({ state, inbox }) {
    return state.report_status === 'filed' && inbox.some((m) => m.body.includes('report filed'));
  },
};
