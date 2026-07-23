// test/vote.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voteClass, FLOOR } from '../src/rag/diagnose.js';

const loose = { minScore: 0, minConfidence: 0 };

test('score-weighted vote can beat a raw count', () => {
  // beta has 2 of 3 votes but alpha carries more score.
  const hits = [
    { id: 'a', label: 'alpha', score: 9 },
    { id: 'b', label: 'beta', score: 3 },
    { id: 'c', label: 'beta', score: 2 },
  ];
  const v = voteClass(hits, loose);
  assert.equal(v.predicted_class, 'alpha');
  assert.ok(Math.abs(v.confidence - 9 / 14) < 1e-9);
});

test('unanimous neighbours give confidence 1', () => {
  const v = voteClass([
    { id: 'a', label: 'alpha', score: 4 },
    { id: 'b', label: 'alpha', score: 2 },
  ], loose);
  assert.equal(v.predicted_class, 'alpha');
  assert.equal(v.confidence, 1);
});

test('no neighbours means no prediction', () => {
  assert.deepEqual(voteClass([], loose), { predicted_class: null, confidence: 0 });
});

test('a weak top score is rejected by the floor', () => {
  const hits = [{ id: 'a', label: 'alpha', score: 0.4 }];
  const v = voteClass(hits, { minScore: 2, minConfidence: 0 });
  assert.equal(v.predicted_class, null, 'below minScore must not be classified');
  assert.ok(v.confidence > 0, 'confidence is still reported');
});

test('a split vote is rejected by the confidence floor', () => {
  const hits = [
    { id: 'a', label: 'alpha', score: 5 },
    { id: 'b', label: 'beta', score: 4.9 },
  ];
  const v = voteClass(hits, { minScore: 0, minConfidence: 0.6 });
  assert.equal(v.predicted_class, null);
});

test('FLOOR is a calibrated pair of numbers, not a guess', () => {
  assert.equal(typeof FLOOR.minScore, 'number');
  assert.equal(typeof FLOOR.minConfidence, 'number');
});
