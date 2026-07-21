// test-helpers/complete-task-writer.mjs
//
// Spawned by test/verification.test.js to call completeTask from a SEPARATE OS
// process. In-process concurrency would share one lock holder and prove nothing
// about the cross-process guarantee.
//
// Usage: node complete-task-writer.mjs <dataDir> <task_id>
// Prints the resulting record as JSON on stdout.

const [dataDir, taskId] = process.argv.slice(2);
process.env.COORDINATOR_STATE_DIR = dataDir;

const { completeTask } = await import('../src/store.js');

const record = await completeTask({
  task_id: taskId,
  criteria: [{ state_key: 'never_written', exists: true }], // always fails
});

process.stdout.write(JSON.stringify(record));
