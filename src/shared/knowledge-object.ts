/**
 * Update-Plan/checkpoint-1.md §5 — the unified Knowledge Object model.
 *
 * §5.1 asks for ONE knowledge record type with `id, type, scope, source,
 * content, summary, provenance, confidence, authority, freshness, createdAt,
 * updatedAt` and a fixed type vocabulary. §5.2–§5.5 ask for provenance, a write
 * gate, non-destructive conflict handling and task-aware retrieval — all of
 * which live here as pure, deterministic functions so the same rules run in the
 * host, in tests and in any future node.
 *
 * Relationship to the pre-existing knowledge modules (there are several, none of
 * them wired into the app — see docs/checkpoint-2-knowledge-foundation.md):
 *
 *   - `KnowledgeScope` is reused verbatim from src/shared/tenx/knowledge.ts, and
 *     lexical similarity reuses its `tokenSimilarity`, so this module does not
 *     introduce a fifth tokenizer;
 *   - `KnowledgeTrust` (src/shared/knowledge.ts) is a *catalog* trust label and
 *     is deliberately NOT reused: §5.1 needs an authority + a verification
 *     state, which are different questions ("who is allowed to assert this?"
 *     vs "how much do we believe it?"). `KnowledgeAuthority` is the new name so
 *     nothing collides with `ContractAuthority`, `RootAuthority` or the
 *     `authority` field on WorkBook contract declarations.
 *
 * Nothing here reads the clock except through an injected `now`, nothing here
 * touches the filesystem, and nothing here calls a model: a fact only becomes
 * knowledge when the host can point at the bytes it came from.
 */
import { scanSecrets } from "./secret-scan";
import { structuralHashOf, type TaskFingerprint } from "./task-fingerprint";
import { tokenSimilarity, type KnowledgeScope, type TemporalValidity } from "./tenx/knowledge";
import { contentHashOf } from "./workbook";

/* ------------------------------------------------------------------ *
 * §5.1 Vocabulary
 * ------------------------------------------------------------------ */

