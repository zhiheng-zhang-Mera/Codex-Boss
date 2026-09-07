import type { ExternalSessionLedger } from "./external-session-ledger";
import type { ExternalSessionRecord } from "../../src/shared/external-session";

/**
 * Retryable external-archive automation (plan §14/§51). Pure seam on top of the
 * durable ledger.
 *
 * When a task completes, Boss defers the external archive to ARCHIVE_PENDING
 * because the provider page could not be verified at that moment. This pass
 * retries those pending records: for each one it asks an injected page-state
 * `attempt` (the live app verifies the provider conversation list and archives
 * the conversation there) and only marks the ledger ARCHIVED when the attempt
 * reports verified success. A failed or throwing attempt leaves the record
 * ARCHIVE_PENDING with an updated note — retryable, never fake-archived, and
 * never auto-deleted (§13). Ordering is deterministic (oldest first) and the
 * pass is bounded so a stuck provider cannot spin forever.
 */

export interface ExternalArchiveAttempt {
  /** True only when the caller verified the external conversation is archived. */
  archived: boolean;
  /** Human/verification note recorded on the ledger row. */
  note: string;
}

/** Injected page-state verifier/archiver (production wires the live app). */
export type ArchiveAttempt = (record: ExternalSessionRecord) => Promise<ExternalArchiveAttempt>;

export interface ExternalArchiveAutomationResult {
  attempted: number;
  archived: number;
  deferred: number;
  /** Pending records still awaiting a successful archive after this pass. */
  remainingPending: number;
  stillPending: ExternalSessionRecord[];
}

export const DEFAULT_ARCHIVE_AUTOMATION_LIMIT = 10;

export async function automatePendingExternalArchives(
  ledger: ExternalSessionLedger,
  attempt: ArchiveAttempt,
  options: { limit?: number } = {}
): Promise<ExternalArchiveAutomationResult> {
  const limit = Number.isFinite(options.limit) && options.limit! > 0 ? Math.floor(options.limit!) : DEFAULT_ARCHIVE_AUTOMATION_LIMIT;
  // Deterministic: oldest ARCHIVE_PENDING rows first.
  const pending = [...ledger.pending()].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, limit);
  let archived = 0;
  let deferred = 0;
  for (const record of pending) {
    let result: ExternalArchiveAttempt;
    try {
      result = await attempt(record);
    } catch (error) {
      // Fail-closed: an errored attempt never fabricates ARCHIVED.
      ledger.deferArchive(record.taskId, record.providerId, `archive automation attempt errored: ${String(error).slice(0, 200)}`);
      deferred++;
      continue;
    }
    if (result.archived === true) {
      ledger.markArchived(record.taskId, record.providerId, result.note || "verified archived by automation");
      archived++;
    } else {
      ledger.deferArchive(record.taskId, record.providerId, result.note || "provider page did not confirm archive; will retry");
      deferred++;
    }
  }
  const stillPending = ledger.pending();
  return { attempted: pending.length, archived, deferred, remainingPending: stillPending.length, stillPending };
}
