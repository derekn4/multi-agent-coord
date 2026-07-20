// tasks/state-round-trip.js
//
// TASK 5 (you type the bodies — mirror tasks/msg-round-trip.js).
//
// Scenario: the shared state bag is the other half of the coordinator (messages
// are the first half). One session writes a key; any session can read it back.
// This is the most basic proof that a write is durable and readable by key.
//
// Plan: set_state('task_x', 'v1'), then get_state('task_x'), pass if the value
// that comes back is 'v1'.
//
// GOTCHA: get_state does NOT return a bare value — its handler returns
// ok({ key, value }), so `call()` resolves to an object like
//   { key: 'task_x', value: 'v1' }
// Your check() has to read `.value`, not compare the object itself.
//
// Reference shape: tasks/msg-round-trip.js. `call(client, tool, args)` returns
// the parsed JSON payload.

import { call } from '../src/eval/harness.js';

export default {
  id: 'state-round-trip',
  title: 'set_state then get_state returns the written value',

  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      // TODO(you):
      //  1. call set_state with { key: 'task_x', value: 'v1', trace_id: traceId }.
      //  2. call get_state with { key: 'task_x', trace_id: traceId } -> `got`.
      //  3. return { got }.
      await call(client, 'set_state', { key: 'task_x', value: 'v1', trace_id: traceId });
      const got = await call(client, 'get_state', { key: 'task_x', trace_id: traceId });
      return { got };
    } finally {
      await close();
    }
  },

  // Param is already destructured for you — fill in the boolean.
  check({ got }) {
    // TODO(you): pass only if the read-back key is 'task_x' and its value is 'v1'.
    return got.key === 'task_x' && got.value === 'v1';
  },
};
