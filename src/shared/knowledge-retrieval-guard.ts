import type { ConfidenceLevel, KnowledgeClaim } from "./knowledge-claim";
import { assessStaleness, type StalenessObservation, type StalenessResult } from "./knowledge-staleness";

/**
 * Retrieval quality guard (platform foundation, Phase 04 Task F).
 *
 * The rules that stop accumulated history drowning current knowledge, expressed as a scoring
 * function plus the reasons a claim was ranked or excluded — never as a bare number, because
 * "why is this answer here" is the question a retrieval guard exists to make answerable.
 *
 * ## The four properties the book names
 *
 *  1. **Current knowledge outranks superseded and stale versions.** A superseded claim is excluded
 *     outright; a stale one is heavily penalised rather than hidden, so it can still be found when
 *     it is what the caller asked for.
 *  2. **A disputed claim is never output as certain fact.** Disputed claims are excluded from the
 *     fact list and returned in their own bucket, so a caller has to ask for them by name.
 *  3. **Project A's knowledge does not pollute project B.** Scope is a filter, not a score: a claim
 *     from another project is excluded regardless of how well it matches, because a high score for
 *     the wrong project is exactly the contamination the book names.
 *  4. **A missing source degrades confidence.** Reported as a distinct downgrade so a reader can
 *     see the claim is being offered with less backing than it was recorded with.
 *
 * ## Why scoring is additive and small
 *
 * Every term is bounded and every term has a stated reason. A large score would let one strong
 * signal hide another, and the guard's job is to make the ordering explainable rather than
 * impressive.
 */

/** Why a claim was excluded from retrieval entirely. */
type RetrievalExclusion = "other-project" | "superseded" | "disputed" | "empty-claim";

/** A ranking adjustment that did not exclude the claim. */
interface RetrievalAdjustment {
  reason: "stale" | "source-missing" | "source-quarantined" | "owner-invalidated" | "low-confidence" | "kind-weight";
  penaltyOrBonus: number;
  detail: string;
}

interface RetrievalEntry {
  claimId: string;
  claim: string;
  kind: KnowledgeClaim["kind"];
  confidence: ConfidenceLevel;
  score: number;
  /** Sorted highest-magnitude first, so the dominant reason reads first. */
  adjustments: RetrievalAdjustment[];
  /** The staleness verdict behind the score, so a caller can show why. */
  staleness: StalenessResult;
}

interface RetrievalExcluded {
  claimId: string;
  reason: RetrievalExclusion;
  detail: string;
}

export interface RetrievalRequest {
  project: string;
  /** Terms to match against the claim text. Empty means "everything in scope". */
  terms?: readonly string[];
  observation: StalenessObservation;
  /** Maximum entries to return. */
  limit?: number;
}

export interface RetrievalResult {
  project: string;
  /** Ranked highest first. Only claims offered as current fact. */
  entries: RetrievalEntry[];
  /** Disputed claims, kept separate so a caller cannot mistake one for a fact. */
  disputed: Array<{ claimId: string; claim: string; basis: string }>;
  excluded: RetrievalExcluded[];
}

/** How much each confidence level is worth. `disputed` is handled by exclusion, not by a score. */
const CONFIDENCE_SCORE: Record<ConfidenceLevel, number> = {
  verified: 40,
  supported: 25,
  tentative: 10,
  disputed: 0
};

/** How much each epistemic kind is worth, which is a statement about how assertable it is. */
const KIND_SCORE: Record<KnowledgeClaim["kind"], number> = {
  fact: 12,
  constraint: 10,
  decision: 8,
  lesson: 4,
  hypothesis: 0
};

/** Penalties. Staleness is the largest by design: a stale fact is not a slightly worse fact. */
const STALE_PENALTY = 60;
const SOURCE_MISSING_PENALTY = 30;
const SOURCE_QUARANTINED_PENALTY = 35;
const OWNER_INVALIDATED_PENALTY = 100;

/** Case-insensitive term coverage, counted rather than scored, so the reason is explainable. */
function termMatches(text: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const haystack = text.toLowerCase();
  return terms.filter((term) => term.trim() !== "" && haystack.includes(term.toLowerCase().trim())).length;
}

/**
 * Rank a claim set for one project.
 *
 * Pure: the same claims, request and observation always produce the same ordering, including ties,
 * which are broken by claim id. A retrieval guard that reordered equal claims between runs would
 * make its own benchmark unreproducible.
 */
