// tasks/msg-broadcast.js
//
// TASK 2 (you type the bodies — mirror tasks/msg-round-trip.js).
//
// Scenario: agent A broadcasts one message to "all". BOTH agent B and agent C
// read their mailboxes and must each see it. This proves the "all" fan-out:
// read_messages returns a message when m.to === to OR m.to === 'all'
// (see src/store.js readMessages).
//
// Reference shape lives in tasks/msg-round-trip.js. `call(client, tool, args)`
// sends a tool call and returns its parsed JSON payload.
import { call } from '../src/eval/harness.js';

export default {
  id: 'msg-broadcast',
  title: 'A broadcast to "all" is seen by both B and C',

  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      // TODO(you): send ONE message from 'agentA' to 'all' (body 'hello-all',
      // pass trace_id: traceId), then read messages for BOTH 'agentB' and
      // 'agentC'. Return { bInbox, cInbox }.
      const sent = await call(client, 'send_message', {
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
    // TODO(you): pass only if B's mailbox and C's mailbox each contain exactly
    // one message whose body is 'hello-all'.
    return (
      bInbox.length === 1 &&
      bInbox[0].body === 'hello-all' &&
      cInbox.length === 1 &&
      cInbox[0].body === 'hello-all'
    );
  },
};