/**
 * Compiled Task Contract (Work Unit 1, plan §4). Pure and shareable: a
 * WorkBook plus the user's text compile into the single structured object a
 * provider may receive — Goal, Scope, Constraints, Inputs, Dependencies,
 * Deliverables, Acceptance Criteria, Risk, Permissions, Execution Strategy,
 * Source WorkBook, Overrides.
 *
 * Two invariants live here:
 *  1. A declaration is only ever taken from a recognised heading, in a fixed
 *     vocabulary, with its exact provenance (document, section, authority).
 *  2. When a WorkBook exists, the user's own words are an override: they take
 *     precedence and every workbook-derived field is marked overridable, so a
 *     document can never silently outrank the person who sent it.
 */
import { redactSecrets } from "./secret-scan";
import type { CanonicalSection, CanonicalTaskDocument, WorkBookClassification, WorkBookVerdict } from "./workbook";

export type DeclarationKind =
  | "GOAL"
  | "SCOPE"
  | "CONSTRAINTS"
  | "INPUTS"
  | "DEPENDENCIES"
  | "DELIVERABLES"
  | "ACCEPTANCE_CRITERIA"
  | "RISK"
  | "PERMISSIONS"
  | "EXECUTION_STRATEGY";

export const DECLARATION_KINDS: readonly DeclarationKind[] = [
  "GOAL", "SCOPE", "CONSTRAINTS", "INPUTS", "DEPENDENCIES", "DELIVERABLES", "ACCEPTANCE_CRITERIA", "RISK", "PERMISSIONS", "EXECUTION_STRATEGY"
];

export type ContractAuthority = "WORKBOOK" | "USER";

/**
 * Per-item provenance: merging declarations from several documents must never
 * pretend every item came from the winning section. Items that genuinely belong
 * to the winner are listed here; items inherited from another document keep
 * their own source in `inherited_items`, so requirement isolation can trace
 * every item back to the section that actually contains it.
 */
export interface ContractItemProvenance {
  item: string;
  source_document_id: string;
  source_section_id?: string;
  heading?: string;
}

export interface ContractDeclaration {
  kind: DeclarationKind;
  authority: ContractAuthority;
  source_document_id: string;
  source_section_id?: string;
  heading?: string;
  items: string[];
  text: string;
  /** True when the user's message may replace this declaration. */
  overridable: boolean;
  /** Provenance for every item, in `items` order. */
  item_provenance: ContractItemProvenance[];
}

export interface ContractInput {
  document_id: string;
  file_name: string;
  role?: string;
  hash: string;
  classification?: WorkBookClassification;
  sections_used: number;
}

export interface ContractOverride {
  /** Raw user text that carries override authority. */
  text: string;
  authority: "USER";
  /** True when a WorkBook was present, so the message is an amendment. */
  applies_to_workbook: boolean;
  supersedes: DeclarationKind[];
  reason: string;
}

export interface ExecutionStrategy {
  mode: "NATIVE" | "WORK" | "CHAT";
  analysis_only: boolean;
  requires_planning: boolean;
  /** Declared capability tokens for the capability graph / router. */
  required_capabilities: string[];
  /** WorkBook sections that must be re-read before acting. */
  reference_sections: { document_id: string; section_id: string; heading?: string }[];
  rationale: string;
}

export interface TaskContractDiagnostics {
  warnings: string[];
  /** Declaration kinds nobody declared, in canonical order. */
  missing: DeclarationKind[];
  analysis_only_reasons: string[];
  classification_reasons: string[];
}

