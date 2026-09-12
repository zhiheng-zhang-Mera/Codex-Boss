/**
 * WorkBook dispatch orchestration (WORK_UNIT_2).
 *
 * One bounded, testable place that turns bound conversation attachments into a
 * compiled Task Contract, decides whether Work may run, and records exactly how
 * far it got, so electron/main.ts only has to pass refs and publish.
 *
 * Ordering is fixed and truthful:
 *   INPUT_RECEIVED -> INGESTING -> CLASSIFYING -> COMPILING -> DISCOVERING
 *   -> PLANNING -> READY, then the existing task statuses (RUNNING/WAITING/
 *   COMPLETED/FAILED) plus BLOCKED for a guardian refusal.
 *
 * Nothing here calls a model or the network: classification, roles, conflicts,
 * the contract, guardian screening and repository discovery are deterministic.
 */
import fs from "node:fs";
import path from "node:path";
import { detectAnalysisOnly, type CanonicalTaskDocument, type WorkBookVerdict } from "../../src/shared/workbook";
import { compileTaskContract, type CompiledTaskContract, isolateRequirements } from "../../src/shared/task-contract";
import { buildRequirementsGraph } from "../../src/shared/requirements-graph";
import { changeAllowed } from "../../src/shared/guardian";
import {
  AUTO_RUN_CLASSIFICATIONS,
  type DiscoverySummary,
  type WorkBookDispatchRecord,
  type WorkBookDocumentSummary,
  type WorkBookRefusal,
  type WorkBookStage,
  type WorkBookStageEntry
} from "../../src/shared/workbook-dispatch";
import { scanRepo, repositoryModelFrom, type RepoSnapshot } from "../engineering/repo-inspector";
import { assignRoles } from "../ingestion/role-assignment";
import { WorkbookRegistry, type WorkbookRevisionInput } from "../ingestion/workbook-registry";
import { ingestDocuments, type DocumentSource, type IngestionLimits } from "../ingestion/ingest";
import type { InputObjectRef } from "../../src/shared/input-object";

export { AUTO_RUN_CLASSIFICATIONS };
export type { DiscoverySummary, WorkBookDispatchRecord, WorkBookRefusal, WorkBookStage, WorkBookStageEntry };

/** Classification kinds that may start provider work without human approval. */
export const AUTO_RUN_KINDS = AUTO_RUN_CLASSIFICATIONS;

export interface WorkBookDispatchDeps {
  /** Registry used to PLAN duplicate/resume/amend relations (never written here). */
  registry?: WorkbookRegistry;
  /** Injected for tests; defaults to the real ingestion pipeline. */
  ingest?: (sources: DocumentSource[], options: { limits?: Partial<IngestionLimits> }) => Promise<{ documents: CanonicalTaskDocument[] }>;
  /** Injected for tests; defaults to scanRepo. */
  discover?: (root: string) => RepoSnapshot;
  /**
   * checkpoint-1 §6: establishes the Repository World Model (and the §9 UI
   * surface registry) BEFORE any engineering execution. The host persists the
   * full model; the durable record only carries the summaries. Optional and
   * fail-soft: a model failure is recorded as a diagnostic, never as a task
   * failure (§2.5).
   */
  worldModel?: (root: string) => { summary: import("../../src/shared/repo-world-model").WorldModelSummary; surfaces?: import("../../src/shared/ui-surface").UISurfaceSummary } | undefined;
  limits?: Partial<IngestionLimits>;
  now?: () => Date;
}

export interface WorkBookDispatchRequest {
  /** User message; optional when attachments or a repository carry the request. */
  prompt?: string;
  title?: string;
  conversationId: string;
  /** Attachment refs resolved for this conversation only. */
  attachments?: InputObjectRef[];
  /** Input object ids the task bound (already conversation-scoped by the store). */
  inputObjectIds?: string[];
  workspacePath?: string;
  /** True only when the caller explicitly asked for provider work. */
  allowProviderDispatch?: boolean;
  guardianToken?: boolean;
  /**
   * Existing WorkBook tasks keyed by recorded content hash
   * (`BossTask.workbookDispatch.workbook_hash`). A bound attachment whose
   * sha256 matches reuses that task instead of creating a duplicate.
   */
  existingWorkbookTasks?: Record<string, string>;
}

