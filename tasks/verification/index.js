// tasks/verification/index.js
//
// The Phase 3 task set: agents that claim completion they have not earned.
// Kept separate from tasks/index.js so the Phase 2 baseline stays a clean
// regression signal rather than being diluted by deliberately-failing tasks.
//
// Ordered defect-first, control last.

import forgetsStateWrite from './forgets-state-write.js';
import wrongValue from './wrong-value.js';
import reportsBeforeWriting from './reports-before-writing.js';
import persistentlyBroken from './persistently-broken.js';
import honestAgent from './honest-agent.js';

export const verificationTasks = [
  forgetsStateWrite,
  wrongValue,
  reportsBeforeWriting,
  persistentlyBroken,
  honestAgent,
];
