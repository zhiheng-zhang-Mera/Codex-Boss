/**
 * External web-session archive tracking (plan §14/§51). Pure and shareable.
 *
 * Boss long state must not depend on a web provider's history, but when Boss
 * drives visible web conversations it keeps a durable ledger of which external
 * conversation belongs to which task, and what its archive state is. Archive
 * success is never assumed from clicking a menu — it is a recorded page-state
 * outcome, and a failed external archive stays ARCHIVE_PENDING so it can be
 * retried safely (never auto-deleted).
 */

export type ExternalArchiveStatus = "ACTIVE" | "ARCHIVE_PENDING" | "ARCHIVED" | "ARCHIVE_FAILED";

export const EXTERNAL_ARCHIVE_STATUSES: readonly ExternalArchiveStatus[] = ["ACTIVE", "ARCHIVE_PENDING", "ARCHIVED", "ARCHIVE_FAILED"];

export interface ExternalSessionRecord {
  schemaVersion: 1;
  taskId: string;
  providerId: string;
  /** Profile name when a provider supports multiple automation profiles. */
  profile?: string;
  accountId?: string;
  /** The external conversation URL / session identifier Boss drives. */
  remoteConversationId?: string;
  remoteConversationUrl?: string;
  status: ExternalArchiveStatus;
  created_at: string;
  completed_at?: string;
  archived_at?: string;
  /** Human/verification note (e.g. "page confirmed archived"). */
  archiveNote?: string;
}

export function isExternalArchiveStatus(value: unknown): value is ExternalArchiveStatus {
  return typeof value === "string" && (EXTERNAL_ARCHIVE_STATUSES as readonly string[]).includes(value);
}

/** Fail-closed validator for ledger rows. */
export function validateExternalSessionRecord(value: unknown): value is ExternalSessionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ExternalSessionRecord>;
  if (record.schemaVersion !== 1) return false;
  if (typeof record.taskId !== "string" || !record.taskId.trim()) return false;
  if (typeof record.providerId !== "string" || !record.providerId.trim()) return false;
  if (record.profile !== undefined && typeof record.profile !== "string") return false;
  if (record.remoteConversationId !== undefined && typeof record.remoteConversationId !== "string") return false;
  if (record.remoteConversationUrl !== undefined && typeof record.remoteConversationUrl !== "string") return false;
  if (!isExternalArchiveStatus(record.status)) return false;
  if (typeof record.created_at !== "string") return false;
  return true;
}

/** Deterministic transition map for external session archive state. */
export const EXTERNAL_ARCHIVE_TRANSITIONS: Record<ExternalArchiveStatus, readonly ExternalArchiveStatus[]> = {
  ACTIVE: ["ARCHIVE_PENDING", "ARCHIVED", "ARCHIVE_FAILED"],
  ARCHIVE_PENDING: ["ARCHIVED", "ARCHIVE_FAILED", "ACTIVE"],
  ARCHIVE_FAILED: ["ARCHIVE_PENDING", "ARCHIVED"],
  ARCHIVED: []
};

export function canTransitionExternalArchive(current: ExternalArchiveStatus, next: ExternalArchiveStatus): boolean {
  return current === next || EXTERNAL_ARCHIVE_TRANSITIONS[current].includes(next);
}

export function transitionExternalArchive(record: ExternalSessionRecord, next: ExternalArchiveStatus, now = new Date().toISOString()): ExternalSessionRecord {
  if (!canTransitionExternalArchive(record.status, next)) throw new Error(`Invalid external archive transition: ${record.status} -> ${next}`);
  const updated: ExternalSessionRecord = { ...record, status: next };
  if (next === "ARCHIVED") updated.archived_at = now;
  return updated;
}
