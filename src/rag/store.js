// src/rag/store.js
//
// BM25 over token bags. Hand-written because the corpus is ~100 short,
// structured documents -- pulling in a search engine for that would be
// infrastructure tourism (guardrail 1).
//
// Okapi BM25: for query term t against document d,
//   idf(t) * tf(t,d) * (k1+1) / (tf(t,d) + k1 * (1 - b + b * |d|/avgdl))
// The length normalization is what stops a long trace from outranking a
// short one purely by having more tokens.

const K1 = 1.5; // term-frequency saturation
const B = 0.75; // length-normalization strength

// docs: [{ id, label, tokens: string[] }]
export function buildIndex(docs) {
  const entries = docs.map((d) => {
    const tf = new Map();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { id: d.id, label: d.label, tf, len: d.tokens.length };
  });

  const df = new Map();
  for (const e of entries) for (const t of e.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);

  const N = entries.length;
  const avgdl = N ? entries.reduce((s, e) => s + e.len, 0) / N : 0;

  return { entries, df, N, avgdl };
}

// Probabilistic IDF, floored at 0 so a term in every document contributes
// nothing rather than going negative and penalizing a match.
function idf(index, term) {
  const n = index.df.get(term) ?? 0;
  if (n === 0) return 0;
  return Math.max(0, Math.log(1 + (index.N - n + 0.5) / (n + 0.5)));
}

export function query(index, tokens, k = 3, { excludeId = null } = {}) {
  if (!index.N) return [];
  const qtf = new Map();
  for (const t of tokens) qtf.set(t, (qtf.get(t) ?? 0) + 1);

  const scored = [];
  for (const e of index.entries) {
    if (excludeId !== null && e.id === excludeId) continue;
    let score = 0;
    for (const [t, qn] of qtf) {
      const f = e.tf.get(t);
      if (!f) continue;
      const norm = (f * (K1 + 1)) / (f + K1 * (1 - B + B * (e.len / (index.avgdl || 1))));
      score += idf(index, t) * norm * qn;
    }
    if (score > 0) scored.push({ id: e.id, label: e.label, score: Number(score.toFixed(6)) });
  }

  scored.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  return scored.slice(0, k);
}
