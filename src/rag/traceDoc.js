// src/rag/traceDoc.js
//
// Trace -> token bag. This is the defensible core of Phase 4.
//
// Raw trace JSONL is mostly high-cardinality noise: UUIDs, ISO timestamps,
// per-run state keys, float latencies. A lexical index built over raw lines
// would MEMORIZE those identifiers -- scoring a fake 100% on leave-one-out and
// only exposing itself on the held-out surface-B split. So this function keeps
// the run's SHAPE and throws the literals away.
//
// KEEP:                                  DISCARD:
//   event:<type>                           ts / any timestamp
//   tool:<name>                            trace_id, session_id (as literals)
//   ok:false (once per occurrence)         state key names and values
//   error_class:<name>                     message bodies
//   latency_bucket:<bucket>                exact latency floats
//   seq:<toolA>><toolB> bigrams            task ids, agent ids
//   parse_error
//   no_terminal_event
//   multi_session
//   state_read_before_write
//   len_bucket:<bucket>
//
// Term FREQUENCY carries signal, so repeated tokens are pushed repeatedly --
// three failed calls must not look like one. BM25 handles the saturation.

// Latency ladder. Buckets, not floats: the useful distinction is "instant" vs
// "blocked on something", and gte1000 is the only thing separating a timeout
// trace from a killed-session one.
export function latencyBucket(ms) {
  if (ms < 10) return 'lt10';
  if (ms < 100) return 'lt100';
  if (ms < 1000) return 'lt1000';
  return 'gte1000';
}

export function lenBucket(n) {
  if (n <= 2) return '1-2';
  if (n <= 5) return '3-5';
  if (n <= 10) return '6-10';
  return 'gt10';
}

// A parse failure, wherever it happened: a truncated state file (server-side,
// "Corrupt coordinator state file") or a truncated message body (client-side,
// SyntaxError from JSON.parse).
export function isParseError(e) {
  if (e.error_class === 'SyntaxError') return true;
  return /corrupt|json|parse|unexpected token/i.test(e.error ?? '');
}

// ── TODO(you) ───────────────────────────────────────────────────────────────
// Implement traceDoc(events) -> { tokens: string[] }.
//
// 1. Sort a copy of `events` by `ts` ascending. Do not mutate the input.
// 2. Per event, in order, push:
//      `event:${e.event}`
//      `tool:${e.tool}`                        when e.tool is set
//      'ok:false'                              when e.ok === false
//      `error_class:${e.error_class}`          when set
//      `latency_bucket:${latencyBucket(e.latency_ms)}`  when latency_ms is a number
//      'parse_error'                           when isParseError(e)
// 3. Build the tool sequence (e.tool for events that have one, in order) and
//    push a `seq:${prev}>${next}` bigram for each adjacent pair. Ordering is
//    what distinguishes a read-then-write from a write-then-read.
// 4. Push the derived shape tokens:
//      'no_terminal_event'        when no event has event === 'task_end'
//      'multi_session'            when the number of distinct session_id values
//                                 (ignore null/undefined) is > 1
//      'state_read_before_write'  when some get_state event precedes some
//                                 set_state event
//      `len_bucket:${lenBucket(events.length)}`
// 5. Return { tokens }.
//
// Guardrail: no token may contain a UUID, an ISO timestamp, a state key, or an
// agent id. test/trace-doc.test.js asserts exactly that.
export function traceDoc(events) {
  const events_sorted = [...events].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const tokens = [];
  for (const e of events_sorted) {
    tokens.push(`event:${e.event}`);
    if (e.tool) tokens.push(`tool:${e.tool}`);
    if (e.ok === false) tokens.push('ok:false');
    if (e.error_class) tokens.push(`error_class:${e.error_class}`);
    if (typeof e.latency_ms === 'number') {
      tokens.push(`latency_bucket:${latencyBucket(e.latency_ms)}`);
    }
    if (isParseError(e)) tokens.push('parse_error');
  }
  const tools = events_sorted.map((e) => e.tool).filter(Boolean);
  for (let i = 0; i < tools.length - 1; i++) {
    tokens.push(`seq:${tools[i]}>${tools[i + 1]}`);
  }
  // 4. Push the derived shape tokens:
  if (!events_sorted.some((e) => e.event === 'task_end')) {
    tokens.push('no_terminal_event');
  }
  const session_ids = new Set(
    events_sorted.map((e) => e.session_id).filter(Boolean)
  );
  if (session_ids.size > 1) {
    tokens.push('multi_session');
  }
  const toolSeq = events_sorted.filter((e) => e.tool);
  const firstGetIndex = toolSeq.findIndex((e) => e.tool === 'get_state');
  const lastSetIndex = toolSeq.findLastIndex((e) => e.tool === 'set_state');
  if (firstGetIndex !== -1 && lastSetIndex > firstGetIndex) {
    tokens.push('state_read_before_write');
  }
  tokens.push(`len_bucket:${lenBucket(events_sorted.length)}`);
  return { tokens };
}
