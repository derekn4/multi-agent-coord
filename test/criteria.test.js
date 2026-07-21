// test/criteria.test.js
//
// The criteria vocabulary is the deterministic oracle the verifier runs on, so
// each predicate is tested BOTH ways: it must pass when it should, and fail
// with a reason a retrying agent can act on. The reason strings are asserted
// exactly because they ARE the retry feedback — vague text is a real defect.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateCriteria } from '../src/criteria.js';

const snapshot = {
  state: { step1_status: 'pending', flag: 'set' },
  messages: [
    { id: 1, from: 'agentB', to: 'agentA', body: 'step1 complete' },
    { id: 2, from: 'agentC', to: 'all', body: 'broadcast hello' },
  ],
};

test('state_key/equals passes when the value matches', () => {
  assert.deepEqual(evaluateCriteria([{ state_key: 'flag', equals: 'set' }], snapshot), []);
});

test('state_key/equals fails with expected-vs-got', () => {
  assert.deepEqual(
    evaluateCriteria([{ state_key: 'step1_status', equals: 'done' }], snapshot),
    ["state_key step1_status: expected 'done', got 'pending'"],
  );
});

test('state_key/equals reports a missing key as undefined', () => {
  assert.deepEqual(
    evaluateCriteria([{ state_key: 'nope', equals: 'done' }], snapshot),
    ["state_key nope: expected 'done', got undefined"],
  );
});

test('state_key/exists passes for any set value and fails when missing', () => {
  assert.deepEqual(evaluateCriteria([{ state_key: 'flag', exists: true }], snapshot), []);
  assert.deepEqual(
    evaluateCriteria([{ state_key: 'nope', exists: true }], snapshot),
    ['state_key nope: expected it to be set, but it is missing'],
  );
});

test('message_to/from matches a directed message', () => {
  assert.deepEqual(
    evaluateCriteria([{ message_to: 'agentA', from: 'agentB' }], snapshot),
    [],
  );
});

test('message_to/from also matches a broadcast to "all"', () => {
  assert.deepEqual(
    evaluateCriteria([{ message_to: 'agentA', from: 'agentC' }], snapshot),
    [],
  );
});

test('message_to/from fails when no message matches', () => {
  assert.deepEqual(
    evaluateCriteria([{ message_to: 'agentA', from: 'agentZ' }], snapshot),
    ['message_to agentA from agentZ: no matching message'],
  );
});

test('message_to/body_contains matches on substring', () => {
  assert.deepEqual(
    evaluateCriteria([{ message_to: 'agentA', body_contains: 'complete' }], snapshot),
    [],
  );
  assert.deepEqual(
    evaluateCriteria([{ message_to: 'agentA', body_contains: 'rolled back' }], snapshot),
    ["message_to agentA body_contains 'rolled back': no matching message"],
  );
});

test('every failing criterion is reported, not just the first', () => {
  const failures = evaluateCriteria(
    [
      { state_key: 'step1_status', equals: 'done' },
      { message_to: 'agentA', from: 'agentZ' },
    ],
    snapshot,
  );
  assert.equal(failures.length, 2);
});

test('an unrecognized criterion fails loudly instead of passing silently', () => {
  const failures = evaluateCriteria([{ mystery: true }], snapshot);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /unsupported criterion/);
});
