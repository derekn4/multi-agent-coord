// hooks/on-stop.mjs
//
// A Stop hook: fires when a Claude Code session ends. We write a session-end
// snapshot marker into shared coordinator state so other sessions (and later
// the observability layer in Phase 1) can tell when a peer finished.
//
// Register it via examples/hooks-settings.json. Requires COORDINATOR_STATE_DIR
// to point at the same shared dir the coordinator uses.
import { setState } from '../src/store.js';
import { logEvent } from '../src/trace.js';

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (buf += chunk));
  process.stdin.on('end', () => resolve(buf));
});

try {
  const payload = JSON.parse(raw || '{}');
  const sessionId = payload.session_id ?? 'unknown';
  await setState(`session:${sessionId}:ended`, new Date().toISOString());
  logEvent({ event: 'session_end', session_id: sessionId, source: 'hook' });
} catch (err) {
  // Never break session teardown — log to stderr and exit cleanly.
  process.stderr.write(`on-stop hook: ${err.message}\n`);
}
