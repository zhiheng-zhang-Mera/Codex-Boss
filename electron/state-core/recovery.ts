import fs from "node:fs";
import { checkIntegrity, type DatabaseHandle, type IntegrityReport } from "./database";
import { appliedMigrations, readSchemaState, type MigrationRecord, type SchemaState } from "./schema-version";
import { listCheckpoints } from "./migration-runner";
import type { EventJournal } from "./event-journal";
import type { StateQuarantine } from "./state-quarantine";
import type { EventConsumer } from "./event-consumer";

/**
 * Recovery and integrity (platform foundation, Phase 02 Task E).
 *
 * Every start runs this and records what it found. The book's requirement is that "any
 * recovery leaves evidence" — so this produces a report rather than a log line, and the
 * report is what the acceptance suite asserts against.
 *
 * ## What recovery actually is here, and what it deliberately is not
 *
 * There is no repair pass, and that is a design decision rather than an omission. The
 * failures the book lists are each already handled by a mechanism that cannot corrupt
 * data, so the honest job of this module is to OBSERVE and REPORT them:
 *
 * | Failure | Handled by | What this module reports |
 * | --- | --- | --- |
 * | crash before a transaction | SQLite rolls the open transaction back | `rolledBack: true` (no `-wal` frame to replay into state) |
 * | crash after commit, before the handler | the commit is durable in WAL | the consumer's cursor is behind the journal head |
 * | crash mid-handler | the cursor did not advance | `pendingDelivery` for that consumer |
 * | the same event replayed twice | `(producer, idempotencyKey)` is unique; the consumer records handled ids | `replayedEvents` |
 * | database corrupt / unopenable | the open fails loudly | `integrity.ok === false` with the reason |
 * | migration interrupted | the step's transaction rolled back | `resumedAt` from the migration record |
 *
 * The one thing it will NOT do is "repair" a namespace by emptying it. A namespace with
 * no rows is reported as empty, and a namespace with unreadable rows is reported as
 * quarantined — never the same thing.
 */

type RecoveryObservation =
  | "database-opened-clean"
  | "database-created"
  | "integrity-ok"
  | "integrity-failed"
  | "schema-current"
  | "schema-behind"
  | "schema-ahead"
  | "migration-interrupted"
  | "journal-has-undelivered-events"
  | "consumer-stalled"
  | "rows-quarantined"
  | "checkpoint-available"
  | "no-checkpoint-available";

interface ConsumerStatus {
  consumer: string;
  lastSequence: number;
  deliveries: number;
  failures: number;
  /** Events committed after this consumer's cursor. */
  pending: number;
  /** True when a previous delivery attempt failed and the cursor did not advance. */
  stalled: boolean;
}

export interface RecoveryReport {
  at: string;
  file: string;
  integrity: IntegrityReport;
  schema: SchemaState;
  migrations: MigrationRecord[];
  journal: { events: number; head: number; quarantined: number };
  consumers: ConsumerStatus[];
  quarantinedRows: number;
  checkpoints: Array<{ file: string; bytes: number; modifiedAt: string }>;
  observations: RecoveryObservation[];
  /**
   * True when the core may be used. An integrity failure or a schema-ahead database make
   * this false; a pending delivery or a quarantined row does not, because those are
   * recoverable states the core is designed to run in.
   */
  usable: boolean;
  detail: string;
}

interface RecoveryInput {
  handle: DatabaseHandle;
  journal: EventJournal;
  quarantine: StateQuarantine;
  consumers: ReadonlyArray<EventConsumer>;
  root: string;
  checkpointDir?: string;
  /**
   * The highest domain schema version THIS BUILD understands.
   *
   * Without it, "ahead" is undetectable: the expectation would be derived from the file's own
   * contents, so it could never exceed the file's own version. That was a real hole — the boot
   * module's guard against a newer build could not fire, and a test proved it by setting
   * `user_version = 99` and watching the module still report READY. A caller that knows what
   * it implements has to say so.
   */
  supportedVersion?: number;
}

