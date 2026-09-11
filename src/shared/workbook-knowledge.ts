/**
 * WorkBook knowledge seams (Work Unit 1). This is deliberately NOT a knowledge
 * base: it fixes the interfaces a later Knowledge
 * Intake / Store / Retrieval / Context Builder / Provenance / Validation stack
 * must satisfy, so WorkBook ingestion is already the canonical entry point and
 * the renderer/IPC unit can be wired against stable types. One deterministic
 * implementation of each port ships here so the pipeline is usable and
 * testable today.
 *
 * Kept separate from the pre-existing src/shared/knowledge.ts and
 * knowledge-governance.ts (entry-catalog governance) so no existing contract
 * changes shape: `KnowledgeEntry` keeps its meaning and this module speaks in
 * canonical WorkBook documents.
 *
 * Pure and shareable: no fs, no network, no model.
 */
import { classifyWorkBook, type CanonicalTaskDocument, type WorkBookVerdict } from "./workbook";

export type KnowledgeVisibility = "PRIVATE" | "CONVERSATION" | "WORKSPACE" | "SHARED";

export interface KnowledgeIntakeRules {
  /** Reject documents that fail validation instead of storing them. */
  failClosed: boolean;
  /** Keep the raw canonical document alongside extracted knowledge. */
  retainSource: boolean;
  maxDocumentBytes?: number;
  visibility?: KnowledgeVisibility;
}

export const DEFAULT_INTAKE_RULES: KnowledgeIntakeRules = { failClosed: false, retainSource: true, visibility: "CONVERSATION" };

export interface KnowledgeIntakeRequest {
  documents: CanonicalTaskDocument[];
  conversationId: string;
  workspacePath?: string;
  rules?: Partial<KnowledgeIntakeRules>;
}

export interface KnowledgeIntakeRecord {
  ids: string[];
  accepted: CanonicalTaskDocument[];
  rejected: { document_id: string; file_name: string; reasons: string[] }[];
}

/** Future: Knowledge Intake. Normalizes + validates before anything is stored. */
export interface KnowledgeIntake {
  intake(request: KnowledgeIntakeRequest): Promise<KnowledgeIntakeRecord>;
}

export interface KnowledgeItem {
  id: string;
  canonical_document_id: string;
  conversationId: string;
  workspacePath?: string;
  title: string;
  text: string;
  visibility: KnowledgeVisibility;
  /** Section ids that contributed to this item. */
  section_ids: string[];
  classification: WorkBookVerdict["kind"];
  createdAt: string;
}

export interface KnowledgeItemQuery {
  text?: string;
  conversationId?: string;
  workspacePath?: string;
  classification?: WorkBookVerdict["kind"];
  limit?: number;
  maxCharacters?: number;
}

/** Future: Knowledge Store. Durable, conversation/workspace scoped. */
export interface KnowledgeStorePort {
  put(items: KnowledgeItem[]): Promise<void>;
  get(id: string): Promise<KnowledgeItem | undefined>;
  list(filter?: Omit<KnowledgeItemQuery, "text">): Promise<KnowledgeItem[]>;
  delete(id: string): Promise<boolean>;
}

export interface RetrievalHit {
  item: KnowledgeItem;
  score: number;
  matchedTerms: string[];
}

export type RetrievalStrategyId = "LEXICAL" | "CLASSIFICATION_FIRST";

export interface RetrievalRequest extends KnowledgeItemQuery {
  /** Deterministic strategies only; a reranker is a later, separate port. */
  strategy?: RetrievalStrategyId;
}

export interface RetrievalResult {
  hits: RetrievalHit[];
  strategy: RetrievalStrategyId;
  characters: number;
  truncated: boolean;
}

/** Future: Retrieval. Pluggable so a reranker can be added without caller changes. */
export interface KnowledgeRetrieval {
  search(request: RetrievalRequest, items: KnowledgeItem[]): RetrievalResult;
}

export type ContextPurpose = "PLANNING" | "EXECUTION" | "ANSWER" | "VERIFICATION";

