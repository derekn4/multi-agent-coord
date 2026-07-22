// tasks/failures/corrupted-state-file.js
//
// state.json is truncated between calls. readAll() throws "Corrupt coordinator
// state file", instrument() logs ok:false + error_class, and the tool returns an
// error to the client. Unlike killed-session, the agent is alive to see it fail
// and logs a terminal event -- so this class terminates cleanly with a
// server-side error, which is what separates it.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call } from '../../src/eval/harness.js';
import { logEvent } from '../../src/trace.js';
import { pick } from './surfaces.js';

export default {
  id: 'corrupted-state-file',

  async run({ dataDir, connect, traceId, surface, i }) {
    const key = pick(surface, 'keys', i);
    const agent = pick(surface, 'agents', i);
    logEvent({ event: 'task_start', trace_id: traceId, injector: 'corrupted-state-file' });

    const s = await connect();
    await call(s.client, 'set_state', { key, value: 'started', trace_id: traceId });
    if (i % 2 === 0) {
      await call(s.client, 'send_message', {
        from: agent,
        to: 'all',
        body: 'phase 1 done',
        trace_id: traceId,
      });
    }

    // Truncate mid-object: valid JSON prefix, invalid document.
    writeFileSync(join(dataDir, 'state.json'), '{"messages":[{"id":1,"from":"');

    try {
      await call(s.client, 'get_state', { key, trace_id: traceId });
    } catch {
      logEvent({
        event: 'agent_error',
        trace_id: traceId,
        error_class: 'ToolError',
        error: 'get_state failed',
      });
    }

    try {
      await s.close();
    } catch {
      // Transport already closing.
    }
    logEvent({ event: 'task_end', trace_id: traceId, outcome: 'failed' });
  },
};
