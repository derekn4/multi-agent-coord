// tasks/concurrent-writers.js
//
// N processes write distinct keys at once; none may be lost.
//
// setState is a read-modify-write, so without a lock two processes read the same
// base state and the second write clobbers the first. Separate OS processes on
// purpose — in-process concurrency just serializes through one withLock and
// proves nothing about the cross-process mkdir lock.

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
