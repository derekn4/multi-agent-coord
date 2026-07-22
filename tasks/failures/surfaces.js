// tasks/failures/surfaces.js
//
// Two DISJOINT vocabularies. Surface A runs build the index; surface B runs are
// held out. A held-out query therefore shares a class's SHAPE with the index
// but none of its literals -- which is the leak the held-out number exists to
// catch. If accuracy on B tracks leave-one-out on A, the featurizer is keying
// on shape; if it collapses, it memorized identifiers.

export const SURFACES = {
  A: {
    agents: ['agentA', 'agentB', 'agentC'],
    keys: ['build_status', 'deploy_flag', 'lint_phase'],
    taskIds: ['build-42', 'deploy-7', 'lint-13'],
  },
  B: {
    agents: ['workerX', 'workerY', 'workerZ'],
    keys: ['ingest_phase', 'render_slot', 'shard_cursor'],
    taskIds: ['ingest-91', 'render-3', 'shard-58'],
  },
};

// Deterministic per-run rotation through a surface's vocabulary, so no two runs
// of a class share literals but the run set stays reproducible.
export function pick(surface, kind, i) {
  const list = SURFACES[surface][kind];
  return list[i % list.length];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
