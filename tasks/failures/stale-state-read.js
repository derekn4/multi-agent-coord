// tasks/failures/stale-state-read.js
//
// Two sessions. Session 1 reads a key, session 2 overwrites it, session 1 then
// acts on the value it read. Nothing errors -- every call is ok:true and the run
// terminates normally. The damage is silent and only visible in the SHAPE:
// a read preceding a write, across more than one session. That makes this the
// hardest class to detect and the one that most justifies retrieval over a
// grep for error strings.

import { call } from '../../src/eval/harness.js';
import { logEvent } from '../../src/trace.js';
import { pick } from './surfaces.js';

export default {
  id: 'stale-state-read',

  async run({ connect, traceId, surface, i }) {
    const key = pick(surface, 'keys', i);
    const agent = pick(surface, 'agents', i);
    logEvent({ event: 'task_start', trace_id: traceId, injector: 'stale-state-read' });

    const s1 = await connect();
    const s2 = await connect(); // second session == second coordinator process

    await call(s1.client, 'set_state', { key, value: 'v1', trace_id: traceId });
    const seen = await call(s1.client, 'get_state', { key, trace_id: traceId });

    // Another session moves the world on underneath session 1.
    await call(s2.client, 'set_state', { key, value: 'v2', trace_id: traceId });

    // Session 1 commits a decision derived from the value it read earlier.
    await call(s1.client, 'set_state', {
      key: `${key}_derived`,
      value: `from:${seen.value}`,
      trace_id: traceId,
    });
    await call(s1.client, 'send_message', {
      from: agent,
      to: 'all',
      body: 'derived committed',
      trace_id: traceId,
    });

    try {
      await s1.close();
    } catch {
      // Transport already closing.
    }
    try {
      await s2.close();
    } catch {
      // Transport already closing.
    }
    logEvent({ event: 'task_end', trace_id: traceId, outcome: 'ok' });
  },
};
