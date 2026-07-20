// tasks/directed-isolation.js
//
// TASK 3 (you type the bodies — mirror tasks/msg-round-trip.js).
//
// Scenario: agent A sends a DIRECTED message to agent B (to: 'agentB', not
// 'all'). Agent B must see it; a third agent C must NOT. This is the negative
// half of Task 2 — it proves the filter actually excludes non-recipients, so a
// directed message stays private. (In store.js readMessages, a directed message
// matches only when m.to === to; C's read should return nothing.)
//
// Reference shape: tasks/msg-round-trip.js. `call(client, tool, args)` sends a
// tool call and returns its parsed JSON payload.

import { call } from '../src/eval/harness.js';

export default {
  id: 'directed-isolation',
  title: 'A directed A->B message is seen by B but not by C',

  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      // TODO(you): send ONE message from 'agentA' to 'agentB' (body 'secret',
      // pass trace_id: traceId), then read messages for BOTH 'agentB' and
      // 'agentC'. Return { bInbox, cInbox }.
      const sent = await call(client, 'send_message', {
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
