// tasks/index.js
//
// The eval task set — one file per task, collected here into the single list the
// runner iterates. Roughly ordered from narrowest to broadest: messaging, then
// state, then concurrency and observability, ending with the end-to-end flow.

import msgRoundTrip from './msg-round-trip.js';
import msgBroadcast from './msg-broadcast.js';
import directedIsolation from './directed-isolation.js';
import sinceCursor from './since-cursor.js';
import stateRoundTrip from './state-round-trip.js';
import stateOverwrite from './state-overwrite.js';
import crossProcessPersistence from './cross-process-persistence.js';
import concurrentWriters from './concurrent-writers.js';
import traceLinkage from './trace-linkage.js';
import planExecuteReport from './plan-execute-report.js';

export const tasks = [
  msgRoundTrip,
  msgBroadcast,
  directedIsolation,
  sinceCursor,
  stateRoundTrip,
  stateOverwrite,
  crossProcessPersistence,
  concurrentWriters,
  traceLinkage,
  planExecuteReport,
];
