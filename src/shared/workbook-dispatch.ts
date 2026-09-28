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
  // The heading is part of what the conflict is about — the caller reports which
  // sections collided by name — and the written record has always carried it; the type
  // simply omitted it, so a reader (and the acceptance test) could not name it.
  sections: { document_id: string; file_name: string; section_id: string; heading?: string; hash: string }[];
  similarity?: number;
}

/**
 * Bounded repository world model captured by the discovery stage.
 *
 * checkpoint-1 §5 requires the facts an earlier task established to be reusable
 * WITHOUT rescanning the repository. The scan already happened for discovery, so
 * the model that matters is recorded here once and read back from the durable
 * WorkBook record afterwards (see src/shared/knowledge-extraction.ts).
 */
/**
 * The two discovery summaries the WorkBook dispatch record CARRIES, declared here rather than imported.
 *
 * CC-125 cut (`docs/city/POST_CC103_DEPENDENCY_CUT_PLAN.md`): these two fields were the ONLY edges this file had
 * onto the `workspace` and `theme` capabilities — two inline type positions naming the world-model and
 * UI-surface summary types — and each was the cheaper direction of a mutual capability pair. **Nothing in this file
 * reads either value**: the record carries what the host produced, and the host's own typed value is still checked
 * against the shape below at the assignment. (The two paths are deliberately NOT written here: the repository's
 * edge instrument scans import statements textually, so a path spelled in a comment is counted as an edge, which
 * the first attempt at this cut discovered by measurement.)
 *
 * The shapes are the full summaries rather than the handful of fields any current consumer touches, because the
 * contract of a CARRIED record is to say what it may contain. Two fields that cannot be restated as literals are
 * widened deliberately and named:
 *
 * ```text
 * version      `typeof` a version CONSTANT in the owner. A value cannot be redeclared as a type, and copying the
 *              literal would be a second source of truth for a schema version, so it is `string` here.
 * workspace    `RepoWorkspaceBoundary["kind"]`, which IS a two-literal union ("SINGLE" | "MONOREPO"), so it is
 *              restated exactly.
 * unbound      `UISurfaceId[]`, whose vocabulary is the twenty-three ids in `ui-surface-ids.ts`. It is `string[]`
 *              here for the same reason as `version`: the vocabulary is a VALUE, and one definition of it already
 *              exists. The producer's typed value is what enforces membership.
 * ```
 *
 * `tests/unit/workbook-dispatch-summaries.test.ts` pins both shapes IN BOTH DIRECTIONS at COMPILE time against the
 * owner's interfaces except for those three named widenings, so a field added or changed on either side stops the
 * build instead of silently dropping out of the record.
 */
export interface WorkBookWorldModelSummary {
  /** `typeof REPO_WORLD_MODEL_VERSION` in the owner; a version VALUE, widened for the reason above. */
  version: string;
  id: string;
  fingerprint: string;
  built_at: string;
  package_managers: string[];
  build_system: string[];
  runtimes: string[];
  ci_files: string[];
  languages: string[];
  entry_points: string[];
  modules: number;
  tests: number;
  /** `RepoWorkspaceBoundary["kind"]`, restated exactly. */
  workspace: "SINGLE" | "MONOREPO";
  git: { is_repository: boolean; head?: string; branch?: string; dirty_files?: number };
  generated_surfaces: string[];
}

export interface WorkBookUISurfaceSummary {
  /** `typeof UI_SURFACE_REGISTRY_VERSION` in the owner; widened for the same reason as `version` above. */
  version: string;
  generated_at: string;
  surfaces: number;
  bound: number;
  /** `UISurfaceId[]` in the owner; the id vocabulary is a VALUE, widened for the same reason. */
  unbound: string[];
  tokens_declared: number;
  tokens_total: number;
  tokens_applied: boolean;
  style_files: string[];
  component_files: string[];
}

export interface RepositoryModelSummary {
  schemaVersion: 1;
  /** First path segment of every file, sorted and capped. */
  top_level: string[];
  /** Dependency/build manifests seen at any depth. */
  manifests: string[];
  /** Files that look like process/program entry points. */
  entry_points: string[];
  test_files: string[];
  /** Renderer/UI/customisation surface files. */
  ui_surface_files: string[];
  /** Observed languages, most files first. */
  languages: string[];
  /** True when any list above hit its cap, so the model is deliberately partial. */
  truncated: boolean;
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
  repository_model?: RepositoryModelSummary;
  /**
   * checkpoint-1 §6: the repository world model established BEFORE execution.
   * The full model is persisted by the host; the record carries this summary.
   */
  world_model?: WorkBookWorldModelSummary;
  /** checkpoint-1 §9: the discovered UI surface registry, summarized. */
  ui_surfaces?: WorkBookUISurfaceSummary;
  /** Non-empty when the world model or UI discovery degraded. */
  world_model_error?: string;
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
  /**
   * checkpoint-1 §28: the compiled contract expressed as a requirement graph
   * (types, dependency edges, states and the evidence each requirement needs).
   */
  requirements?: import("./requirements-graph").RequirementsGraph;
  /**
   * checkpoint-1 §29: the execution DAG derived from the requirement graph —
   * every node's objective, scope, allowed files, outputs, verification,
   * dependencies and rollback.
   */
  execution_plan?: import("./execution-planner").ExecutionPlan;
  discovery?: DiscoverySummary;
  /** Trustworthy refusal/failure text; never a stack trace. */
  blocked_reason?: string;
}

export type WorkBookRefusal = "EMPTY_INPUT" | "NO_PROVIDER_DISPATCH" | "GUARDIAN_DENIED";

/** Classification kinds allowed to start provider work without human approval. */
export const AUTO_RUN_CLASSIFICATIONS: readonly WorkBookVerdict["kind"][] = ["EXECUTABLE_WORKBOOK"];