export interface CompiledTaskContract {
  version: 1;
  goal: ContractDeclaration[];
  scope: ContractDeclaration[];
  constraints: ContractDeclaration[];
  inputs: ContractInput[];
  dependencies: ContractDeclaration[];
  deliverables: ContractDeclaration[];
  acceptance_criteria: ContractDeclaration[];
  risk: ContractDeclaration[];
  permissions: ContractDeclaration[];
  execution_strategy: ExecutionStrategy;
  source_workbook: {
    document_ids: string[];
    classifications: { document_id: string; file_name: string; kind?: WorkBookClassification; confidence?: number }[];
    primary_document_id?: string;
    has_workbook: boolean;
  };
  overrides: ContractOverride[];
  diagnostics: TaskContractDiagnostics;
}

/** Role vocabulary mirrored here as strings to keep this module dependency-free. */
type SourceRoleName = "PRIMARY_SPEC" | "SUB_PLAN" | "REFERENCE" | "ACCEPTANCE_CRITERIA";

/** A document assigned a role owns that role's declaration kind. */
const DECLARATION_KIND_FOR_ROLE: Partial<Record<SourceRoleName, DeclarationKind>> = {
  ACCEPTANCE_CRITERIA: "ACCEPTANCE_CRITERIA",
  SUB_PLAN: "EXECUTION_STRATEGY",
  PRIMARY_SPEC: "GOAL"
};

export interface CompileTaskContractInput {
  documents: CanonicalTaskDocument[];
  userText?: string;
  analysisOnly?: { kind: string; confidence: number; reasons: string[] };
  classifications?: { document_id: string; verdict: WorkBookVerdict }[];
  primaryDocumentId?: string;
  /** Per-document roles from role assignment. */
  roles?: { document_id: string; role: string }[];
}

/**
 * Heading boundary that works for both scripts. `\b` cannot be used after a
 * CJK character (CJK chars are word characters), so the boundary is "end of
 * heading or non-letter/digit" instead.
 */
const HEADING_END = "(?=$|[\\s:：\\-—(（\\[].*$)";
const headingPattern = (body: string) => new RegExp(`^(?:${body})${HEADING_END}`, "i");

const DECLARATION_PATTERNS: { kind: DeclarationKind; patterns: RegExp[] }[] = [
  {
    kind: "GOAL",
    patterns: [headingPattern("goal|objective|background\\s*(?:and|&)\\s*goal|purpose|目标|任务目标|项目目标|背景与目标|目的|需求背景|概述")]
  },
  {
    kind: "SCOPE",
    patterns: [headingPattern("scope|in\\s+scope|out\\s+of\\s+scope|工作范围|范围|作用域|需求范围|边界")]
  },
  {
    kind: "CONSTRAINTS",
    patterns: [headingPattern("constraints?|restrictions?|limitations?|non-?functional|约束|限制|前提|边界条件|非功能要求|技术要求")]
  },
  {
    kind: "INPUTS",
    patterns: [headingPattern("inputs?|materials?|data\\s+sources?|输入|输入资料|输入物|素材|依赖输入")]
  },
  {
    kind: "DEPENDENCIES",
    patterns: [headingPattern("dependencies|depends\\s+on|prerequisites?|依赖|前置条件|依赖项|关联系统")]
  },
  {
    kind: "DELIVERABLES",
    patterns: [headingPattern("deliverables?|outputs?|artifacts?|交付物|产出|交付清单|输出物|交付内容")]
  },
  {
    kind: "ACCEPTANCE_CRITERIA",
    patterns: [headingPattern("acceptance\\s+criteria|definition\\s+of\\s+done|done\\s+criteria|验收标准|验收条件|完成标准|测试标准|成功标准")]
  },
  {
    kind: "RISK",
    patterns: [headingPattern("risks?|risk\\s+(?:assessment|analysis)|open\\s+questions?|风险|风险与依赖|风险评估|待确认|开放问题")]
  },
  {
    kind: "PERMISSIONS",
    patterns: [headingPattern("permissions?|access\\s+control|authorization|grants?|权限|授权|访问权限|许可")]
  },
  {
    kind: "EXECUTION_STRATEGY",
    patterns: [headingPattern("execution\\s+strategy|approach|implementation\\s+(?:strategy|plan)|methodology|milestones?|plan|tasks?|steps?|work\\s*items?|sub-?tasks?|实施步骤|执行策略|执行方案|实施计划|任务列表|执行步骤|子任务|具体任务|阶段计划|方案|里程碑|阶段")]
  }
];

