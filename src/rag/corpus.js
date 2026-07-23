// src/rag/corpus.js
//
// Loads labeled traces from src/eval/corpus/, featurizes them, and builds the
// BM25 index. Filenames carry the label: <class>-<surface>-<nn>.jsonl.
//
// The index is built from surface A ONLY. Surface B is the held-out split and
// must never enter the index -- if it did, the held-out accuracy number would be
// measuring memorization, which is the exact thing it exists to rule out.
//
// Built lazily on first use and cached for the process lifetime: a Claude Code
// session pays the ~100-file parse once, not per diagnose_failure call.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { traceDoc } from './traceDoc.js';
import { buildIndex } from './store.js';

const __dir = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = join(__dir, '..', 'eval', 'corpus');

const NAME = /^(.+)-([AB])-(\d+)\.jsonl$/;

export function parseEvents(text) {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// surface: 'A' | 'B' | null (both)
export function loadDocs({ surface = null, dir = CORPUS_DIR } = {}) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => ({ f, m: NAME.exec(f) }))
    .filter(({ m }) => m && (surface === null || m[2] === surface))
    .map(({ f, m }) => ({
      id: f,
      label: m[1],
      surface: m[2],
      tokens: traceDoc(parseEvents(readFileSync(join(dir, f), 'utf8'))).tokens,
    }));
}

let cached = null;

export function loadIndex() {
  if (!cached) cached = buildIndex(loadDocs({ surface: 'A' }));
  return cached;
}

// Tests that swap the corpus need to drop the cache.
export function resetIndexCache() {
  cached = null;
}
