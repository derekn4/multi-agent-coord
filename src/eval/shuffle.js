// src/eval/shuffle.js
//
// The label shuffle used by the Phase 4 falsification, in ONE place because
// both the runner and the test need it and a second copy is how it broke the
// first time.
//
// History worth keeping: this started as a rotate-by-7 over the label column.
// loadDocs returns files in alphabetical order, so the corpus arrives as five
// contiguous blocks of 15 identical labels, and sliding 7 positions inside a
// block of 15 lands on the SAME label more often than not. 40 of 75 labels
// (53%) survived unchanged, the k=3 majority vote repaired most of the rest,
// and the "falsification" reported 92% accuracy -- which reads exactly like a
// real finding that retrieval is decorative. A falsification that cannot fail
// is worse than no falsification, because it looks like evidence.
//
// Hence assertShuffled: the shuffle now proves it actually shuffled.

// Seeded LCG (glibc constants). Deterministic, so the falsification number is
// reproducible across runs -- a moving target proves nothing -- without
// Math.random's non-reproducibility.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1103515245, s) + 12345) >>> 0;
    return s / 4294967296;
  };
}

// Fisher-Yates over the label column, decoupling every label from its document.
// Returns the relabeled docs plus the fraction of labels that coincidentally
// landed on their own value.
export function shuffleLabels(docs, seed = 20260723) {
  const labels = docs.map((d) => d.label);
  const rand = lcg(seed);
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  const shuffled = docs.map((d, i) => ({ ...d, label: labels[i] }));
  const unchanged = shuffled.filter((d, i) => d.label === docs[i].label).length;
  return { shuffled, unchanged, unchangedRatio: Number((unchanged / docs.length).toFixed(4)) };
}

// With C balanced classes about 1/C of labels land on their own value by
// chance. Anything far above that means the shuffle is not shuffling.
export const SHUFFLE_CEILING = 0.4;
