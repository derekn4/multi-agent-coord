// hooks/on-todo-write.mjs
//
// A PostToolUse hook for the TodoWrite tool. Claude Code pipes the hook payload
// as JSON on stdin; we snapshot the session's current todo list into shared
// coordinator state so other sessions can see this agent's progress.
//
// Register it via examples/hooks-settings.json. Requires COORDINATOR_STATE_DIR
// to point at the same shared dir the coordinator uses.
import { setState } from '../src/store.js';
import { logEvent } from '../src/trace.js';

// Read the whole hook payload from stdin.
const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (buf += chunk));
  process.stdin.on('end', () => resolve(buf));
});

try {
  const payload = JSON.parse(raw || '{}');
  const sessionId = payload.session_id ?? 'unknown';
  const todos = payload.tool_input?.todos ?? [];
  await setState(`todos:${sessionId}`, todos);
  logEvent({ event: 'todo_update', session_id: sessionId, count: todos.length, source: 'hook' });
} catch (err) {
  // A hook must never break the agent's turn — log to stderr and exit cleanly.
  process.stderr.write(`on-todo-write hook: ${err.message}\n`);
}
