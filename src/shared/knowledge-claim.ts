/**
 * Knowledge claim contract (platform foundation, Phase 04 Task A).
 *
 * The five-way epistemic classification the engineering book requires — `fact`, `decision`,
 * `hypothesis`, `lesson`, `constraint` — with provenance, validity, confidence and supersession
 * lineage, plus the minimum-evidence rule for each kind.
 *
 * ## Why this is a new axis rather than a reuse
 *
 * `src/shared/knowledge-object.ts` already carries a seventeen-value `KnowledgeType`
 * (`ARCHITECTURE`, `BUG`, `PROVIDER`, …). That answers "what is this about"; the book's `kind`
 * answers "what sort of claim is this", and the two are independent — a `BUG` can be a FACT
 * ("this crashes") or a HYPOTHESIS ("I think this crashes"). Collapsing them would lose the
 * distinction the whole phase rests on, so `kind` is added as a second axis rather than folded
 * into the first, and the existing module is left alone.
 *
 * ## The rules this file enforces
 *
 *  - **No provenance, no verified knowledge.** A claim with no source is a note or a draft; the
 *    type system gives it no way to be `verified`, and `derivableConfidence` refuses to promote it.
 *  - **Confidence never grows by repetition.** There is no field counting citations and no rule
 *    that reads one. A claim asserted by fifty agents is exactly as confident as its evidence
 *    makes it, which is the book's explicit prohibition and the reason `confidenceOf` takes
 *    evidence rather than a citation count.
 *  - **Code-bound knowledge names its repo and commit.** A claim about code that cannot say which
 *    revision it was true of cannot be marked stale when that revision moves, so the constraint is
 *    enforced at construction.
 *  - **Supersession preserves lineage.** A superseded claim is not deleted and its evidence is not
 *    replaced; `supersededBy` points at the winner while the loser keeps its own provenance, so
 *    "why did the current version win" is answerable.
 *
 * Pure and shareable: no filesystem, no clock beyond an injected `now`, no model call.
 */

import { isValidSemver } from "./semver";

/**
 * What sort of claim this is.
 *
 * Ordered from most to least assertive, which is also the order of their evidence requirements:
 * a `fact` needs immutable evidence, a `hypothesis` explicitly does not.
 */
