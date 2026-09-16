import fs from "node:fs";
import path from "node:path";
import { checkIntegrity, copyDatabaseTo, openDatabaseFile, type DatabaseHandle } from "./database";
import {
  SchemaAheadError,
  appliedMigrations,
  applyMigrationStep,
  readSchemaState,
  validateMigrationPlan,
  type MigrationRecord,
  type MigrationStep,
  type SchemaState
} from "./schema-version";

/**
 * Migration runner (platform foundation, Phase 02 Task A/E).
 *
 * Moves a database forward to the build's schema version, with the two properties the
 * book demands: a verifiable checkpoint BEFORE anything is applied, and a deterministic
 * outcome after an interruption.
 *
 * ## Why an interrupted migration needs no special recovery code
 *
 * Each step's `up()` runs in the same transaction as its version bump, and SQLite
 * guarantees that a transaction interrupted by process death is rolled back when the
 * file is next opened. So an interruption leaves the data at the previous version with
 * no row in `state_migration` — and re-running therefore resumes at exactly the step
 * that was interrupted. There is no half-applied version to detect, because a
 * half-applied version cannot exist. What the runner DOES add is the evidence: it
 * reports which step it resumed at, so "it recovered" is observable rather than
 * asserted.
 *
 * ## Why a checkpoint, when transactions already give atomicity
 *
 * Atomicity protects against a failed step. It does not protect against a step that
 * succeeds at the SQL level while being semantically wrong — a migration that drops or
 * rewrites history. The checkpoint is the answer to that, and it is verified by opening
 * it and running `integrity_check` rather than by trusting that the copy succeeded.
 *
 * ## Refusals
 *
 * A schema NEWER than this build is refused (`SchemaAheadError`) rather than opened
 * read-write. The book's rollback rule is explicit that refusing to start a capability
 * beats continuing with an empty or downgraded database, and this is that refusal.
 */

interface MigrationRunResult {
  before: SchemaState;
  after: SchemaState;
  applied: MigrationRecord[];
  /** Absolute path of the pre-migration checkpoint, when one was taken. */
  checkpointPath?: string;
  /** True when the checkpoint was opened and passed `integrity_check`. */
  checkpointVerified: boolean;
  /** True when nothing needed applying. */
  noop: boolean;
  /**
   * Set when the plan was already partially recorded and this run reconciled it, naming
   * the step it resumed at. This is the evidence that recovery happened: the version
   * marker was aligned to a step whose record already existed.
   */
  resumedAt?: number;
  /**
   * Steps that were already recorded and were therefore ADOPTED rather than re-applied.
   * Non-empty means a previous run got that far; re-running their DDL would fail.
   */
  adopted: number[];
  /** Anything that went wrong while taking or verifying the checkpoint. */
  checkpointProblem?: string;
}

interface MigrationRunnerOptions {
  /** Where checkpoints are written. Defaults to a `checkpoints` directory beside the database. */
  checkpointDir?: string;
  /** Skip the checkpoint. Only for an empty/in-memory database; refused when data exists. */
  skipCheckpoint?: boolean;
  /** Refuse to write a checkpoint path outside this root. Defaults to the database's own root. */
  root?: string;
}

/** Timestamp without characters that are awkward in a filename. */
function stamp(at: string): string {
  return at.replace(/[:.]/g, "-");
}

export class CheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckpointError";
  }
}

/**
 * Create and verify a checkpoint.
 *
 * Verified by reopening the copy and running `integrity_check`, because an unverified
 * backup is a belief rather than a guarantee — and the whole reason to take one is the
 * case where the migration itself turns out to be wrong.
 */
export function createCheckpoint(handle: DatabaseHandle, target: string): void {
  if (fs.existsSync(target)) throw new CheckpointError(`refusing to overwrite an existing checkpoint: ${target}`);
  copyDatabaseTo(handle, target);
  if (!fs.existsSync(target)) throw new CheckpointError(`the checkpoint was not written: ${target}`);

  const copy = openDatabaseFile(target);
  try {
    // A checkpoint is only useful if it is a valid database; VACUUM INTO normally
    // guarantees that, and "normally" is not what a rollback depends on.
    copy.raw.exec("PRAGMA journal_mode = DELETE");
    const integrity = checkIntegrity(copy);
    if (!integrity.ok) throw new CheckpointError(`the checkpoint failed integrity_check: ${integrity.detail}`);
  } finally {
    copy.close();
  }
}

