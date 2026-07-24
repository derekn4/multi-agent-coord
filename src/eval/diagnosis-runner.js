#!/usr/bin/env node
// src/eval/diagnosis-runner.js
//
// Phase 4 scorecard. Three numbers, because one would not be evidence:
//
//   leave-one-out   classification works when a trace cannot match itself
//   held-out        generalization: surface-B queries share a class's SHAPE
//                   with the index but none of its literals. If this tracks
//                   leave-one-out, the featurizer keys on shape; if it
//                   collapses, it memorized identifiers.
//   shuffled-label  retrieval is load-bearing. Scramble the index labels and
//                   accuracy must fall to ~20% (chance at 5 classes). This is
//                   the direct analogue of Phase 3's neutered-verifier
//                   falsification: if scrambling does NOT hurt, the featurizer
//                   is secretly a rules engine and retrieval is decorative.
//
// Never merges into baseline.json -- same separation Phase 3 used so new tasks
// cannot dilute the existing 100%.
//
// Usage:
//   node src/eval/diagnosis-runner.js              measure + write baseline
//   node src/eval/diagnosis-runner.js --calibrate  sweep the confidence floor
//   node src/eval/diagnosis-runner.js --no-save    print only

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadDocs } from '../rag/corpus.js';
import { buildIndex, query } from '../rag/store.js';
import { traceDoc } from '../rag/traceDoc.js';
import { voteClass, FLOOR, K } from '../rag/diagnose.js';
import { FAILURE_CLASSES } from '../../tasks/failures/index.js';
import { shuffleLabels, SHUFFLE_CEILING } from './shuffle.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, 'diagnosis-baseline.json');

// A trace belonging to none of the five classes. The floor must reject it --
// a classifier that cannot say "I do not recognize this" is wrong in the most
// dangerous way, since it files novel failures under a familiar name.
//
// Featurized by the REAL traceDoc rather than hand-written, and that matters.
// A hand-written bag is trivially rejected because its tokens do not exist in
// the corpus at all, so `query` returns [] and voteClass declines via its
// no-neighbours branch -- the floor is never exercised and every calibration
// row reports "rejects OOD" vacuously. Run through the featurizer, this probe
// shares `no_terminal_event` with killed-session and genuinely retrieves it,
// so the sweep measures the floor instead of an artifact.
const OOD_TOKENS = traceDoc([
  { ts: '2026-01-01T00:00:00.000Z', event: 'heartbeat', trace_id: 't-ood', session_id: 'srv-ood' },
]).tokens;

// shuffleLabels lives in ./shuffle.js so this runner and
// test/diagnosis-falsification.test.js cannot drift apart. See that file for
// why the shuffle self-checks.

function classify(index, tokens, { excludeId = null, floor = FLOOR } = {}) {
  return voteClass(query(index, tokens, K, { excludeId }), floor);
}

function accuracy(index, probes, { selfExclude, floor }) {
  let correct = 0;
  const pairs = [];
  for (const p of probes) {
    const { predicted_class } = classify(index, p.tokens, {
      excludeId: selfExclude ? p.id : null,
      floor,
    });
    if (predicted_class === p.trueLabel) correct++;
    pairs.push({ actual: p.trueLabel, predicted: predicted_class });
  }
  return { accuracy: probes.length ? Number((correct / probes.length).toFixed(4)) : null, pairs };
}

function confusion(pairs, classes) {
  const cols = [...classes, 'none'];
  const m = {};
  for (const a of classes) { m[a] = {}; for (const p of cols) m[a][p] = 0; }
  for (const { actual, predicted } of pairs) m[actual][predicted ?? 'none']++;

  const perClass = {};
  for (const c of classes) {
    const tp = m[c][c];
    const fn = cols.reduce((s, p) => s + (p === c ? 0 : m[c][p]), 0);
    const fp = classes.reduce((s, a) => s + (a === c ? 0 : m[a][c]), 0);
    perClass[c] = {
      precision: tp + fp ? Number((tp / (tp + fp)).toFixed(3)) : null,
      recall: tp + fn ? Number((tp / (tp + fn)).toFixed(3)) : null,
    };
  }
  return { matrix: m, perClass };
}