export const KNOWLEDGE_TYPES = [
  "ARCHITECTURE",
  "REQUIREMENT",
  "DECISION",
  "CONSTRAINT",
  "BUG",
  "FIX",
  "TEST",
  "BENCHMARK",
  "PROVIDER",
  "WORKFLOW",
  "RESEARCH",
  "USER_OVERRIDE",
  "CAPABILITY_GAP",
  "UI_SURFACE",
  "UI_CONTRACT",
  "THEME",
  "THEME_VALIDATION"
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

/** Who is allowed to assert a fact. Higher rank wins a conflict of substance. */
export const KNOWLEDGE_AUTHORITIES = ["OWNER", "WORKBOOK", "VERIFIED_HOST", "HOST", "REVIEWER", "MODEL", "INFERRED"] as const;
export type KnowledgeAuthority = (typeof KNOWLEDGE_AUTHORITIES)[number];

export const KNOWLEDGE_AUTHORITY_RANK: Record<KnowledgeAuthority, number> = {
  OWNER: 6,
  WORKBOOK: 5,
  VERIFIED_HOST: 4,
  HOST: 3,
  REVIEWER: 2,
  MODEL: 1,
  INFERRED: 0
};

/**
 * Who produced the candidate. `MODEL` is the only class that cannot certify
 * itself (§5.2: a model claim is never its own proof); it must arrive with an
 * independent `VERIFIED` state and evidence, or it is quarantined.
 */
export type KnowledgeProducerKind = "HUMAN" | "VERIFICATION" | "DETERMINISTIC_HOST" | "MODEL";
export const KNOWLEDGE_PRODUCER_KINDS: readonly KnowledgeProducerKind[] = ["HUMAN", "VERIFICATION", "DETERMINISTIC_HOST", "MODEL"];

export type KnowledgeVerificationState = "VERIFIED" | "UNVERIFIED" | "CONTRADICTED";

/** §5.4 conflict outcome. `ACTIVE` may also mean "resolved by supersede". */
export type KnowledgeStatus = "ACTIVE" | "SUPERSEDED" | "UNRESOLVED";

/** §5.3 write-gate outcome. */
export type KnowledgeWriteOutcome = "ACCEPT" | "REJECT" | "QUARANTINE" | "SUPERSEDE";
export const KNOWLEDGE_WRITE_OUTCOMES: readonly KnowledgeWriteOutcome[] = ["ACCEPT", "REJECT", "QUARANTINE", "SUPERSEDE"];

/* ------------------------------------------------------------------ *
 * §5.1 / §5.2 Record
 * ------------------------------------------------------------------ */

export interface KnowledgeObjectProvenance {
  /** Human-readable origin, e.g. `workbook:spec.md#goal` or `repo-scan:<sha>`. */
  source: string;
  /** sha256 of the exact bytes this fact was read from. Never optional. */
  source_hash: string;
  document_ref?: string;
  task_ref?: string;
  run_ref?: string;
  /** When the host observed the fact (not when it was written). */
  captured_at: string;
  producer: KnowledgeProducerKind;
  /** Concrete producer id, e.g. `codex-boss/workbook-intake@1`. */
  produced_by: string;
  verification: KnowledgeVerificationState;
  verification_evidence: string[];
}

export interface KnowledgeObject {
  id: string;
  type: KnowledgeType;
  scope: KnowledgeScope;
  /** Short normalized identity: same scope+type+subject ⇒ same fact. */
  subject: string;
  /** Conflict identity = scope + type + subject. */
  key: string;
  source: string;
  content: string;
  summary: string;
  provenance: KnowledgeObjectProvenance;
  confidence: number;
  authority: KnowledgeAuthority;
  freshness: string;
  status: KnowledgeStatus;
  supersedes?: string;
  conflict_set?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Optional temporal bounds carried by the existing vNext vocabulary. */
  validity?: TemporalValidity;
}

/** A proposed fact before the gate decides what may be stored. */
export interface KnowledgeCandidate {
  type: KnowledgeType;
  scope: KnowledgeScope;
  subject: string;
  source: string;
  source_hash: string;
  content: string;
  summary: string;
  document_ref?: string;
  task_ref?: string;
  run_ref?: string;
  captured_at: string;
  producer: KnowledgeProducerKind;
  produced_by: string;
  verification: KnowledgeVerificationState;
  verification_evidence?: string[];
  confidence: number;
  authority: KnowledgeAuthority;
  freshness: string;
  validity?: TemporalValidity;
  /** Explicit supersede request (e.g. an AMENDED WorkBook revision). */
  supersedes?: string;
}

export const KNOWLEDGE_CONTENT_LIMIT = 8000;

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

function normalizeSubject(subject: string): string {
  return subject.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function knowledgeKeyFor(input: { scope: KnowledgeScope; type: KnowledgeType; subject: string }): string {
  return `${input.scope}|${input.type}|${normalizeSubject(input.subject)}`;
}

/** Content-addressed id: knowledge identity is content, never a local path (§49). */
export function knowledgeIdFor(candidate: Pick<KnowledgeCandidate, "scope" | "type" | "subject" | "content" | "source_hash">): string {
  return `ko-${contentHashOf([candidate.scope, candidate.type, normalizeSubject(candidate.subject), candidate.source_hash, candidate.content].join("\u0000")).slice(0, 32)}`;
}

/** Deterministic ISO comparison that tolerates unparseable values. */
function timeOf(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ------------------------------------------------------------------ *
 * §5.3 Knowledge Write Gate
 * ------------------------------------------------------------------ */

export type KnowledgeGatePhaseName = "PROVENANCE" | "CONSISTENCY" | "AUTHORITY" | "VERIFICATION" | "GATE";

export interface KnowledgeGatePhase {
  phase: KnowledgeGatePhaseName;
  ok: boolean;
  detail: string;
}

export interface KnowledgeWriteGateResult {
  outcome: KnowledgeWriteOutcome;
  phases: KnowledgeGatePhase[];
  reasons: string[];
  /** For SUPERSEDE: the active object this candidate replaces. */
  supersedes?: string;
  /** For QUARANTINE: the active object(s) this candidate contradicts. */
  conflicts_with: string[];
  /** Materialized object for ACCEPT/SUPERSEDE. */
  object?: KnowledgeObject;
  /** True when an identical fact is already ACTIVE and nothing new is stored. */
  deduplicated: boolean;
}

export interface KnowledgeWriteGateOptions {
  now?: string;
  /** Producer id recorded when the caller did not supply one. */
  producerId?: string;
}

/**
 * §5.3: candidate → provenance → consistency → authority → verification → gate.
 *
 * Fail closed at every phase: an incomplete provenance is REJECTed (never
 * stored), a self-certified model claim is QUARANTINEd, and a weaker claim
 * never overwrites a stronger active one — it is QUARANTINEd with an explicit
 * conflict set instead (§5.4).
 */
export function gateKnowledgeWrite(
  candidate: KnowledgeCandidate,
  existing: readonly KnowledgeObject[],
  options: KnowledgeWriteGateOptions = {}
): KnowledgeWriteGateResult {
  const now = options.now ?? candidate.captured_at;
  const phases: KnowledgeGatePhase[] = [];
  const reasons: string[] = [];
  const record = (phase: KnowledgeGatePhaseName, ok: boolean, detail: string): void => {
    phases.push({ phase, ok, detail });
    if (!ok) reasons.push(`${phase}: ${detail}`);
  };
  const reject = (): KnowledgeWriteGateResult => ({ outcome: "REJECT", phases, reasons, conflicts_with: [], deduplicated: false });
  const quarantine = (detail: string, conflictsWith: string[]): KnowledgeWriteGateResult => {
    reasons.push(detail);
    return { outcome: "QUARANTINE", phases, reasons, conflicts_with: conflictsWith, deduplicated: false };
  };

  /* Phase 1 — provenance (§5.2: no source ⇒ no knowledge). */
  const evidence = candidate.verification_evidence ?? [];
  const provenanceMissing = [
    !candidate.source?.trim() ? "source" : "",
    !/^[0-9a-f]{64}$/.test(candidate.source_hash ?? "") ? "source_hash(sha256)" : "",
    !candidate.captured_at || !Number.isFinite(Date.parse(candidate.captured_at)) ? "captured_at" : "",
    !KNOWLEDGE_PRODUCER_KINDS.includes(candidate.producer) ? "producer" : "",
    !candidate.produced_by?.trim() ? "produced_by" : "",
    !candidate.document_ref && !candidate.task_ref && !candidate.run_ref ? "document/task/run ref" : "",
    !candidate.scope?.trim() ? "scope" : ""
  ].filter(Boolean);
  if (provenanceMissing.length) {
    record("PROVENANCE", false, `missing ${provenanceMissing.join(", ")} — knowledge without a source is refused (§5.2)`);
    return reject();
  }
  record("PROVENANCE", true, `source=${candidate.source} hash=${candidate.source_hash.slice(0, 12)}… producer=${candidate.producer}`);

  /* Phase 2 — consistency. */
  const consistencyProblems = [
    !KNOWLEDGE_TYPES.includes(candidate.type) ? `unknown type ${String(candidate.type)}` : "",
    !candidate.content?.trim() ? "empty content" : "",
    !candidate.summary?.trim() ? "empty summary" : "",
    !candidate.subject?.trim() ? "empty subject" : "",
    (candidate.content ?? "").length > KNOWLEDGE_CONTENT_LIMIT ? `content exceeds ${KNOWLEDGE_CONTENT_LIMIT} characters` : "",
    !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1 ? "confidence must be within [0,1]" : "",
    !KNOWLEDGE_AUTHORITIES.includes(candidate.authority) ? `unknown authority ${String(candidate.authority)}` : ""
  ].filter(Boolean);
  if (consistencyProblems.length) {
    record("CONSISTENCY", false, consistencyProblems.join("; "));
    return reject();
  }
  const secretHits = scanSecrets([candidate.subject, candidate.summary, candidate.content].join("\n"));
  if (secretHits.length) {
    record("CONSISTENCY", false, `${secretHits.length} secret-shaped value(s) — knowledge never stores credentials (§50)`);
    return reject();
  }
  record("CONSISTENCY", true, "type/subject/content/confidence consistent and secret-free");

  /* Phase 3 — authority. */
  if (candidate.producer === "MODEL" && candidate.verification !== "VERIFIED" && KNOWLEDGE_AUTHORITY_RANK[candidate.authority] <= KNOWLEDGE_AUTHORITY_RANK.MODEL) {
    record("AUTHORITY", false, "a model-produced claim cannot certify itself (§5.2)");
    return quarantine("model claim is not independently verified and cannot become active knowledge", []);
  }
  record("AUTHORITY", true, `authority=${candidate.authority} producer=${candidate.producer}`);

  /* Phase 4 — verification. */
  if (candidate.verification === "CONTRADICTED") {
    record("VERIFICATION", false, "candidate is contradicted by existing evidence");
    return reject();
  }
  if (candidate.verification === "VERIFIED" && evidence.length === 0) {
    record("VERIFICATION", false, "a VERIFIED candidate must cite its verification evidence");
    return reject();
  }
  record("VERIFICATION", true, candidate.verification === "VERIFIED" ? `verified by ${evidence.length} evidence pointer(s)` : "explicitly unverified");

  /* Phase 5 — gate: identity, idempotence, authority comparison. */
  const key = knowledgeKeyFor(candidate);
  const active = existing.filter((object) => object.key === key && object.status === "ACTIVE");
  const id = knowledgeIdFor(candidate);
  if (!active.length) {
    record("GATE", true, "no active knowledge for this key — accepted");
    return { outcome: "ACCEPT", phases, reasons, conflicts_with: [], object: materialize(candidate, { id, key, now, version: 1 }), deduplicated: false };
  }

  // Deduplication is exact: same bytes AND same standing. Identical text at a
  // higher authority is a real upgrade of the record (it changes who asserts the
  // fact), so it falls through to the authority comparison below.
  const identical = active.find((object) =>
    object.provenance.source_hash === candidate.source_hash
    && object.content === candidate.content
    && object.authority === candidate.authority
    && object.provenance.verification === candidate.verification);
  if (identical) {
    record("GATE", true, `identical fact already ACTIVE as ${identical.id} — nothing stored`);
    return { outcome: "ACCEPT", phases, reasons: [...reasons, "identical knowledge already active (deduplicated)"], conflicts_with: [], object: identical, deduplicated: true };
  }

  const strongest = strongestActive(active);
  const requested = candidate.supersedes ? active.find((object) => object.id === candidate.supersedes) : undefined;
  const comparison = compareCandidateToActive(candidate, strongest);
  // An explicit supersede is a host/owner decision (an AMENDED WorkBook revision
  // replacing its predecessor), so it can pick its target — but it can never let
  // a strictly weaker claim overwrite a stronger one. That is what keeps the
  // "never overwrite" rule independent of who set `supersedes`.
  if (comparison > 0 || (requested !== undefined && comparison === 0)) {
    const target = comparison > 0 ? strongest : requested!;
    record("GATE", true, `candidate is stronger than ${target.id} (${comparison > 0 ? "authority/verification/freshness" : "explicit supersede at equal strength"}) — supersede`);
    return {
      outcome: "SUPERSEDE",
      phases,
      reasons,
      supersedes: target.id,
      conflicts_with: active.map((object) => object.id),
      object: materialize(candidate, { id, key, now, version: target.version + 1, supersedes: target.id }),
      deduplicated: false
    };
  }
  if (comparison < 0) {
    record("GATE", false, `candidate is weaker than active ${strongest.id} — quarantined, active knowledge untouched`);
    return quarantine("a lower-authority/unverified/older claim cannot overwrite active knowledge", active.map((object) => object.id));
  }
  record("GATE", false, `candidate conflicts with active ${strongest.id} at equal strength — UNRESOLVED`);
  return quarantine("equal-strength contradiction: recorded as an unresolved conflict, nothing overwritten", active.map((object) => object.id));
}

function materialize(
  candidate: KnowledgeCandidate,
  input: { id: string; key: string; now: string; version: number; supersedes?: string }
): KnowledgeObject {
  const object: KnowledgeObject = {
    id: input.id,
    type: candidate.type,
    scope: candidate.scope,
    subject: normalizeSubject(candidate.subject),
    key: input.key,
    source: candidate.source,
    content: candidate.content,
    summary: candidate.summary,
    provenance: {
      source: candidate.source,
      source_hash: candidate.source_hash,
      captured_at: candidate.captured_at,
      producer: candidate.producer,
      produced_by: candidate.produced_by,
      verification: candidate.verification,
      verification_evidence: [...(candidate.verification_evidence ?? [])]
    },
    confidence: candidate.confidence,
    authority: candidate.authority,
    freshness: candidate.freshness,
    status: "ACTIVE",
    version: input.version,
    createdAt: input.now,
    updatedAt: input.now
  };
  if (candidate.document_ref) object.provenance.document_ref = candidate.document_ref;
  if (candidate.task_ref) object.provenance.task_ref = candidate.task_ref;
  if (candidate.run_ref) object.provenance.run_ref = candidate.run_ref;
  if (input.supersedes) object.supersedes = input.supersedes;
  if (candidate.validity) object.validity = { ...candidate.validity };
  return object;
}

/**
 * Positive when the candidate is strictly stronger than `active`, negative when
 * strictly weaker, zero when the two are indistinguishable on authority,
 * verification and freshness (§5.4 — that tie is UNRESOLVED, not a coin flip).
 */
export function compareCandidateToActive(candidate: KnowledgeCandidate, active: KnowledgeObject): number {
  const authority = KNOWLEDGE_AUTHORITY_RANK[candidate.authority] - KNOWLEDGE_AUTHORITY_RANK[active.authority];
  if (authority !== 0) return Math.sign(authority);
  const verification = verificationRank(candidate.verification) - verificationRank(active.provenance.verification);
  if (verification !== 0) return Math.sign(verification);
  const freshness = timeOf(candidate.freshness) - timeOf(active.freshness);
  if (freshness !== 0) return Math.sign(freshness);
  return 0;
}

function verificationRank(state: KnowledgeVerificationState): number {
  return state === "VERIFIED" ? 2 : state === "UNVERIFIED" ? 1 : 0;
}

/** The active object a candidate would have to beat: strongest wins the slot. */
function strongestActive(active: readonly KnowledgeObject[]): KnowledgeObject {
  return [...active].sort((left, right) =>
    KNOWLEDGE_AUTHORITY_RANK[right.authority] - KNOWLEDGE_AUTHORITY_RANK[left.authority]
    || verificationRank(right.provenance.verification) - verificationRank(left.provenance.verification)
    || timeOf(right.freshness) - timeOf(left.freshness)
    || left.id.localeCompare(right.id))[0];
}

/* ------------------------------------------------------------------ *
 * §5.4 Conflict handling
 * ------------------------------------------------------------------ */

export interface KnowledgeConflictMember {
  object_id: string;
  scope: KnowledgeScope;
  type: KnowledgeType;
  subject: string;
  authority: KnowledgeAuthority;
  freshness: string;
  source: string;
  source_hash: string;
  verification: KnowledgeVerificationState;
  summary: string;
  content: string;
}

export interface KnowledgeConflictSet {
  id: string;
  key: string;
  scope: KnowledgeScope;
  type: KnowledgeType;
  subject: string;
  members: KnowledgeConflictMember[];
  resolution: KnowledgeStatus;
  winner_id?: string;
  superseded_ids: string[];
  reasons: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeConflictResolution {
  resolution: KnowledgeStatus;
  winner_id?: string;
  superseded_ids: string[];
  reasons: string[];
  statuses: Record<string, KnowledgeStatus>;
}

export function conflictMemberFor(object: KnowledgeObject): KnowledgeConflictMember {
  return {
    object_id: object.id,
    scope: object.scope,
    type: object.type,
    subject: object.subject,
    authority: object.authority,
    freshness: object.freshness,
    source: object.source,
    source_hash: object.provenance.source_hash,
    verification: object.provenance.verification,
    summary: object.summary,
    content: object.content
  };
}

export function conflictSetIdFor(key: string): string {
  return `kc-${structuralHashOf([key]).padStart(8, "0")}`;
}

/**
 * §5.4: a conflict never overwrites. The set records authority, freshness,
 * source and validation for every claim and then decides ACTIVE / SUPERSEDED /
 * UNRESOLVED. An explicit supersede edge wins; otherwise authority, then
 * verification, then freshness; a tie is UNRESOLVED and stays visible.
 */
export function resolveKnowledgeConflict(
  set: Pick<KnowledgeConflictSet, "key" | "members">,
  now: string
): KnowledgeConflictResolution {
  const members = [...set.members];
  if (!members.length) return { resolution: "UNRESOLVED", superseded_ids: [], reasons: ["conflict set has no members"], statuses: {} };
  if (members.length === 1) {
    return { resolution: "ACTIVE", winner_id: members[0].object_id, superseded_ids: [], reasons: ["single member"], statuses: { [members[0].object_id]: "ACTIVE" } };
  }
  const ordered = [...members].sort((left, right) => {
    const authority = KNOWLEDGE_AUTHORITY_RANK[right.authority] - KNOWLEDGE_AUTHORITY_RANK[left.authority];
    if (authority !== 0) return authority;
    const verification = verificationRank(right.verification) - verificationRank(left.verification);
    if (verification !== 0) return verification;
    const freshness = timeOf(right.freshness) - timeOf(left.freshness);
    if (freshness !== 0) return freshness;
    return left.object_id.localeCompare(right.object_id);
  });
  const winner = ordered[0];
  const runnerUp = ordered[1];
  const tied = runnerUp !== undefined
    && KNOWLEDGE_AUTHORITY_RANK[winner.authority] === KNOWLEDGE_AUTHORITY_RANK[runnerUp.authority]
    && winner.verification === runnerUp.verification
    && timeOf(winner.freshness) === timeOf(runnerUp.freshness);
  if (tied) {
    const statuses: Record<string, KnowledgeStatus> = {};
    for (const member of members) statuses[member.object_id] = "UNRESOLVED";
    return {
      resolution: "UNRESOLVED",
      superseded_ids: [],
      reasons: [`${members.length} equal-strength claims tie on authority, verification and freshness`, `recorded at ${now}`],
      statuses
    };
  }
  const statuses: Record<string, KnowledgeStatus> = {};
  const superseded: string[] = [];
  for (const member of members) {
    if (member.object_id === winner.object_id) { statuses[member.object_id] = "ACTIVE"; continue; }
    statuses[member.object_id] = "SUPERSEDED";
    superseded.push(member.object_id);
  }
  return {
    resolution: "ACTIVE",
    winner_id: winner.object_id,
    superseded_ids: superseded,
    reasons: [`authority ${winner.authority} / verification ${winner.verification} / freshness ${winner.freshness} wins`, `losers retained as SUPERSEDED (never deleted)`],
    statuses
  };
}

/* ------------------------------------------------------------------ *
 * §5.5 Task-aware retrieval
 * ------------------------------------------------------------------ */

/**
 * Which knowledge types a task shape actually wants. This is §5.5's "relevant
 * knowledge objects" step: a type with weight 0 is not offered to the task at
 * all, which is what keeps an unrelated project fact out of a prompt. Ordering
 * among the offered types is still authority → freshness → relevance, exactly as
 * §5.5 lists it, so a weight is a filter, never a hidden ranking.
 */
export function knowledgeTypeWeights(fingerprint: TaskFingerprint): Record<KnowledgeType, number> {
  const weights = Object.fromEntries(KNOWLEDGE_TYPES.map((type) => [type, 0])) as Record<KnowledgeType, number>;
  const capabilities = new Set((fingerprint.capabilities ?? []).map((item) => item.toLocaleLowerCase()));
  const modalities = new Set((fingerprint.modality ?? []).map((item) => item.toLocaleLowerCase()));
  const concepts = new Set((fingerprint.concepts ?? []).map((concept) => concept.conceptId.toLocaleLowerCase()));
  const wants = (...values: string[]): boolean => values.some((value) => capabilities.has(value) || modalities.has(value) || concepts.has(value));
  const role = fingerprint.role.toLocaleLowerCase();

  // Owner statements and standing constraints are relevant to every task.
  weights.USER_OVERRIDE = 4;
  weights.CONSTRAINT = 3;
  weights.CAPABILITY_GAP = 2;
  weights.DECISION = 2;
  weights.REQUIREMENT = 2;
  weights.PROVIDER = 1;

  if (wants("code", "coding", "file", "refactor", "implement", "verification") || /cod|implement|engineer/.test(role)) {
    weights.ARCHITECTURE = 3;
    weights.TEST = 3;
    weights.BUG = 2;
    weights.FIX = 2;
    weights.WORKFLOW = 2;
    weights.BENCHMARK = 1;
  }
  if (wants("research", "text", "answer") || /research|review|synth/.test(role)) {
    weights.RESEARCH = 3;
    weights.BENCHMARK = 2;
    weights.WORKFLOW = 1;
  }
  if (wants("ui", "theme", "frontend", "visual", "css", "web")) {
    weights.UI_SURFACE = 3;
    weights.UI_CONTRACT = 2;
    weights.THEME = 2;
    weights.THEME_VALIDATION = 2;
  }
  return weights;
}

export interface KnowledgeRankingStep {
  object_id: string;
  type: KnowledgeType;
  authority: KnowledgeAuthority;
  authority_rank: number;
  freshness: string;
  relevance: number;
  type_weight: number;
  selected: boolean;
  reason: string;
}

export interface KnowledgeRetrievalRequest {
  fingerprint: TaskFingerprint;
  /** The task's own goal text; used for the semantic half of the ranking. */
  goal: string;
  objects: readonly KnowledgeObject[];
  characterBudget: number;
  maxObjects?: number;
  /** Restrict to one scope (plus `global`) — how a project reuses its own facts. */
  scope?: KnowledgeScope;
  /** Objects produced by this task are excluded: a task never cites itself. */
  excludeTaskRef?: string;
  now?: string;
}

export interface KnowledgeRetrievalResult {
  selected: KnowledgeObject[];
  characters: number;
  budget: number;
  truncated: boolean;
  dropped: number;
  /** Active in-scope objects whose TYPE this task shape does not ask for. */
  not_offered: number;
  ranking: KnowledgeRankingStep[];
  scopes: string[];
  types: Partial<Record<KnowledgeType, number>>;
}

/**
 * §5.5: task → fingerprint → relevant objects → authority → freshness →
 * semantic relevance → context budget. The whole knowledge base can never reach
 * a prompt: the character budget and the object cap are hard limits, and every
 * candidate's fate is recorded so the caller can prove what was dropped.
 */
export function selectKnowledgeForTask(request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult {
  const budget = Math.max(0, request.characterBudget);
  const maxObjects = Math.max(0, request.maxObjects ?? 12);
  const weights = knowledgeTypeWeights(request.fingerprint);

  const inScope = request.objects.filter((object) => {
    if (object.status !== "ACTIVE") return false;
    if (request.scope && object.scope !== request.scope && object.scope !== "global") return false;
    if (request.excludeTaskRef && object.provenance.task_ref === request.excludeTaskRef) return false;
    return true;
  });

  const candidates = inScope.map((object) => {
    const relevance = Number(tokenSimilarity(`${object.subject} ${object.summary}`, request.goal).toFixed(4));
    return { object, relevance, authorityRank: KNOWLEDGE_AUTHORITY_RANK[object.authority], typeWeight: weights[object.type], offered: weights[object.type] > 0 };
  });

  // §5.5 ordering is explicit: authority first, then freshness, then semantic
  // relevance. The id is the final tiebreak so the result is reproducible.
  const specOrder = (left: typeof candidates[number], right: typeof candidates[number]): number =>
    right.authorityRank - left.authorityRank
    || timeOf(right.object.freshness) - timeOf(left.object.freshness)
    || right.relevance - left.relevance
    || left.object.id.localeCompare(right.object.id);
  const offered = candidates.filter((entry) => entry.offered).sort(specOrder);
  const notOffered = candidates.filter((entry) => !entry.offered).sort((left, right) => left.object.id.localeCompare(right.object.id));

  const ranking: KnowledgeRankingStep[] = [];
  const selected: KnowledgeObject[] = [];
  const types: Partial<Record<KnowledgeType, number>> = {};
  const scopes = new Set<string>();
  let characters = 0;
  let truncated = false;

  for (const entry of [...offered, ...notOffered]) {
    const length = entry.object.summary.length + entry.object.content.length;
    const reasons: string[] = [];
    let ok = false;
    if (!entry.offered) {
      reasons.push(`type ${entry.object.type} is not offered to this task shape`);
    } else if (selected.length >= maxObjects) {
      reasons.push(`object cap ${maxObjects} reached`);
      truncated = true;
    } else if (characters + length > budget) {
      reasons.push(`character budget ${budget} would be exceeded`);
      truncated = true;
    } else {
      ok = true;
      selected.push(entry.object);
      characters += length;
      scopes.add(entry.object.scope);
      types[entry.object.type] = (types[entry.object.type] ?? 0) + 1;
      reasons.push(`authority ${entry.object.authority} (${entry.authorityRank}) + freshness ${entry.object.freshness.slice(0, 10)} + relevance ${entry.relevance}`);
    }
    ranking.push({
      object_id: entry.object.id,
      type: entry.object.type,
      authority: entry.object.authority,
      authority_rank: entry.authorityRank,
      freshness: entry.object.freshness,
      relevance: entry.relevance,
      type_weight: entry.typeWeight,
      selected: ok,
      reason: reasons.join("; ")
    });
  }

  return {
    selected,
    characters,
    budget,
    truncated,
    dropped: offered.length - selected.length,
    not_offered: notOffered.length,
    ranking,
    scopes: [...scopes].sort(),
    types
  };
}

/**
 * Renders the bounded knowledge section for a prompt. Deterministic, provenance
 * carrying, and honest when there is nothing to reuse.
 */
export function renderKnowledgeSection(result: KnowledgeRetrievalResult): string {
  if (!result.selected.length) return "";
  const lines: string[] = [
    `REUSED_PROJECT_KNOWLEDGE (${result.selected.length} object(s), ${result.characters}/${result.budget} chars):`,
    "Facts already established for this project by earlier verified work. They carry provenance; prefer them over re-deriving the same thing, and say so if one is wrong."
  ];
  for (const object of result.selected) {
    lines.push(`- [${object.type}] ${object.summary}`);
    lines.push(`  ${object.content}`);
    lines.push(`  source: ${object.provenance.source} (${object.provenance.source_hash.slice(0, 12)}…, ${object.provenance.verification}, authority ${object.authority})`);
  }
  return lines.join("\n");
}
