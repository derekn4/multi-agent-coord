// src/rag/diagnose.js
//
// The diagnosis path: featurize a query trace, retrieve its k nearest labeled
// neighbours, vote, and attach the playbook entry for the winning class.
//
// No LLM anywhere in here. The project's credibility rests on deterministic
// oracles -- Phase 2 needed no LLM-as-judge and token cost is honestly reported
// as N/A -- so a nondeterministic, paid, key-requiring component would trade
// that away for prose. The output is grounded entirely in retrieved evidence
// and accuracy is a real confusion matrix.

import { traceDoc } from './traceDoc.js';
import { query } from './store.js';
import { loadIndex } from './corpus.js';
import { PLAYBOOK } from './playbook.js';

export const K = 3;

// CALIBRATED, not guessed. src/eval/diagnosis-runner.js --calibrate sweeps both
// values and picks the pair that maximizes held-out accuracy while still
// REJECTING a synthetic sixth-class trace. Re-run the sweep and update these two
// numbers whenever the featurizer or the corpus changes.
export const FLOOR = { minScore: 1.5, minConfidence: 0.4 };

// ── TODO(you) ───────────────────────────────────────────────────────────────
// Implement voteClass(neighbors, floor) -> { predicted_class, confidence }.
//
// neighbors: [{ id, label, score }] sorted by score descending.
// floor:     { minScore, minConfidence }
//
// 1. No neighbours -> { predicted_class: null, confidence: 0 }.
// 2. Sum score per label. Winner is the highest summed score; break ties by
//    label name ascending so the result is deterministic.
// 3. confidence = winnerScoreSum / sumOfAllNeighborScores.
// 4. THE CONFIDENCE FLOOR. If neighbors[0].score < floor.minScore OR
//    confidence < floor.minConfidence, return predicted_class: null but keep
//    the computed confidence. Without this, a failure mode that was never
//    staged gets silently filed as whichever of the five it happens to resemble
//    most -- the classifier would have no way to say "I do not recognize this".
//    The neighbours are still returned by the caller either way, so a human
//    sees the evidence even when the machine declines to name a class.
// 5. Guard against a total score of 0 (return null, confidence 0) so step 3
//    never divides by zero.
export function voteClass(neighbors, floor = FLOOR) {
  if (neighbors.length === 0) {
    return { predicted_class: null, confidence: 0 };
  }
  const scoreSums = {};
  let totalScore = 0;
  for (const { label, score } of neighbors) {
    scoreSums[label] = (scoreSums[label] || 0) + score;
    totalScore += score;
  }
  if (totalScore === 0) {
    return { predicted_class: null, confidence: 0 };
  }
  const sortedLabels = Object.keys(scoreSums).sort();
  let winnerLabel = sortedLabels[0];
  let winnerScoreSum = scoreSums[winnerLabel];
  for (const label of sortedLabels) {
    if (scoreSums[label] > winnerScoreSum) {
      winnerLabel = label;
      winnerScoreSum = scoreSums[label];
    }
  }
  const confidence = winnerScoreSum / totalScore;
  if (neighbors[0].score < floor.minScore || confidence < floor.minConfidence) {
    return { predicted_class: null, confidence };
  }
  return { predicted_class: winnerLabel, confidence };
}

// Full diagnosis. `index` is injectable so the runner can pass a shuffled or
// leave-one-out index without touching the cached production one.
export function diagnose({ events, trace_id, index = null, k = K, floor = FLOOR, excludeId = null }) {
  const idx = index ?? loadIndex();
  const mine = events.filter((e) => e.trace_id === trace_id);

  if (mine.length === 0) {
    return {
      predicted_class: null,
      confidence: 0,
      neighbors: [],
      remediation: null,
      reason: `no events found for trace_id ${trace_id}`,
    };
  }
  if (!idx.N) {
    return {
      predicted_class: null,
      confidence: 0,
      neighbors: [],
      remediation: null,
      reason: 'diagnosis corpus is empty; run src/eval/corpus-runner.js',
    };
  }

  const { tokens } = traceDoc(mine);
  const neighbors = query(idx, tokens, k, { excludeId });
  const { predicted_class, confidence } = voteClass(neighbors, floor);

  return {
    predicted_class,
    confidence: Number(confidence.toFixed(4)),
    neighbors,
    remediation: predicted_class ? PLAYBOOK[predicted_class] : null,
    ...(predicted_class ? {} : { reason: 'below confidence floor; neighbours returned as evidence' }),
  };
}
