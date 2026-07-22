// test/rag-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, query } from '../src/rag/store.js';

const docs = [
  { id: 'a1', label: 'alpha', tokens: ['tool:set_state', 'ok:false', 'error_class:Error'] },
  { id: 'a2', label: 'alpha', tokens: ['tool:set_state', 'ok:false', 'error_class:Error', 'parse_error'] },
  { id: 'b1', label: 'beta', tokens: ['tool:get_state', 'no_terminal_event'] },
];

test('ranks the closer document first', () => {
  const idx = buildIndex(docs);
  const hits = query(idx, ['tool:set_state', 'ok:false', 'error_class:Error'], 3);
  assert.equal(hits[0].label, 'alpha');
  assert.ok(hits[0].score > hits[hits.length - 1].score);
});

test('rare terms outweigh common ones (IDF)', () => {
  const idx = buildIndex(docs);
  // 'tool:set_state' appears in 2/3 docs; 'no_terminal_event' in 1/3.
  const common = query(idx, ['tool:set_state'], 1)[0].score;
  const rare = query(idx, ['no_terminal_event'], 1)[0].score;
  assert.ok(rare > common, `rare ${rare} should outscore common ${common}`);
});

test('excludeId removes a document from its own results', () => {
  const idx = buildIndex(docs);
  const hits = query(idx, docs[0].tokens, 3, { excludeId: 'a1' });
  assert.ok(!hits.some((h) => h.id === 'a1'));
});

test('k caps the result count', () => {
  const idx = buildIndex(docs);
  assert.equal(query(idx, ['tool:set_state'], 1).length, 1);
});

test('empty index returns no hits', () => {
  assert.deepEqual(query(buildIndex([]), ['tool:set_state'], 3), []);
});

test('singleton index returns that one doc', () => {
  const idx = buildIndex([docs[0]]);
  const hits = query(idx, ['tool:set_state'], 3);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'a1');
});

test('a query sharing no terms scores nothing', () => {
  const idx = buildIndex(docs);
  assert.deepEqual(query(idx, ['tool:nonexistent'], 3), []);
});
