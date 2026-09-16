import type { DatabaseHandle } from "./database";

/**
 * Transaction runner (platform foundation, Phase 02 Task A).
 *
 * The one place a multi-statement change is made atomic. Everything the book asks for
 * about cross-store consistency reduces to this: "the task moved to COMPLETED and the
 * decision was recorded and the event was published" either all commit or none do.
 *
 * ## Why `BEGIN IMMEDIATE` and not `BEGIN`
 *
 * Deferred (the SQLite default) takes the write lock on the first write, so two
 * transactions can both start, both read, and then one fails at its first write with
 * `SQLITE_BUSY` after having already made decisions from a stale read. `IMMEDIATE`
 * takes the write lock at the start, which turns a mid-transaction surprise into a
 * clean serialization at the boundary. For a desktop app with one writer this costs
 * nothing and removes a class of retry bug.
 *
 * ## Nesting
 *
 * SQLite has no nested transactions, only savepoints. Rather than pretend otherwise,
 * a nested `withTransaction` becomes a savepoint: the inner unit can roll back on its
 * own without discarding the outer one, which is what a caller actually means when it
 * nests. The outer transaction still governs durability.
 *
 * ## Retry
 *
 * `SQLITE_BUSY` and `SQLITE_LOCKED` are retried a bounded number of times with a short
 * backoff, because a checkpoint or a reader can hold the lock briefly. A retry is only
 * safe because the body is rolled back before it is re-run — a body that already had a
 * side effect outside the database is the caller's responsibility, which is exactly
 * why the state core keeps external side effects in event handlers (Task E) rather
 * than inside a transaction body.
 */

interface TransactionOptions {
  /** Attempts before `SQLITE_BUSY`/`SQLITE_LOCKED` gives up. Default 5. */
  attempts?: number;
  /** Base backoff in milliseconds; grows linearly per attempt. Default 10. */
  backoffMs?: number;
  /** Label used in the error when every attempt fails. */
  label?: string;
}

export interface TransactionContext {
  /** Nesting depth: 1 for the outermost transaction, 2+ inside a savepoint. */
  readonly depth: number;
  /** Release a savepoint early; a no-op at depth 1. */
  readonly savepointName: string | undefined;
}

export class TransactionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TransactionError";
  }
}

/** SQLite result codes that mean "try again", not "this is broken". */
const RETRYABLE = ["SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_BUSY_SNAPSHOT"];

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code ?? "";
  if (RETRYABLE.includes(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|database table is locked/i.test(message);
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  // Synchronous by necessity: the state core is called from synchronous store methods
  // (`DecisionLedgerStore.append` is not async), so an async backoff is not available.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `body` inside a transaction, committing on return and rolling back on throw.
 *
 * Returns whatever `body` returns. The transaction is committed BEFORE the value is
 * returned, so a caller that receives a result can rely on it being durable — that is
 * the property the crash-recovery acceptance depends on.
 */
export function withTransaction<T>(handle: DatabaseHandle, body: (context: TransactionContext) => T, options: TransactionOptions = {}): T {
  if (handle.closed()) throw new TransactionError("the database handle is closed");
  const attempts = Math.max(1, options.attempts ?? 5);
  const backoffMs = options.backoffMs ?? 10;
  const label = options.label ? ` (${options.label})` : "";
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const depth = depthOf(handle);
    const savepointName = depth === 0 ? undefined : `boss_sp_${depth}_${attempt}`;
    let entered = false;
    try {
      handle.raw.exec(savepointName ? `SAVEPOINT ${savepointName}` : "BEGIN IMMEDIATE");
      entered = true;
      setDepth(handle, depth + 1);
      let value: T;
      try {
        value = body({ depth: depth + 1, savepointName });
      } catch (error) {
        // Roll back before rethrowing, so a caller's catch never observes a
        // half-applied change.
        try {
          handle.raw.exec(savepointName ? `ROLLBACK TO ${savepointName}` : "ROLLBACK");
          if (savepointName) handle.raw.exec(`RELEASE ${savepointName}`);
        } catch { /* the rollback itself failing must not mask the body's error */ }
        throw error;
      }
      handle.raw.exec(savepointName ? `RELEASE ${savepointName}` : "COMMIT");
      return value;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) break;
      sleepSync(backoffMs * attempt);
    } finally {
      // Restored on every path, including the retry path, so a retry starts from the
      // depth the caller actually had rather than from a leaked increment.
      if (entered) setDepth(handle, depth);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new TransactionError(`transaction failed after ${attempts} attempt(s)${label}: ${message}`, lastError);
}

/**
 * Transaction depth per handle.
 *
 * SQLite does not expose its own transaction state through `node:sqlite` — the C-level
 * `sqlite3_get_autocommit` has no binding, and the `pragma_transaction_state` virtual
 * table that would report it is not compiled in (measured: "no such table"). So the
 * depth is tracked here.
 *
 * That is sound only because `withTransaction` is the ONLY place in the state core that
 * issues `BEGIN`/`COMMIT`/`SAVEPOINT`/`RELEASE`, and it restores the counter in a
 * `finally` on every path. Nothing else is permitted to open a transaction, which the
 * acceptance suite checks by driving nesting, rollback and retry and asserting the
 * depth returns to zero.
 *
 * A WeakMap keyed by the handle, rather than a module-level number, so two handles
 * cannot share a counter and so a closed handle's entry is collectable.
 */
const transactionDepth = new WeakMap<object, number>();

function depthOf(handle: DatabaseHandle): number {
  return transactionDepth.get(handle as unknown as object) ?? 0;
}

function setDepth(handle: DatabaseHandle, depth: number): void {
  transactionDepth.set(handle as unknown as object, depth);
}

/** True when a transaction is currently open on this handle. */
export function inTransaction(handle: DatabaseHandle): boolean {
  return depthOf(handle) > 0;
}

/** The current nesting depth: 0 outside any transaction. For diagnostics and tests. */
export function transactionDepthOf(handle: DatabaseHandle): number {
  return depthOf(handle);
}
