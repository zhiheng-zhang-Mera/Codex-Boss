/**
 * WorkBook relation registry (Work Unit 1). Durable, hash-based bookkeeping
 * that answers two questions before any work is planned:
 *
 *   1. Have I already ingested these bytes?      -> DUPLICATE (resume, skip)
 *   2. Is this a newer revision of a known doc?  -> AMENDED (supersedes)
 *
 * Identity is the SHA-256 of the raw bytes, so a renamed or re-exported file
 * is recognised as the same content. Revisions are grouped by a logical key
 * derived from the file name, so `spec.md` -> `spec-v2.md` amends rather than
 * starting fresh. Everything is persisted with the durable JSON writer used by
 * the task ledger (atomic replace, fsync, no partial state).
 */
import { readJson, writeJson } from "../commander/durable-json";
import type { CanonicalTaskDocument } from "../../src/shared/workbook";

export type RelationKind = "NEW" | "DUPLICATE" | "AMENDED";

export interface WorkbookRevision {
  document_id: string;
  hash: string;
  file_name: string;
  title: string;
  created_at: string;
  status: CanonicalTaskDocument["status"];
  /** 1-based revision number within the logical workbook. */
  revision: number;
  supersedes?: string;
  /**
   * BossTask this revision belongs to. Revisions are always traceable to the
   * task that produced them, so a document can be found from its task and back.
   */
  task_id?: string;
}

export interface WorkbookLedgerEntry {
  logical_key: string;
  file_name: string;
  revisions: WorkbookRevision[];
  /** document_id of the highest revision seen. */
  latest_document_id: string;
  updated_at: string;
}

export interface WorkbookLedgerFile {
  schemaVersion: 1;
  entries: WorkbookLedgerEntry[];
  /** hash -> document_id, so content identity survives name changes. */
  byHash: Record<string, string>;
}

/**
 * The minimal document facts a revision needs. Accepting this instead of the
 * full CanonicalTaskDocument is what lets recovery rebuild a revision from a
 * durable BossTask WorkBook record (REPAIR_BATCH_4).
 */
export interface WorkbookRevisionInput {
  id: string;
  hash: string;
  file_name: string;
  title: string;
  created_at: string;
  status: CanonicalTaskDocument["status"];
  logical_key: string;
}

export interface RelationDecision {
  document_id: string;
  file_name: string;
  hash: string;
  logical_key: string;
  relation: RelationKind;
  /** Existing document this revision supersedes. */
  supersedes_document_id?: string;
  /** Existing identical document (DUPLICATE only). */
  duplicate_of_document_id?: string;
  revision?: number;
  /** True when the caller can resume instead of re-doing ingestion work. */
  resume: boolean;
  reasons: string[];
}

export interface RelationPlan {
  decisions: RelationDecision[];
  /** document_ids that still need work (NEW and AMENDED). */
  to_process: string[];
  /** document_ids already known by content hash (resume candidates). */
  skipped: string[];
  warnings: string[];
}

/** Persisted store. Safe to construct over an existing file. */
export class WorkbookRegistry {
  constructor(private readonly file: string) {}

  private read(): WorkbookLedgerFile {
    const value = readJson<Partial<WorkbookLedgerFile>>(this.file);
    if (!value) return { schemaVersion: 1, entries: [], byHash: {} };
    if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error("Invalid workbook registry file");
    return { schemaVersion: 1, entries: value.entries, byHash: value.byHash ?? {} };
  }

  list(): WorkbookLedgerEntry[] {
    return this.read().entries;
  }

  entryFor(logicalKey: string): WorkbookLedgerEntry | undefined {
    return this.read().entries.find((entry) => entry.logical_key === logicalKey);
  }

  /** Document id previously recorded for this exact content hash, if any. */
  documentIdForHash(hash: string): string | undefined {
    return this.read().byHash[hash];
  }

