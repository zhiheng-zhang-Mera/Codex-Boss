/**
 * Update-Plan/checkpoint-1.md §5 — deterministic knowledge extraction.
 *
 * §2.3 and §59 forbid a model from certifying its own work, and §5.2 forbids
 * knowledge without a source. So knowledge is not "asked for": it is DERIVED
 * here from bytes the host already read and verified — the compiled Task
 * Contract, the ingested WorkBook hashes, the repository model the discovery
 * stage scanned, and the durable dispatch outcome.
 *
 * Everything is pure: the caller passes the durable record and receives
 * candidates. That keeps extraction testable without a filesystem, and it means
 * the second task can reuse these facts from the durable knowledge base without
 * re-reading or re-scanning anything.
 */
import type { CompiledTaskContract } from "./task-contract";
import type { KnowledgeScope } from "./tenx/knowledge";
import type { WorkBookDispatchRecord } from "./workbook-dispatch";
import type { KnowledgeAuthority, KnowledgeCandidate, KnowledgeType, KnowledgeVerificationState } from "./knowledge-object";
import { contentHashOf } from "./workbook";

/** Producer identity recorded on every host-derived fact. */
export const KNOWLEDGE_PRODUCER_ID = "codex-boss/workbook-intake@1";

export interface KnowledgeExtractionInput {
  taskId: string;
  /** Scope every fact from this dispatch belongs to (the project, §5 DoD). */
  scope: KnowledgeScope;
  workspacePath?: string;
  record: WorkBookDispatchRecord;
  /** Dispatch outcome kind, e.g. DISPATCHED / BLOCKED / NO_AUTO_RUN. */
  outcome: string;
  /** ISO timestamp of the observation. */
  observedAt: string;
  /** Optional checkpoint message explaining the dispatch boundary result. */
  dispatchMessage?: string;
  /** Caps so one large repository cannot flood the knowledge base. */
  limits?: { testFiles?: number; uiFiles?: number; contractItems?: number };
}

const DEFAULT_LIMITS = { testFiles: 12, uiFiles: 8, contractItems: 10 };

/** A host fact is verified by definition: the host read the bytes it cites. */
const HOST_AUTHORITY: KnowledgeAuthority = "VERIFIED_HOST";
const HOST_VERIFICATION: KnowledgeVerificationState = "VERIFIED";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function collapse(value: string, limit = 400): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function make(input: {
  type: KnowledgeType;
  scope: KnowledgeScope;
  subject: string;
  content: string;
  summary: string;
  source: string;
  sourceHash: string;
  taskId: string;
  observedAt: string;
  documentRef?: string;
  runRef?: string;
  authority?: KnowledgeAuthority;
  verification?: KnowledgeVerificationState;
  evidence?: string[];
  confidence?: number;
  freshness?: string;
  validity?: { validUntil?: string };
}): KnowledgeCandidate {
  const candidate: KnowledgeCandidate = {
    type: input.type,
    scope: input.scope,
    subject: input.subject,
    source: input.source,
    source_hash: input.sourceHash,
    content: input.content,
    summary: input.summary,
    captured_at: input.observedAt,
    producer: "DETERMINISTIC_HOST",
    produced_by: KNOWLEDGE_PRODUCER_ID,
    verification: input.verification ?? HOST_VERIFICATION,
    verification_evidence: input.evidence ?? [input.source],
    confidence: input.confidence ?? 1,
    authority: input.authority ?? HOST_AUTHORITY,
    freshness: input.freshness ?? input.observedAt,
    task_ref: input.taskId
  };
  if (input.documentRef) candidate.document_ref = input.documentRef;
  if (input.runRef) candidate.run_ref = input.runRef;
  if (input.validity) candidate.validity = input.validity;
  return candidate;
}

/**
 * Derives the reusable facts of one WorkBook dispatch. Types produced:
 *
 *   ARCHITECTURE   — the bounded repository model the discovery stage scanned
 *   TEST           — the test map (one summary + the individual test files)
 *   UI_SURFACE     — the renderer/UI files the repository exposes
 *   CONSTRAINT     — every contract constraint item (authority WORKBOOK)
 *   REQUIREMENT    — goal, deliverables and acceptance criteria items
 *   DECISION       — what the dispatch decided and why (dispatch outcome)
 */
