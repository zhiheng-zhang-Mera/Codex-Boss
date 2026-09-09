import { describe, expect, it } from "vitest";
import {
  RESEARCH_DOMAINS,
  adjudicateResearchOutcome,
  buildResearchBattery,
  runResearchBattery,
  type ResearchEvidence
} from "../../src/shared/research-battery";

function full(over: Partial<ResearchEvidence> = {}): ResearchEvidence {
  return {
    protocol: true,
    executionEvidence: true,
    replication: "REPRODUCED",
    statistics: true,
    claimGraph: true,
    citations: true,
    review: "APPROVED",
    manuscript: true,
    finalAudit: true,
    ...over
  };
}

describe("research battery (§33): honest terminal states", () => {
  it("a genuine READY with the full §34 artifact chain passes", () => {
    const verdict = adjudicateResearchOutcome({ domain: "software-engineering", declaredStatus: "READY", hypothesisSupported: true, evidence: full() });
    expect(verdict.pass).toBe(true);
    expect(verdict.status).toBe("READY");
    expect(verdict.missing).toEqual([]);
  });

  it("a fake READY (missing manuscript/review/citations) is caught and downgraded", () => {
    const verdict = adjudicateResearchOutcome({
      domain: "multi-agent",
      declaredStatus: "READY",
      hypothesisSupported: true,
      evidence: full({ manuscript: false, finalAudit: false, review: "NOT_RUN", citations: false })
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(verdict.reason).toContain("fake READY");
  });

  it("a correct rejection (null/negative result, review passed) is a PASS", () => {
    const verdict = adjudicateResearchOutcome({ domain: "negative-null-result", declaredStatus: "REJECTED", hypothesisSupported: false, evidence: full() });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("correct rejection");
  });

  it("a hypothesis-supported rejection claim is not waved through", () => {
    const verdict = adjudicateResearchOutcome({ domain: "software-engineering", declaredStatus: "REJECTED", hypothesisSupported: true, evidence: full() });
    expect(verdict.pass).toBe(false);
  });

  it("REPLICATION_FAILED with recorded failure is a PASS (never a fake READY)", () => {
    const verdict = adjudicateResearchOutcome({ domain: "reliability", declaredStatus: "REPLICATION_FAILED", hypothesisSupported: null, evidence: full({ replication: "FAILED" }) });
    expect(verdict.pass).toBe(true);
  });

  it("an INSUFFICIENT_EVIDENCE call with protocol+execution trail is a PASS; INCONCLUSIVE needs statistics", () => {
    expect(adjudicateResearchOutcome({ domain: "negative-null-result", declaredStatus: "INSUFFICIENT_EVIDENCE", hypothesisSupported: null, evidence: full({ statistics: false, replication: "NOT_ATTEMPTED", manuscript: false }) }).pass).toBe(true);
    expect(adjudicateResearchOutcome({ domain: "writing-evaluation", declaredStatus: "INCONCLUSIVE", hypothesisSupported: null, evidence: full({ statistics: false }) }).pass).toBe(false);
  });

  it("covers all five domains", () => {
    expect(RESEARCH_DOMAINS).toHaveLength(5);
    const verdicts = buildResearchBattery().map((scenario) => adjudicateResearchOutcome(scenario.input));
    expect(new Set(verdicts.map((verdict) => verdict.domain)).size).toBe(5);
  });
});

describe("research battery (§33/§34): full battery run", () => {
  it("all six battery scenarios judge as expected (correct rejection counts as pass)", () => {
    const result = runResearchBattery();
    expect(result.total).toBe(6);
    expect(result.passed).toBe(result.total);
  });
});