  /** Records an ingested document as a revision of its logical workbook. */
  record(document: WorkbookRevisionInput, taskId?: string): WorkbookRevision {
    const file = this.read();
    const entry = file.entries.find((candidate) => candidate.logical_key === document.logical_key);
    const existingByHash = file.byHash[document.hash];
    if (existingByHash === document.id) {
      // Idempotent re-record of the same bytes; still backfill the task id.
      const revision = entry?.revisions.find((candidate) => candidate.document_id === document.id);
      if (revision && entry) {
        if (taskId && revision.task_id !== taskId) {
          revision.task_id = taskId;
          writeJson(this.file, file);
        }
        return revision;
      }
    }
    const supersedes = entry?.revisions[entry.revisions.length - 1]?.document_id;
    const revision: WorkbookRevision = {
      document_id: document.id,
      hash: document.hash,
      file_name: document.file_name,
      title: document.title,
      created_at: document.created_at,
      status: document.status,
      revision: (entry?.revisions.length ?? 0) + 1
    };
    if (supersedes && supersedes !== document.id) revision.supersedes = supersedes;
    if (taskId) revision.task_id = taskId;

    if (entry) {
      entry.revisions = [...entry.revisions.filter((candidate) => candidate.document_id !== document.id), revision];
      entry.latest_document_id = document.id;
      entry.file_name = document.file_name;
      entry.updated_at = document.created_at;
    } else {
      file.entries.push({
        logical_key: document.logical_key,
        file_name: document.file_name,
        revisions: [revision],
        latest_document_id: document.id,
        updated_at: document.created_at
      });
    }
    file.byHash[document.hash] = document.id;
    writeJson(this.file, file);
    return revision;
  }

  recordAll(documents: WorkbookRevisionInput[], taskId?: string): WorkbookRevision[] {
    return documents.map((document) => this.record(document, taskId));
  }

  /**
   * WORK_UNIT_2 (REPAIR_BATCH_3): links an already-recorded revision to the
   * task that actually owns it.
   *
   * Intake records revisions before the task exists (so duplicate/resume can
   * run first), which leaves `task_id` unset. This closes the loop after
   * creation and is idempotent: an unchanged link writes nothing, and a
   * missing revision (never ingested) reports false instead of inventing a
   * revision.
   */
  linkRevisionTask(hash: string, taskId: string): boolean {
    if (!hash?.trim() || !taskId?.trim()) return false;
    const file = this.read();
    for (const entry of file.entries) {
      for (const revision of entry.revisions) {
        if (revision.hash !== hash) continue;
        if (revision.task_id === taskId) return true;
        revision.task_id = taskId;
        writeJson(this.file, file);
        return true;
      }
    }
    return false;
  }

  /**
   * WORK_UNIT_3: recovers revisions left unlinked by a crash.
   *
   * Intake records a revision before the task exists and the link happens after
   * creation, so a crash in that window leaves `task_id` unset. Given the
   * authoritative hash -> task map (built from durable task records), this
   * re-links every orphaned revision. Idempotent: already-linked revisions are
   * untouched, and an unknown hash stays unlinked rather than being guessed.
   */
  recoverTaskLinks(hashToTaskId: Record<string, string>): { recovered: number; stillUnlinked: number } {
    const file = this.read();
    let recovered = 0;
    let stillUnlinked = 0;
    let dirty = false;
    for (const entry of file.entries) {
      for (const revision of entry.revisions) {
        if (revision.task_id) continue;
        const taskId = hashToTaskId[revision.hash];
        if (!taskId) { stillUnlinked += 1; continue; }
        revision.task_id = taskId;
        recovered += 1;
        dirty = true;
      }
    }
    if (dirty) writeJson(this.file, file);
    return { recovered, stillUnlinked };
  }

  /** Every revision still missing a task association (diagnostics/recovery). */
  unlinkedRevisions(): WorkbookRevision[] {
    return this.read().entries.flatMap((entry) => entry.revisions).filter((revision) => !revision.task_id);
  }