export interface ContextChunk {
  record_id: string;
  canonical_document_id: string;
  section_ids: string[];
  text: string;
  score: number;
}

/** Future: Provenance. Every chunk that reaches a provider carries one. */
export interface ProvenanceRecord {
  record_id: string;
  canonical_document_id: string;
  file_name: string;
  hash: string;
  section_ids: string[];
  /** 1-based revision of the logical workbook this content came from. */
  revision?: number;
  captured_at: string;
}

export interface ProviderContext {
  purpose: ContextPurpose;
  chunks: ContextChunk[];
  characters: number;
  provenance: ProvenanceRecord[];
  truncated: boolean;
}

export interface ContextBuildRequest {
  purpose: ContextPurpose;
  goal: string;
  documents: CanonicalTaskDocument[];
  characterBudget: number;
}

/** Future: Context Builder. Owns the budget and the provenance list. */
export interface ContextBuilder {
  build(request: ContextBuildRequest): ProviderContext;
}

export interface ProvenanceLookup {
  forRecord(recordId: string): ProvenanceRecord | undefined;
  forDocument(documentId: string): ProvenanceRecord[];
}

export type ValidationRuleId = "NON_EMPTY" | "HAS_SECTIONS" | "NO_SECRETS" | "CLASSIFIABLE" | "HASH_PRESENT" | "PROVENANCE_COMPLETE";

export interface ValidationDiagnostic {
  document_id: string;
  rule: ValidationRuleId;
  severity: "WARN" | "ERROR";
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  diagnostics: ValidationDiagnostic[];
}

/** Future: Validation. Runs before storage and again before context injection. */
export interface KnowledgeValidation {
  validate(documents: CanonicalTaskDocument[]): ValidationResult;
}

/* ------------------------------------------------------------------ *
 * Deterministic reference implementations (used today)
 * ------------------------------------------------------------------ */

const SECRET_SHAPE = /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,})\b/;
const REDACTION_MARKER = /\[REDACTED:[a-z-]+\]/;

export const DEFAULT_VALIDATION_RULES: readonly ValidationRuleId[] = ["NON_EMPTY", "HAS_SECTIONS", "NO_SECRETS", "HASH_PRESENT"];

export class DeterministicValidator implements KnowledgeValidation {
  constructor(private readonly rules: readonly ValidationRuleId[] = DEFAULT_VALIDATION_RULES) {}

  validate(documents: CanonicalTaskDocument[]): ValidationResult {
    const diagnostics: ValidationDiagnostic[] = [];
    for (const document of documents) {
      const push = (rule: ValidationRuleId, severity: ValidationDiagnostic["severity"], message: string) =>
        diagnostics.push({ document_id: document.id, rule, severity, message });
      if (this.rules.includes("NON_EMPTY") && (!document.content.trim() || document.byte_length === 0)) {
        push("NON_EMPTY", "ERROR", "document has no content");
      }
      if (this.rules.includes("HAS_SECTIONS") && !document.sections.length) {
        push("HAS_SECTIONS", "ERROR", "document has no sections");
      }
      if (this.rules.includes("NO_SECRETS")) {
        const tainted = document.sections.find((section) => SECRET_SHAPE.test(section.text));
        if (tainted) push("NO_SECRETS", "ERROR", `section ${tainted.id} still contains secret-shaped text`);
        else if (document.redactions.length) push("NO_SECRETS", "WARN", `${document.redactions.length} secret shape(s) were redacted before storage`);
      }
      if (this.rules.includes("HASH_PRESENT") && !/^[0-9a-f]{64}$/.test(document.hash)) {
        push("HASH_PRESENT", "ERROR", "document hash is not a sha256");
      }
      if (this.rules.includes("CLASSIFIABLE")) {
        const verdict = classifyWorkBook({ content: document.content, sections: document.sections });
        if (verdict.kind === "AMBIGUOUS") push("CLASSIFIABLE", "WARN", `classification is ambiguous (score ${verdict.score})`);
      }
      if (this.rules.includes("PROVENANCE_COMPLETE") && !document.source_input_id) {
        push("PROVENANCE_COMPLETE", "ERROR", "document has no source input id");
      }
    }
    return { ok: diagnostics.every((entry) => entry.severity !== "ERROR"), diagnostics };
  }
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) tokens.push(word);
  for (const cjk of text.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (cjk.length === 1) tokens.push(cjk);
    else for (let index = 0; index < cjk.length - 1; index++) tokens.push(cjk.slice(index, index + 2));
  }
  return tokens;
}

