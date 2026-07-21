// tasks/verification/wrong-value.js
//
// Subtler than doing nothing: the agent writes the right key with the wrong
// value, so any "is the key set?" check would wave it through. Only comparing
// the value catches it.

import { call } from '../../src/eval/harness.js';

export default {
  id: 'wrong-value',
  title: 'Agent writes the right key with the wrong value',
  criteria: [{ state_key: 'deploy_status', equals: 'done' }],

  async act({ client, traceId, attempt }) {
    const value = attempt === 1 ? 'pending' : 'done';
    await call(client, 'set_state', { key: 'deploy_status', value, trace_id: traceId });
  },

  check({ state }) {
    return state.deploy_status === 'done';
  },
};
