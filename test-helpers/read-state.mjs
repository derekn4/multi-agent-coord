// Reads one shared-state key from a SEPARATE process and prints it to stdout.
// Used by the "survives a restart" test to prove state lives on disk, not RAM.
import { getState } from '../src/store.js';

const key = process.argv[2];
const value = getState(key);
process.stdout.write(value === undefined ? '' : String(value));
