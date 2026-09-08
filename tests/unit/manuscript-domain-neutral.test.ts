import { describe, expect, it } from "vitest";
import { makeSectionWriter, headlineFor } from "../../electron/research/research-conductor";
import type { ResearchProtocol } from "../../src/shared/research-protocol";

const PROTOCOL: ResearchProtocol = {
  schemaVersion: 1,
  hypothesis: "Solar wind variation is correlated with heliospheric current sheet crossings.",
  primaryMetric: "pass@k",
  baseline: "0.5",
  sampleDefinition: "fixed benchmark × seeds 1..N",
  evaluationCriterion: "mean pass@k > baseline",
  createdAt: new Date(0).toISOString()
};

function writerFor(question: string) {
  return makeSectionWriter({
    question,
    hypothesis: PROTOCOL.hypothesis,
    protocol: PROTOCOL,
    metric: "pass@k",
    mean: 0.72,
    ciLower: 0.68,
    ciUpper: 0.76,
    n: 2,
    claimId: "claim:bench-1",
    experimentId: "bench-1",
    baseline: PROTOCOL.baseline,
    sample: PROTOCOL.sampleDefinition,
    criterion: PROTOCOL.evaluationCriterion,
    runs: [{ seed: 1, value: 0.71 }, { seed: 2, value: 0.73 }]
  });
}

describe("domain-neutral manuscript writer (Overcomplete §9.15)", () => {
  it("derives an abstract bound to the actual research question, not a hard-coded domain", async () => {
    const question = "Does solar wind variation correlate with heliospheric current sheet crossings?";
    const writer = writerFor(question);
    const abstract = await writer.write({ section: "abstract" } as never, 1);
    expect(abstract).toContain(question);
    expect(abstract).toContain("pass@k");
    expect(abstract).toContain("frozen");
    // No leftover hard-coded review-benchmark domain narrative.
    expect(abstract).not.toContain("majority voting");
    expect(abstract).not.toContain("adjudication");
  });

  it("keeps discussion/conclusion evidence-bound and generic for any RQ", async () => {
    const writer = writerFor("Is training on synthetic data beneficial for code completion models?");
    const discussion = await writer.write({ section: "discussion" } as never, 1);
    const conclusion = await writer.write({ section: "conclusion" } as never, 1);
    expect(discussion).toContain("pass@k");
    expect(conclusion).toContain("REPRODUCED");
    expect(discussion).not.toContain("judges are simulated");
    expect(conclusion).not.toContain("majority voting");
  });

  it("headlineFor builds a bounded title from the question", () => {
    expect(headlineFor("Does X reduce Y?")).toBe("Does X reduce Y");
    expect(headlineFor("A ".repeat(200).trim()).length).toBeLessThanOrEqual(105);
  });
});