/** Heading -> declaration kind, or undefined when the heading is not a declaration. */
export function declarationKindForHeading(heading: string | undefined): DeclarationKind | undefined {
  if (!heading?.trim()) return undefined;
  const normalized = heading.replace(/^[#*\s\d.、)（(]+/, "").replace(/[：:]\s*$/, "").trim();  for (const entry of DECLARATION_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) return entry.kind;
  }
  return undefined;
}

/** Splits a declaration body into discrete items, keeping original phrasing. */
export function itemsFromDeclarationText(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const items: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^(?:[-*+•]|\[[ xX]\]|\d+[.)、]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.]|第[一二三四五六七八九十百\d]+[条章节步])\s*(.*)$/.exec(line);
    const body = bullet ? bullet[1].trim() : line;
    if (!body) continue;
    if (bullet) items.push(body);
    else if (!items.length) items.push(body);
    else items[items.length - 1] = `${items[items.length - 1]} ${body}`.trim();
  }
  if (!items.length && text.trim()) items.push(text.trim());
  return items.slice(0, 200);
}

interface FoundDeclaration {
  kind: DeclarationKind;
  /** Heading that opened the declaration: provenance, never an item. */
  heading?: string;
  /** Id of the heading section, so callers can jump back to the source. */
  headingSectionId?: string;
  /** Body sections only; heading-only sections are excluded by construction. */
  sections: CanonicalSection[];
  documentId: string;
}

/**
 * True when a section carries only its heading line. Extractors model a heading
 * as its own section (kind HEADING/TITLE) whose text equals the heading; every
 * other kind keeps its body even when the body coincidentally repeats it.
 */