const pad = (s, w) => (String(s).length >= w ? String(s) : String(s) + ' '.repeat(w - String(s).length));
const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`);

function printConfusion(matrix, perClass, classes) {
  const W = 24;
  const lines = ['', 'CONFUSION MATRIX  (rows = actual, cols = predicted)', '-'.repeat(W + 8 * (classes.length + 1) + 20)];
  lines.push(pad('', W) + classes.map((c) => pad(c.slice(0, 7), 8)).join('') + pad('none', 8) + pad('prec', 8) + 'recall');
  for (const a of classes) {
    lines.push(
      pad(a, W) +
      classes.map((p) => pad(matrix[a][p], 8)).join('') +
      pad(matrix[a].none, 8) +
      pad(perClass[a].precision ?? '-', 8) +
      (perClass[a].recall ?? '-'),
    );
  }
  console.log(lines.join('\n'));
}

function calibrate(indexA, probesA, probesB) {
  console.log('\nCALIBRATION SWEEP  (pick max held-out accuracy that still rejects OOD)');
  console.log(pad('minScore', 12) + pad('minConf', 12) + pad('held-out', 12) + 'rejects OOD');
  console.log('-'.repeat(50));
  const rows = [];
  for (const minScore of [0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0]) {
    for (const minConfidence of [0, 0.34, 0.4, 0.5, 0.6, 0.7]) {
      const floor = { minScore, minConfidence };
      const held = accuracy(indexA, probesB, { selfExclude: false, floor }).accuracy;
      const oodRejected = classify(indexA, OOD_TOKENS, { floor }).predicted_class === null;
      rows.push({ minScore, minConfidence, held, oodRejected });
      console.log(pad(minScore, 12) + pad(minConfidence, 12) + pad(pct(held), 12) + (oodRejected ? 'yes' : 'NO'));
    }
  }
  // Rank: held-out accuracy first, then the LOOSEST minScore that still rejects
  // OOD (a tighter one buys nothing and risks rejecting real traces), then the
  // TIGHTEST minConfidence. That last tiebreak matters: held-out is flat across
  // every minConfidence at the winning minScore, so the confidence half is
  // unconstrained by this data -- taking 0 would silently disable it and let a
  // bare-majority split vote through at full confidence. Free insurance.
  const best = rows
    .filter((r) => r.oodRejected)
    .sort((a, b) => b.held - a.held || a.minScore - b.minScore || b.minConfidence - a.minConfidence)[0];
  console.log(`\nPICK: minScore=${best.minScore} minConfidence=${best.minConfidence} -> held-out ${pct(best.held)}`);
  console.log('Copy these into FLOOR in src/rag/diagnose.js, then re-run without --calibrate.');
  // Leave-one-out is intentionally NOT used to pick the floor: choosing a
  // threshold on the same split you report would be fitting to the test set.
}

function main() {
  const docsA = loadDocs({ surface: 'A' });
  const docsB = loadDocs({ surface: 'B' });
  if (!docsA.length) {
    console.error('empty corpus -- run: node src/eval/corpus-runner.js --clean');
    process.exit(1);
  }

  const indexA = buildIndex(docsA);
  const probesA = docsA.map((d) => ({ ...d, trueLabel: d.label }));
  const probesB = docsB.map((d) => ({ ...d, trueLabel: d.label }));

  if (process.argv.includes('--calibrate')) {
    calibrate(indexA, probesA, probesB);
    return;
  }

  const loo = accuracy(indexA, probesA, { selfExclude: true, floor: FLOOR });
  const held = accuracy(indexA, probesB, { selfExclude: false, floor: FLOOR });
  const shuf = shuffleLabels(docsA);
  if (shuf.unchangedRatio > SHUFFLE_CEILING) {
    console.error(`BAD SHUFFLE: ${shuf.unchanged}/${docsA.length} labels unchanged (${pct(shuf.unchangedRatio)}). Not a falsification.`);
    process.exit(1);
  }
  const shuffled = accuracy(buildIndex(shuf.shuffled), probesA, { selfExclude: true, floor: FLOOR });
  const { matrix, perClass } = confusion(held.pairs, FAILURE_CLASSES);
  const oodRejected = classify(indexA, OOD_TOKENS).predicted_class === null;

  console.log(`Diagnosis scorecard  (${docsA.length} indexed / ${docsB.length} held out, ${FAILURE_CLASSES.length} classes, k=${K})`);
  console.log('='.repeat(70));
  console.log(`${pad('leave-one-out (surface A)', 32)}${pct(loo.accuracy)}`);
  console.log(`${pad('held-out (surface B)', 32)}${pct(held.accuracy)}   <- the headline`);
  console.log(`${pad('shuffled labels', 32)}${pct(shuffled.accuracy)}   <- must collapse to ~${pct(1 / FAILURE_CLASSES.length)}`);
  console.log(`${pad('rejects out-of-distribution', 32)}${oodRejected ? 'yes' : 'NO'}`);
  console.log(`${pad('floor', 32)}minScore=${FLOOR.minScore} minConfidence=${FLOOR.minConfidence}`);
  printConfusion(matrix, perClass, FAILURE_CLASSES);

  const card = {
    generatedFrom: 'src/eval/diagnosis-runner.js',
    retrieval: 'BM25 lexical over engineered trace features (not dense-vector embeddings)',
    classes: FAILURE_CLASSES,
    k: K,
    floor: FLOOR,
    indexed: docsA.length,
    heldOut: docsB.length,
    leaveOneOut: loo.accuracy,
    heldOutAccuracy: held.accuracy,
    shuffledLabelAccuracy: shuffled.accuracy,
    shuffledLabelsUnchangedRatio: shuf.unchangedRatio,
    chance: Number((1 / FAILURE_CLASSES.length).toFixed(4)),
    rejectsOutOfDistribution: oodRejected,
    confusion: matrix,
    perClass,
  };

  if (!process.argv.includes('--no-save')) {
    writeFileSync(OUT, JSON.stringify(card, null, 2));
    console.log(`\n-> ${OUT}`);
  }

  // The falsification must hold, or the headline number means nothing.
  if (shuffled.accuracy > 0.4) {
    console.error('\nFAIL: shuffling labels barely hurt. Retrieval is not load-bearing.');
    process.exit(1);
  }
  process.exit(0);
}

main();
