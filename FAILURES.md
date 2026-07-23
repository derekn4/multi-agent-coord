# FAILURES.md

Real bugs and injected failure classes hit while building this coordinator.
Guardrail 3 of the build plan: every weird bug is an interview anecdote.

Everything below actually went wrong. The deliberately *injected* failure classes
Phase 4 diagnoses are a separate thing, and live in `src/rag/playbook.js`.

---

## Cross-process state isolation (Phase 0, real)

**Symptom:** Two Claude Code sessions each had the coordinator's four tools, but
messages sent from one were invisible to the other. `get_state` returned empty
in session B moments after session A wrote it.

**Root cause:** Each session spawns its own child process of the MCP server. A
module-level object is per-process, so "shared" state was two separate bags.

**Fix:** One JSON file on disk is the source of truth. Every mutation writes it
(atomically, via temp file + rename), every read loads it. Concurrent writers
serialize on an `mkdir`-based cross-process lock with stale reclamation.

## `removeDataDir` outside the try/catch discarded an entire eval run (Phase 2, real)

**Symptom:** A full eval sweep aborted partway through and reported nothing, even
though most runs had already completed successfully.

**Root cause:** A Windows `ENOTEMPTY` during temp-dir cleanup threw from *outside*
the runner's per-run `try/catch`, so a failure cleaning up a disposable artifact
killed the whole sweep and discarded every result already collected.

**Fix:** Cleanup is best-effort (`maxRetries`, errors swallowed). Cleanup of a
disposable artifact must never be able to fail the work that produced it.
`retainEvents` was later written to the same rule.

## A missing lock surfaces as EPERM on Windows, not a lost update (Phase 2, real)

**Symptom:** Removing `withLock` to falsify the `concurrent-writers` eval task did
not produce the expected silent lost update.

**Root cause:** On Windows, two processes renaming onto the same path race at the
filesystem level and one gets `EPERM`. Same corruption, different symptom.

**Fix:** Nothing to fix in the code — but it changed how the test is written. A
falsification that asserted on the *symptom* rather than the *outcome* would have
passed on Linux and failed here. Assert that the task goes red, not how.

## Lock leak under concurrent verification (Phase 3, real)

**Symptom:** Two simultaneous `complete_task` calls could both observe
`attempts: 1` and both be granted a further retry, so the bound leaked.

**Root cause:** Criteria were evaluated outside the lock that incremented the
counter — a read-modify-write split across the critical section boundary.

**Fix:** Increment, evaluate, and write the verdict as ONE locked
read-modify-write against a single in-lock snapshot. `test/verification.test.js`
holds the multi-process regression.

---

## Injected infrastructure failure classes (Phase 4)

Five classes — `killed-session`, `timeout`, `corrupted-state-file`,
`malformed-message`, `stale-state-read` — are deliberately injected against the
real coordinator by `tasks/failures/`, so the retrieval index has labeled
failure history to diagnose against. They are staged, not accidents, so they are
not written up here.

Their symptom / root cause / remediation prose lives in **`src/rag/playbook.js`**,
which is the single source of truth: `diagnose_failure` returns those strings at
runtime, so a second copy in this file would drift the moment one is edited and
the stale copy is the one a reader meets first.
