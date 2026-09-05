/**
 * Evidence-over-vote adjudication (plan 9-6 Phase 8 decision rule). Pure.
 *
 * Multi-AI decisions must follow `evidence > vote`: a claim supported by
 * verified experiment evidence (with an independent replication) is adopted
 * even if fewer reviewers voted for it; majority opinion with no evidence is
 * not adopted. This module supplies the deterministic adjudicator.
 */

export interface ReviewerVote {
  reviewerId: string;
  claimId: string;
  stance: "supports" | "opposes";
}

export interface ClaimEvidence {
  claimId: string;
  /** Deterministic statistic outcome (e.g. effect + replication both significant). */
  statisticSupported: boolean;
  independentReplication: boolean;
  /** Verified citations bound to this claim (Phase 9 ladder ≥ PASSAGE_VERIFIED). */
  verifiedCitations: number;
}

export interface AdjudicationVerdict {
  claimId: string;
  adopted: boolean;
  reason: string;
}

/**
 * Adopts a claim only when the evidence is decisive:
 *  - statistic supports AND independent replication exists;
 *  - verified citations (ladder ≥ SOURCE_RETRIEVED) do not contradict;
 *  - otherwise even unanimous reviewer votes never adopt (evidence > vote).
 */
export function adjudicateClaim(input: { votes: ReviewerVote[]; evidence: ClaimEvidence; requiredVotes?: number }): AdjudicationVerdict {
  const votes = input.votes.filter((vote) => vote.claimId === input.evidence.claimId);
  const supports = votes.filter((vote) => vote.stance === "supports").length;
  const required = input.requiredVotes ?? 1;
  const majorityBacks = supports >= required;
  const reasons: string[] = [];
  if (!input.evidence.statisticSupported) reasons.push("statistic does not support the claim");
  if (!input.evidence.independentReplication) reasons.push("no independent replication");
  if (reasons.length === 0 && majorityBacks) {
    return { claimId: input.evidence.claimId, adopted: true, reason: `evidence supports claim and ${supports}/${votes.length} reviewers concur` };
  }
  if (reasons.length === 0 && !majorityBacks) {
    return { claimId: input.evidence.claimId, adopted: false, reason: `evidence supports the claim but fewer than ${required} reviewers concur; requires human review` };
  }
  return { claimId: input.evidence.claimId, adopted: false, reason: reasons.join("; ") || "no evidence" };
}
