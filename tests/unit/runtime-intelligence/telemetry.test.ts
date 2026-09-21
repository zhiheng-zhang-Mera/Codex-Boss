import { describe, expect, it } from "vitest";
import { createObservation, explainObservation, judgeDecisionOutcome, loadoutWasFollowed, observationIdFor, traceIdFor, unusedMountedSkills } from "../../../src/shared/runtime-intelligence/telemetry";
import type { RuntimeObservation } from "../../../src/shared/runtime-intelligence/contracts";
import type { DecisionOutcomeVerdict, ExplanationInput, ObservationExplanation, ObservationInput } from "../../../src/shared/runtime-intelligence/telemetry";

/**
 * The unified observation record: one row that can answer "why this model, on this
 * machine, with these skills" — and that says "not recorded" instead of inventing an
 * answer when the advice was never written down.
 */

const AT = "2026-01-01T00:00:00.000Z";

function observation(overrides: Partial<RuntimeObservation> = {}): RuntimeObservation {
  const input: ObservationInput = {
    observationId: "obs-1",
    traceId: traceIdFor("task-1"),
    task: { taskId: "task-1", role: "coder", taskKind: "coding" },
    model: { modelKey: "p:f:1", provider: "p", family: "f", version: "1", basis: "RECOMMENDED", reasonRefs: ["capability:coding"] },
    node: { nodeId: "node-a", basis: "RECOMMENDED", reasonRefs: ["memory:free"] },
    createdAt: AT
  };
  const base = createObservation(input);
  return { ...base, ...overrides };
}

describe("observation identity", () => {
  it("gives one trace per task and a distinct id per run", () => {
    expect(traceIdFor("task-1")).toBe(traceIdFor("task-1"));
    expect(traceIdFor("task-1")).not.toBe(traceIdFor("task-2"));
    expect(observationIdFor({ taskId: "task-1", modelKey: "m", nodeId: "n", sequence: 1 })).not.toBe(
      observationIdFor({ taskId: "task-1", modelKey: "m", nodeId: "n", sequence: 2 })
    );
  });
});

describe("the record's defaults are honest, not flattering", () => {
  it("records an unknown outcome as UNKNOWN and an unreviewed run as NOT_REVIEWED", () => {
    const record = observation();
    expect(record.execution.outcome).toBe("UNKNOWN");
    expect(record.review.agreement).toBe("NOT_REVIEWED");
    expect(record.capabilityUpdate.applied).toBe(false);
    expect(record.capabilityUpdate.reason).toBeTruthy();
  });

  it("keeps an unmeasured failure class, latency, tokens and cost absent rather than zero", () => {
    const record = observation();
    expect(record.execution.failureClass).toBeUndefined();
    expect(record.execution.latencyMs).toBeUndefined();
    expect(record.execution.tokens).toBeUndefined();
    expect(record.execution.costUsd).toBeUndefined();
  });

  it("never guesses a model version", () => {
    const record = createObservation({
      observationId: "obs-2",
      traceId: "t",
      task: { taskId: "task-1", role: "coder", taskKind: "coding" },
      model: { modelKey: "p:f:unknown", provider: "p", family: "f" },
      node: { nodeId: "n" },
      createdAt: AT
    });
    expect(record.model.version).toBe("unknown");
    expect(record.model.basis).toBe("UNKNOWN");
    expect(record.node.basis).toBe("UNKNOWN");
  });

  it("carries a kind and schema version so a reader can refuse an older row", () => {
    const record = observation();
    expect(record.kind).toBe("RUNTIME_OBSERVATION");
    expect(record.schemaVersion).toBe(1);
  });
});

describe("loadout evidence", () => {
  it("separates 'mounted' from 'invoked'", () => {
    const record = observation({ skills: { recommended: ["a", "b"], actual: ["a", "b"], used: ["a"] } });
    expect(loadoutWasFollowed(record)).toBe(true);
    expect(unusedMountedSkills(record)).toEqual(["b"]);
  });

  it("detects a loadout that was recommended but not followed", () => {
    const record = observation({ skills: { recommended: ["a", "b"], actual: ["a"], used: ["a"] } });
    expect(loadoutWasFollowed(record)).toBe(false);
    expect(unusedMountedSkills(record)).toEqual([]);
  });
});

