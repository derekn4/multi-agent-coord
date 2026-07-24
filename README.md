# multi-agent-coord

A custom [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets **concurrent Claude Code sessions coordinate** — passing messages and sharing persistent state through four tools.

It exists to demonstrate one specific, non-obvious systems problem and its fix (see below), and it's the foundation for a larger agent-reliability project: observability, an eval harness, a verification loop, and RAG-based failure diagnostics (roadmap at the bottom).

---

## The problem it solves: cross-process state isolation

A stdio MCP server is launched as a **child process of each client**. When two Claude Code sessions both connect to this coordinator, each spawns its **own** server process:

```
Session A ──spawns──> coordinator process A   (its own memory)
Session B ──spawns──> coordinator process B   (its own memory)
```

So if coordinator state lived in an in-memory object, `send_message` from A would land in process A's RAM, and `read_messages` from B would read process B's RAM — **empty**. The two agents can't see each other.

**The fix:** state is not held in memory. A single JSON file on disk is the source of truth. Every mutation writes it; every read loads it. The file is shared by both processes, so messages and state flow between sessions.

Two correctness details make the file safe under concurrency (both in [`src/store.js`](src/store.js)):

- **Atomic writes** — write to a temp file, then `rename()` over the target. `rename` is atomic within a filesystem, so a reader always sees a whole file, never a half-written one. (This is why reads need no lock.)
- **A cross-process lock** — read-modify-write operations acquire a lock built on `mkdir()` (atomic; fails if the directory already exists), with stale-lock recovery so a crashed holder can't deadlock everyone.

Both guarantees are proven by the test suite, including a test that spawns 5 separate OS processes hammering the same file at once.

---

## The four tools

| Tool | Purpose |
|---|---|
| `send_message` | Append a message to the shared log. `to` is a recipient agent id, or `"all"` to broadcast. |
| `read_messages` | Return messages addressed to an agent (or broadcasts). Optional `since` ISO-timestamp cursor for polling only new ones. |
| `set_state` | Write a shared key/value visible to every session. |
| `get_state` | Read a shared key, or the whole state bag. |

State is persisted to `$COORDINATOR_STATE_DIR/state.json` (default: `~/.multi-agent-coord/`).

---

## Quick start

```bash
git clone <this repo>
cd multi-agent-coord
npm install
npm test          # proves the persistence guarantees
```

### Wire it into two Claude Code sessions

Point **both** projects at this same server and the **same** state dir. Copy [`examples/mcp-config.json`](examples/mcp-config.json) to a `.mcp.json` in each project, editing the absolute paths:

```json
{
  "mcpServers": {
    "coordinator": {
      "command": "node",
      "args": ["/abs/path/to/multi-agent-coord/src/coordinator.js"],
      "env": { "COORDINATOR_STATE_DIR": "/abs/path/to/shared-coord-state" }
    }
  }
}
```

Then, in session A:

> Use `send_message` to send `to: "agentB"`, `body: "ping"`.

And in session B:

> Use `read_messages` with `to: "agentB"`.

Session B sees the message A wrote — across two independent processes.

---

## Layout

```
src/store.js           Persistence: atomic writes + cross-process lock (the core)
src/coordinator.js     MCP server; four tools are thin wrappers over the store
src/trace.js           Observability: JSONL event log + trace-id helpers
src/eval/              Eval harness: spawn/client plumbing, runner, scorecard, baseline
tasks/                 The 10 eval tasks, one per file, collected in index.js
tools/trace_viewer.py  Per-trace timeline viewer (stdlib Python, no deps)
test/                  store + trace unit tests, and an end-to-end smoke test
test-helpers/          Child-process scripts the multi-process tests spawn
hooks/                 SessionStart + PostToolUse (TodoWrite) + Stop hook scripts
examples/              MCP config + hook settings snippets to copy into a project
```

---

## Observability (Phase 1)

Every tool call appends one JSON line to `$COORDINATOR_STATE_DIR/events.jsonl`:
timestamp, session id, tool, input, output, latency, `trace_id`, and — on
failure — the error and its class. A `trace_id` passed on a message and threaded
through the recipient's tool calls lets one task be reconstructed **across both
sessions**.

View any run as a per-trace timeline:

```bash
python tools/trace_viewer.py                 # all traces
python tools/trace_viewer.py --failures      # only traces that hit an error
python tools/trace_viewer.py --trace t-abc…  # one trace
```

---

## Eval harness (Phase 2)

Turns "does the coordinator work?" from a vibe into a number. Ten coordination
tasks run against the **real** server — spawned as a child process, driven over
stdio, the same path Claude Code uses — N times each, producing a scorecard and a
saved baseline to compare future changes against.

```bash
node src/eval/runner.js                  # all tasks, scorecard + diff vs baseline
node src/eval/runner.js --n 20           # runs per task (default 5)
node src/eval/runner.js --save-baseline  # (re)establish the baseline
```

The eval "agents" are **deterministic scripts**, not live LLMs. That's a
deliberate trade: pass rate and latency are real and reproducible, and token cost
is honestly reported as `N/A` rather than fabricated. Every pass criterion is a
deterministic check — no LLM-as-judge was needed.

**Baseline — N=20, 200 runs, 100%:**

| task | proves |
|---|---|
| `msg-round-trip` | directed delivery A→B |
| `msg-broadcast` | `to:"all"` fan-out reaches B and C |
| `directed-isolation` | a directed message is *not* visible to a third agent |
| `since-cursor` | the `since` cursor returns only newer messages |
| `state-round-trip` | `set_state` → `get_state` |
| `state-overwrite` | last write wins, without duplicating the key |
| `cross-process-persistence` | state and messages survive a server restart |
| `concurrent-writers` | 5 concurrent processes, distinct keys, none lost |
| `trace-linkage` | one `trace_id` spans two sessions' events |
| `plan-execute-report` | A plans → B executes and reports → A confirms |

Latency reads as **process-spawn cost, not coordination cost** — the floor is
~350–450ms per `node coordinator.js` spawn, and the numbers scale with how many
processes a task starts. The store operations themselves are sub-millisecond.

100% is the intended *starting* point, not a stretch goal: these are
deterministic oracles against a system with no injected failures. Phase 4 injects
failures; that's when the number is meant to move.

### Can the checks actually fail?

A green scorecard is worthless if `check()` can't return false, so non-vacuity is
verified two ways. [`test/eval.test.js`](test/eval.test.js) runs a real task with
its check replaced by `() => false` and confirms the harness reports failure. And
for the two tasks whose value rests on a subtle mechanism, breaking the mechanism
must turn them red:

| mutation | task | with | without |
|---|---|---|---|
| `withLock` → call `fn()` directly (no mutex) | `concurrent-writers` | 5/5 | **2/5** |
| `instrument()` → `trace_id = null` | `trace-linkage` | 3/3 | **0/3** |

`concurrent-writers` is a *probabilistic* detector — process spawn latency
sometimes staggers the writers enough to avoid overlap — so it catches a missing
lock reliably across N=20, not necessarily on a single run.

---

## Verification loop (Phase 3)

The Phase 2 tasks grade the *coordinator*. This grades the *agent*: `complete_task`
re-reads shared state and decides whether a claimed completion actually happened,
before it is recorded.

```bash
node src/eval/verification-runner.js --n 5
```

The agent submits deterministic criteria; the coordinator evaluates them against
the store and returns the gap as text the agent can act on:

    { verified: false, attempts: 1, escalate: false,
      failures: ["state_key deploy_status: expected 'done', got 'pending'"] }

Two attempts, then the task is escalated and further attempts are refused. The
bound lives in shared state, not in the caller — a looping agent cannot talk its
way past it, and the count survives a session crash.

**Results (N=5, both arms):**

| metric | ungated | gated |
|---|---|---|
| pass rate | 20% | 80% |
| escalation rate | — | 20% |
| **bad completions accepted as done** | **80%** | **0%** |

Pass rate is the lesser number. `persistently-broken` counts as a gated *failure*
even though the system did the right thing by escalating it, so 80% understates
the result. The claim that matters is the last row: failures that used to pass
silently now either get repaired or get escalated — none pass silently.

**These rates are exact, not sampled.** The injected defects are deterministic, so
N guards against flakiness and measures latency; it does not estimate a rate. And
per Phase 2's discipline, the gate is falsified in
[`test/verification-falsification.test.js`](test/verification-falsification.test.js):
replace it with one that verifies everything and the gated arm collapses back to
20% with silent failures returning to 80%.

---

## Failure diagnostics (Phase 4)

`diagnose_failure({ trace_id })` classifies a failed run by retrieving the most
similar *labeled* past failures and returning the matched class with an authored
remediation entry.

**This is lexical retrieval (BM25) over engineered trace features, not
dense-vector RAG.** That is a deliberate choice, not a shortcut: the corpus is
short, highly structured JSONL whose signal is literal tokens (`error_class`,
tool names, `no_terminal_event`), so embeddings buy little over lexical matching
on that shape — and it keeps the project at two runtime dependencies.

There is **no LLM in the scored path**. Retrieval predicts the class by a
score-weighted vote over its k=3 nearest neighbours, so accuracy is a confusion
matrix rather than a judgment call.

### Failure classes

Five infrastructure failure classes, deliberately injected by `tasks/failures/`
to build a real labeled corpus:

| class | injection |
|---|---|
| `killed-session` | SIGKILL the coordinator child mid-call |
| `timeout` | hold the store lock past the client's deadline |
| `corrupted-state-file` | truncate `state.json` between calls |
| `malformed-message` | deliver a body that fails the receiver's `JSON.parse` |
| `stale-state-read` | read a key another session then overwrites |

### The featurizer

Raw trace lines are mostly high-cardinality noise: UUIDs, timestamps, per-run
state keys, float latencies. Indexing them directly would memorize identifiers
and score a fake 100%. [`src/rag/traceDoc.js`](src/rag/traceDoc.js) keeps a run's
*shape* — event and tool tokens, tool-sequence bigrams, latency buckets,
`no_terminal_event`, `state_read_before_write` — and discards every literal.

### Results

Run `npm run eval:diagnosis`. Three numbers, because one would not be evidence:

| measurement | result | what it shows |
|---|---|---|
| leave-one-out (surface A) | **100%** | classification works when a trace cannot match itself |
| held-out (surface B) | **100%** | queries drawn from a *disjoint vocabulary* of agent ids, state keys and task ids the index never saw |
| shuffled labels | **9.3%** | scramble the index labels and accuracy collapses below the 20% chance line |
| rejects out-of-distribution | **yes** | a synthetic sixth-class trace returns `null`, not a confident guess |

Numbers live in [`src/eval/diagnosis-baseline.json`](src/eval/diagnosis-baseline.json),
kept separate from `baseline.json` so new work cannot dilute the Phase 2 result.

### Why 100% is the *weakest* number here

Read honestly: **the accuracy figures are high because the task is easy by
construction, and the shuffle result is what carries the evidence.**

The five injectors are deterministic scripts, one code path each, and the
featurizer discards exactly the material that varies between runs of a class.
So after featurization the 20 traces of a class collapse onto 2–5 distinct token
bags, and **no token bag is shared between any two classes** — the classes are
disjoint sets, and nearest-neighbour over disjoint sets is trivial.

The held-out number is likewise softer than it looks. Surface B swaps the
vocabulary, and the featurizer throws vocabulary away by design, so a surface-B
trace featurizes to nearly the same bag as its surface-A counterpart (for
`killed-session`, *identically*). It proves the featurizer discards identifiers —
worth proving — but not that the system generalizes to unseen failure modes.

`killed-session` and `timeout` were designed to be confusable: both truncate the
trace with no terminal event, separated only by a final slow event. In practice
`latency_bucket:gte1000` separates them cleanly and the confusion matrix has **no
off-diagonal mass**. Genuine overlap would need a larger fraction of killed
sessions dying while lock-blocked.

What the numbers do support: the featurizer separates five deliberately-distinct
synthetic failure modes, and — via the shuffle — retrieval is genuinely
load-bearing rather than decorative. That second claim is the defensible one.

### Falsification

Per Phase 2's discipline, the mechanism is falsified in
[`test/diagnosis-falsification.test.js`](test/diagnosis-falsification.test.js):
scramble the labels in the index and accuracy falls from 100% to **9.3%**, below
the 20% chance line. Below chance rather than at it, because when scrambled
neighbours disagree the confidence floor declines to answer at all — sabotaged,
the classifier goes quiet instead of confidently wrong.

If scrambling did *not* hurt, the featurizer would be a rules engine and
retrieval decorative — so this is the test that makes the headline mean anything.
It ships with a guard of its own: the shuffle asserts it actually moved the
labels, after an earlier rotation-based version left 53% of them in place and
reported a false collapse.

An unrecognized trace returns `predicted_class: null` with its neighbours still
attached, rather than being filed under whichever of the five it happens to
resemble most. The floor that does this is calibrated by
`npm run eval:diagnosis -- --calibrate`, on the held-out split only — calibrating
on the reported split would be fitting to the test set.

---

## Roadmap

A multi-phase build toward a production-grade agent-coordination project:

- **Phase 0 — Coordinator** ✅: MCP server, file persistence, tests, hooks.
- **Phase 1 — Observability** ✅: trace IDs across sessions, JSONL event log, a Python timeline viewer. Errors are captured generically (`ok:false` + `error_class`); naming specific failure classes — timeout, malformed message, stale read — is still open, and lands with Phase 4's failure injection.
- **Phase 2 — Eval harness** ✅: 10 coordination tasks with deterministic pass criteria, a scorecard runner, a saved baseline at 100% (N=20).
- **Phase 3 — Verification loop** ✅ *(current)*: `complete_task` gates a claimed completion against deterministic criteria, with a server-enforced retry bound and escalation. On injected agent-behavior failures, pass rate goes 20% → 80% and silently-accepted bad completions go 80% → 0%.
- **Phase 4 — RAG diagnostics**: index past traces; a `diagnose_failure(trace_id)` tool that retrieves similar failures and proposes root causes.
