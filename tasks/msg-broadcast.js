// tasks/msg-broadcast.js
//
// A broadcasts one message to "all"; both B and C must see it in their own
// mailboxes. Covers the fan-out branch in store.js readMessages, where a message
// matches when m.to === to OR m.to === 'all'.
//
// Scope note: this only asserts both recipients receive the broadcast. That a
// *directed* message stays hidden from third parties is directed-isolation's job.

import { call } from '../src/eval/harness.js';

export default {
  id: 'msg-broadcast',
  title: 'A broadcast to "all" is seen by both B and C',

  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      await call(client, 'send_message', {
        from: 'agentA',
        to: 'all',
        body: 'hello-all',
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
      bInbox[0].body === 'hello-all' &&
      cInbox.length === 1 &&
      cInbox[0].body === 'hello-all'
    );
  },
};