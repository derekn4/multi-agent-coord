// Appends `count` messages to the shared log from a SEPARATE process.
// Several of these run at once to stress the cross-process lock in store.js.
// argv: [procId, count]
import { appendMessage } from '../src/store.js';

const procId = process.argv[2];
const count = Number(process.argv[3]);

for (let i = 0; i < count; i++) {
  await appendMessage({ from: `proc-${procId}`, to: 'B', body: `p${procId}-m${i}` });
}
