// tasks/state-overwrite.js
//
// TASK 6 — last write wins.
//
// Scenario: state keys are mutable. Writing the same key twice must leave the
// SECOND value, and must not leave a duplicate entry or resurrect the first.
// Trivial-looking, but it is the property every "task_42_status" update depends
// on: an agent overwrites status as work progresses, and readers must never see
// a stale value once the newer write has returned.
//
// This is the read-modify-write path in store.setState (data.state[key] = value
// under the lock), so it also proves the lock's write path round-trips cleanly.

import { call } from '../src/eval/harness.js';

export default {
  id: 'state-overwrite',
  title: 'second set_state on a key wins over the first',

  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      await call(client, 'set_state', { key: 'status', value: 'pending', trace_id: traceId });
      await call(client, 'set_state', { key: 'status', value: 'done', trace_id: traceId });

      const got = await call(client, 'get_state', { key: 'status', trace_id: traceId });
      // Whole bag (key omitted) — proves the overwrite replaced rather than added.
      const bag = await call(client, 'get_state', { trace_id: traceId });

      return { got, bag };
    } finally {
      await close();
    }
  },

  check({ got, bag }) {
    return (
      got.value === 'done' &&
      bag.value.status === 'done' &&
      Object.keys(bag.value).length === 1
    );
  },
};
