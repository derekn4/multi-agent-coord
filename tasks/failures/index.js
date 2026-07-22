// tasks/failures/index.js
//
// Phase 4's INFRASTRUCTURE failure taxonomy -- kept separate from
// tasks/verification/ (agent-behavior failures, Phase 3) and tasks/ (the Phase 2
// baseline), so no set dilutes another's scorecard.

import killedSession from './killed-session.js';
import corruptedStateFile from './corrupted-state-file.js';
import timeout from './timeout.js';
import malformedMessage from './malformed-message.js';
import staleStateRead from './stale-state-read.js';

export const failureInjectors = [
  killedSession,
  corruptedStateFile,
  timeout,
  malformedMessage,
  staleStateRead,
];

export const FAILURE_CLASSES = failureInjectors.map((f) => f.id);
