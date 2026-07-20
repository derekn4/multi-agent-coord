// tasks/since-cursor.js
//
// TASK 4 (you type the bodies — mirror tasks/msg-round-trip.js).
//
// Scenario: `read_messages` takes an optional `since` (an ISO timestamp). It is
// an EXCLUSIVE cursor — it returns only messages strictly newer than `since`.
// This is how an agent polls for "just what's new" without re-reading history.
// (In store.js readMessages, a message is kept only when m.ts > since.)
//
// Plan: send three messages A->B (bodies 'm1','m2','m3'). Read B's full mailbox,
// grab the timestamp (.ts) of the SECOND message, then read again with
// since = that timestamp. The second read should return only 'm3'.
//
// Note: messages carry a `.ts` ISO timestamp field (set by appendMessage). Since
// the cursor is exclusive, using m2's ts excludes m1 and m2, leaving m3.
//
// Reference shape: tasks/msg-round-trip.js. `call(client, tool, args)` returns
// the parsed JSON payload.

import { call } from '../src/eval/harness.js';

export default {
  id: 'since-cursor',
  title: 'read_messages `since` returns only newer messages',

  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      // TODO(you):
      //  1. send three messages A->B with bodies 'm1', 'm2', 'm3'
      //     (each: from 'agentA', to 'agentB', trace_id: traceId).
      //  2. read B's full mailbox -> `all`.
      //  3. read again with { to: 'agentB', since: all[1].ts } -> `afterM2`.
      //  4. return { all, afterM2 }.
      for (const body of ['m1', 'm2', 'm3']) {
        await call(client, 'send_message', {
          from: 'agentA',
          to: 'agentB',
          body,
          trace_id: traceId,
        });
      };
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

  // Param is already destructured for you — fill in the boolean.
  check({ all, afterM2 }) {
    // TODO(you): pass only if the full read has 3 messages AND the since-read
    // has exactly one message whose body is 'm3'.
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