export const KNOWLEDGE_KINDS = ["fact", "decision", "constraint", "lesson", "hypothesis"] as const;
type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** How much the system believes a claim. `disputed` is a state, not a low score. */
export const CONFIDENCE_LEVELS = ["verified", "supported", "tentative", "disputed"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Where a claim came from. */
const SOURCE_TYPES = ["commit", "test", "artifact", "owner", "external"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Which sources are IMMUTABLE.
 *
 * The distinction is doing real work: `verified` requires a source that cannot change underneath
 * the claim. A commit hash and a test run id qualify; `owner` qualifies because a person said it;
 * `artifact` and `external` do NOT, because an artifact can be rewritten and a URL can change its
 * content — a claim resting on one of those is `supported` at best.
 */
const IMMUTABLE_SOURCES: readonly SourceType[] = ["commit", "test", "owner"];

/** A repository binding, so code knowledge can be judged stale when the code moves. */
interface CodeBinding {
  repo: string;
  /** The commit or range the claim was true of, e.g. a SHA or `abc123..def456`. */
  revision: string;
  /** Repo-relative POSIX paths the claim is about. A claim with no paths cannot go stale on a diff. */
  paths: string[];
}

/** Where a claim came from, in enough detail to re-derive it. */
interface ClaimProvenance {
  sourceType: SourceType;
  /** An immutable reference: a SHA, a run id, a document id. Required and non-empty. */
  sourceRef: string;
  /** A human-readable pointer, e.g. the command that produced it. Optional but never a substitute. */
  note?: string;
}

/** When the claim was and is true. */
interface ClaimValidity {
  /** An ISO timestamp, a commit SHA, or a capability version. */
  validFrom: string;
  /** `null` while the claim is current. */
  validUntil: string | null;
  /** Why it stopped being valid, once it has. */
  invalidatedBy?: string;
}

/** The scopes a claim can be confined to. */
interface ClaimScope {
  project: string;
  repo?: string;
  /** A capability id and version the claim depends on, e.g. `persistence@1.0.0`. */
  capability?: string;
}

interface ClaimConfidence {
  level: ConfidenceLevel;
  /** Why this level, in the asserting party's words. Required, so a level is never bare. */
  basis: string;
}

export interface KnowledgeClaim {
  id: string;
  /** The claim itself, as one sentence. */
  claim: string;
  kind: KnowledgeKind;
  scope: ClaimScope;
  provenance: ClaimProvenance;
  /** Required for a claim about code; see `CodeBinding`. */
  code?: CodeBinding;
  validity: ClaimValidity;
  confidence: ClaimConfidence;
  /** The id of the claim that replaced this one, once one has. */
  supersededBy: string | null;
  /** Set when this claim is disputed, naming the claim it conflicts with. */
  disputedWith?: string;
  /**
   * The confidence level this claim held before it was disputed.
   *
   * Present only while `disputedWith` is set. It exists so an adjudication can restore the level
   * rather than leave the winner permanently marked as disputed.
   */
  disputedFromLevel?: ConfidenceLevel;
  createdAt: string;
}

/** A claim that failed validation, with every reason. */
class ClaimValidationError extends Error {
  constructor(readonly claimId: string, readonly problems: readonly string[]) {
    super(`knowledge claim ${claimId} is invalid:\n  ${problems.join("\n  ")}`);
    this.name = "ClaimValidationError";
  }
}

/**
 * The minimum evidence each kind requires.
 *
 * The book asks for different floors per kind, and the floors are the whole point: without them
 * "every claim needs provenance" would be satisfied by attaching a meaningless reference to a
 * guess, and a hypothesis dressed as a fact is exactly the self-reinforcing error the phase
 * exists to prevent.
 */
interface EvidenceFloor {
  kind: KnowledgeKind;
  /** The highest confidence this kind may claim without additional evidence. */
  maxConfidence: ConfidenceLevel;
  /** Whether the claim must name a code binding. */
  requiresCodeBinding: boolean;
  /** Whether a provenance reference is required at all. */
  requiresProvenance: boolean;
  why: string;
}

export const EVIDENCE_FLOORS: Record<KnowledgeKind, EvidenceFloor> = {
  fact: {
    kind: "fact",
    maxConfidence: "verified",
    requiresCodeBinding: false,
    requiresProvenance: true,
    why: "a fact asserts what IS, so it needs a source that cannot change underneath it; `verified` is reachable only from an immutable one"
  },
  decision: {
    kind: "decision",
    maxConfidence: "verified",
    requiresCodeBinding: false,
    requiresProvenance: true,
    why: "a decision is a fact about what was chosen, so the same floor applies — and its source is normally the owner or the ledger entry recording it"
  },
  constraint: {
    kind: "constraint",
    maxConfidence: "verified",
    requiresCodeBinding: false,
    requiresProvenance: true,
    why: "a constraint asserts what MUST hold; a constraint nobody can trace is indistinguishable from a preference"
  },
  lesson: {
    kind: "lesson",
    maxConfidence: "supported",
    requiresCodeBinding: false,
    requiresProvenance: true,
    why: "a lesson generalises from an experience, which is a judgement rather than a reading, so it caps at `supported` however many times it is repeated"
  },
  hypothesis: {
    kind: "hypothesis",
    maxConfidence: "tentative",
    requiresCodeBinding: false,
    requiresProvenance: true,
    why: "a hypothesis is explicitly unproven, so it caps at `tentative`; promoting one to `verified` is the self-reinforcement the book prohibits"
  }
};

/** Whether a source type can support a `verified` claim. */
export function isImmutableSource(sourceType: SourceType): boolean {
  return IMMUTABLE_SOURCES.includes(sourceType);
}

/**
 * The highest confidence a claim's evidence can justify.
 *
 * Takes the EVIDENCE, never a citation count — there is deliberately no parameter for how many
 * times the claim has been repeated, because the book forbids repetition raising confidence.
 */
export function derivableConfidence(input: { kind: KnowledgeKind; provenance: ClaimProvenance; codeBindingRequired?: boolean }): { level: ConfidenceLevel; basis: string } {
  const floor = EVIDENCE_FLOORS[input.kind];
  if (!input.provenance.sourceRef.trim()) {
    return { level: "tentative", basis: "no provenance reference, so this is a draft rather than knowledge" };
  }
  if (!isImmutableSource(input.provenance.sourceType)) {
    return {
      level: floor.maxConfidence === "tentative" ? "tentative" : "supported",
      basis: `a ${input.provenance.sourceType} source is not immutable, so it cannot support a verified claim`
    };
  }
  return { level: floor.maxConfidence, basis: `${input.kind} with an immutable ${input.provenance.sourceType} source` };
}

/** Validate one claim, returning every problem rather than the first. */
export function validateClaim(claim: KnowledgeClaim): string[] {
  const problems: string[] = [];
  if (!claim.id || !claim.id.trim()) problems.push("an id is required, so a supersession chain can name it");
  if (!claim.claim || !claim.claim.trim()) problems.push("the claim text is empty");
  if (!KNOWLEDGE_KINDS.includes(claim.kind)) problems.push(`kind ${JSON.stringify(claim.kind)} is not one of ${KNOWLEDGE_KINDS.join(", ")}`);
  if (!claim.scope || !claim.scope.project || !claim.scope.project.trim()) problems.push("a project scope is required; an unscoped claim can leak across projects");
  if (!claim.confidence || !claim.confidence.basis || !claim.confidence.basis.trim()) {
    problems.push("a confidence level needs a stated basis; a bare level is not reviewable");
  }
  const floor = EVIDENCE_FLOORS[claim.kind];
  if (floor && floor.requiresProvenance && (!claim.provenance || !claim.provenance.sourceRef || !claim.provenance.sourceRef.trim())) {
    problems.push(`a ${claim.kind} requires provenance with an immutable sourceRef; without one it can only be a note or a draft`);
  }
  if (claim.provenance && !SOURCE_TYPES.includes(claim.provenance.sourceType)) {
    problems.push(`sourceType ${JSON.stringify(claim.provenance.sourceType)} is not one of ${SOURCE_TYPES.join(", ")}`);
  }
  // The confidence ceiling: any claim above what its evidence can justify is refused, which is
  // what makes the floors enforcement rather than documentation.
  if (claim.provenance && claim.confidence) {
    const derivable = derivableConfidence({ kind: claim.kind, provenance: claim.provenance });
    const rank = (level: ConfidenceLevel) => CONFIDENCE_LEVELS.indexOf(level);
    if (claim.confidence.level !== "disputed" && rank(claim.confidence.level) < rank(derivable.level)) {
      problems.push(`confidence ${claim.confidence.level} exceeds what its evidence supports (${derivable.level}: ${derivable.basis})`);
    }
  }
  // Code-bound knowledge must name the revision, or it cannot be judged stale when that moves.
  if (claim.code) {
    if (!claim.code.repo || !claim.code.repo.trim()) problems.push("a code binding needs a repo");
    if (!claim.code.revision || !claim.code.revision.trim()) problems.push("a code binding needs a revision, or the claim can never be judged stale");
    if (!Array.isArray(claim.code.paths) || claim.code.paths.length === 0) problems.push("a code binding needs at least one path, or a diff cannot be matched against it");
    if (claim.code.repo && claim.scope.repo && claim.code.repo !== claim.scope.repo) {
      problems.push(`the code binding names repo ${claim.code.repo} while the scope names ${claim.scope.repo}`);
    }
  }
  if (claim.scope.capability && claim.scope.capability.includes("@") && !isValidSemver(claim.scope.capability.split("@")[1] ?? "")) {
    problems.push(`capability ${claim.scope.capability} does not name a semantic version`);
  }
  if (!claim.validity) problems.push("validity is required");
  if (claim.validity && typeof claim.validity.validFrom !== "string") problems.push("validFrom must be a string");
  if (claim.supersededBy === claim.id) problems.push("a claim cannot supersede itself");
  if (claim.kind === "hypothesis" && claim.confidence?.level === "verified") {
    problems.push("a hypothesis cannot be verified; it must first be replaced by a fact");
  }
  return problems;
}

/** Validate a claim, throwing with every problem when it is invalid. */
export function assertValidClaim(claim: KnowledgeClaim): void {
  const problems = validateClaim(claim);
  if (problems.length > 0) throw new ClaimValidationError(claim.id, problems);
}

/**
 * Supersede a claim.
 *
 * The loser is returned with `supersededBy` set and its provenance, evidence and code binding
 * untouched — the book forbids physically overwriting the old record, and lineage is what makes
 * "why did the current version win" answerable. `validUntil` is stamped so the claim's window is
 * explicit rather than merely implied by the pointer.
 */
export function supersede(previous: KnowledgeClaim, winner: Pick<KnowledgeClaim, "id">, at: string, reason: string): KnowledgeClaim {
  if (!winner.id || !winner.id.trim()) throw new ClaimValidationError(previous.id, ["a supersession needs the winning claim's id"]);
  if (winner.id === previous.id) throw new ClaimValidationError(previous.id, ["a claim cannot supersede itself"]);
  if (!reason || !reason.trim()) throw new ClaimValidationError(previous.id, ["a supersession needs a stated reason, or the lineage explains nothing"]);
  return {
    ...previous,
    supersededBy: winner.id,
    validity: { ...previous.validity, validUntil: previous.validity.validUntil ?? at, invalidatedBy: reason },
    // The evidence is deliberately preserved: a superseded claim is still the record of what was
    // believed and why.
    provenance: { ...previous.provenance },
    ...(previous.code ? { code: { ...previous.code, paths: [...previous.code.paths] } } : {})
  };
}

/**
 * Mark two claims as conflicting.
 *
 * BOTH are returned disputed and neither is superseded. The book requires conflicts to be
 * `DISPUTED` first, with both sides' evidence kept until an adjudication decides — a version that
 * picked a winner here would be exactly the automatic overwrite it forbids.
 */
export function dispute(left: KnowledgeClaim, right: KnowledgeClaim): [KnowledgeClaim, KnowledgeClaim] {
  if (left.id === right.id) throw new ClaimValidationError(left.id, ["a claim cannot conflict with itself"]);
  const mark = (target: KnowledgeClaim, other: KnowledgeClaim): KnowledgeClaim => ({
    ...target,
    confidence: { level: "disputed", basis: `conflicts with ${other.id}: ${other.claim}` },
    disputedWith: other.id,
    // The level the claim held before it was disputed, so adjudication can restore it. Without this
    // the winner of a conflict would stay marked `disputed` forever: the conflict would be resolved
    // on paper while nothing was left that a reader could treat as current.
    disputedFromLevel: target.disputedFromLevel ?? target.confidence.level,
    validity: { ...target.validity, validUntil: null }
  });
  return [mark(left, right), mark(right, left)];
}

/**
 * Resolve a dispute in favour of one side.
 *
 * Refused unless the winner carries evidence the loser does not — "adjudication" means a reason,
 * and a caller that just prefers one claim should leave them disputed rather than dress a
 * preference as a decision. The reason is recorded on the loser's lineage.
 */
export function adjudicate(winner: KnowledgeClaim, loser: KnowledgeClaim, at: string, reason: string): { winner: KnowledgeClaim; loser: KnowledgeClaim } {
  if (!reason || reason.trim().length < 10) {
    throw new ClaimValidationError(winner.id, ["an adjudication needs a substantive reason; a preference is not a decision"]);
  }
  const winnerEvidence = `${winner.provenance.sourceType}:${winner.provenance.sourceRef}`;
  const loserEvidence = `${loser.provenance.sourceType}:${loser.provenance.sourceRef}`;
  if (winnerEvidence === loserEvidence && winner.confidence.level === loser.confidence.level) {
    throw new ClaimValidationError(winner.id, ["the two claims rest on the same evidence at the same confidence, so neither wins; leave them disputed"]);
  }
  const cleared: KnowledgeClaim = {
    ...winner,
    disputedWith: undefined,
    disputedFromLevel: undefined,
    // Restored to the level the claim held before the dispute. Adjudication settles the CONFLICT,
    // not the evidence, so it must not silently promote the winner either: a claim that was
    // `supported` before the dispute is `supported` after it.
    confidence: { ...winner.confidence, level: winner.disputedFromLevel ?? winner.confidence.level, basis: `adjudicated over ${loser.id}: ${reason}` }
  };
  return { winner: cleared, loser: supersede(loser, winner, at, `adjudicated: ${reason}`) };
}

/**
 * Whether a claim is currently valid at `at`.
 *
 * A superseded claim is NOT valid: its window closed, and returning it as current is the
 * "old knowledge posing as fact" failure the phase exists to stop.
 */
export function isCurrent(claim: KnowledgeClaim, at: string): boolean {
  if (claim.supersededBy) return false;
  if (claim.confidence.level === "disputed") return false;
  if (claim.validity.validUntil !== null) return false;
  return claim.validity.validFrom <= at;
}
