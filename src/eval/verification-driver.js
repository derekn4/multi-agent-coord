// src/eval/verification-driver.js
//
// Runs one unreliable-agent task in one of two arms:
//
//   ungated - the agent acts (defectively) and claims done. Nothing checks it.
//   gated   - the agent acts, submits criteria to complete_task, reads the
//             failure reasons back, repairs, and retries within the bound.
//
// Both arms grade with the task's own check() against the FINAL store contents,
// so the arms are directly comparable. The gated arm additionally requires the
// coordinator to agree (status verified) -- see the note on silentFailure below.

import { call } from './harness.js';

const MAX_ATTEMPTS = 2;

// Read the world back the way a third party would: whole state bag plus, if the
// task names an inbox, that agent's messages.
async function observe(connect, task) {
  const s = await connect();
  try {
    const state = (await call(s.client, 'get_state', {})).value ?? {};
    const inbox = task.inboxFor
      ? await call(s.client, 'read_messages', { to: task.inboxFor })
      : [];
    return { state, inbox };
  } finally {
    await s.close();
  }
}

export async function runArm(task, arm, { connect, traceId }) {
  let verdict = null;

  if (arm === 'ungated') {
    const s = await connect();
    try {
      await task.act({ client: s.client, traceId, attempt: 1 });
    } finally {
      await s.close();
    }
  } else {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const s = await connect();
      try {
        await task.act({ client: s.client, traceId, attempt });
        verdict = await call(s.client, 'complete_task', {
          task_id: task.id,
          criteria: task.criteria,
          trace_id: traceId,
        });
      } finally {
        await s.close();
      }
      if (verdict.verified || verdict.escalate) break;
    }
  }

  const observed = await observe(connect, task);
  const workCorrect = Boolean(task.check(observed));
  const verified = verdict ? verdict.verified : null;

  // A "pass" in the gated arm needs BOTH the work to be right and the gate to
  // agree. check() alone would credit a run whose work happened to land while
  // the gate still reported it unverified -- precisely the disagreement this
  // phase exists to surface. A run where they disagree is a criteria bug.
  const pass = arm === 'gated' ? workCorrect && verified === true : workCorrect;

  // The headline metric: a completion accepted as done while the work is wrong.
  // Ungated there is no gate, so every wrong-but-claimed run is silent. Gated
  // this must be exactly 0 -- every unverified claim repairs or escalates.
  const silentFailure = arm === 'gated' ? !workCorrect && verified === true : !workCorrect;

  return {
    taskId: task.id,
    title: task.title,
    arm,
    pass,
    verified,
    attempts: verdict?.attempts ?? 1,
    escalated: Boolean(verdict?.escalate),
    silentFailure,
  };
}
