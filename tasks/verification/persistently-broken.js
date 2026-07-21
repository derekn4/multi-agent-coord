// tasks/verification/persistently-broken.js
//
// The task that must NOT heal. Without it the eval would report a suspiciously
// clean 0% -> 100% and hide the real point: some bad completions should stop and
// page a human rather than be retried forever. This is where escalation rate
// comes from, and it is deliberately counted as a gated FAILURE even though the
// system behaved exactly as designed.

import { call } from '../../src/eval/harness.js';

export default {
  id: 'persistently-broken',
  title: 'Agent writes the wrong value on every attempt and must escalate',
  criteria: [{ state_key: 'migration_status', equals: 'complete' }],

  async act({ client, traceId }) {
    await call(client, 'set_state', {
      key: 'migration_status',
      value: 'failed',
      trace_id: traceId,
    });
  },

  check({ state }) {
    return state.migration_status === 'complete'; // never true, by construction
  },
};
