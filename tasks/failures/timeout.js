// tasks/failures/timeout.js
//
// The agent sets a client-side deadline and abandons the run when a call blows
// past it. The call itself still completes server-side, so the trace keeps a
// final event carrying a large latency_ms -- and then stops, because the client
// walked away without logging a terminal event.
//
// The block is real: we hold the store's mkdir lock, so the next call sits in
// withLock's retry loop for as long as we hold it. Held under withLock's own
// 5s ceiling so the call eventually succeeds slowly rather than erroring --
// an error would carry an error_class token and make this trivially separable
// from killed-session, collapsing the deliberate confusion.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { call } from '../../src/eval/harness.js';
import { logEvent } from '../../src/trace.js';
import { pick, sleep } from './surfaces.js';

const DEADLINE_MS = 500;

export default {
  id: 'timeout',

  async run({ dataDir, connect, traceId, surface, i }) {
    const key = pick(surface, 'keys', i);
    logEvent({ event: 'task_start', trace_id: traceId, injector: 'timeout' });

    const s = await connect();
    const before = (i % 2) + 1;
    for (let n = 0; n < before; n++) {
      await call(s.client, 'get_state', { key: `${key}_${n}`, trace_id: traceId });
    }

    const lockDir = join(dataDir, 'state.lock');
    mkdirSync(lockDir, { recursive: true });
    const holdMs = 1200 + (i % 4) * 300; // 1200-2100ms, all well under withLock's 5s ceiling
    setTimeout(() => {
      try {
        rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // Already released.
      }
    }, holdMs);

    const slow = call(s.client, 'set_state', { key, value: 'committed', trace_id: traceId }).catch(
      () => null,
    );

    // The agent gives up at its deadline. The server keeps going and logs the
    // slow call; we just never hear the answer.
    await sleep(DEADLINE_MS);

    await slow; // let the event land before the dir is torn down
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Already released.
    }
    try {
      await s.close();
    } catch {
      // Transport already closing.
    }

    // NO task_end -- the agent abandoned the run.
  },
};