describe("a decision is judged against its outcome", () => {
  it("says NO_ADVICE_RECORDED when no recommendation reached the run", () => {
    const record = observation({ model: { modelKey: "m", provider: "p", family: "f", version: "1", basis: "UNKNOWN", reasonRefs: [] } });
    expect(judgeDecisionOutcome(record)).toBe("NO_ADVICE_RECORDED");
  });

  it("says INCONCLUSIVE_NO_OUTCOME rather than counting an unobserved outcome either way", () => {
    expect(judgeDecisionOutcome(observation())).toBe("INCONCLUSIVE_NO_OUTCOME");
  });

  it("supports or contradicts the advice only when an outcome was observed", () => {
    expect(judgeDecisionOutcome(observation({ execution: { outcome: "SUCCESS" } }))).toBe("SUPPORTED_BY_OUTCOME");
    expect(judgeDecisionOutcome(observation({ execution: { outcome: "FAILED", failureClass: "TIMEOUT" } }))).toBe("CONTRADICTED_BY_OUTCOME");
  });

  it("records a fallback as NOT_FOLLOWED, which is not the same as a failure", () => {
    const record = observation({ model: { modelKey: "m2", provider: "p", family: "f", version: "1", basis: "FALLBACK", reasonRefs: [] }, execution: { outcome: "SUCCESS" } });
    expect(judgeDecisionOutcome(record)).toBe("NOT_FOLLOWED");
  });
});

describe("the explanation answers the operator's questions", () => {
  it("says plainly when no recommendation was recorded", () => {
    const input: ExplanationInput = { observation: observation() };
    const explanation: ObservationExplanation = explainObservation(input);
    expect(explanation.whyThisModel).toContain("no scheduling recommendation was recorded");
    expect(explanation.whyThisNode).toContain("no node recommendation was recorded");
    expect(explanation.whyThisNode).toContain("node-a is recorded as RECOMMENDED");
    expect(explanation.continuationAdvice).toContain("no shadow continuation opinion was recorded");
    const verdict: DecisionOutcomeVerdict = explanation.decisionOutcome;
    expect(verdict).toBe("INCONCLUSIVE_NO_OUTCOME");
  });

  it("quotes the recommendation's own factors and reasons when they exist", () => {
    const explanation = explainObservation({
      observation: observation({ execution: { outcome: "SUCCESS" } }),
      recommendation: {
        schemaVersion: 1,
        kind: "SCHEDULING_RECOMMENDATION",
        recommendationId: "rec-1",
        taskId: "task-1",
        createdAt: AT,
        authority: "ADVISORY_ONLY",
        preferredNode: { nodeId: "node-a", score: 0.8, reasons: ["48 GB free"] },
        preferredModel: { modelKey: "p:f:1", score: 0.9, confidence: 0.7, reasons: ["coding estimate 0.9 with 4 samples"] },
        preferredSkillLoadout: ["a"],
        reasoningFactors: [{ factor: "capability.coding", weight: 0.5, detail: "task needs coding", evidence: ["p:f:1"] }],
        confidence: 0.7,
        estimatedRisk: "low",
        blocked: [],
        productionRoutingAuthority: false,
        qualificationHostSelection: false
      },
      deviations: ["operator pinned the node"]
    });
    expect(explanation.whyThisModel).toContain("p:f:1");
    expect(explanation.whyThisNode).toContain("node-a");
    expect(explanation.decisionOutcome).toBe("SUPPORTED_BY_OUTCOME");
    expect(explanation.evidence.join("\n")).toContain("operator pinned the node");
    expect(explanation.evidence.join("\n")).toContain("capability.coding");
  });

  it("distinguishes wasted mounting from an unused skill", () => {
    const explanation = explainObservation({ observation: observation({ skills: { recommended: ["a", "b"], actual: ["a", "b"], used: ["a"] } }) });
    expect(explanation.whyNotOtherSkills).toContain("mounted but never invoked: b");
    expect(explanation.whyNotOtherSkills).toContain("not evidence that the skill is useless");
  });

  it("states that archived context is still retrievable", () => {
    const explanation = explainObservation({ observation: observation({ context: { injected: ["c1"], candidate: ["c2"], archived: ["c3"] } }) });
    expect(explanation.whyThisContext).toContain("injected 1 record(s): c1");
    expect(explanation.whyThisContext).toContain("still retrievable");
  });
});
