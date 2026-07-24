// test/diagnosis-falsification.test.js
//
// Phase 3 proved its verifier was load-bearing by neutering it and watching the
// gated arm collapse onto the ungated one. This is the same move for retrieval:
// scramble the labels in the index and classification must fall to chance.
//
// If it does NOT collapse, the featurizer is secretly a rules engine -- it is
// recognizing classes by handcrafted tokens and retrieval is decorative. That
// would invalidate the headline accuracy number, so this test is the one that
// makes the number mean something.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadDocs } from '../src/rag/corpus.js';
import { buildIndex, query } from '../src/rag/store.js';
import { voteClass, FLOOR, K } from '../src/rag/diagnose.js';
import { shuffleLabels, SHUFFLE_CEILING } from '../src/eval/shuffle.js';

const docs = loadDocs({ surface: 'A' });
const CHANCE = 0.2; // five classes

function accuracyOver(index, probes) {
  let correct = 0;
  for (const p of probes) {
    const { predicted_class } = voteClass(query(index, p.tokens, K, { excludeId: p.id }), FLOOR);
    if (predicted_class === p.label) correct++;
  }
  return correct / probes.length;
}

test('the corpus is present', () => {
  assert.ok(docs.length >= 50, `expected the surface-A corpus, got ${docs.length} docs`);
});

// Guards the falsification itself. The original shuffle was a rotate-by-7 over
// a corpus that loads grouped by class, so 53% of labels never moved and the
// "collapse" it reported was an artifact. A falsification that cannot fail is
// worse than none, because it still looks like evidence.
test('the shuffle actually shuffles', () => {
  const { unchangedRatio } = shuffleLabels(docs);
  assert.ok(
    unchangedRatio <= SHUFFLE_CEILING,
    `${(unchangedRatio * 100).toFixed(1)}% of labels kept their original value; the shuffle is not shuffling`,
  );
});

test('intact index classifies well above chance', () => {
  const acc = accuracyOver(buildIndex(docs), docs);
  assert.ok(acc > 0.7, `intact accuracy ${acc} should be well above chance`);
});

test('shuffling the labels collapses accuracy to ~chance', () => {
  const intact = accuracyOver(buildIndex(docs), docs);
  const shuffled = accuracyOver(buildIndex(shuffleLabels(docs).shuffled), docs);
  assert.ok(
    shuffled < 0.4,
    `shuffled accuracy ${shuffled} must collapse toward chance (${CHANCE}); retrieval is not load-bearing otherwise`,
  );
  assert.ok(intact - shuffled > 0.3, `the gap ${intact - shuffled} is too small to be evidence`);
});