export function inspectRecovery(input: RecoveryInput, at = new Date().toISOString()): RecoveryReport {
  const observations: RecoveryObservation[] = [];
  const integrity = checkIntegrity(input.handle);
  const migrations = appliedMigrations(input.handle);
  /**
   * What "current" means for THIS file, given what this build implements.
   *
   * `user_version` is the DOMAIN migration version. The core's own tables are created
   * idempotently at open time and are not versioned here, so a fresh store legitimately sits
   * at 0 and is healthy.
   *
   * The expectation deliberately does NOT include the file's own version. Including it made
   * `ahead` self-cancelling — the maximum always equalled the file's version, so the relation
   * could only ever be `current` or `behind`, and the boot module's guard against a database
   * from a NEWER build could not fire. Measured: `user_version = 99` reported `relation:
   * current`. The expectation is what this build can legitimately be at: the migrations it has
   * recorded, and the version it implements.
   */
  const recordedMax = migrations.reduce((highest, record) => Math.max(highest, record.version), 0);
  const expected = Math.max(recordedMax, input.supportedVersion ?? 0);
  const schema = readSchemaState(input.handle, expected);
  const stats = input.journal.stats();
  const quarantinedRows = input.quarantine.entries().length;
  const checkpoints = listCheckpoints(input.root, input.checkpointDir);

  if (integrity.ok) observations.push("integrity-ok"); else observations.push("integrity-failed");
  if (schema.relation === "current") observations.push("schema-current");
  else if (schema.relation === "behind") observations.push("schema-behind");
  else observations.push("schema-ahead");

  // A migration that was interrupted leaves the file at the previous version with the
  // step unrecorded; a partially recorded plan is the evidence that a resume will happen.
  const interrupted = migrations.some((record) => record.version > schema.current);
  if (interrupted) observations.push("migration-interrupted");

  const consumers: ConsumerStatus[] = input.consumers.map((consumer) => {
    const cursor = consumer.cursor();
    const pending = Math.max(0, stats.maxSequence - cursor.lastSequence);
    if (pending > 0) observations.push("journal-has-undelivered-events");
    if (cursor.failures > 0) observations.push("consumer-stalled");
    return {
      consumer: cursor.consumer,
      lastSequence: cursor.lastSequence,
      deliveries: cursor.deliveries,
      failures: cursor.failures,
      pending,
      stalled: cursor.failures > 0
    };
  });

  if (stats.quarantined + quarantinedRows > 0) observations.push("rows-quarantined");
  observations.push(checkpoints.length > 0 ? "checkpoint-available" : "no-checkpoint-available");
  observations.push(input.handle.info().existed ? "database-opened-clean" : "database-created");

  const usable = integrity.ok && schema.relation !== "ahead";
  const unique = [...new Set(observations)].sort();
  return {
    at,
    file: input.handle.file,
    integrity,
    schema,
    migrations,
    journal: { events: stats.events, head: stats.maxSequence, quarantined: stats.quarantined },
    consumers,
    quarantinedRows,
    checkpoints,
    observations: unique,
    usable,
    detail: usable
      ? `state core usable: v${schema.current}, ${stats.events} event(s), ${consumers.length} consumer(s), ${checkpoints.length} checkpoint(s)`
      : `state core NOT usable: integrity=${integrity.detail} schema=${schema.relation}`
  };
}

/**
 * Whether a database file can be opened at all.
 *
 * Separate from `inspectRecovery` because it must work when opening FAILED, which is the
 * corruption case: the caller has no handle to inspect, only a path and an error.
 */
function diagnoseUnopenable(file: string, error: unknown): { file: string; exists: boolean; bytes: number; reason: string; advice: string } {
  const exists = fs.existsSync(file);
  const bytes = exists ? fs.statSync(file).size : 0;
  const reason = error instanceof Error ? error.message : String(error);
  // The advice differs by cause, because "restore a checkpoint" is wrong advice for a
  // locked file and "wait and retry" is wrong advice for a truncated one.
  const advice = /not a database|malformed|file is encrypted/i.test(reason)
    ? "the file is not a SQLite database; restore a verified checkpoint rather than deleting it"
    : /locked|busy/i.test(reason)
      ? "another process holds the database; retry after it exits"
      : /unable to open/i.test(reason)
        ? "the path is not writable or is a directory"
        : "inspect the file before removing it; the state core never deletes data to recover";
  return { file, exists, bytes, reason, advice };
}