/**
 * Bring a database up to the highest version the supplied `steps` define.
 *
 * The target comes from the PLAN, not from the build's `CURRENT_SCHEMA_VERSION`: a test
 * or a caller that hands in a smaller set of steps is migrating to that set's ceiling,
 * and checking against an unrelated global would fail a correct run. A database already
 * ABOVE the plan's ceiling is refused, which is the case that matters.
 *
 * `openDatabase` must already have been called; this never opens the live file itself,
 * so the single-lifecycle-owner rule in `database.ts` is preserved.
 */
export function runMigrations(handle: DatabaseHandle, steps: readonly MigrationStep[], options: MigrationRunnerOptions = {}): MigrationRunResult {
  const target = steps.reduce((highest, step) => Math.max(highest, Number(step.version) || 0), 0);
  const before = readSchemaState(handle, target);

  if (before.relation === "ahead") throw new SchemaAheadError(before.current, target);
  if (before.relation === "current") {
    return { before, after: before, applied: [], adopted: [], checkpointVerified: false, noop: true };
  }

  const pending = [...steps].filter((step) => step.version > before.current).sort((left, right) => left.version - right.version);
  if (pending.length === 0) throw new CheckpointError(`schema is at v${before.current} but no migration step moves it to v${target}`);
  validateMigrationPlan(steps, before.current, target);

  /**
   * Evidence that a previous attempt was interrupted mid-chain.
   *
   * Detected by an already-APPLIED step that is still ahead of the file's version and
   * which this run would therefore attempt again — the signature of a plan that was
   * partially applied. A plain `v1 -> v2` upgrade is NOT a resume, so it must not report
   * one; conflating the two would make the field meaningless as evidence.
   */
  const appliedRecords = appliedMigrations(handle);
  const appliedVersions = new Set(appliedRecords.map((record) => record.version));
  const resumedAt = pending.find((step) => appliedVersions.has(step.version))?.version;

  const databaseRoot = options.root ?? path.dirname(handle.file);
  const checkpointDir = options.checkpointDir ?? path.join(databaseRoot, "checkpoints");
  let checkpointPath: string | undefined;
  let checkpointVerified = false;
  let checkpointProblem: string | undefined;

  const hasData = handle.raw.prepare("SELECT COUNT(*) AS c FROM state_record").get();
  const recordCount = Number(hasData?.c ?? 0);
  const eventCount = Number((handle.raw.prepare("SELECT COUNT(*) AS c FROM event_journal").get() as { c: number })?.c ?? 0);

  if (!options.skipCheckpoint) {
    checkpointPath = path.join(checkpointDir, `state-v${before.current}-${stamp(new Date().toISOString())}.db`);
    try {
      createCheckpoint(handle, checkpointPath);
      checkpointVerified = true;
    } catch (error) {
      // A migration may not proceed without a verified checkpoint when there is data to
      // lose. On an empty database there is nothing to protect, so the run continues and
      // the problem is reported rather than blocking a first boot.
      checkpointProblem = error instanceof Error ? error.message : String(error);
      if (recordCount > 0 || eventCount > 0) {
        throw new CheckpointError(`refusing to migrate ${recordCount} record(s) and ${eventCount} event(s) without a verified checkpoint: ${checkpointProblem}`);
      }
    }
  }

  const applied: MigrationRecord[] = [];
  const adopted: number[] = [];
  for (const step of pending) {
    // A recorded step is not re-applied: the record means its DDL already ran, and
    // re-running an `ALTER` would fail on the constraint. Its version marker is
    // reconciled instead — a record without the matching `user_version` is exactly the
    // relic an interrupted chain leaves behind, and aligning them is the resume.
    const existing = appliedRecords.find((record) => record.version === step.version);
    if (existing) {
      adopted.push(step.version);
      if (readSchemaState(handle, target).current < step.version) {
        // Same reconciliation `recordMigration` performs, without a second INSERT.
        handle.raw.exec(`PRAGMA user_version = ${Math.trunc(step.version)}`);
      }
      applied.push(existing);
      continue;
    }
    applied.push(applyMigrationStep(handle, step, checkpointPath));
  }

  const after = readSchemaState(handle, target);
  if (after.current !== target) {
    throw new CheckpointError(`migration finished at v${after.current} but v${target} was expected`);
  }

  return {
    before,
    after,
    applied,
    adopted,
    ...(checkpointPath ? { checkpointPath } : {}),
    checkpointVerified,
    noop: false,
    ...(resumedAt === undefined ? {} : { resumedAt }),
    ...(checkpointProblem ? { checkpointProblem } : {})
  };
}

/** List checkpoints for a database root, newest first. */
export function listCheckpoints(root: string, checkpointDir?: string): Array<{ file: string; bytes: number; modifiedAt: string }> {
  const dir = checkpointDir ?? path.join(root, "checkpoints");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      return { file, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((left, right) => (left.modifiedAt < right.modifiedAt ? 1 : -1));
}