function isPureHeading(section: CanonicalSection): boolean {
  const heading = section.heading?.trim();
  if (!heading) return false;
  if (section.kind !== "HEADING" && section.kind !== "TITLE") return false;
  const text = section.text.trim();
  return text === heading || text.replace(/^#+\s*/, "").trim() === heading;
}

/**
 * Collects declarations per document: a headed section declares its kind, and
 * every following heading-less section is an implicit continuation of it.
 */
export function collectDeclarations(document: CanonicalTaskDocument): FoundDeclaration[] {
  const found = new Map<DeclarationKind, FoundDeclaration>();
  let current: FoundDeclaration | undefined;
  for (const section of document.sections) {
    const kind = declarationKindForHeading(section.heading);
    if (kind) {
      // Reassign `current` first: the heading belongs to the new declaration,
      // never to the one it just closed.
      const existing = found.get(kind);
      current = existing ?? { kind, sections: [], documentId: document.id };
      if (!existing) found.set(kind, current);
      const heading = section.heading?.trim();
      if (heading && !current.heading) {
        current.heading = heading;
        current.headingSectionId = section.id;
      }
      // A heading may carry body text on the same line; keep that text only.
      if (section.text.trim() && !isPureHeading(section)) current.sections.push(section);
      continue;
    }
    if (section.heading) { current = undefined; continue; }
    if (current && section.kind !== "TITLE") current.sections.push(section);
  }
  // A declaration with no body still reports its heading, so the reader sees
  // what the document actually said instead of an empty field.
  for (const declaration of found.values()) {
    if (declaration.sections.length || !declaration.heading) continue;
    const headingSection = document.sections.find((section) => section.id === declaration.headingSectionId);
    if (headingSection) declaration.sections.push({ ...headingSection, text: declaration.heading });
  }
  return [...found.values()];
}

function declarationFrom(found: FoundDeclaration, overridable: boolean): ContractDeclaration {
  const heading = found.heading;
  const bodyText = found.sections.map((section) => section.text.trim()).filter(Boolean).join("\n");
  // The heading is provenance: it is kept in `text` for context but never
  // becomes a bullet in `items`.
  const text = heading && bodyText && !bodyText.startsWith(heading) ? `${heading}\n${bodyText}` : bodyText || heading || "";
  const items = itemsFromDeclarationText(bodyText || heading || "");
  const declaration: ContractDeclaration = {
    kind: found.kind,
    authority: "WORKBOOK",
    source_document_id: found.documentId,
    items,
    text,
    overridable,
    item_provenance: []
  };
  const first = found.sections[0];
  if (first) declaration.source_section_id = first.id;
  else if (found.headingSectionId) declaration.source_section_id = found.headingSectionId;
  if (heading) declaration.heading = heading;
  // Every item starts with the declaration's own provenance; the merge step
  // rewrites the entries that actually came from another document.
  declaration.item_provenance = items.map((item) => {
    const provenance: ContractItemProvenance = { item, source_document_id: found.documentId };
    if (declaration.source_section_id) provenance.source_section_id = declaration.source_section_id;
    if (heading) provenance.heading = heading;
    return provenance;
  });
  return declaration;
}

/** Execution verbs that make a task plan-worthy even without a WorkBook. */
const PLANNING_HINT = /(?:按照|根据|follow|according\s+to).*\.md|并行|parallel|重构|refactor|多步骤|分阶段|migrate|迁移/i;

function buildExecutionStrategy(input: {
  documents: CanonicalTaskDocument[];
  classifications: WorkBookVerdict[];
  primary?: CanonicalTaskDocument;
  analysisOnly: boolean;
  userText: string;
  declarations: Map<DeclarationKind, ContractDeclaration>;
}): ExecutionStrategy {
  const hasWorkbook = input.documents.length > 0;
  const executable = input.classifications.some((verdict) => verdict.kind === "EXECUTABLE_WORKBOOK");
  const onlyReference = hasWorkbook && !executable;
  const mode: ExecutionStrategy["mode"] = hasWorkbook ? (onlyReference ? "CHAT" : "WORK") : (PLANNING_HINT.test(input.userText) ? "WORK" : "CHAT");
  const required = new Set<string>();
  if (mode === "WORK") required.add("work");
  if (input.documents.some((document) => document.sections.some((section) => section.kind === "CODE"))) required.add("code");
  if (input.declarations.has("DELIVERABLES")) required.add("deliverable");
  if (input.declarations.has("ACCEPTANCE_CRITERIA")) required.add("verification");
  if (hasWorkbook) required.add("document_ingestion");

  const referenceSections: ExecutionStrategy["reference_sections"] = [];
  for (const document of input.documents) {
    for (const section of document.sections) {
      if (declarationKindForHeading(section.heading) === undefined) continue;
      const entry: ExecutionStrategy["reference_sections"][number] = { document_id: document.id, section_id: section.id };
      if (section.heading) entry.heading = section.heading;
      referenceSections.push(entry);
    }
  }

  const reasons: string[] = [];
  reasons.push(hasWorkbook ? `${input.documents.length} ingested document(s)` : "no WorkBook attached");
  if (input.classifications.length) reasons.push(`classifications: ${input.classifications.map((verdict) => verdict.kind).join(", ")}`);
  if (input.analysisOnly) reasons.push("user asked for analysis only");
  if (input.primary) reasons.push(`primary document ${input.primary.file_name}`);

  return {
    mode,
    analysis_only: input.analysisOnly,
    requires_planning: mode === "WORK" && !input.analysisOnly && (executable || PLANNING_HINT.test(input.userText)),
    required_capabilities: [...required].sort(),
    reference_sections: referenceSections,
    rationale: reasons.join("; ")
  };
}

/**
 * Compiles the contract. `analysisOnly` is passed in (computed from the user
 * text by detectAnalysisOnly) so this module stays free of phrase tables.
 */
export function compileTaskContract(input: CompileTaskContractInput): CompiledTaskContract {
  const userText = (input.userText ?? "").trim();
  const documents = input.documents ?? [];
  const hasWorkbook = documents.length > 0;
  const verdictByDocument = new Map((input.classifications ?? []).map((entry) => [entry.document_id, entry.verdict]));
  const roleByDocument = new Map((input.roles ?? []).map((entry) => [entry.document_id, entry.role]));
  const classifications = (input.classifications ?? []).map((entry) => entry.verdict);
  const warnings: string[] = [];
  const classificationReasons: string[] = [];
  for (const entry of input.classifications ?? []) {
    const document = documents.find((candidate) => candidate.id === entry.document_id);
    for (const reason of entry.verdict.reasons) classificationReasons.push(`${document?.file_name ?? entry.document_id}: ${reason.code} (${reason.weight >= 0 ? "+" : ""}${reason.weight})`);
  }

  // Merge declarations across documents. Precedence is deterministic and
  // auditable: the document that owns the corresponding role wins (an
  // ACCEPTANCE_CRITERIA document owns the acceptance criteria), then the
  // primary document, then ingestion order. Losing declarations still
  // contribute their items, appended after the winner's, and the combination
  // is reported as a warning.
  const roleOwner = new Map<DeclarationKind, string>();
  for (const entry of input.roles ?? []) {
    const kind = DECLARATION_KIND_FOR_ROLE[entry.role as SourceRoleName];
    if (kind) roleOwner.set(kind, entry.document_id);
  }
  const documentOrder = new Map(documents.map((document, index) => [document.id, index]));
  const rankOf = (kind: DeclarationKind, documentId: string): number => {
    const owner = roleOwner.get(kind);
    if (owner === documentId) return 0;
    if (input.primaryDocumentId === documentId) return 1;
    return 2 + (documentOrder.get(documentId) ?? 99);
  };

  const merged = new Map<DeclarationKind, ContractDeclaration>();
  const contributorWarnings: string[] = [];
  for (const document of documents) {
    for (const found of collectDeclarations(document)) {
      const candidate = declarationFrom(found, hasWorkbook);
      const existing = merged.get(found.kind);
      if (!existing) { merged.set(found.kind, candidate); continue; }
      const winner = rankOf(found.kind, existing.source_document_id) <= rankOf(found.kind, candidate.source_document_id) ? existing : candidate;
      const loser = winner === existing ? candidate : existing;
      const mergedDeclaration: ContractDeclaration = {
        ...winner,
        items: [...winner.items, ...loser.items],
        // Item provenance survives the merge: an inherited item keeps the
        // document/section that actually contains it, never the winner's.
        item_provenance: [...winner.item_provenance, ...loser.item_provenance],
        text: `${winner.text}\n${loser.text}`.trim(),
        overridable: winner.overridable || loser.overridable
      };
      merged.set(found.kind, mergedDeclaration);
      contributorWarnings.push(`${found.kind} is declared by more than one document (owner ${winner.source_document_id}, also ${loser.source_document_id}); the owner's items come first`);
    }
  }

  const contract: CompiledTaskContract = {
    version: 1,
    goal: merged.has("GOAL") ? [merged.get("GOAL")!] : [],
    scope: merged.has("SCOPE") ? [merged.get("SCOPE")!] : [],
    constraints: merged.has("CONSTRAINTS") ? [merged.get("CONSTRAINTS")!] : [],
    inputs: documents.map((document) => {
      const entry: ContractInput = {
        document_id: document.id,
        file_name: document.file_name,
        hash: document.hash,
        sections_used: document.sections.length
      };
      const role = roleByDocument.get(document.id);
      if (role) entry.role = role;
      const verdict = verdictByDocument.get(document.id);
      if (verdict) entry.classification = verdict.kind;
      return entry;
    }),
    dependencies: merged.has("DEPENDENCIES") ? [merged.get("DEPENDENCIES")!] : [],
    deliverables: merged.has("DELIVERABLES") ? [merged.get("DELIVERABLES")!] : [],
    acceptance_criteria: merged.has("ACCEPTANCE_CRITERIA") ? [merged.get("ACCEPTANCE_CRITERIA")!] : [],
    risk: merged.has("RISK") ? [merged.get("RISK")!] : [],
    permissions: merged.has("PERMISSIONS") ? [merged.get("PERMISSIONS")!] : [],
    execution_strategy: buildExecutionStrategy({
      documents,
      classifications,
      primary: documents.find((document) => document.id === input.primaryDocumentId) ?? documents[0],
      analysisOnly: input.analysisOnly?.kind === "ANALYSIS_ONLY",
      userText,
      declarations: merged
    }),
    source_workbook: {
      document_ids: documents.map((document) => document.id),
      classifications: documents.map((document) => {
        const verdict = verdictByDocument.get(document.id);
        const entry: CompiledTaskContract["source_workbook"]["classifications"][number] = { document_id: document.id, file_name: document.file_name };
        if (verdict) { entry.kind = verdict.kind; entry.confidence = verdict.confidence; }
        return entry;
      }),
      has_workbook: hasWorkbook
    },
    overrides: [],
    diagnostics: {
      warnings,
      missing: DECLARATION_KINDS.filter((kind) => !merged.has(kind)),
      analysis_only_reasons: input.analysisOnly?.reasons ?? [],
      classification_reasons: classificationReasons
    }
  };
  if (input.primaryDocumentId) contract.source_workbook.primary_document_id = input.primaryDocumentId;

  if (userText) {
    const override: ContractOverride = {
      text: redactSecrets(userText),
      authority: "USER",
      applies_to_workbook: hasWorkbook,
      supersedes: [...merged.keys()].filter((kind) => kind !== "INPUTS"),
      reason: hasWorkbook
        ? "user text accompanies an ingested WorkBook and therefore carries override authority"
        : "user text is the only instruction; there is no WorkBook to defer to"
    };
    contract.overrides.push(override);
  }

  if (hasWorkbook && !merged.size) {
    warnings.push("no declaration heading (goal/scope/deliverables/acceptance criteria) was found in the WorkBook; the contract relies on the user text alone");
  }
  if (hasWorkbook && !input.primaryDocumentId) warnings.push("no primary document was designated; inputs are listed in ingestion order");
  contract.diagnostics.warnings = [...warnings, ...contributorWarnings];
  return contract;
}

/**
 * True when a user message should replace a workbook declaration rather than
 * merely accompany it. Used by callers that need the narrow decision without
 * compiling a whole contract.
 */
export function userOverridesWorkbook(hasWorkbook: boolean, userText: string): boolean {
  return hasWorkbook && userText.trim().length > 0;
}

/* ------------------------------------------------------------------ *
 * Requirement isolation (WB-06)
 * ------------------------------------------------------------------ */

export interface QuarantinedRequirement {
  kind: DeclarationKind;
  item: string;
  /** Documents whose sections disagree about this requirement. */
  document_ids: string[];
  /** Section ids that produced the conflict, so the reason is auditable. */
  section_ids: string[];
  /** Headings of the conflicting sections, when the extractor found one. */
  headings: string[];
  reason: string;
}

export interface RequirementIsolationView {
  /** Items inside conflicting sections: blocked until a human resolves them. */
  quarantined: QuarantinedRequirement[];
  /** Items outside every conflicting section: still representable/executable. */
  executable: QuarantinedRequirement[];
  /** Declaration items that could not be traced to a section (never assumed safe). */
  untraceable: QuarantinedRequirement[];
  /**
   * Conflicting sections that no declaration represents. These are blocked too
   * (they are conflicting source text), but they cannot be expressed as contract
   * items — reporting them keeps "only conflicting requirements are blocked"
   * honest instead of silently dropping them.
   */
  unrepresented_conflicts: { section_ids: string[]; headings: string[]; documents: string[]; similarity?: number }[];
  /** Diagnostic summaries that prove which sections conflict and where. */
  conflict_provenance: { kind: string; severity: string; similarity?: number; section_ids: string[]; headings: string[]; documents: string[] }[];
  /** False when no conflict was reported, so callers can state that plainly. */
  has_conflicts: boolean;
}

/** One conflicting or duplicate section pair, as role assignment reports it. */
export interface SectionConflictInput {
  kind: string;
  severity: "INFO" | "WARN" | "ERROR";
  similarity?: number;
  normalized_heading?: string;
  sections: { document_id: string; file_name: string; section_id: string; heading?: string; hash: string }[];
}

/**
 * Item-level requirement isolation (WB-06).
 *
 * A conflict is only ever claimed at section granularity by the role/conflict
 * pass, so this view quarantines exactly the declaration items whose text lives
 * inside a conflicting section and leaves every other item executable. An item
 * that cannot be traced back to a section is quarantined too — isolation is
 * never assumed just because provenance is missing.
 *
 * Deterministic and pure: it reads the compiled contract plus the conflict
 * diagnostics and never rewrites the contract.
 */
export function isolateRequirements(
  contract: CompiledTaskContract,
  documents: CanonicalTaskDocument[],
  conflicts: SectionConflictInput[]
): RequirementIsolationView {
  // Section ids are only unique WITHIN a document (every extractor numbers them
  // s1..sN), so provenance must always be the (document, section) pair. Keying
  // by section id alone would silently quarantine the wrong requirements.
  const sectionKey = (documentId: string, sectionId: string) => `${documentId}\u0000${sectionId}`;
  const sectionByKey = new Map<string, CanonicalSection>();
  for (const document of documents) {
    for (const section of document.sections) sectionByKey.set(sectionKey(document.id, section.id), section);
  }

  const conflicting = new Map<string, SectionConflictInput>();
  for (const conflict of conflicts) {
    if (conflict.kind !== "CONFLICTING_SECTION") continue;
    for (const section of conflict.sections) conflicting.set(sectionKey(section.document_id, section.section_id), conflict);
  }

  const quarantined: QuarantinedRequirement[] = [];
  const executable: QuarantinedRequirement[] = [];
  const untraceable: QuarantinedRequirement[] = [];
  /** Whitespace-folded containment test (never case), matching the conflict test. */
  const foldWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

  const declarations: ContractDeclaration[] = [
    ...contract.goal, ...contract.scope, ...contract.constraints, ...contract.dependencies,
    ...contract.deliverables, ...contract.acceptance_criteria, ...contract.risk, ...contract.permissions
  ];

  for (const declaration of declarations) {
    // Per-item provenance: a merged declaration may hold items from several
    // documents, and each item must be traced to the section that truly
    // contains it. Falls back to the declaration's own source only when the
    // declaration carries no per-item provenance.
    const provenanceFor = (item: string, index: number): ContractItemProvenance => {
      // Match on the item text first: provenance order is the merge order, and
      // an index lookup would attach the wrong source when items interleave.
      const byText = declaration.item_provenance?.find((entry) => entry.item === item);
      if (byText) return byText;
      const explicit = declaration.item_provenance?.[index];
      if (explicit) return explicit;
      const fallback: ContractItemProvenance = { item, source_document_id: declaration.source_document_id };
      if (declaration.source_section_id) fallback.source_section_id = declaration.source_section_id;
      if (declaration.heading) fallback.heading = declaration.heading;
      return fallback;
    };

    for (const [index, item] of declaration.items.entries()) {
      const provenance = provenanceFor(item, index);
      const sourceSection = provenance.source_section_id
        ? sectionByKey.get(sectionKey(provenance.source_document_id, provenance.source_section_id))
        : undefined;
      if (!sourceSection) {
        untraceable.push({ kind: declaration.kind, item, document_ids: [provenance.source_document_id], section_ids: [], headings: provenance.heading ? [provenance.heading] : [], reason: "item has no traceable source section" });
        continue;
      }
      const conflict = conflicting.get(sectionKey(provenance.source_document_id, sourceSection.id));
      if (conflict) {
        // The item lives inside a section the documents disagree about, so it is
        // blocked regardless of which half of that section it came from.
        quarantined.push({
          kind: declaration.kind,
          item,
          document_ids: [...new Set(conflict.sections.map((section) => section.document_id))],
          section_ids: conflict.sections.map((section) => section.section_id),
          headings: conflict.sections.map((section) => section.heading).filter((heading): heading is string => Boolean(heading)),
          reason: conflict.normalized_heading
            ? `"${conflict.normalized_heading}" disagrees across documents`
            : "source section disagrees across documents"
        });
        continue;
      }
      // An item that cannot be located inside its own section is untraceable.
      // Whitespace is folded (never case), matching the duplicate/conflict test.
      if (!foldWhitespace(sourceSection.text).includes(foldWhitespace(item))) {
        untraceable.push({ kind: declaration.kind, item, document_ids: [provenance.source_document_id], section_ids: [sourceSection.id], headings: sourceSection.heading ? [sourceSection.heading] : [], reason: "item text is not present in its source section" });
        continue;
      }
      // Extractors model a heading as its own section, so a body section often
      // has no heading of its own; the declaration's recorded heading is the
      // truthful label in that case.
      const heading = sourceSection.heading ?? provenance.heading;
      executable.push({ kind: declaration.kind, item, document_ids: [provenance.source_document_id], section_ids: [sourceSection.id], headings: heading ? [heading] : [], reason: "outside every conflicting section" });
    }
  }

  const conflictProvenance = conflicts
    .filter((conflict) => conflict.kind === "CONFLICTING_SECTION")
    .map((conflict) => {
      const entry: RequirementIsolationView["conflict_provenance"][number] = {
        kind: conflict.kind,
        severity: conflict.severity,
        section_ids: conflict.sections.map((section) => section.section_id),
        headings: conflict.sections.map((section) => section.heading).filter((heading): heading is string => Boolean(heading)),
        documents: conflict.sections.map((section) => section.file_name)
      };
      if (conflict.similarity !== undefined) entry.similarity = conflict.similarity;
      return entry;
    });

  // A conflicting section that no declaration maps to cannot be expressed as an
  // item. It is still blocked source text, so it is reported explicitly.
  const represented = new Set<string>();
  for (const declaration of declarations) {
    for (const provenance of declaration.item_provenance ?? []) {
      if (provenance.source_section_id) represented.add(sectionKey(provenance.source_document_id, provenance.source_section_id));
    }
    if (declaration.source_section_id) represented.add(sectionKey(declaration.source_document_id, declaration.source_section_id));
  }
  const unrepresented = conflicts
    .filter((conflict) => conflict.kind === "CONFLICTING_SECTION")
    .filter((conflict) => conflict.sections.every((section) => !represented.has(sectionKey(section.document_id, section.section_id))))
    .map((conflict) => {
      const entry: RequirementIsolationView["unrepresented_conflicts"][number] = {
        section_ids: conflict.sections.map((section) => section.section_id),
        headings: conflict.sections.map((section) => section.heading).filter((heading): heading is string => Boolean(heading)),
        documents: conflict.sections.map((section) => section.file_name)
      };
      if (conflict.similarity !== undefined) entry.similarity = conflict.similarity;
      return entry;
    });

  return {
    quarantined,
    executable,
    untraceable,
    unrepresented_conflicts: unrepresented,
    conflict_provenance: conflictProvenance,
    has_conflicts: conflictProvenance.length > 0
  };
}
