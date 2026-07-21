// tasks/directed-isolation.js
//
// A sends a DIRECTED message to B (to: 'agentB', not 'all'). B must see it; a
// third agent C must not. The negative half of msg-broadcast: it proves the
// filter actually excludes non-recipients, so a directed message stays private.
//
// The empty-C assertion is the whole value here. Without it, a bug that
// delivered every message to everyone would still pass round-trip and broadcast.

import { call } from '../src/eval/harness.js';

export default {
  id: 'directed-isolation',
  title: 'A directed A->B message is seen by B but not by C',

  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      await call(client, 'send_message', {
        from: 'agentA',
        to: 'agentB',
        body: 'secret',
        trace_id: traceId,
      });
      const bInbox = await call(client, 'read_messages', {
        to: 'agentB',
        trace_id: traceId,
      });
      const cInbox = await call(client, 'read_messages', {
        to: 'agentC',
        trace_id: traceId,
      });
      return { bInbox, cInbox };
    } finally {
      await close();
    }
  },

  check({ bInbox, cInbox }) {
    return (
      bInbox.length === 1 &&
      bInbox[0].body === 'secret' &&
      cInbox.length === 0
    );
  },
};