export interface WorkBookDispatchResult {
  stage: WorkBookStage;
  /** Fresh record for the caller to persist; this module never persists. */
  record: WorkBookDispatchRecord;  /** Deterministic title: caller title, else WorkBook title, else file name. */
  title: string;
  /**
   * Concise executable objective derived from the compiled contract plus the
   * user override. Never the whole document; the caller passes it to the task.
   */
  objective: string;
  autoRun: boolean;
  analysisOnly: boolean;
  blocked: boolean;
  refusal?: WorkBookRefusal;
  /** True when an exact duplicate resumed an existing WorkBook task. */
  reused: boolean;
  reuse_task_id?: string;
  /**
   * Revisions the caller commits AFTER the task is durably persisted.
   * Intake itself never writes the registry (REPAIR_BATCH_4): that ordering is
   * what removes the unrecoverable orphan window.
   */
  revisionPlan: WorkbookRevisionInput[];
}

/* ------------------------------------------------------------------ *
 * Input rule
 * ------------------------------------------------------------------ */

export interface PrimaryInputState {
  text: boolean;
  attachment: boolean;
  repository: boolean;
}

/** The single rule for "this request has something to work on". */
export function hasPrimaryInput(state: PrimaryInputState): boolean {
  return state.text || state.attachment || state.repository;
}

/** Derives the rule inputs from already-resolved, conversation-scoped refs. */
export function primaryInputState(prompt: string, attachments: InputObjectRef[]): PrimaryInputState {
  return {
    text: (prompt ?? "").trim().length > 0,
    attachment: attachments.length > 0,
    repository: attachments.some((ref) => ref.kind === "REPOSITORY")
  };
}

/** Empty text with no bound input is a clear, early error. */
export function assertPrimaryInput(prompt: string, attachments: InputObjectRef[]): void {
  const state = primaryInputState(prompt, attachments);
  if (!hasPrimaryInput(state)) {
    throw new Error("Task requires a message, an attachment, or a repository");
  }
}

/* ------------------------------------------------------------------ *
 * Guardian screening
 * ------------------------------------------------------------------ */

export type GuardianDenialCode =
  | "BYPASS_ROOT"
  | "WEAKEN_SECURITY"
  | "WEAKEN_VERIFICATION"
  | "EXPOSE_SECRETS"
  | "WRITE_OUTSIDE_WORKSPACE"
  | "PROTECTED_AREA";

export interface GuardianRefusal {
  code: GuardianDenialCode;
  reason: string;
}

/**
 * WorkBook intake augments attachment/repository Work tasks, not plain text
 * Work: a text-only Work request keeps the legacy path even though the input
 * rule would accept it. Chat never enters intake.
 */
export function shouldRunWorkBookIntake(appMode: "chat" | "work", attachments: InputObjectRef[]): boolean {
  return appMode === "work" && attachments.length > 0;
}

/**
 * A WorkBook commonly states safety constraints such as "do not expose
 * credentials". Match dangerous requests only when the matching clause is not
 * explicitly negated; otherwise Guardian would reject the very policy that
 * protects it. Clause resets keep a later "but/then reveal it" actionable.
 */
