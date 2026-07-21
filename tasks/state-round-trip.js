// tasks/state-round-trip.js
//
// The shared state bag is the other half of the coordinator; messages are the
// first. One session writes a key, any session reads it back — the most basic
// proof that a write is durable and readable by key.
//
// Note the return shape: get_state does not hand back a bare value. Its handler
// returns ok({ key, value }), so call() resolves to { key: 'task_x', value: 'v1' }
// and check has to read .value.

import { call } from '../src/eval/harness.js';

export default {
  id: 'state-round-trip',
  title: 'set_state then get_state returns the written value',

  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      await call(client, 'set_state',{ key: 'task_x', value: 'v1', trace_id: traceId });
      const got = await call(client, 'get_state', { key: 'task_x', trace_id: traceId });
      return { got };
    } finally {
      await close();
    }
  },

  check({ got }) {
    return got.key === 'task_x' && got.value === 'v1';
  },
};