/** Deterministic lexical retrieval: term overlap over title + text, budgeted. */
export class LexicalRetrieval implements KnowledgeRetrieval {
  search(request: RetrievalRequest, items: KnowledgeItem[]): RetrievalResult {
    const strategy: RetrievalStrategyId = request.strategy ?? "LEXICAL";
    const terms = [...new Set(tokenize(request.text ?? ""))];
    const pool = items.filter((item) =>
      (request.conversationId === undefined || item.conversationId === request.conversationId)
      && (request.workspacePath === undefined || item.workspacePath === request.workspacePath)
      && (request.classification === undefined || item.classification === request.classification));

    const scored: RetrievalHit[] = pool.map((item) => {
      const haystack = new Set(tokenize(`${item.title}\n${item.text}`));
      const matchedTerms = terms.filter((term) => haystack.has(term));
      const titleTerms = new Set(tokenize(item.title));
      const titleBoost = terms.filter((term) => titleTerms.has(term)).length * 0.5;
      const classificationBonus = strategy === "CLASSIFICATION_FIRST" && request.classification === item.classification ? 0.25 : 0;
      return { item, score: matchedTerms.length + titleBoost + classificationBonus, matchedTerms };
    }).filter((hit) => hit.score > 0 || terms.length === 0);

    scored.sort((a, b) => (b.score - a.score) || a.item.id.localeCompare(b.item.id));
    const limit = request.limit ?? scored.length;
    const budget = request.maxCharacters ?? Number.POSITIVE_INFINITY;
    const hits: RetrievalHit[] = [];
    let characters = 0;
    for (const hit of scored.slice(0, limit)) {
      if (characters + hit.item.text.length > budget) continue;
      characters += hit.item.text.length;
      hits.push(hit);
    }
    return { hits, strategy, characters, truncated: hits.length < scored.length };
  }
}

/** In-memory store used by tests and by callers with no durable store yet. */
export class InMemoryKnowledgeStore implements KnowledgeStorePort {
  private readonly items = new Map<string, KnowledgeItem>();

  async put(items: KnowledgeItem[]): Promise<void> {
    for (const item of items) {
      if (!item.id?.trim()) throw new Error("Knowledge item requires an id");
      if (!item.canonical_document_id?.trim()) throw new Error("Knowledge item requires a canonical document id");
      this.items.set(item.id, { ...item, section_ids: [...item.section_ids] });
    }
  }

  async get(id: string): Promise<KnowledgeItem | undefined> {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  async list(filter: Omit<KnowledgeItemQuery, "text"> = {}): Promise<KnowledgeItem[]> {
    return [...this.items.values()].filter((item) =>
      (filter.conversationId === undefined || item.conversationId === filter.conversationId)
      && (filter.workspacePath === undefined || item.workspacePath === filter.workspacePath)
      && (filter.classification === undefined || item.classification === filter.classification));
  }

  async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }
}

/** Provenance index over canonical documents; the source of truth for citations. */
export class DocumentProvenanceIndex implements ProvenanceLookup {
  private readonly byDocument = new Map<string, ProvenanceRecord>();
  private readonly byRecord = new Map<string, ProvenanceRecord>();

  constructor(documents: CanonicalTaskDocument[] = [], revisions: Record<string, number> = {}) {
    for (const document of documents) this.add(document, revisions[document.id]);
  }