function hasAffirmativeMatch(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    const before = text.slice(Math.max(0, match.index - 180), match.index);
    const clause = before.split(/(?:[\n.!?;。！？；]|\b(?:but|however|then|instead)\b|但是|然而|然后|却)/i).at(-1) ?? before;
    const negated = /(?:\b(?:do not|don't|never|must not|shall not|should not|avoid|without)\b|不要|不得|不可|禁止|避免|不应)/i.test(clause);
    if (!negated) return true;
    if (match[0].length === 0) matcher.lastIndex += 1;
  }
  return false;
}

/**
 * Deterministic screening of the request (user text + ingested WorkBook text).
 * Matched against the request only, never as a semantic judge: each rule has a
 * fixed phrase set so a denial is explainable and reproducible.
 */
export function screenWorkBookRequest(input: {
  text: string;
  guardianToken: boolean;
  workspacePath?: string;
  outsideWorkspacePaths?: string[];
}): GuardianRefusal | undefined {
  const text = input.text ?? "";
  // Bypassing Root/Guardian authority is refused outright: a request can never
  // grant itself the authority it is trying to skip.
  const rootBypass = /(?:\u8df3\u8fc7|\u7ed5\u8fc7|\u5173\u95ed|\u7981\u7528)\s*(?:Root|Guardian|\u6839\u6743\u9650|\u6839\u6388\u6743|\u5b88\u62a4)|bypass (?:the )?(?:root|guardian)|disable (?:the )?(?:root|guardian)|ignore (?:root|guardian) (?:authority|policy)/i;
  if (hasAffirmativeMatch(text, rootBypass)) {
    return { code: "BYPASS_ROOT", reason: "request asks to bypass Root/Guardian authority" };
  }
  const rules: { code: GuardianDenialCode; reason: string; pattern: RegExp }[] = [
    {
      code: "WEAKEN_SECURITY",
      reason: "request asks to weaken the security boundary",
      pattern: /(?:\u5173\u95ed|\u7981\u7528|\u964d\u4f4e|\u7ed5\u8fc7)\s*(?:\u5b89\u5168|\u9274\u6743|\u6743\u9650\u6821\u9a8c|\u5b89\u5168\u68c0\u67e5)|disable (?:the )?(?:security|auth|authorization|permission checks?)|weaken (?:the )?security|lower (?:the )?(?:security|classification) (?:level|boundary)/i
    },
    {
      code: "WEAKEN_VERIFICATION",
      reason: "request asks to skip verification or accept unverified completion",
      pattern: /(?:\u8df3\u8fc7|\u53d6\u6d88|\u7981\u7528)\s*(?:\u9a8c\u8bc1|\u6821\u9a8c|\u6d4b\u8bd5)|(?:\u65e0\u9700|\u4e0d\u7528|\u4e0d\u5fc5)(?:\u9a8c\u8bc1|\u6821\u9a8c|\u6d4b\u8bd5)|(?:\u76f4\u63a5|\u81ea\u52a8)(?:\u6807\u8bb0|\u8ba4\u4e3a)(?:\u4e3a)?\u5b8c\u6210|skip (?:the )?(?:verification|validation|tests?)|without (?:verification|validation|tests?)|accept unverified|mark (?:it )?(?:as )?complete without/i
    },
    {
      code: "EXPOSE_SECRETS",
      reason: "request asks to reveal a secret value",
      pattern: /(?:\u8f93\u51fa|\u6253\u5370|\u663e\u793a|\u6cc4\u9732|\u5bfc\u51fa|\u7ed9\u6211)[^\u3002\uff01\uff1f\uff1b\n]{0,6}?(?:\u5bc6\u94a5|\u5bc6\u7801|\u53e3\u4ee4|\u4ee4\u724c|\u51ed\u636e|API\s*key|apikey)|(?:print|reveal|expose|dump|show me|give me)[^.!?\n]{0,24}?(?:secret|secrets|api\s*key|password|token|credential)/i
    },
    {
      code: "WRITE_OUTSIDE_WORKSPACE",
      reason: "request asks to write outside the selected workspace",
      pattern: /(?:\u5199\u5230|\u5199\u5165|\u8f93\u51fa\u5230|\u4fdd\u5b58\u5230)\s*(?:\u5de5\u4f5c\u533a\u5916|\u9879\u76ee\u5916|\u7cfb\u7edf\u76ee\u5f55|\u5176\u4ed6\u76ee\u5f55)|write (?:outside|beyond) (?:the )?workspace|outside (?:the )?workspace (?:directory|root)|write to \/etc|write to C:\\\\Windows/i
    }
  ];
  for (const rule of rules) {
    if (!hasAffirmativeMatch(text, rule.pattern)) continue;
    // A protected/guardian area needs a Guardian token; the request text cannot
    // grant it, so an untokened attempt is denied fail-closed.
    const verdict = changeAllowed("core.security.boundary", input.guardianToken, "workbook dispatch");
    return { code: rule.code, reason: verdict.allowed ? rule.reason : `${verdict.reason}: ${rule.reason}` };
  }
  // Path containment: any declared target outside the selected workspace denies.
  const outside = (input.outsideWorkspacePaths ?? []).filter((candidate) => candidate.trim().length > 0);
  if (!input.workspacePath?.trim() && outside.length) {
    return { code: "WRITE_OUTSIDE_WORKSPACE", reason: `no workspace is selected but the request targets ${outside.join(", ")}` };
  }
  if (input.workspacePath?.trim()) {
    for (const candidate of outside) {
      if (!isInsideWorkspace(input.workspacePath, candidate)) {
        return { code: "WRITE_OUTSIDE_WORKSPACE", reason: `${candidate} is outside the selected workspace ${input.workspacePath}` };
      }
    }
  }
  return undefined;
}

/** Path containment that treats a sibling with a shared prefix as outside. */
export function isInsideWorkspace(workspacePath: string, candidate: string): boolean {
  const root = path.resolve(workspacePath);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  if (relative === "") return true;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */

function reasonLines(verdict: WorkBookVerdict | undefined): string[] {
  if (!verdict) return [];
  return verdict.reasons.map((reason) => `${reason.code} (${reason.weight >= 0 ? "+" : ""}${reason.weight})`);
}

/** Concatenated user text + document titles/content, for guardian screening. */
function screeningText(prompt: string, documents: CanonicalTaskDocument[]): string {
  const parts = [prompt ?? ""];
  for (const document of documents) {
    parts.push(document.title);
    for (const section of document.sections) parts.push(section.text);
  }
  return parts.join("\n");
}

/* ------------------------------------------------------------------ *
 * Objective derivation
 * ------------------------------------------------------------------ */

/** Per-field bound so a single verbose section cannot dominate the objective. */
export const OBJECTIVE_FIELD_LIMIT = 400;
export const OBJECTIVE_LIMIT = 1200;

function objectiveLine(label: string, items: string[]): string | undefined {
  const joined = items
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("; ");
  if (!joined) return undefined;
  return `${label}: ${joined.slice(0, OBJECTIVE_FIELD_LIMIT)}`;
}

/**
 * Derives a concise executable objective from the compiled contract plus the
 * user override. It carries the goal, scope, deliverables and acceptance
 * criteria — never the document body — and is bounded so a task objective
 * stays a task objective. Empty until the contract exists, which is exactly
 * why intake must finish before the task is created.
 */
export function deriveObjectiveFromContract(
  contract: CompiledTaskContract | undefined,
  userText?: string
): string {
  const parts: string[] = [];
  const push = (line: string | undefined) => { if (line) parts.push(line); };

  if (contract) {
    const goal = contract.goal[0]?.items.join("; ") ?? contract.goal[0]?.text ?? "";
    push(goal.trim() ? goal.replace(/\s+/g, " ").trim().slice(0, OBJECTIVE_FIELD_LIMIT) : undefined);
    push(objectiveLine("Scope", contract.scope[0]?.items ?? []));
    push(objectiveLine("Deliverables", contract.deliverables[0]?.items ?? []));
    push(objectiveLine("Acceptance criteria", contract.acceptance_criteria[0]?.items ?? []));
    push(objectiveLine("Constraints", contract.constraints[0]?.items ?? []));
  }
  const trimmedUser = (userText ?? "").replace(/\s+/g, " ").trim();
  if (trimmedUser) push(`User override: ${trimmedUser.slice(0, OBJECTIVE_FIELD_LIMIT)}`);

  const objective = parts.join("\n").trim();
  if (!objective) return "";
  return objective.length > OBJECTIVE_LIMIT ? objective.slice(0, OBJECTIVE_LIMIT).trim() : objective;
}

/**
 * State snapshots deliberately omit private attachment-store paths. Hydrate a
 * transient copy for ingestion through the store's conversation-scoped
 * resolver; never persist the path back into the public input reference.
 */
export function hydrateWorkBookAttachmentPaths(
  attachments: InputObjectRef[],
  resolvePath: (conversationId: string, inputObjectId: string) => string | undefined
): InputObjectRef[] {
  return attachments.map((ref) => {
    if (ref.localPath || ref.source !== "UPLOAD") return { ...ref };
    const localPath = resolvePath(ref.conversationId, ref.id);
    return localPath ? { ...ref, localPath } : { ...ref };
  });
}

/**
 * Every persisted task needs a non-empty objective, including a reference-only
 * WorkBook whose contract intentionally has no executable goal. Keep the
 * fallback descriptive rather than turning reference material into an
 * instruction to execute it.
 */
export function ensureWorkBookTaskObjective(
  objective: string,
  title: string,
  attachments: InputObjectRef[]
): string {
  const derived = objective.trim();
  if (derived) return derived;
  const names = attachments
    .map((ref) => ref.originalName ?? ref.id)
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
  const subject = names || title.trim() || "attached input";
  return `Review attached reference input: ${subject}`.slice(0, OBJECTIVE_LIMIT);
}

/* ------------------------------------------------------------------ *
 * Intake (decision only)
 * ------------------------------------------------------------------ */

/**
 * Runs the WorkBook intake ladder and returns a decision.
 *
 * This function is deliberately side-effect free with respect to the app: it
 * never persists, never changes a task status and never starts provider work.
 * The caller owns the task lifecycle, so exactly one place decides to dispatch
 * and duplicate/resume can be resolved before a task is created at all.
 *
 * Never throws for document-level problems: a corrupt or unsupported
 * attachment becomes a diagnostic and the rest still ingests.
 */
export async function runWorkBookDispatch(
  request: WorkBookDispatchRequest,
  deps: WorkBookDispatchDeps = {}
): Promise<WorkBookDispatchResult> {
  const now = deps.now ?? (() => new Date());
  const attachments = request.attachments ?? [];
  const history: WorkBookStageEntry[] = [];
  const push = (stage: WorkBookStage, detail: string) => history.push({ stage, at: now().toISOString(), detail });
  const build = (stage: WorkBookStage, patch: Partial<WorkBookDispatchRecord> = {}): WorkBookDispatchRecord => ({
    schemaVersion: 1,
    stage,
    stageHistory: [...history],
    analysis_only: false,
    auto_run: false,
    has_workbook: false,
    classification_reasons: [],
    documents: [],
    roles: {},
    conflicts: [],
    ...patch
  });

  const state = primaryInputState(request.prompt ?? "", attachments);
  if (!hasPrimaryInput(state)) {
    push("BLOCKED", "no message, attachment or repository was supplied");
    return {
      stage: "BLOCKED",
      record: build("BLOCKED", { blocked_reason: "Task requires a message, an attachment, or a repository" }),
      title: request.title?.trim() ?? "Untitled task",
      objective: "",
      autoRun: false,
      analysisOnly: false,
      blocked: true,
      refusal: "EMPTY_INPUT",
      reused: false,
      revisionPlan: []
    };
  }
  push("INPUT_RECEIVED", `${attachments.length} attachment ref(s), text ${state.text ? "present" : "absent"}${state.repository ? ", repository bound" : ""}`);

  const analysis = detectAnalysisOnly(request.prompt ?? "");
  const analysisOnly = analysis.kind === "ANALYSIS_ONLY";

  // Duplicate/resume: an exact content match reuses the existing WorkBook task,
  // so the caller must not create another one.
  const reuse = findReusableTask(request.existingWorkbookTasks ?? {}, attachments);
  if (reuse) {
    push("INGESTING", `exact content hash already belongs to WorkBook task ${reuse.task_id}`);
    push("READY", "duplicate content: the caller resumes the existing task");
    return {
      stage: "READY",
      record: build("READY", {
        resolved_title: reuse.file_name,
        analysis_only: analysisOnly,
        has_workbook: true,
        workbook_hash: reuse.hash,
        documents: [{
          document_id: reuse.document_id,
          file_name: reuse.file_name,
          hash: reuse.hash,
          status: "OK",
          sections: 0,
          relation: "DUPLICATE",
          diagnostics: []
        }]
      }),
      title: request.title?.trim() || reuse.file_name,
      objective: deriveObjectiveFromContract(undefined, request.prompt),
      autoRun: false,
      analysisOnly,
      blocked: false,
      reused: true,
      reuse_task_id: reuse.task_id,
      revisionPlan: []
    };
  }

  // INGESTING: only refs belonging to this conversation ever reach the reader.
  const scoped = conversationScopedRefs(request, attachments);
  push("INGESTING", `${scoped.length} conversation-scoped document(s)`);
  const sources: DocumentSource[] = scoped.map((ref) => {
    const source: DocumentSource = {
      file_name: ref.originalName ?? ref.id,
      source_input_id: ref.id,
      source_type: ref.source,
      created_at: now().toISOString()
    };
    if (ref.mime) source.mime_type = ref.mime;
    if (ref.kind) source.kind = ref.kind;
    if (ref.localPath) source.path = ref.localPath;
    return source;
  });
  const ingest = deps.ingest ?? ((list, options) => ingestDocuments(list, options));
  const { documents } = await ingest(sources, { limits: deps.limits });

  const verdicts = new Map<string, WorkBookVerdict>();
  const roleAssignment = assignRoles(documents);
  const roleByDocument = new Map(roleAssignment.assignments.map((entry) => [entry.document_id, entry]));
  push("CLASSIFYING", `${documents.length} document(s) classified`);

  // RELATION PLAN ONLY (REPAIR_BATCH_4): intake must not write the registry.
  // Recording before the task exists is what created an unrecoverable orphan
  // window. The plan is computed here in memory, the caller creates and
  // durably persists the task (including this record), and only then commits
  // the revisions with the real task id.
  const registry = deps.registry;
  const relations = registry ? registry.plan(documents) : undefined;
  const readable = documents.filter((document) => document.status !== "FAILED");
  const relationByDocument = new Map((relations?.decisions ?? []).map((decision) => [decision.document_id, decision]));

  const summaries: WorkBookDocumentSummary[] = documents.map((document) => {
    const assignment = roleByDocument.get(document.id);
    const decision = relationByDocument.get(document.id);
    if (assignment) verdicts.set(document.id, assignment.verdict);
    const summary: WorkBookDocumentSummary = {
      document_id: document.id,
      file_name: document.file_name,
      hash: document.hash,
      status: document.status,
      sections: document.sections.length,
      relation: decision?.relation ?? "NEW",
      diagnostics: document.diagnostics.filter((entry) => entry.severity !== "INFO").map((entry) => `${entry.code}: ${entry.message}`)
    };
    if (assignment) { summary.classification = assignment.verdict.kind; summary.confidence = assignment.verdict.confidence; summary.role = assignment.role; }
    if (decision?.supersedes_document_id) summary.supersedes_document_id = decision.supersedes_document_id;
    return summary;
  });

  push("COMPILING", `compiling contract from ${readable.length} readable document(s)`);
  const contract = compileTaskContract({
    documents,
    userText: request.prompt ?? "",
    analysisOnly: { kind: analysis.kind, confidence: analysis.confidence, reasons: analysis.reasons },
    classifications: [...verdicts.entries()].map(([document_id, verdict]) => ({ document_id, verdict })),
    roles: roleAssignment.assignments.map((entry) => ({ document_id: entry.document_id, role: entry.role })),
    ...(roleAssignment.primary_document_id ? { primaryDocumentId: roleAssignment.primary_document_id } : {})
  });
  const title = resolveTitle(request, documents);
  const objective = ensureWorkBookTaskObjective(
    deriveObjectiveFromContract(contract, request.prompt),
    title,
    scoped
  );
  // checkpoint-1 §28: the contract becomes a requirements graph, so every later
  // stage can bind evidence to a requirement instead of to prose. Requirements
  // inside conflicting sections start QUARANTINED (§28.3) rather than being
  // silently dropped or silently executable.
  const isolation = isolateRequirements(contract, documents, roleAssignment.diagnostics);
  const requirements = buildRequirementsGraph({
    contract,
    quarantined: isolation.quarantined,
    untraceable: isolation.untraceable,
    now: now().toISOString()
  });
  for (const entry of isolation.quarantined) {
    const match = requirements.nodes.find((node) => node.text === entry.item);
    if (match && match.state !== "QUARANTINED") { match.state = "QUARANTINED"; match.state_reason = entry.reason; }
  }

  const primaryDocument = documents.find((document) => document.id === roleAssignment.primary_document_id)
    ?? readable[0]
    ?? documents[0];
  const primaryVerdict = primaryDocument ? verdicts.get(primaryDocument.id) : undefined;

  // Guardian screening runs on the composed request before anything is planned.
  const refusal = screenWorkBookRequest({
    text: screeningText(request.prompt ?? "", documents),
    guardianToken: request.guardianToken === true,
    ...(request.workspacePath ? { workspacePath: request.workspacePath } : {})
  });
  if (refusal) {
    push("BLOCKED", `${refusal.code}: ${refusal.reason}`);
    return {
      stage: "BLOCKED",
      record: build("BLOCKED", {
        has_workbook: documents.length > 0,
        ...(primaryVerdict ? { classification: primaryVerdict.kind, confidence: primaryVerdict.confidence, classification_reasons: reasonLines(primaryVerdict) } : {}),
        documents: summaries,
        roles: roleAssignment.winners,
        conflicts: roleAssignment.diagnostics,
        contract,
        requirements,
        blocked_reason: `${refusal.code}: ${refusal.reason}`,
        ...(primaryDocument ? { workbook_hash: primaryDocument.hash } : {})
      }),
      title,
      objective,
      autoRun: false,
      analysisOnly,
      blocked: true,
      refusal: "GUARDIAN_DENIED",
      reused: false,
      revisionPlan: revisionPlanFor(readable, registry !== undefined)
    };
  }

  // DISCOVERING: repository discovery must precede any final/dynamic plan.
  push("DISCOVERING", "scanning the selected workspace");
  const discovery = runDiscovery(request, documents, deps);

  const executable = readable.some((document) => verdicts.get(document.id)?.kind === "EXECUTABLE_WORKBOOK");
  const autoRun = executable && !analysisOnly && request.allowProviderDispatch !== false;
  push("PLANNING", analysisOnly
    ? "analysis-only request: the compiled contract is the deliverable"
    : autoRun ? "executable WorkBook: the caller may start provider work" : "no auto-run: reference/ambiguous or dispatch not requested");
  push("READY", `intake complete; dispatch decision=${autoRun ? "provider" : "none"}`);

  return {
    stage: "READY",
    record: build("READY", {
      resolved_title: title,
      analysis_only: analysisOnly,
      auto_run: autoRun,
      has_workbook: documents.length > 0,
      ...(primaryDocument ? { workbook_hash: primaryDocument.hash } : {}),
      ...(roleAssignment.primary_document_id ? { primary_document_id: roleAssignment.primary_document_id } : {}),
      ...(primaryVerdict ? { classification: primaryVerdict.kind, confidence: primaryVerdict.confidence, classification_reasons: reasonLines(primaryVerdict) } : {}),
      documents: summaries,
      roles: roleAssignment.winners,
      conflicts: roleAssignment.diagnostics,
      contract,
      requirements,
      discovery
    }),
    title,
    objective,
    autoRun,
    analysisOnly,
    blocked: false,
    reused: false,
    revisionPlan: revisionPlanFor(readable, registry !== undefined),
    ...(analysisOnly ? { refusal: "NO_PROVIDER_DISPATCH" as WorkBookRefusal } : {})
  };
}

/** Revisions the caller must commit once the task durably exists. */
function revisionPlanFor(
  readable: CanonicalTaskDocument[],
  hasRegistry: boolean
): WorkbookRevisionInput[] {
  if (!hasRegistry) return [];
  return readable.map((document) => ({
    id: document.id,
    hash: document.hash,
    file_name: document.file_name,
    title: document.title,
    created_at: document.created_at,
    status: document.status,
    logical_key: document.logical_key
  }));
}

/** Only refs the task bound and that belong to this conversation are ingested. */
function conversationScopedRefs(request: WorkBookDispatchRequest, attachments: InputObjectRef[]): InputObjectRef[] {
  const bound = request.inputObjectIds ? new Set(request.inputObjectIds) : undefined;
  const seen = new Set<string>();
  return attachments.filter((ref) => {
    if (ref.conversationId !== request.conversationId) return false;
    if (bound && !bound.has(ref.id)) return false;
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
}

function resolveTitle(request: WorkBookDispatchRequest, documents: CanonicalTaskDocument[]): string {
  const explicit = request.title?.trim();
  if (explicit) return explicit;
  const workbookTitle = documents.find((document) => document.title.trim())?.title.trim();
  if (workbookTitle) return workbookTitle;
  const fileName = documents.find((document) => document.file_name.trim())?.file_name.trim();
  if (fileName) return fileName;
  const prompt = (request.prompt ?? "").trim().split(/\r?\n/)[0].trim();
  return prompt.slice(0, 80) || "Untitled task";
}

function runDiscovery(
  request: WorkBookDispatchRequest,
  documents: CanonicalTaskDocument[],
  deps: WorkBookDispatchDeps
): DiscoverySummary {
  const repositoryRoot = repositoryRootFor(request);
  if (!repositoryRoot) {
    return { repository: false, files: 0, test_files: 0, skipped_directories: 0, reason: "no workspace or local repository input is bound" };
  }
  if (!fs.existsSync(repositoryRoot)) {
    return { repository: true, root: repositoryRoot, files: 0, test_files: 0, skipped_directories: 0, reason: "repository root does not exist" };
  }
  const discover = deps.discover ?? scanRepo;
  try {
    const snapshot = discover(repositoryRoot);
    void documents;
    const summary: DiscoverySummary = {
      repository: true,
      root: snapshot.root,
      files: snapshot.files.length,
      test_files: Object.values(snapshot.testMap).flat().length,
      fingerprint: snapshot.fingerprint,
      skipped_directories: snapshot.skippedDirectories,
      // checkpoint-1 §5: record the bounded repository model once, so a later
      // task in this project can reuse it instead of scanning again.
      repository_model: repositoryModelFrom(snapshot)
    };
    // checkpoint-1 §6/§9: the Repository World Model and the UI surface registry
    // must exist before engineering execution. Both are host-derived and both
    // degrade into a diagnostic rather than failing the task.
    if (deps.worldModel) {
      try {
        const built = deps.worldModel(repositoryRoot);
        if (built) {
          summary.world_model = built.summary;
          if (built.surfaces) summary.ui_surfaces = built.surfaces;
        } else {
          summary.world_model_error = "world model builder returned no model";
        }
      } catch (error) {
        summary.world_model_error = String((error as Error).message ?? error).slice(0, 400);
      }
    }
    return summary;
  } catch (error) {
    return { repository: true, root: repositoryRoot, files: 0, test_files: 0, skipped_directories: 0, reason: `repository scan failed: ${(error as Error).message}` };
  }
}

/** Local repository inputs win over the generic workspace path. */
function repositoryRootFor(request: WorkBookDispatchRequest): string | undefined {
  const repo = (request.attachments ?? []).find((ref) => ref.kind === "REPOSITORY" && ref.localPath);
  if (repo?.localPath) return repo.localPath;
  return request.workspacePath?.trim() || undefined;
}

/**
 * Exact-duplicate lookup: the bound attachment's sha256 is matched against the
 * workbook hash already recorded on an existing task, so resume happens before
 * any new task is created.
 */
function findReusableTask(
  existingTasks: Record<string, string>,
  attachments: InputObjectRef[]
): { task_id: string; document_id: string; file_name: string; hash: string } | undefined {
  for (const ref of attachments) {
    const hash = ref.sha256;
    if (!hash) continue;
    const taskId = existingTasks[hash];
    if (taskId) return { task_id: taskId, document_id: taskId, file_name: ref.originalName ?? ref.id, hash };
  }
  return undefined;
}
