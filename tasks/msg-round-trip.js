// tasks/msg-round-trip.js
//
// A sends one directed message to B; B reads its mailbox and must see exactly
// that message, same body. The most basic proof that the coordinator delivers a
// directed message across the tool boundary.
//
// Task shape, common to every file here:
//   run({ connect, traceId })  drives the real coordinator, returns a context
//   check(context)             grades it, deterministically

import { call } from '../src/eval/harness.js';

export default {
  id: 'msg-round-trip',
  title: 'A->B message round-trips with matching body',

  // `connect()` spawns a fresh coordinator bound to this run's state dir and
  // returns { client, close }. `traceId` is minted per run for observability.
  async run({ connect, traceId }) {
    const { client, close } = await connect();
    try {
      const sent = await call(client, 'send_message', {
        from: 'agentA',
        to: 'agentB',
        body: 'ping',
        trace_id: traceId,
      });
      const inbox = await call(client, 'read_messages', {
        to: 'agentB',
        trace_id: traceId,
      });
      return { sent, inbox };
    } finally {
      await close();
    }
  },

  // Deterministic pass criteria: the send echoed the body, and B's mailbox holds
  // exactly that one message, addressed to B.
  check({ sent, inbox }) {
    return (
      sent.body === 'ping' &&
      inbox.length === 1 &&
      inbox[0].body === 'ping' &&
      inbox[0].to === 'agentB'
    );
  },
};
