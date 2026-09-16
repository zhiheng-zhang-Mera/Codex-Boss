import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Database lifecycle (platform foundation, Phase 02 Task A).
 *
 * The single owner of the SQLite handle. One process, one `DatabaseSync`, WAL on —
 * the engineering book requires "单一 DB lifecycle owner", and the reason is concrete:
 * `node:sqlite` gives no cross-instance coordination, so two handles over one file
 * would be two writers racing on the same pages.
 *
 * ## Why SQLite is not a service locator here
 *
 * The book forbids the database becoming one, and the shape of this file is the
 * answer: it exposes SCHEMA and a transaction runner, and it exposes no way to reach
 * a domain decision. It does not know what a task is, cannot be asked for one, and is
 * imported only by `state-repository.ts` and `event-journal.ts`. Business logic keeps
 * receiving its stores as constructor arguments from the composition root, exactly as
 * before; those stores may now be SQLite-backed, which is a storage detail.
 *
 * ## Why `node:sqlite`
 *
 * It is a built-in, so there is no native module to compile and nothing to bundle for
 * the Windows portable build — the packaging constraint the book names. The features
 * this core depends on (WAL, foreign keys, `user_version`, manual transactions,
 * savepoints, durability across reopen, and a loud failure on a corrupt file) are
 * measured, not assumed, by `scripts/probe-sqlite.cjs` under both Node and Electron.
 *
 * The base for `createRequire` below is the package manifest rather than `import.meta.url`,
 * because this file compiles to CommonJS for the Electron build and `import.meta` is not
 * available there. A path that always exists is sufficient: the specifier is a builtin, so
 * nothing is resolved relative to it. It is called inline rather than bound to a module
 * level name, because TypeScript reserves `require` in a CommonJS module's top-level scope.
 */

/**
 * `createRequire` rather than a static `import` on purpose.
 *
 * `node:sqlite` is still labelled experimental, and a static import of it would make
 * merely *loading* any module that transitively reaches this file emit a warning —
 * including in the test tier and in module-resolution-only tooling. Loading it lazily
 * inside `openDatabase` keeps the warning next to the one call that actually uses it,
 * and keeps this file importable in an environment without SQLite.
 */
interface SqliteModule {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  function(name: string, options: { varargs?: boolean } | ((...args: any[]) => unknown), fn?: (...args: any[]) => unknown): void;
}

