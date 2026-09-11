/**
 * WorkBook dispatch vocabulary (WORK_UNIT_2). Pure and shareable: the durable
 * record a Work task carries, plus the truthful stage ladder. The orchestrator
 * that produces it lives in electron/commander/workbook-dispatch.ts (it reads
 * attachments and the filesystem).
 */
import type { CompiledTaskContract } from "./task-contract";
import type { CanonicalTaskDocument, WorkBookVerdict } from "./workbook";

/**
 * Truly-ordered stages. INPUT_RECEIVED..READY are the intake ladder; the last
 * five mirror the existing BossTask statuses so the record and the task never
 * disagree.
 */
export type WorkBookStage =
  | "INPUT_RECEIVED"
  | "INGESTING"
  | "CLASSIFYING"
  | "COMPILING"
  | "DISCOVERING"
  | "PLANNING"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED";

export const WORKBOOK_INTAKE_STAGES: readonly WorkBookStage[] = [
  "INPUT_RECEIVED", "INGESTING", "CLASSIFYING", "COMPILING", "DISCOVERING", "PLANNING", "READY"
];

export interface WorkBookStageEntry {
  stage: WorkBookStage;
  at: string;
  detail: string;
}

export type WorkBookRole = "PRIMARY_SPEC" | "SUB_PLAN" | "REFERENCE" | "ACCEPTANCE_CRITERIA";

export interface WorkBookDocumentSummary {
  document_id: string;
  file_name: string;
  hash: string;
  status: CanonicalTaskDocument["status"];
  sections: number;
  classification?: WorkBookVerdict["kind"];
  confidence?: number;
  role?: WorkBookRole;
  relation: "NEW" | "DUPLICATE" | "AMENDED";
  supersedes_document_id?: string;
  diagnostics: string[];
}

export interface WorkBookConflictSummary {
  kind: string;
  severity: "INFO" | "WARN" | "ERROR";
  message: string;
  sections: { document_id: string; file_name: string; section_id: string; hash: string }[];
  similarity?: number;
}

export interface DiscoverySummary {
  repository: boolean;
  root?: string;
  files: number;
  test_files: number;
  fingerprint?: string;
  skipped_directories: number;
  /** Non-empty when discovery was requested but could not run. */
  reason?: string;
}

/** Durable per-task WorkBook execution record: hashes, verdicts, provenance. */
export interface WorkBookDispatchRecord {
  schemaVersion: 1;
  stage: WorkBookStage;
  stageHistory: WorkBookStageEntry[];
  /** Deterministic title resolved from the WorkBook when the caller had none. */
  resolved_title?: string;
  analysis_only: boolean;
  auto_run: boolean;
  has_workbook: boolean;
  /** Content hash of the primary readable document, for duplicate resume. */
  workbook_hash?: string;
  classification?: WorkBookVerdict["kind"];
  confidence?: number;
  classification_reasons: string[];
  documents: WorkBookDocumentSummary[];
  roles: Partial<Record<WorkBookRole, string>>;
  primary_document_id?: string;
  conflicts: WorkBookConflictSummary[];
  contract?: CompiledTaskContract;
  discovery?: DiscoverySummary;
  /** Trustworthy refusal/failure text; never a stack trace. */
  blocked_reason?: string;
}

export type WorkBookRefusal = "EMPTY_INPUT" | "NO_PROVIDER_DISPATCH" | "GUARDIAN_DENIED";

/** Classification kinds allowed to start provider work without human approval. */
export const AUTO_RUN_CLASSIFICATIONS: readonly WorkBookVerdict["kind"][] = ["EXECUTABLE_WORKBOOK"];
