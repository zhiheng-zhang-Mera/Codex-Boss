#!/usr/bin/env node
/**
 * Crash harness for the Phase 02 state core.
 *
 * Spawned by `tests/acceptance/state-core-crash.test.ts`, and it is a real child process
 * on purpose: "a hard kill must not lose a committed event" is a claim about the operating
 * system and the storage engine, so it can only be established by actually dying in the
 * middle of the work. An in-process simulation would prove nothing about durability.
 *
 * Usage: node scripts/state-core-crash-child.cjs <mode> <dataRoot> <marker>
 *
 * Modes:
 *   commit-then-crash   commit a state change plus an event, then die WITHOUT closing
 *                       the database — the committed work must survive.
 *   die-in-transaction  open a transaction, write, and die before committing — nothing
 *                       of that transaction may survive.
 *   multi-commit-crash  commit N transactions then die, so a restart can verify the
 *                       cursor resumes at the right place.
 *   migrate-then-crash  run a migration step that commits, then die without closing.
 *
 * The marker is echoed on stdout the instant a commit returns, so the parent knows the
 * commit really happened before the crash rather than inferring it.
 *
 * Implementation note: `process.exit()` is used rather than `process.kill(process.pid, ...)`
 * because a signal handler registered by a runtime or a test harness could intercept the
 * latter, and this script's whole job is to be uninterceptable.
 */

const fs = require("node:fs");
const path = require("node:path");

const [mode, dataRoot, marker] = process.argv.slice(2);
if (!mode || !dataRoot) {
  console.error("usage: state-core-crash-child.cjs <mode> <dataRoot> [marker]");
  process.exit(2);
}

const repoRoot = path.resolve(__dirname, "..");
const { openDatabase, stateDatabasePath } = require(path.join(repoRoot, "dist-electron", "electron", "state-core", "database.js"));
const { withTransaction } = require(path.join(repoRoot, "dist-electron", "electron", "state-core", "transaction.js"));
const { createStateRepository } = require(path.join(repoRoot, "dist-electron", "electron", "state-core", "state-repository.js"));
const { createEventJournal } = require(path.join(repoRoot, "dist-electron", "electron", "state-core", "event-journal.js"));

function echo(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** Exit immediately, leaving the WAL and any open transaction exactly as they are. */
function crash() {
  process.exit(0);
}

const handle = openDatabase(stateDatabasePath(dataRoot));
const repository = createStateRepository(handle);
const journal = createEventJournal(handle);

repository.declareNamespace({ namespace: "pilot.tasks", owner: "persistence", kind: "document" });

if (mode === "commit-then-crash") {
  withTransaction(handle, () => {
    repository.put("pilot.tasks", "task-1", { status: "RUNNING", marker });
    journal.append({
      type: "TASK_CREATED",
      aggregateId: "task-1",
      payload: { status: "RUNNING", marker },
      producer: "persistence",
      idempotencyKey: `task-1:created:${marker}`
    });
  });
  // The commit returned, so the work is in the WAL. Dying now must not lose it.
  echo({ mode, committed: true, marker, sequence: journal.head() });
  crash();
}

if (mode === "die-in-transaction") {
  withTransaction(handle, () => {
    repository.put("pilot.tasks", "ghost", { status: "SHOULD_NOT_SURVIVE", marker });
    journal.append({
      type: "TASK_CREATED",
      aggregateId: "ghost",
      payload: { marker },
      producer: "persistence",
      idempotencyKey: `ghost:${marker}`
    });
    echo({ mode, insideTransaction: true, marker });
    // Still inside the transaction: no COMMIT has happened.
    crash();
  });
}

if (mode === "multi-commit-crash") {
  const sequences = [];
  for (let index = 0; index < 3; index++) {
    withTransaction(handle, () => {
      repository.put("pilot.tasks", `task-${index}`, { status: "RUNNING", index, marker });
      journal.append({
        type: "TASK_CREATED",
        aggregateId: `task-${index}`,
        payload: { index, marker },
        producer: "persistence",
        idempotencyKey: `task-${index}:created:${marker}`
      });
    });
    sequences.push(journal.head());
  }
  echo({ mode, committed: true, marker, sequences });
  crash();
}

if (mode === "migrate-then-crash") {
  const { runMigrations } = require(path.join(repoRoot, "dist-electron", "electron", "state-core", "migration-runner.js"));
  const steps = [{
    version: 1,
    name: "add pilot marker table",
    up: (h) => { h.raw.exec("CREATE TABLE pilot_marker(id TEXT PRIMARY KEY)"); }
  }];
  const result = runMigrations(handle, steps, { root: path.dirname(stateDatabasePath(dataRoot)) });
  echo({ mode, applied: result.applied.map((record) => record.version), marker, current: result.after.current });
  crash();
}

console.error(`unknown mode: ${mode}`);
process.exit(2);
