// tasks/failures/killed-session.js
//
// The coordinator child is SIGKILLed mid-task. Its trace stops dead: no
// terminal event, no error event, nothing. Nobody gets to log a failure when
// the process holding the pen is gone -- that absence IS the signal.
//
// Deliberately confusable with `timeout` (see the design doc). Both leave a
// truncated trace with no terminal event; the nominal separator is that timeout
// leaves a final slow event. So 1 run in 5 here is killed WHILE BLOCKED ON THE
// LOCK, producing a slow final event too. That is a real scenario, and it gives
// the confusion matrix genuine off-diagonal mass instead of a rigged diagonal.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { call } from '../../src/eval/harness.js';
import { logEvent } from '../../src/trace.js';
import { pick, sleep } from './surfaces.js';

export default {
  id: 'killed-session',

  async run({ dataDir, connect, traceId, surface, i }) {
    const agent = pick(surface, 'agents', i);
    const key = pick(surface, 'keys', i);
    logEvent({ event: 'task_start', trace_id: traceId, injector: 'killed-session' });

    const s = await connect();
    // Vary how far the run gets before dying: 1, 2, or 3 completed calls.
    const before = (i % 3) + 1;
    for (let n = 0; n < before; n++) {
      await call(s.client, 'set_state', { key: `${key}_${n}`, value: 'working', trace_id: traceId });
    }

    const slowVariant = i % 5 === 4;
    const lockDir = join(dataDir, 'state.lock');
    if (slowVariant) {
      // Hold the store lock so the next call blocks; kill the child while it waits.
      mkdirSync(lockDir, { recursive: true });
      setTimeout(() => {
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // Already released.
        }
      }, 1400);
    }

    const inflight = call(s.client, 'send_message', {
      from: agent,
      to: 'all',
      body: 'checkpoint',
      trace_id: traceId,
    }).catch(() => null); // the transport dies under us; that is the point

    await sleep(slowVariant ? 1600 : 40);
    const pid = s.kill();
    if (pid === null) throw new Error('killed-session: no child handle to kill');
    await inflight;
    try {
      await s.close();
    } catch {
      // The transport is already gone.
    }
    if (slowVariant) {
      try {
        rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // Already released.
      }
    }

    // NO task_end. That absence is this class's defining feature.
  },
};
