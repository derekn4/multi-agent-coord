// tasks/failures/malformed-message.js
//
// The sender puts a truncated JSON payload in a message body. Every tool call
// succeeds -- the coordinator's job is delivery, not schema validation -- and
// the failure happens in the RECEIVER, client-side, on JSON.parse. So this
// class has zero ok:false events but a SyntaxError agent_error, which is
// exactly what separates it from corrupted-state-file.

import { call } from '../../src/eval/harness.js';
import { logEvent } from '../../src/trace.js';
import { pick } from './surfaces.js';

export default {
  id: 'malformed-message',

  async run({ connect, traceId, surface, i }) {
    const sender = pick(surface, 'agents', i);
    const receiver = pick(surface, 'agents', i + 1);
    const key = pick(surface, 'keys', i);
    logEvent({ event: 'task_start', trace_id: traceId, injector: 'malformed-message' });

    const s = await connect();
    await call(s.client, 'set_state', { key, value: 'ready', trace_id: traceId });
    await call(s.client, 'send_message', {
      from: sender,
      to: receiver,
      body: `{"phase":"${key}","count":`, // truncated on purpose
      trace_id: traceId,
    });

    const inbox = await call(s.client, 'read_messages', { to: receiver, trace_id: traceId });
    for (const m of inbox) {
      try {
        JSON.parse(m.body);
      } catch (err) {
        logEvent({
          event: 'agent_error',
          trace_id: traceId,
          error_class: err.name, // SyntaxError
          error: err.message,
        });
      }
    }

    try {
      await s.close();
    } catch {
      // Transport already closing.
    }
    logEvent({ event: 'task_end', trace_id: traceId, outcome: 'failed' });
  },
};
