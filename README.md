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
src/store.js         Persistence: atomic writes + cross-process lock (the core)
src/coordinator.js   MCP server; four tools are thin wrappers over the store
test/store.test.js   Proves: survives restart, concurrent writes don't corrupt
test-helpers/        Child-process scripts the multi-process tests spawn
hooks/               PostToolUse (TodoWrite) + Stop lifecycle hook scripts
examples/            MCP config + hook settings snippets to copy into a project
```

---

## Roadmap

This is Phase 0 of a multi-phase build toward a production-grade agent-coordination project:

- **Phase 0 — Coordinator** *(this)*: MCP server, file persistence, tests, hooks.
- **Phase 1 — Observability**: trace IDs across sessions, JSONL event log, a timeline viewer, explicit failure capture.
- **Phase 2 — Eval harness**: 10–20 coordination tasks with deterministic pass criteria, a scorecard runner, a saved baseline.
- **Phase 3 — Verification loop**: a grader that gates task completion, with bounded retry.
- **Phase 4 — RAG diagnostics**: index past traces; a `diagnose_failure(trace_id)` tool that retrieves similar failures and proposes root causes.
