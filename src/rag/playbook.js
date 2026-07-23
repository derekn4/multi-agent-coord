// src/rag/playbook.js
//
// Remediation text, keyed by failure class. Authored, not generated and not
// retrieved. This file is the SOURCE OF TRUTH for that prose -- FAILURES.md
// points here rather than restating it, because these strings ship at runtime
// in every diagnose_failure response and a second copy would drift.
//
// This split is deliberate: retrieval is the MEASURED component (accuracy,
// confusion matrix, shuffle falsification); remediation is a STABLE authored
// component. Per-trace notes would be templated per class anyway, so their
// apparent granularity would be illusory.

export const PLAYBOOK = {
  'killed-session': {
    symptom:
      'The trace stops mid-run: no terminal event, no error event, last record is an ordinary successful call.',
    root_cause:
      'The coordinator child process died (SIGKILL, OOM kill, closed terminal) with a call in flight. Nothing logged the failure because the process holding the pen is gone.',
    remediation:
      'Treat a trace with no terminal event as unfinished, not successful. Re-drive the task from its last durable state write -- the store survived the process. Check host memory pressure and supervisor restart policy before blaming the agent.',
  },
  timeout: {
    symptom:
      'The trace ends with one unusually slow call (>=1s against a millisecond baseline) and then nothing further.',
    root_cause:
      'The call blocked past the caller deadline, typically waiting on the store lock held by another session, and the client abandoned the run. The server completed the work anyway.',
    remediation:
      'Re-read state before retrying; the abandoned write may have landed. Raise the client deadline above the store lock ceiling, or shorten the critical section holding the lock.',
  },
  'corrupted-state-file': {
    symptom:
      'A tool call fails with "Corrupt coordinator state file" after earlier calls succeeded.',
    root_cause:
      'state.json was truncated or partially written outside the atomic-write path -- disk-full, an external editor, or a process killed mid-write.',
    remediation:
      'Never let readers fall back silently to empty state; that hides data loss. Restore the most recent intact copy or rebuild state from the message log, and verify every writer goes through writeAtomic.',
  },
  'malformed-message': {
    symptom:
      'Every tool call succeeds, but the receiving agent raises a SyntaxError parsing a message body.',
    root_cause:
      'A sender put a truncated or non-JSON payload in `body`. The coordinator delivers messages and does not validate their schema, so acceptance was correct; the failure is in the consumer.',
    remediation:
      'Validate payloads at the receiver and route unparseable messages to a dead-letter path rather than throwing mid-task. If a structured payload is required, agree a schema and check it before sending.',
  },
  'stale-state-read': {
    symptom:
      'Nothing errors. Every call is ok:true, the run terminates normally, and the resulting state is wrong.',
    root_cause:
      'One session read a key, another overwrote it, and the first committed a decision derived from the value it had already read. Read-then-write is not atomic across sessions.',
    remediation:
      'The most dangerous class, because no error signal exists -- only the trace shape reveals it. Do the read and the dependent write in one locked read-modify-write, the way completeTask does, or carry a version and reject a write whose read-version is stale.',
  },
};
