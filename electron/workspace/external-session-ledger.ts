import { readJson, writeJson } from "../commander/durable-json";
import { transitionExternalArchive, validateExternalSessionRecord, type ExternalSessionRecord } from "../../src/shared/external-session";

/**
 * Durable ledger of external web-session records (plan §14/§51). For each task
 * + provider Boss records the remote conversation it drove and its archive
 * lifecycle. Archive is only ever marked ARCHIVED when the page state was
 * verified (caller supplies the note); a failed/uncertain external archive
 * stays ARCHIVE_PENDING and may be retried. Delete is never automatic.
 */
export class ExternalSessionLedger {
  private readonly records = new Map<string, ExternalSessionRecord>();

  constructor(private readonly file: string) {
    for (const record of readJson<ExternalSessionRecord[]>(this.file) ?? []) {
      if (validateExternalSessionRecord(record)) this.records.set(this.key(record.taskId, record.providerId), record);
      // corrupt rows fail closed (dropped from memory; file rewritten on next save)
    }
  }

  private key(taskId: string, providerId: string): string {
    return `${taskId}\u0000${providerId}`;
  }

  /** Creates or refreshes the record for (task, provider). */
  upsert(input: Omit<ExternalSessionRecord, "schemaVersion" | "created_at" | "status"> & { remoteConversationId?: string; remoteConversationUrl?: string }): ExternalSessionRecord {
    const record: ExternalSessionRecord = {
      schemaVersion: 1,
      taskId: input.taskId,
      providerId: input.providerId,
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      remoteConversationId: input.remoteConversationId,
      remoteConversationUrl: input.remoteConversationUrl,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      ...(input.archiveNote ? { archiveNote: input.archiveNote } : {})
    };
    this.records.set(this.key(record.taskId, record.providerId), record);
    this.persist();
    return structuredClone(record);
  }

  forTask(taskId: string): ExternalSessionRecord[] {
    return [...this.records.values()].filter((record) => record.taskId === taskId).map((record) => structuredClone(record));
  }

  pending(): ExternalSessionRecord[] {
    return [...this.records.values()].filter((record) => record.status === "ARCHIVE_PENDING").map((record) => structuredClone(record));
  }

  /** Marks an external conversation archived (caller verified page state). */
  markArchived(taskId: string, providerId: string, note: string, now = new Date().toISOString()): ExternalSessionRecord | undefined {
    const current = this.records.get(this.key(taskId, providerId));
    if (!current) return undefined;
    const updated = transitionExternalArchive({ ...current, archived_at: now }, "ARCHIVED", now);
    updated.archiveNote = note;
    this.records.set(this.key(taskId, providerId), updated);
    this.persist();
    return structuredClone(updated);
  }

  /** A task completed but the external archive could not be verified → retryable. */
  deferArchive(taskId: string, providerId: string, reason: string): ExternalSessionRecord | undefined {
    const current = this.records.get(this.key(taskId, providerId));
    if (!current) return undefined;
    const updated = transitionExternalArchive(current, "ARCHIVE_PENDING", new Date().toISOString());
    updated.archiveNote = reason;
    this.records.set(this.key(taskId, providerId), updated);
    this.persist();
    return structuredClone(updated);
  }

  list(): ExternalSessionRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  private persist(): void {
    writeJson(this.file, [...this.records.values()]);
  }
}