export function retrieveClaims(claims: readonly KnowledgeClaim[], request: RetrievalRequest): RetrievalResult {
  const entries: RetrievalEntry[] = [];
  const disputed: RetrievalResult["disputed"] = [];
  const excluded: RetrievalExcluded[] = [];
  const terms = request.terms ?? [];

  for (const claim of claims) {
    // 3. Scope is a FILTER. Contamination is refused before ranking, so no score can smuggle a
    //    foreign project's knowledge into the answer.
    if (claim.scope.project !== request.project) {
      excluded.push({ claimId: claim.id, reason: "other-project", detail: `the claim is scoped to ${claim.scope.project}` });
      continue;
    }
    if (!claim.claim.trim()) {
      excluded.push({ claimId: claim.id, reason: "empty-claim", detail: "the claim text is empty" });
      continue;
    }
    // 2. A disputed claim never appears among the facts; it is returned separately so a caller has
    //    to ask for it explicitly.
    if (claim.confidence.level === "disputed") {
      disputed.push({ claimId: claim.id, claim: claim.claim, basis: claim.confidence.basis });
      continue;
    }
    // 1. Superseded knowledge is excluded from default retrieval; its lineage is still reachable
    //    through the claim store, which is the difference between "not offered" and "deleted".
    if (claim.supersededBy) {
      excluded.push({ claimId: claim.id, reason: "superseded", detail: `superseded by ${claim.supersededBy}` });
      continue;
    }

    const staleness = assessStaleness(claim, request.observation);
    const adjustments: RetrievalAdjustment[] = [];
    let score = CONFIDENCE_SCORE[claim.confidence.level] + KIND_SCORE[claim.kind] + termMatches(claim.claim, terms) * 5;

    adjustments.push({ reason: "kind-weight", penaltyOrBonus: KIND_SCORE[claim.kind], detail: `a ${claim.kind} is worth ${KIND_SCORE[claim.kind]}` });
    if (claim.confidence.level !== "verified") {
      adjustments.push({ reason: "low-confidence", penaltyOrBonus: CONFIDENCE_SCORE[claim.confidence.level] - CONFIDENCE_SCORE.verified, detail: `confidence is ${claim.confidence.level}` });
    }

    // 4. A source that is gone or quarantined degrades the claim, and says so. Owner invalidation is
    //    the harshest: it is a decision rather than an inference.
    for (const finding of staleness.findings) {
      if (finding.reason === "source-missing") {
        score -= SOURCE_MISSING_PENALTY;
        adjustments.push({ reason: "source-missing", penaltyOrBonus: -SOURCE_MISSING_PENALTY, detail: finding.detail });
      } else if (finding.reason === "source-quarantined") {
        score -= SOURCE_QUARANTINED_PENALTY;
        adjustments.push({ reason: "source-quarantined", penaltyOrBonus: -SOURCE_QUARANTINED_PENALTY, detail: finding.detail });
      } else if (finding.reason === "owner-invalidated") {
        score -= OWNER_INVALIDATED_PENALTY;
        adjustments.push({ reason: "owner-invalidated", penaltyOrBonus: -OWNER_INVALIDATED_PENALTY, detail: finding.detail });
      }
    }
    if (staleness.verdict === "STALE") {
      // Applied once rather than per finding: a claim that is stale for three reasons is not three
      // times as stale, and stacking would let a claim drop below an unrelated one for arithmetic
      // reasons rather than substantive ones.
      score -= STALE_PENALTY;
      adjustments.push({ reason: "stale", penaltyOrBonus: -STALE_PENALTY, detail: staleness.detail });
    }

    entries.push({
      claimId: claim.id,
      claim: claim.claim,
      kind: claim.kind,
      confidence: claim.confidence.level,
      score,
      adjustments: adjustments.sort((left, right) => Math.abs(right.penaltyOrBonus) - Math.abs(left.penaltyOrBonus)),
      staleness
    });
  }

  // Ties break on claim id, so the ordering is total and reproducible.
  const ranked = entries.sort((left, right) => (right.score - left.score) || (left.claimId < right.claimId ? -1 : 1));
  return {
    project: request.project,
    entries: request.limit === undefined ? ranked : ranked.slice(0, request.limit),
    disputed: disputed.sort((left, right) => (left.claimId < right.claimId ? -1 : 1)),
    excluded: excluded.sort((left, right) => (left.claimId < right.claimId ? -1 : 1))
  };
}

/**
 * A fixed benchmark over a claim corpus.
 *
 * The book asks for a small fixed benchmark, and the point of FIXING it is that a later change to
 * the ranking can be judged against the same cases rather than against a rewritten expectation. The
 * assertions live in the test; this function returns the measured ordering so both the test and the
 * Phase 04 report can read the same numbers.
 */
export interface RetrievalBenchmarkCase {
  name: string;
  /** What the case demonstrates, so a failure names the property rather than the fixture. */
  demonstrates: string;
  request: RetrievalRequest;
  claims: readonly KnowledgeClaim[];
}

interface RetrievalBenchmarkOutcome {
  name: string;
  demonstrates: string;
  /** The ranking, highest first. */
  ranking: string[];
  disputed: string[];
  excluded: string[];
  /** The scores, so a report can show the margin rather than only the order. */
  scores: Record<string, number>;
}

/** Run one benchmark case and return what the retrieval produced. */
export function runRetrievalBenchmark(testCase: RetrievalBenchmarkCase): RetrievalBenchmarkOutcome {
  const result = retrieveClaims(testCase.claims, testCase.request);
  return {
    name: testCase.name,
    demonstrates: testCase.demonstrates,
    ranking: result.entries.map((entry) => entry.claimId),
    disputed: result.disputed.map((entry) => entry.claimId),
    excluded: result.excluded.map((entry) => `${entry.claimId}:${entry.reason}`),
    scores: Object.fromEntries(result.entries.map((entry) => [entry.claimId, entry.score]))
  };
}

/** The rank of a claim in an outcome, or -1 when it was not offered. */
export function rankOf(outcome: RetrievalBenchmarkOutcome, claimId: string): number {
  return outcome.ranking.indexOf(claimId);
}
