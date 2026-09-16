import type { DatabaseHandle } from "./database";
import { CURRENT_SCHEMA_VERSION } from "./database";
import { withTransaction } from "./transaction";

/**
 * Schema version (platform foundation, Phase 02 Task A).
 *
 * The version lives in SQLite's own `user_version`, not in a table, because it must be
 * readable before any table is assumed to exist — that is what lets an unknown or
 * future database be refused before it is touched.
 *
 * Migrations are FORWARD ONLY and each one is a total function of applying it once. There
 * is no `down`, deliberately: a roll-back migration that has to reconstruct deleted data
 * is the thing the book forbids ("不允许为了 migration 成功删除历史状态"), so the safety
 * mechanism is the checkpoint taken before the run, not a reverse script.
 */

export type MigrationStep = {
  version: number;
  name: string;
  /** Apply the change. Runs inside a transaction with the version bump. */
  up: (handle: DatabaseHandle) => void;
};

export interface SchemaState {
  /** What the file reports. */
  current: number;
  /** What this build implements. */
  expected: number;
  /** `current < expected` needs migration; `==` is ready; `>` is a newer file. */
  relation: "behind" | "current" | "ahead";
}

export interface MigrationRecord {
  version: number;
  name: string;
  appliedAt: string;
  checkpoint?: string;
}

export function readSchemaState(handle: DatabaseHandle, expected: number = CURRENT_SCHEMA_VERSION): SchemaState {
  const row = handle.raw.prepare("PRAGMA user_version").get();
  const current = Number(row?.user_version ?? 0);
  return {
    current,
    expected,
    relation: current < expected ? "behind" : current === expected ? "current" : "ahead"
  };
}

export function appliedMigrations(handle: DatabaseHandle): MigrationRecord[] {
  const tableExists = handle.raw
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'state_migration' LIMIT 1")
    .get();
  if (!tableExists) return [];
  const rows = handle.raw.prepare("SELECT version, name, applied_at, checkpoint FROM state_migration ORDER BY version ASC").all();
  return rows.map((row) => ({
    version: Number(row.version),
    name: String(row.name),
    appliedAt: String(row.applied_at),
    ...(row.checkpoint === null || row.checkpoint === undefined ? {} : { checkpoint: String(row.checkpoint) })
  }));
}

/** Record a successful step. Called inside the step's own transaction. */
function recordMigration(handle: DatabaseHandle, step: MigrationStep, checkpoint: string | undefined, at: string): void {
  handle.raw
    .prepare("INSERT INTO state_migration(version, name, applied_at, checkpoint) VALUES (?, ?, ?, ?)")
    .run(step.version, step.name, at, checkpoint ?? null);
  // `user_version` takes no bound parameter, hence the interpolation; the value is a
  // validated integer from this build's own step list, never caller text.
  const version = Math.trunc(step.version);
  if (!Number.isInteger(version) || version <= 0) throw new Error(`migration version must be a positive integer, got ${step.version}`);
  handle.raw.exec(`PRAGMA user_version = ${version}`);
}

/**
 * A database that is NEWER than this build understands.
 *
 * Refusing is the only safe answer. Opening it read-write would let an older build write
 * rows a newer schema constrains differently, which is the "unknown state" the book
 * forbids. The book's rule for a failed migration is "rather refuse to start the related
 * capability than continue with an empty database" — this error is that refusal, and it
 * is deliberately distinct from a corruption error so the two are diagnosable apart.
 */
export class SchemaAheadError extends Error {
  constructor(readonly found: number, readonly supported: number) {
    super(`state database schema v${found} is newer than this build supports (v${supported}); refusing to open it read-write. Install the newer build or restore a checkpoint.`);
    this.name = "SchemaAheadError";
  }
}

/** A migration list that is malformed. Caught before anything is applied. */
export class MigrationPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationPlanError";
  }
}

/**
 * Validate a migration list.
 *
 * Checked before a single step runs: duplicate versions, a gap, or a step that is not
 * exactly `previous + 1` all make "which version is this file at" ambiguous, and an
 * ambiguous version is worse than a failed migration.
 */
export function validateMigrationPlan(steps: readonly MigrationStep[], from: number, to: number): void {
  const ordered = [...steps].sort((left, right) => left.version - right.version);
  let expected = from + 1;
  for (const step of ordered) {
    if (step.version <= from) continue;
    if (step.version > to) continue;
    if (!Number.isInteger(step.version) || step.version <= 0) throw new MigrationPlanError(`migration version must be a positive integer, got ${step.version}`);
    if (typeof step.name !== "string" || step.name.trim() === "") throw new MigrationPlanError(`migration v${step.version} has no name`);
    if (step.version !== expected) throw new MigrationPlanError(`migration plan is not contiguous: expected v${expected} next, found v${step.version}`);
    expected++;
  }
  if (expected !== to + 1) throw new MigrationPlanError(`migration plan does not reach v${to}: the last applicable step leaves the schema at v${expected - 1}`);
}

/**
 * Apply one step and bump the version, atomically.
 *
 * The step's own DDL and the record that says it ran share a transaction, so the two
 * cannot disagree: either both happened or neither did. That is why there is no
 * "already recorded?" branch here — a record without a bump is not a state a correct
 * run can produce, and treating it as "done" would skip the DDL entirely (measured: it
 * left the column the step was supposed to add missing). An interrupted run leaves NO
 * record, so re-running simply applies the step again from the previous version.
 */
export function applyMigrationStep(handle: DatabaseHandle, step: MigrationStep, checkpoint: string | undefined): MigrationRecord {
  const at = new Date().toISOString();
  return withTransaction(handle, () => {
    step.up(handle);
    recordMigration(handle, step, checkpoint, at);
    return { version: step.version, name: step.name, appliedAt: at, ...(checkpoint ? { checkpoint } : {}) };
  }, { label: `migrate v${step.version} ${step.name}` });
}
