// src/eval/scorecard.js
//
// Aggregates raw per-run results into a scorecard: per-task pass rate and
// latency percentiles, plus an overall pass rate. Token cost is N/A for scripted
// tasks (no LLM calls), reported honestly as null rather than fabricated — the
// real numbers here are pass rate and latency.

// Nearest-rank percentile over an ascending-sorted array.
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, idx))];
}

const round2 = (n) => (n == null ? null : Number(n.toFixed(2)));

// runs: [{ taskId, title, pass, latencyMs }, ...]  (N entries per task)
export function buildScorecard(runs, { n }) {
  const byTask = new Map();
  for (const r of runs) {
    if (!byTask.has(r.taskId)) {
      byTask.set(r.taskId, { taskId: r.taskId, title: r.title, results: [] });
    }
    byTask.get(r.taskId).results.push(r);
  }

  const tasks = [...byTask.values()].map((t) => {
    const passes = t.results.filter((r) => r.pass).length;
    const lat = t.results.map((r) => r.latencyMs).sort((a, b) => a - b);
    return {
      taskId: t.taskId,
      title: t.title,
      runs: t.results.length,
      passes,
      passRate: round2(passes / t.results.length),
      p50Ms: round2(percentile(lat, 50)),
      p95Ms: round2(percentile(lat, 95)),
      tokenCost: null, // scripted agents: no LLM, honestly N/A
    };
  });

  const totalPasses = runs.filter((r) => r.pass).length;
  return {
    n,
    mode: 'scripted',
    overall: {
      tasks: tasks.length,
      totalRuns: runs.length,
      passRate: runs.length ? round2(totalPasses / runs.length) : null,
    },
    tasks,
  };
}

// Pad right to a fixed width (ASCII-only output; the Windows console is cp1252).
function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
const fmt = (n) => (n == null ? '-' : String(n));

export function formatScorecard(sc) {
  const lines = [];
  lines.push(`Scorecard  (N=${sc.n} runs/task, mode=${sc.mode})`);
  lines.push('='.repeat(72));
  lines.push(pad('TASK', 34) + pad('PASS', 10) + pad('p50 ms', 10) + pad('p95 ms', 10) + 'TOKENS');
  lines.push('-'.repeat(72));
  for (const t of sc.tasks) {
    lines.push(
      pad(t.taskId, 34) +
        pad(`${t.passes}/${t.runs}`, 10) +
        pad(fmt(t.p50Ms), 10) +
        pad(fmt(t.p95Ms), 10) +
        'N/A',
    );
  }
  lines.push('-'.repeat(72));
  const pct = Math.round((sc.overall.passRate ?? 0) * 100);
  lines.push(
    `OVERALL pass rate: ${pct}%  (${sc.overall.totalRuns} runs across ${sc.overall.tasks} tasks)`,
  );
  return lines.join('\n');
}