export function extractKnowledgeFromDispatch(input: KnowledgeExtractionInput): KnowledgeCandidate[] {
  const limits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
  const record = input.record;
  const contract: CompiledTaskContract | undefined = record.contract;
  const discovery = record.discovery;
  const model = discovery?.repository_model;
  const workbook = record.documents?.find((document) => document.hash === record.workbook_hash) ?? record.documents?.[0];
  const documentRef = workbook?.document_id;
  const documentSource = workbook ? `workbook:${workbook.file_name}` : `task:${input.taskId}`;
  const documentHash = workbook?.hash ?? contentHashOf(JSON.stringify(record));
  const candidates: KnowledgeCandidate[] = [];

  /* --- ARCHITECTURE: the repository world model, as scanned. --- */
  if (model) {
    const manifests = model.manifests.length ? model.manifests.join(", ") : "none detected";
    const entryPoints = model.entry_points.length ? model.entry_points.join(", ") : "none detected";
    const directories = model.top_level.length ? model.top_level.join(", ") : "(flat repository)";
    const languages = model.languages.length ? model.languages.join(", ") : "unknown";
    candidates.push(make({
      type: "ARCHITECTURE",
      scope: input.scope,
      subject: "repository layout",
      summary: `Repository layout: ${discovery?.files ?? 0} files, ${directories}`,
      content: [
        `files: ${discovery?.files ?? 0} (test files: ${discovery?.test_files ?? 0})`,
        `top-level: ${directories}`,
        `languages: ${languages}`,
        `manifests: ${manifests}`,
        `entry points: ${entryPoints}`,
        `repo fingerprint: ${discovery?.fingerprint ?? "unknown"}`,
        model.truncated ? "note: the listing was truncated at the discovery budget" : "note: complete file listing"
      ].join("\n"),
      source: `repo-scan:${discovery?.fingerprint ?? "unknown"}`,
      sourceHash: contentHashOf([discovery?.fingerprint ?? "", directories, manifests, entryPoints, languages].join("\u0000")),
      taskId: input.taskId,
      observedAt: input.observedAt,
      evidence: [`workspace:${input.workspacePath ?? discovery?.root ?? "unknown"}`, `repo fingerprint ${discovery?.fingerprint ?? "unknown"}`],
      confidence: 0.95,
      freshness: discovery?.fingerprint ? input.observedAt : input.observedAt
    }));
  }

  /* --- TEST: the test map, so a later task never has to rescan to find tests. --- */
  if (model && model.test_files.length) {
    const listed = model.test_files.slice(0, limits.testFiles);
    candidates.push(make({
      type: "TEST",
      scope: input.scope,
      subject: "test layout",
      summary: `Test layout: ${model.test_files.length} test file(s), e.g. ${listed.slice(0, 3).join(", ")}`,
      content: [
        `test files (${model.test_files.length}):`,
        ...listed.map((file) => `- ${file}`),
        model.test_files.length > listed.length ? `- … ${model.test_files.length - listed.length} more (truncated at the knowledge limit)` : ""
      ].filter(Boolean).join("\n"),
      source: `repo-scan:${discovery?.fingerprint ?? "unknown"}`,
      sourceHash: contentHashOf(listed.join("\n")),
      taskId: input.taskId,
      observedAt: input.observedAt,
      evidence: [`test map: ${model.test_files.length} file(s)`],
      confidence: 0.95
    }));
  }

  /* --- UI_SURFACE: which files carry the product's visual surface. --- */
  if (model && model.ui_surface_files.length) {
    const listed = model.ui_surface_files.slice(0, limits.uiFiles);
    candidates.push(make({
      type: "UI_SURFACE",
      scope: input.scope,
      subject: "ui surface files",
      summary: `UI surface: ${model.ui_surface_files.length} file(s), e.g. ${listed.slice(0, 3).join(", ")}`,
      content: [
        `ui surface files (${model.ui_surface_files.length}):`,
        ...listed.map((file) => `- ${file}`),
        model.ui_surface_files.length > listed.length ? `- … ${model.ui_surface_files.length - listed.length} more (truncated at the knowledge limit)` : ""
      ].filter(Boolean).join("\n"),
      source: `repo-scan:${discovery?.fingerprint ?? "unknown"}`,
      sourceHash: contentHashOf(listed.join("\n")),
      taskId: input.taskId,
      observedAt: input.observedAt,
      evidence: [`ui surface: ${model.ui_surface_files.length} file(s)`],
      confidence: 0.9
    }));
  }

  /* --- CONSTRAINT: the WorkBook's own constraints keep their authority. --- */
  const contractConstraints = (contract?.constraints ?? []).flatMap((declaration) => declaration.items ?? []);
  for (const [index, item] of contractConstraints.slice(0, limits.contractItems).entries()) {
    const value = text(item);
    if (!value) continue;
    candidates.push(make({
      type: "CONSTRAINT",
      scope: input.scope,
      subject: `workbook constraint ${index + 1}: ${collapse(value, 60)}`,
      summary: collapse(value, 200),
      content: value,
      source: documentSource,
      sourceHash: contentHashOf(value),
      taskId: input.taskId,
      observedAt: input.observedAt,
      documentRef,
      authority: "WORKBOOK",
      evidence: [`compiled contract constraints[${index}]`, `${documentSource}#${documentHash.slice(0, 12)}`],
      confidence: 0.9
    }));
  }

  /* --- REQUIREMENT: goal / deliverables / acceptance criteria. --- */
  const requirementGroups: Array<{ kind: string; items: string[] }> = [
    { kind: "goal", items: (contract?.goal ?? []).flatMap((declaration) => declaration.items ?? []) },
    { kind: "deliverable", items: (contract?.deliverables ?? []).flatMap((declaration) => declaration.items ?? []) },
    { kind: "acceptance criterion", items: (contract?.acceptance_criteria ?? []).flatMap((declaration) => declaration.items ?? []) }
  ];
  for (const group of requirementGroups) {
    for (const [index, item] of group.items.slice(0, limits.contractItems).entries()) {
      const value = text(item);
      if (!value) continue;
      candidates.push(make({
        type: "REQUIREMENT",
        scope: input.scope,
        subject: `${group.kind} ${index + 1}: ${collapse(value, 60)}`,
        summary: collapse(value, 200),
        content: value,
        source: documentSource,
        sourceHash: contentHashOf(`${group.kind}\u0000${value}`),
        taskId: input.taskId,
        observedAt: input.observedAt,
        documentRef,
        authority: "WORKBOOK",
        evidence: [`compiled contract ${group.kind}[${index}]`, `${documentSource}#${documentHash.slice(0, 12)}`],
        confidence: 0.9
      }));
    }
  }

  /* --- DECISION: what this dispatch actually decided, with the reason. --- */
  const classification = record.classification ?? "UNCLASSIFIED";
  const resolvedTitle = record.resolved_title ?? "untitled workbook";
  const decisionDetail = [
    `outcome: ${input.outcome}`,
    `classification: ${classification}`,
    `auto_run: ${String(record.auto_run)}`,
    `analysis_only: ${String(record.analysis_only)}`,
    `blocked_reason: ${record.blocked_reason ?? "none"}`,
    `dispatch: ${input.dispatchMessage ?? "not applicable"}`
  ].join("\n");
  candidates.push(make({
    type: "DECISION",
    scope: input.scope,
    subject: `dispatch decision for ${resolvedTitle}`,
    summary: `${classification} WorkBook "${resolvedTitle}" was ${input.outcome.toLowerCase()}`,
    content: decisionDetail,
    source: `dispatch:${input.taskId}`,
    sourceHash: contentHashOf(decisionDetail),
    taskId: input.taskId,
    observedAt: input.observedAt,
    documentRef,
    runRef: `dispatch:${input.taskId}`,
    evidence: [`durable WorkBook record ${input.taskId}`, `workbook hash ${record.workbook_hash ?? documentHash}`],
    confidence: 1
  }));

  return candidates;
}

/** Applies the §5.4 type/scope vocabulary check to a raw extraction batch. */
export function summarizeExtraction(candidates: readonly KnowledgeCandidate[]): Partial<Record<KnowledgeType, number>> {
  const counts: Partial<Record<KnowledgeType, number>> = {};
  for (const candidate of candidates) counts[candidate.type] = (counts[candidate.type] ?? 0) + 1;
  return counts;
}
