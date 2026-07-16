// hooks/on-session-start.mjs
//
// A SessionStart hook: logs a `session_start` event into the shared trace log
// so a run's timeline has a clear beginning. Agent-side, so it carries the real
// Claude session id. Register it via examples/hooks-settings.json.
import { logEvent } from '../src/trace.js';

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (buf += chunk));
  process.stdin.on('end', () => resolve(buf));
});

try {
  const payload = JSON.parse(raw || '{}');
  logEvent({
    event: 'session_start',
    session_id: payload.session_id ?? 'unknown',
    source: 'hook',
  });
} catch (err) {
  process.stderr.write(`on-session-start hook: ${err.message}\n`);
}