  add(document: CanonicalTaskDocument, revision?: number): ProvenanceRecord {
    const record: ProvenanceRecord = {
      record_id: `prov-${document.hash.slice(0, 16)}`,
      canonical_document_id: document.id,
      file_name: document.file_name,
      hash: document.hash,
      section_ids: document.sections.map((section) => section.id),
      captured_at: document.created_at
    };
    if (revision !== undefined) record.revision = revision;
    this.byDocument.set(document.id, record);
    this.byRecord.set(record.record_id, record);
    return record;
  }

  forRecord(recordId: string): ProvenanceRecord | undefined {
    return this.byRecord.get(recordId);
  }

  forDocument(documentId: string): ProvenanceRecord[] {
    const record = this.byDocument.get(documentId);
    return record ? [record] : [];
  }
}

/**
 * Deterministic context builder: whole sections under a character budget, with
 * provenance for every chunk. It never rewrites or summarizes content.
 */
export class DeterministicContextBuilder implements ContextBuilder {
  constructor(private readonly provenance: ProvenanceLookup = new DocumentProvenanceIndex()) {}

  build(request: ContextBuildRequest): ProviderContext {
    const chunks: ContextChunk[] = [];
    const provenance: ProvenanceRecord[] = [];
    const goalTerms = new Set(tokenize(request.goal));
    let characters = 0;
    let truncated = false;

    for (const document of request.documents) {
      const record = this.provenance.forDocument(document.id)[0];
      for (const section of document.sections) {
        const text = section.text.trim();
        if (!text) continue;
        if (characters + text.length > request.characterBudget) { truncated = true; continue; }
        const overlap = tokenize(text).filter((term) => goalTerms.has(term)).length;
        chunks.push({
          record_id: record?.record_id ?? `prov-unindexed-${document.id}`,
          canonical_document_id: document.id,
          section_ids: [section.id],
          text,
          score: overlap
        });
        characters += text.length;
      }
      if (record) provenance.push(record);
    }
    chunks.sort((a, b) => (b.score - a.score) || a.canonical_document_id.localeCompare(b.canonical_document_id));
    return { purpose: request.purpose, chunks, characters, provenance, truncated };
  }
}

/** Deterministic intake: validate, then map documents to storeable items. */
export class DeterministicKnowledgeIntake implements KnowledgeIntake {
  constructor(private readonly validator: KnowledgeValidation = new DeterministicValidator()) {}

  async intake(request: KnowledgeIntakeRequest): Promise<KnowledgeIntakeRecord> {
    const rules = { ...DEFAULT_INTAKE_RULES, ...request.rules };
    const validation = this.validator.validate(request.documents);
    const rejected: KnowledgeIntakeRecord["rejected"] = [];
    const accepted: CanonicalTaskDocument[] = [];
    const ids: string[] = [];
    for (const document of request.documents) {
      const errors = validation.diagnostics.filter((entry) => entry.document_id === document.id && entry.severity === "ERROR");
      if (errors.length && rules.failClosed) {
        rejected.push({ document_id: document.id, file_name: document.file_name, reasons: errors.map((entry) => `${entry.rule}: ${entry.message}`) });
        continue;
      }
      accepted.push(document);
      ids.push(`kb-${document.hash.slice(0, 16)}`);
    }
    return { ids, accepted, rejected };
  }
}

/** Maps an accepted canonical document to a storeable knowledge item. */
export function knowledgeItemFrom(document: CanonicalTaskDocument, conversationId: string, workspacePath?: string): KnowledgeItem {
  const verdict = classifyWorkBook({ content: document.content, sections: document.sections });
  const item: KnowledgeItem = {
    id: `kb-${document.hash.slice(0, 16)}`,
    canonical_document_id: document.id,
    conversationId,
    title: document.title,
    text: document.content,
    visibility: DEFAULT_INTAKE_RULES.visibility ?? "CONVERSATION",
    section_ids: document.sections.map((section) => section.id),
    classification: verdict.kind,
    createdAt: document.created_at
  };
  if (workspacePath) item.workspacePath = workspacePath;
  return item;
}

/** Shared marker helper so callers can assert redaction without re-deriving it. */
export function hasRedactionMarker(text: string): boolean {
  return REDACTION_MARKER.test(text);
}
