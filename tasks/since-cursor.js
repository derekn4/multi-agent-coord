// tasks/since-cursor.js
//
// `read_messages` takes an optional `since` (ISO timestamp) and treats it as an
// EXCLUSIVE cursor — only messages strictly newer come back (store.js keeps a
// message when m.ts > since). This is how an agent polls for just what's new
// without re-reading history.
//
// Send m1,m2,m3 A->B, read the full mailbox, then re-read with since = m2's ts.
// Because the cursor is exclusive, that excludes m1 and m2, leaving only m3.

import { call } from '../src/eval/harness.js';

export default {
  id: 'since-cursor',
  title: 'read_messages `since` returns only newer messages',

  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      // Sequential awaits, deliberately — not Promise.all. Parallel sends can
      // land in the same millisecond, and two messages sharing a `ts` make the
      // cursor read non-deterministic (m2 and m3 would both appear or both
      // vanish). Distinct, ordered timestamps are load-bearing here.
      for (const body of ['m1', 'm2', 'm3']) {
        await call(client, 'send_message', {
          from: 'agentA',
          to: 'agentB',
          body,
          trace_id: traceId,
        });
      }
      const bInbox = await call(client, 'read_messages', {
        to: 'agentB',
        trace_id: traceId,
      });
      const afterM2 = await call(client, 'read_messages', {
        to: 'agentB',
        since: bInbox[1].ts,
        trace_id: traceId,
      });
      return { all: bInbox, afterM2 };
    } finally {
      await close();
    }
  },

  check({ all, afterM2 }) {
    return (
      all.length === 3 &&
      all[0].body === 'm1' &&
      all[1].body === 'm2' &&
      all[2].body === 'm3' &&
      afterM2.length === 1 &&
      afterM2[0].body === 'm3'
    );
  },
};
