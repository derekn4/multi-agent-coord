// test/trace-doc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceDoc } from '../src/rag/traceDoc.js';
import { buildIndex, query } from '../src/rag/store.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'eval', 'corpus');

function loadTrace(name) {
  return readFileSync(join(CORPUS, name), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

test('drops identifiers, timestamps, and raw values', () => {
  const events = loadTrace('stale-state-read-A-00.jsonl');
  const { tokens } = traceDoc(events);
  for (const t of tokens) {
    assert.ok(!UUID.test(t), `token leaks a UUID: ${t}`);
    assert.ok(!ISO.test(t), `token leaks a timestamp: ${t}`);
    assert.ok(!t.startsWith('t-'), `token leaks a trace id: ${t}`);
    assert.ok(!t.includes('srv-'), `token leaks a session id: ${t}`);
    assert.ok(!t.includes('build_status'), `token leaks a state key: ${t}`);
  }
});

test('emits the expected shape tokens', () => {
  const { tokens } = traceDoc(loadTrace('killed-session-A-00.jsonl'));
  assert.ok(tokens.includes('no_terminal_event'));
  assert.ok(tokens.some((t) => t.startsWith('tool:')));
  assert.ok(tokens.some((t) => t.startsWith('event:')));
  assert.ok(tokens.some((t) => t.startsWith('latency_bucket:')));
});

test('a terminating class does not get no_terminal_event', () => {
  const { tokens } = traceDoc(loadTrace('malformed-message-A-00.jsonl'));
  assert.ok(!tokens.includes('no_terminal_event'));
  assert.ok(tokens.includes('parse_error'));
});

test('stale-state-read carries its silent shape features', () => {
  const { tokens } = traceDoc(loadTrace('stale-state-read-A-00.jsonl'));
  assert.ok(tokens.includes('state_read_before_write'));
  assert.ok(tokens.includes('multi_session'));
  assert.ok(!tokens.includes('ok:false'), 'this class errors nowhere');
});

test('same-class traces land closer than cross-class ones', () => {
  const files = readdirSync(CORPUS).filter((f) => f.endsWith('.jsonl'));
  const docs = files.map((f) => ({
    id: f,
    label: f.replace(/-[AB]-\d+\.jsonl$/, ''),
    tokens: traceDoc(loadTrace(f)).tokens,
  }));
  const idx = buildIndex(docs);
  const probe = docs.find((d) => d.id === 'corrupted-state-file-A-01.jsonl');
  const hits = query(idx, probe.tokens, 3, { excludeId: probe.id });
  assert.equal(hits[0].label, 'corrupted-state-file');
});