function loadSqlite(): SqliteModule {
  try {
    return createRequire(path.join(process.cwd(), "package.json"))("node:sqlite") as SqliteModule;
  } catch (error) {
    throw new Error(
      `This runtime has no 'node:sqlite'. The durable state core requires Node 22+ / Electron with the node:sqlite built-in; run 'node scripts/probe-sqlite.cjs' to see which feature is missing. Underlying error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * The schema, as ordered statements.
 *
 * Two tables serve the whole core: `state_record` is the transactional state the
 * migrated domains read and write, and `event_journal` is the append-only log. They
 * live in ONE database precisely so that "change the state AND publish the event" is a
 * single transaction — the consistency the book is asking for. Splitting them across
 * files would reintroduce the exact problem Phase 02 exists to remove.
 *
 * `events.sequence` is an INTEGER PRIMARY KEY, which in SQLite is a rowid alias: it is
 * assigned by the engine at insert time, is strictly increasing within a transaction,
 * and needs no separate counter table. Ordering by it is therefore the commit order.
 */
const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS state_namespace (
     namespace   TEXT PRIMARY KEY,
     owner       TEXT NOT NULL,
     kind        TEXT NOT NULL CHECK (kind IN ('document','append-only')),
     updated_at  TEXT NOT NULL,
     revision    INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS state_record (
     namespace   TEXT NOT NULL,
     record_key  TEXT NOT NULL,
     position    INTEGER NOT NULL DEFAULT 0,
     payload     TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     PRIMARY KEY (namespace, record_key),
     FOREIGN KEY (namespace) REFERENCES state_namespace(namespace) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS state_record_by_namespace_position
     ON state_record(namespace, position, record_key)`,
  `CREATE TABLE IF NOT EXISTS event_journal (
     sequence        INTEGER PRIMARY KEY,
     id              TEXT NOT NULL UNIQUE,
     type            TEXT NOT NULL,
     aggregate_id    TEXT NOT NULL,
     payload         TEXT NOT NULL,
     created_at      TEXT NOT NULL,
     schema_version  INTEGER NOT NULL,
     idempotency_key TEXT NOT NULL,
     producer        TEXT NOT NULL
   )`,
  // The idempotency key is unique per producer, which is what makes a replayed append
  // a no-op at the storage layer rather than something a handler has to remember.
  `CREATE UNIQUE INDEX IF NOT EXISTS event_journal_idempotency
     ON event_journal(producer, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS event_journal_by_aggregate
     ON event_journal(aggregate_id, sequence)`,
  `CREATE TABLE IF NOT EXISTS event_consumer (
     consumer        TEXT PRIMARY KEY,
     last_sequence   INTEGER NOT NULL DEFAULT 0,
     updated_at      TEXT NOT NULL,
     deliveries      INTEGER NOT NULL DEFAULT 0,
     failures        INTEGER NOT NULL DEFAULT 0
   )`,
  // Which events a consumer has already completed. This is what makes "replayed"
  // answerable after a crash: the cursor alone cannot distinguish "never delivered"
  // from "delivered, effect applied, cursor not yet advanced".
  `CREATE TABLE IF NOT EXISTS event_handled (
     consumer    TEXT NOT NULL,
     event_id    TEXT NOT NULL,
     sequence    INTEGER NOT NULL,
     handled_at  TEXT NOT NULL,
     PRIMARY KEY (consumer, event_id)
   )`,
  // Malformed events are moved here rather than dropped or allowed to block the
  // journal. The original row is preserved verbatim so it can be inspected later.
  `CREATE TABLE IF NOT EXISTS event_quarantine (
     id            TEXT PRIMARY KEY,
     sequence      INTEGER,
     type          TEXT,
     raw           TEXT NOT NULL,
     reason        TEXT NOT NULL,
     quarantined_at TEXT NOT NULL
   )`,
  // The same rule for STATE rows: a record that cannot be decoded is moved aside, never
  // silently replaced with an empty value. The namespace and key are preserved so the
  // row can be found and, if it was a false alarm, restored by hand.
  `CREATE TABLE IF NOT EXISTS state_quarantine (
     id             TEXT PRIMARY KEY,
     namespace      TEXT NOT NULL,
     record_key     TEXT NOT NULL,
     position       INTEGER NOT NULL,
     payload        TEXT NOT NULL,
     reason         TEXT NOT NULL,
     quarantined_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS state_migration (
     version     INTEGER PRIMARY KEY,
     name        TEXT NOT NULL,
     applied_at  TEXT NOT NULL,
     checkpoint  TEXT
   )`
];

/**
 * The schema version of the state core's OWN tables.
 *
 * Everything in `SCHEMA_STATEMENTS` is idempotent DDL applied on every open, so this
 * version describes a shape that is always present rather than a migration to run. Domain
 * migrations are numbered from here upward and layer on top.
 */
const CORE_SCHEMA_VERSION = 1;

/** The schema version this build expects. Alias of the core version, kept for callers. */
export const CURRENT_SCHEMA_VERSION = CORE_SCHEMA_VERSION;

interface DatabaseInfo {
  file: string;
  schemaVersion: number;
  journalMode: string;
  foreignKeys: boolean;
  /** True when the database already existed and was reopened rather than created. */
  existed: boolean;
}

/**
 * A lifecycle-owned handle.
 *
 * `close()` is idempotent because the composition root disposes boot modules in reverse
 * order and a double close must not throw during shutdown — the same rule
 * `BootModule.dispose` already follows.
 */
export interface DatabaseHandle {
  readonly file: string;
  info(): DatabaseInfo;
  /** The raw handle, for `transaction.ts`, `state-repository.ts` and `event-journal.ts`. */
  readonly raw: SqliteDatabase;
  closed(): boolean;
  close(): void;
}

/**
 * Open (creating if needed) the durable state database.
 *
 * `PRAGMA journal_mode = WAL` is the durability choice the book asks for: a committed
 * transaction survives an abrupt process death because it is in the write-ahead log,
 * not in a page cache that still has to be flushed.
 */
export function openDatabase(file: string): DatabaseHandle {
  return openAt(file, true);
}

/**
 * Open a database that ALREADY exists, without creating or restructuring anything.
 *
 * Used for checkpoints and backups, which are written as bare `.db` files. Going through
 * `openDatabase` would run the data-root directory layout over them, which is wrong for a
 * file whose location the caller chose deliberately.
 */
export function openDatabaseFile(file: string): DatabaseHandle {
  if (!fs.existsSync(file)) throw new Error(`no database at ${file}`);
  return openAt(file, false);
}

function openAt(file: string, createLayout: boolean): DatabaseHandle {
  const existed = fs.existsSync(file);
  if (createLayout) fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = loadSqlite();
  const db = new sqlite.DatabaseSync(file);

  // Order matters: WAL before the first write, and foreign keys per connection
  // (SQLite defaults them OFF, which would silently make the schema's FK decorative).
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS _state_core_probe (id INTEGER PRIMARY KEY)");
  db.exec("DROP TABLE IF EXISTS _state_core_probe");
  // A corrupt or non-database file is detected by the writes above rather than on
  // first read, so `openDatabase` fails at the call site that chose the file.
  for (const statement of SCHEMA_STATEMENTS) db.exec(statement);

  // `user_version` is deliberately NOT stamped here. It is the DOMAIN migration version,
  // and the core's own tables above are guaranteed by idempotent DDL rather than by a
  // migration — so writing a core version into it would make the first domain migration
  // (numbered from 1) look already applied and be skipped, leaving its DDL unrun. A fresh
  // database legitimately reports `user_version = 0`, and `recovery.ts` reads that as
  // "no domain migration has run yet", which for an empty store is healthy.

  let closed = false;

  const info = (): DatabaseInfo => {
    // Read on every call rather than cached. The schema version is changed by migrations
    // that run against this same handle, so a cached value would report the version the
    // file had at open time and make a successful migration look like a no-op.
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    const mode = db.prepare("PRAGMA journal_mode").get()?.journal_mode;
    const fk = db.prepare("PRAGMA foreign_keys").get()?.foreign_keys;
    return {
      file,
      schemaVersion: Number(version ?? 0),
      journalMode: String(mode ?? "unknown"),
      foreignKeys: Number(fk ?? 0) === 1,
      existed
    };
  };

  return {
    file,
    info,
    raw: db,
    closed: () => closed,
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
    }
  };
}

/** A stable, path-safe database filename for a data root. */
export function stateDatabasePath(dataRoot: string): string {
  return path.join(dataRoot, ".boss", "state", "state.db");
}

export interface IntegrityReport {
  ok: boolean;
  /** The raw `PRAGMA integrity_check` result; "ok" when healthy. */
  detail: string;
  /** Messages from `PRAGMA foreign_key_check`, empty when consistent. */
  foreignKeyViolations: Array<Record<string, unknown>>;
}

/**
 * Check that a database file is internally consistent.
 *
 * Used for two things the book asks for explicitly: verifying a checkpoint is actually
 * usable before a migration is allowed to rely on it, and deciding whether a file that
 * failed to open is corrupt or merely locked. A check that cannot run reports `ok: false`
 * with the reason, never a silent pass.
 */
export function checkIntegrity(handle: DatabaseHandle): IntegrityReport {
  try {
    const row = handle.raw.prepare("PRAGMA integrity_check").get();
    const detail = String(row?.integrity_check ?? "unknown");
    let foreignKeyViolations: Array<Record<string, unknown>> = [];
    try {
      foreignKeyViolations = handle.raw.prepare("PRAGMA foreign_key_check").all();
    } catch { /* older files may not support it; the integrity result still stands */ }
    return { ok: detail.toLowerCase() === "ok" && foreignKeyViolations.length === 0, detail, foreignKeyViolations };
  } catch (error) {
    return { ok: false, detail: `integrity_check could not run: ${error instanceof Error ? error.message : String(error)}`, foreignKeyViolations: [] };
  }
}

/**
 * Copy the live database to `target` using SQLite's own online backup.
 *
 * `VACUUM INTO` (SQLite 3.51.2 here) produces a transactionally consistent, already
 * compacted copy of a database that is still open — which a filesystem copy of a WAL
 * database is NOT, because the newest committed pages may still be in the `-wal` file.
 * That distinction is why the checkpoint is taken at the SQLite level rather than with
 * `fs.copyFileSync`.
 */
export function copyDatabaseTo(handle: DatabaseHandle, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // VACUUM INTO takes a string literal, not a bound parameter, so the path is escaped
  // rather than interpolated raw. Nothing here reads caller-controlled text, but an
  // unescaped quote would be a SQL injection by construction.
  const escaped = target.replace(/\\/g, "/").replace(/'/g, "''");
  handle.raw.exec(`VACUUM INTO '${escaped}'`);
}

/** Human-readable one-liner for a boot health line. */
export function describeDatabase(info: DatabaseInfo): string {
  return `${info.file} schema=v${info.schemaVersion} journal=${info.journalMode} fk=${info.foreignKeys ? "on" : "off"}${info.existed ? "" : " (created)"}`;
}
