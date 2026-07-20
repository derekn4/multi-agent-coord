// tasks/concurrent-writers.js
//
// TASK 8 — N concurrent processes writing distinct keys must not lose updates.
//
// This is the task the cross-process lock exists for. store.setState is a
// read-modify-write: load the whole JSON, add one key, write it back. Without a
// lock, two processes that read the same base state each add their own key and
// the second write clobbers the first — a classic lost update. The keys are
// DISTINCT, so a correct implementation must end with all N present; any missing
// key is proof of a race, not of a conflict resolution policy.
//
// Note these are genuinely separate OS processes (one coordinator spawned per
// writer), all bound to the same state dir. In-process concurrency would prove
// nothing here — it would serialize through a single withLock in one process.
// The mkdir-based lock in store.js is what makes this hold ACROSS processes.

import { call } from '../src/eval/harness.js';

const WRITERS = 5;

export default {
  id: 'concurrent-writers',
  title: 'N concurrent processes write distinct keys with no lost updates',

  async run({ connect, traceId }) {
    // Launch all writers at once — no await between spawns, so their
    // read-modify-write windows genuinely overlap.
    await Promise.all(
      Array.from({ length: WRITERS }, async (_, i) => {
        const { client, close } = await connect();
        try {
          await call(client, 'set_state', {
            key: `writer_${i}`,
            value: `v${i}`,
            trace_id: traceId,
          });
        } finally {
          await close();
        }
      }),
    );

    // Fresh reader process: pull the whole bag back off disk.
    const { client, close } = await connect();
    try {
      const bag = await call(client, 'get_state', { trace_id: traceId });
      return { bag };
    } finally {
      await close();
    }
  },

  check({ bag }) {
    const state = bag.value;
    // Every writer's key present, with its own value, and nothing extra.
    for (let i = 0; i < WRITERS; i++) {
      if (state[`writer_${i}`] !== `v${i}`) return false;
    }
    return Object.keys(state).length === WRITERS;
  },
};
