import { describe, expect, it } from "vitest";
import { isFalsifiable, selectFalsifiableQuestion, validateCandidateQuestion, type CandidateQuestion } from "../src/shared/research-levelb";
import { adjudicateClaim, type ClaimEvidence, type ReviewerVote } from "../src/shared/research-adjudicate";

function candidate(id: string, overrides: Partial<CandidateQuestion> = {}): CandidateQuestion {
  return { id, question: `Q ${id}`, measurable: true, falsifiable: true, proposedBy: "reviewer-a", noveltyScore: 1, feasibilityScore: 1, ...overrides };
}

describe("falsifiable question selection (Phase 8)", () => {
  it("selects a falsifiable measurable question and rejects the rest with reasons", () => {
    const selection = selectFalsifiableQuestion([
      candidate("good", { noveltyScore: 3 }),
      candidate("no-metric", { measurable: false }),
      candidate("unfalsifiable", { falsifiable: false })
    ]);
    expect(selection.selectedId).toBe("good");
    expect(selection.rejected.map((item) => item.id).sort()).toEqual(["no-metric", "unfalsifiable"]);
    expect(selection.rejected[0].reason.length).toBeGreaterThan(0);
  });

  it("never picks a non-falsifiable candidate and never proposes by vote alone", () => {
    expect(isFalsifiable({ measurable: true, falsifiable: false })).toBe(false);
    expect(isFalsifiable({ measurable: true, falsifiable: true })).toBe(true);
    const none = selectFalsifiableQuestion([candidate("x", { falsifiable: false })]);
    expect(none.selectedId).toBeNull();
    expect(() => validateCandidateQuestion(candidate("bad", { question: "" }))).toThrow();
  });
});

describe("evidence > vote adjudication (Phase 8)", () => {
  function evidence(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
    return { claimId: "c1", statisticSupported: true, independentReplication: true, verifiedCitations: 1, ...overrides };
  }
  function votes(stance: ReviewerVote["stance"][]): ReviewerVote[] {
    return stance.map((value, index) => ({ reviewerId: `r${index}`, claimId: "c1", stance: value }));
  }

  it("adopts when deterministic evidence + replication support the claim", () => {
    const verdict = adjudicateClaim({ votes: votes(["supports"]), evidence: evidence(), requiredVotes: 1 });
    expect(verdict.adopted).toBe(true);
  });

  it("never adopts on reviewer votes alone when statistics do not support the claim", () => {
    const verdict = adjudicateClaim({ votes: votes(["supports", "supports", "supports"]), evidence: evidence({ statisticSupported: false }), requiredVotes: 2 });
    expect(verdict.adopted).toBe(false);
    expect(verdict.reason).toContain("statistic does not support");
  });

  it("requires independent replication even with statistical support", () => {
    const verdict = adjudicateClaim({ votes: votes(["supports"]), evidence: evidence({ independentReplication: false }), requiredVotes: 1 });
    expect(verdict.adopted).toBe(false);
    expect(verdict.reason).toContain("no independent replication");
  });
});