  /**
   * Classifies a batch without mutating the registry: DUPLICATE when the exact
   * bytes were ingested before, AMENDED when the logical workbook exists with
   * different content, NEW otherwise. Two documents in the same batch sharing
   * a logical key are reported as an intra-batch amendment chain.
   */
  plan(documents: CanonicalTaskDocument[]): RelationPlan {
    const ledger = this.read();
    const decisions: RelationDecision[] = [];
    const warnings: string[] = [];
    const batchByLogicalKey = new Map<string, RelationDecision>();
    const batchHashes = new Map<string, RelationDecision>();

    for (const document of documents) {
      const reasons: string[] = [];
      const knownDocumentId = ledger.byHash[document.hash];
      const batchDuplicate = batchHashes.get(document.hash);
      const entry = ledger.entries.find((candidate) => candidate.logical_key === document.logical_key);

      if (knownDocumentId || batchDuplicate) {
        const duplicateOf = knownDocumentId ?? batchDuplicate!.document_id;
        const decision: RelationDecision = {
          document_id: document.id,
          file_name: document.file_name,
          hash: document.hash,
          logical_key: document.logical_key,
          relation: "DUPLICATE",
          duplicate_of_document_id: duplicateOf,
          resume: true,
          reasons: [knownDocumentId
            ? `identical bytes already ingested as ${knownDocumentId}`
            : `duplicate of ${duplicateOf} inside the same batch`]
        };
        decisions.push(decision);
        batchHashes.set(document.hash, decision);
        continue;
      }

      const batchPrevious = batchByLogicalKey.get(document.logical_key);
      const previousRevision = entry?.revisions[entry.revisions.length - 1];
      if (batchPrevious || previousRevision) {
        const supersedesDocumentId = batchPrevious?.document_id ?? previousRevision?.document_id;
        const revision = batchPrevious
          ? (batchPrevious.revision ?? 1) + 1
          : (entry?.revisions.length ?? 0) + 1;
        reasons.push(batchPrevious
          ? `a later file in this batch carries the same logical workbook key (${document.logical_key})`
          : `logical workbook ${document.logical_key} already has ${entry?.revisions.length ?? 0} revision(s)`);
        if (previousRevision && previousRevision.hash === document.hash) reasons.push("content hash matches an earlier revision");
        const decision: RelationDecision = {
          document_id: document.id,
          file_name: document.file_name,
          hash: document.hash,
          logical_key: document.logical_key,
          relation: "AMENDED",
          revision,
          resume: false,
          reasons
        };
        if (supersedesDocumentId) decision.supersedes_document_id = supersedesDocumentId;
        decisions.push(decision);
        batchByLogicalKey.set(document.logical_key, decision);
        batchHashes.set(document.hash, decision);
        continue;
      }

      const decision: RelationDecision = {
        document_id: document.id,
        file_name: document.file_name,
        hash: document.hash,
        logical_key: document.logical_key,
        relation: "NEW",
        revision: 1,
        resume: false,
        reasons: [`no prior revision for logical workbook ${document.logical_key}`]
      };
      decisions.push(decision);
      batchByLogicalKey.set(document.logical_key, decision);
      batchHashes.set(document.hash, decision);
    }

    // An intra-batch revision chain means the caller may have ingested a stale
    // revision in the same batch; surface it rather than silently ordering it.
    const chained = decisions.filter((decision) => decision.relation === "AMENDED" && (decision.revision ?? 1) > 1
      && decisions.some((other) => other.logical_key === decision.logical_key && other !== decision));
    if (chained.length) {
      warnings.push(`${chained.length} document(s) amend another document in the same batch; only the highest revision is authoritative`);
    }

    return {
      decisions,
      to_process: decisions.filter((decision) => decision.resume === false).map((decision) => decision.document_id),
      skipped: decisions.filter((decision) => decision.resume).map((decision) => decision.document_id),
      warnings
    };
  }

  /** Removes one logical workbook (used when a task is purged). */
  remove(logicalKey: string): boolean {
    const file = this.read();
    const entry = file.entries.find((candidate) => candidate.logical_key === logicalKey);
    if (!entry) return false;
    for (const revision of entry.revisions) delete file.byHash[revision.hash];
    file.entries = file.entries.filter((candidate) => candidate.logical_key !== logicalKey);
    writeJson(this.file, file);
    return true;
  }
}
