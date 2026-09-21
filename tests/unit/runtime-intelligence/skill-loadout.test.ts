import { describe, expect, it } from "vitest";
import * as skillLoadout from "../../../src/shared/runtime-intelligence/skill-loadout";
import {
  SKILL_STATE_RANK,
  SKILL_STATE_VOCABULARY,
  SKILL_THRESHOLDS,
  classifySkillState,
  evaluateLoadoutShadow,
  isHighOverhead,
  recommendLoadout,
  summarizeSkillTelemetry,
  type LoadoutInput,
  type LoadoutShadowEvaluation,
  type LoadoutShadowInput
} from "../../../src/shared/runtime-intelligence/skill-loadout";
import type { SkillCard, SkillUsageTelemetry, TaskProfile } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase B. The two claims that matter are asserted directly: an unused or high-overhead
 * skill is identifiable, and nothing in this module can delete a skill. The second claim
 * is checked against the module's own exports, so it cannot be weakened by adding a
 * helpful `pruneSkill()` later without this test failing.
 */

const AT = "2026-01-01T00:00:00.000Z";

function card(overrides: Partial<SkillCard> & { skillId: string }): SkillCard {
  return { schemaVersion: 1, name: overrides.skillId, providesCapabilities: ["coding"], contextTokens: 500, baseLatencyMs: 100, tags: [], ...overrides };
}

function telemetry(overrides: Partial<SkillUsageTelemetry> & { skillId: string }): SkillUsageTelemetry {
  return {
    taskId: "task-1",
    observationId: "obs-1",
    selected: true,
    used: true,
    invocationCount: 1,
    contextTokens: 500,
    latencyMs: 100,
    success: true,
    conflictsWith: [],
    overlappingWith: [],
    at: AT,
    ...overrides
  };
}

function task(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    taskId: "task-1",
    role: "coder",
    taskKind: "coding",
    requiredCapabilities: ["coding"],
    contextScale: "small",
    externalEffect: false,
    risk: "low",
    createdAt: AT,
    ...overrides
  };
}

function summaryOf(entries: SkillUsageTelemetry[], skillId = entries[0]?.skillId ?? "s") {
  return summarizeSkillTelemetry(skillId, entries);
}

describe("telemetry aggregation separates selection from use", () => {
  it("counts selections, uses, invocations and the unused selections that cost tokens", () => {
    const entries = [
      telemetry({ skillId: "s", selected: true, used: true }),
      telemetry({ skillId: "s", selected: true, used: false, invocationCount: 0 }),
      telemetry({ skillId: "s", selected: true, used: false, invocationCount: 0 }),
      telemetry({ skillId: "s", selected: true, used: true, success: false })
    ];
    const summary = summaryOf(entries);
    expect(summary.selections).toBe(4);
    expect(summary.uses).toBe(2);
    expect(summary.invocations).toBe(2);
    expect(summary.unusedSelections).toBe(2);
    expect(summary.usageRate).toBe(0.5);
    expect(summary.contextTokensMounted).toBe(2000);
    expect(summary.successes).toBe(1);
    expect(summary.failures).toBe(1);
    expect(summary.successContribution).toBe(0.5);
  });

  it("does not credit a skill for a success on a task where it never ran", () => {
    const summary = summaryOf([telemetry({ skillId: "s", selected: true, used: false, invocationCount: 0, success: true })]);
    expect(summary.successContribution).toBe(0);
    expect(summary.failureAssociation).toBe(0);
  });

  it("reports zero rates for a skill with no telemetry rather than dividing by zero", () => {
    const summary = summarizeSkillTelemetry("never-seen", []);
    expect(summary).toMatchObject({ selections: 0, uses: 0, usageRate: 0, successContribution: 0, failureAssociation: 0, redundancy: 0 });
  });

  it("collects conflicts and overlaps as sets", () => {
    const summary = summaryOf([
      telemetry({ skillId: "s", overlappingWith: ["b"], conflictsWith: ["c"] }),
      telemetry({ skillId: "s", overlappingWith: ["b", "d"], conflictsWith: [] })
    ]);
    expect(summary.redundancy).toBe(2);
    expect(summary.conflicts).toEqual(["c"]);
  });

  it("recognises high overhead by tokens or by latency", () => {
    expect(isHighOverhead(summaryOf([telemetry({ skillId: "s", contextTokens: SKILL_THRESHOLDS.highOverheadContextTokens })]) )).toBe(true);
    expect(isHighOverhead(summaryOf([telemetry({ skillId: "s", latencyMs: SKILL_THRESHOLDS.highOverheadLatencyMs })]) )).toBe(true);
    expect(isHighOverhead(summaryOf([telemetry({ skillId: "s" })]))).toBe(false);
  });
});

describe("the six states are derived from usage, overhead and overlap", () => {
  it("declares all six states with a total preference order", () => {
    expect(SKILL_STATE_VOCABULARY).toEqual(["HOT", "WARM", "COLD", "RARE", "REDUNDANT", "PRUNE_CANDIDATE"]);
    const ranks = SKILL_STATE_VOCABULARY.map((state) => SKILL_STATE_RANK[state]);
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
  });

  it("calls a consistently used skill HOT", () => {
    const assessment = classifySkillState(summaryOf([telemetry({ skillId: "s" }), telemetry({ skillId: "s" }), telemetry({ skillId: "s" })]));
    expect(assessment.state).toBe("HOT");
    expect(assessment.reasons.join(" ")).toContain("3 of 3");
  });

  it("calls a half-used skill with no overlap WARM", () => {
    const assessment = classifySkillState(summaryOf([telemetry({ skillId: "s" }), telemetry({ skillId: "s" }), telemetry({ skillId: "s", used: false, invocationCount: 0 }), telemetry({ skillId: "s", used: false, invocationCount: 0 })]));
    expect(assessment.state).toBe("WARM");
  });

  it("calls a rarely used skill RARE", () => {
    const assessment = classifySkillState(summaryOf([telemetry({ skillId: "s" }), telemetry({ skillId: "s", used: false, invocationCount: 0 }), telemetry({ skillId: "s", used: false, invocationCount: 0 }), telemetry({ skillId: "s", used: false, invocationCount: 0 })]));
    expect(assessment.state).toBe("RARE");
  });

  it("calls a never-selected skill COLD, explicitly kept available", () => {
    const assessment = classifySkillState(summarizeSkillTelemetry("s", []));
    expect(assessment.state).toBe("COLD");
    expect(assessment.reasons.join(" ")).toContain("never selected");
    expect(assessment.reasons.join(" ")).toContain("kept available");
  });

  it("calls a high-overhead, rarely used skill COLD and names the cost", () => {
    const entries = [
      telemetry({ skillId: "s", contextTokens: 5000, latencyMs: 2000 }),
      telemetry({ skillId: "s", used: false, invocationCount: 0, contextTokens: 5000, latencyMs: 2000 }),
      telemetry({ skillId: "s", used: false, invocationCount: 0, contextTokens: 5000, latencyMs: 2000 }),
      telemetry({ skillId: "s", used: false, invocationCount: 0, contextTokens: 5000, latencyMs: 2000 })
    ];
    const assessment = classifySkillState(summaryOf(entries));
    expect(assessment.state).toBe("COLD");
    expect(assessment.reasons.join(" ")).toContain("20000 tokens");
    expect(assessment.reasons.join(" ")).toContain("high overhead");
  });

  it("calls an overlapped skill REDUNDANT", () => {
    // Two unused selections with an overlap is redundant but not yet a prune candidate:
    // the prune threshold is what keeps "overlapped once" from becoming "remove it".
    const entries = [
      telemetry({ skillId: "s", used: false, invocationCount: 0, overlappingWith: ["other"] }),
      telemetry({ skillId: "s", used: false, invocationCount: 0, overlappingWith: ["other"] })
    ];
    const assessment = classifySkillState(summaryOf(entries));
    expect(assessment.state).toBe("REDUNDANT");
    expect(assessment.reasons.join(" ")).toContain("overlap");
    expect(assessment.summary.unusedSelections).toBeLessThan(SKILL_THRESHOLDS.minUnusedForPrune);
  });

  it("calls a repeatedly-unused, overlapped skill PRUNE_CANDIDATE and says it is not deleted", () => {
    const entries = [
      telemetry({ skillId: "s", used: false, invocationCount: 0, overlappingWith: ["other"] }),
      telemetry({ skillId: "s", used: false, invocationCount: 0, overlappingWith: ["other"] }),
      telemetry({ skillId: "s", used: false, invocationCount: 0, overlappingWith: ["other"] }),
      telemetry({ skillId: "s", used: false, invocationCount: 0, overlappingWith: ["other"] })
    ];
    const assessment = classifySkillState(summaryOf(entries));
    expect(assessment.state).toBe("PRUNE_CANDIDATE");
    expect(assessment.reasons.join(" ")).toContain("NOT deleted");
    expect(assessment.reasons.join(" ")).toContain("no code is removed");
  });

  it("keeps a merely unused skill out of PRUNE_CANDIDATE when nothing replaces it", () => {
    const entries = [
      telemetry({ skillId: "s", used: false, invocationCount: 0 }),
      telemetry({ skillId: "s", used: false, invocationCount: 0 }),
      telemetry({ skillId: "s", used: false, invocationCount: 0 }),
      telemetry({ skillId: "s", used: false, invocationCount: 0 })
    ];
    const assessment = classifySkillState(summaryOf(entries));
    expect(assessment.state).not.toBe("PRUNE_CANDIDATE");
    expect(assessment.state).toBe("RARE");
    expect(SKILL_THRESHOLDS.minUnusedForPrune).toBeGreaterThan(0);
  });

  it("does not assert a hot or rare state from a single selection", () => {
    const single = classifySkillState(summaryOf([telemetry({ skillId: "s" })]));
    expect(single.state).not.toBe("HOT");
    expect(single.state).toBe("WARM");
  });
});

describe("there is no delete: PRUNE_CANDIDATE is a state, not an action", () => {
  it("exports no mutating function at all", () => {
    const mutating = Object.keys(skillLoadout).filter((name) => /delete|remove|uninstall|prune|purge|drop|disable/i.test(name));
    expect(mutating, `this module must not be able to remove a skill: ${mutating.join(", ")}`).toEqual([]);
  });

  it("returns an advisory recommendation whose authority can never be anything else", () => {
    const input: LoadoutInput = { task: task(), cards: [card({ skillId: "a" })] };
    expect(recommendLoadout(input).authority).toBe("ADVISORY_ONLY");
  });

  it("says in the shadow evaluation that it deletes nothing", () => {
    const input: LoadoutShadowInput = { observationId: "obs-1", taskId: "task-1", recommended: ["a"], actual: ["a"], used: [], cards: [card({ skillId: "a" })] };
    const evaluation: LoadoutShadowEvaluation = evaluateLoadoutShadow(input);
    expect(evaluation.deletesNothing).toBe(true);
  });

  it("fires the no-delete control: a deleting export WOULD be caught", () => {
    const probe = { pruneSkill: () => undefined };
    const mutating = Object.keys(probe).filter((name) => /delete|remove|uninstall|prune|purge|drop|disable/i.test(name));
    expect(mutating).toEqual(["pruneSkill"]);
  });
});

describe("loadout recommendation explains every omission", () => {
  const cards = [card({ skillId: "a", providesCapabilities: ["coding"] }), card({ skillId: "b", providesCapabilities: ["coding"] }), card({ skillId: "c", providesCapabilities: ["research"] })];

  it("mounts the best covering skill and explains the two it leaves out", () => {
    const recommendation = recommendLoadout({ task: task(), cards });
    expect(recommendation.mountedSkillIds).toEqual(["a"]);
    expect(recommendation.omittedSkillIds.sort()).toEqual(["b", "c"]);
    expect(recommendation.omittedBecause.find((entry) => entry.skillId === "b")?.reason).toContain("already covered");
    expect(recommendation.omittedBecause.find((entry) => entry.skillId === "c")?.reason).toContain("serves none");
    expect(recommendation.projectedContextTokens).toBe(500);
    expect(recommendation.projectedLatencyMs).toBe(100);
  });

  it("mounts nothing when the task declares no capability, and says why", () => {
    const recommendation = recommendLoadout({ task: task({ requiredCapabilities: [] }), cards });
    expect(recommendation.mountedSkillIds).toEqual([]);
    expect(recommendation.factors[0].detail).toContain("declares no capability");
  });

  it("never mounts a redundant or prune-candidate skill even when only it covers a capability", () => {
    const summaries = [
      summarizeSkillTelemetry("a", []),
      classifySkillState(
        summaryOf([
          telemetry({ skillId: "b", used: false, invocationCount: 0, overlappingWith: ["a"] }),
          telemetry({ skillId: "b", used: false, invocationCount: 0, overlappingWith: ["a"] }),
          telemetry({ skillId: "b", used: false, invocationCount: 0, overlappingWith: ["a"] })
        ])
      ).summary
    ];
    expect(classifySkillState(summaries[1]).state).toBe("PRUNE_CANDIDATE");
    const recommendation = recommendLoadout({
      task: task({ requiredCapabilities: ["coding", "review"] }),
      cards: [card({ skillId: "a", providesCapabilities: ["coding"] }), card({ skillId: "b", providesCapabilities: ["review"] })],
      summaries
    });
    expect(recommendation.mountedSkillIds).toEqual(["a"]);
    expect(recommendation.omittedBecause.find((entry) => entry.skillId === "b")?.reason).toContain("PRUNE_CANDIDATE");
    // The capability it would have served is then honestly reported as uncovered.
    expect(recommendation.factors.find((factor) => factor.factor === "capability.uncovered")?.evidence).toEqual(["review"]);
  });

  it("mounts a pinned skill regardless of its state", () => {
    const recommendation = recommendLoadout({ task: task(), cards, pinned: ["b"] });
    expect(recommendation.mountedSkillIds).toContain("b");
    expect(recommendation.factors.some((factor) => factor.factor === "skill.pinned")).toBe(true);
  });

  it("respects a loadout token budget and explains the skill it dropped", () => {
    const recommendation = recommendLoadout({
      task: task({ requiredCapabilities: ["coding", "review"] }),
      cards: [card({ skillId: "a", providesCapabilities: ["coding"], contextTokens: 500 }), card({ skillId: "b", providesCapabilities: ["review"], contextTokens: 500 })],
      maxContextTokens: 600
    });
    expect(recommendation.mountedSkillIds).toEqual(["a"]);
    expect(recommendation.omittedBecause.find((entry) => entry.skillId === "b")?.reason).toContain("600-token loadout budget");
  });

  it("reports an uncovered capability instead of implying full coverage", () => {
    const recommendation = recommendLoadout({ task: task({ requiredCapabilities: ["coding", "computer_use"] }), cards });
    expect(recommendation.mountedSkillIds).toEqual(["a"]);
    expect(recommendation.factors.find((factor) => factor.factor === "capability.uncovered")?.evidence).toEqual(["computer_use"]);
  });
});

describe("the shadow evaluation reports divergence without acting on it", () => {
  const cards = [card({ skillId: "a", contextTokens: 800 }), card({ skillId: "b", contextTokens: 200 })];

  it("reports a loadout that was followed but wasted tokens on an unused skill", () => {
    const evaluation = evaluateLoadoutShadow({ observationId: "obs-1", taskId: "task-1", recommended: ["a", "b"], actual: ["a", "b"], used: ["a"], cards });
    expect(evaluation.followed).toBe(true);
    expect(evaluation.unusedMounted).toEqual(["b"]);
    expect(evaluation.wastedContextTokens).toBe(200);
    expect(evaluation.findings.join(" ")).toContain("200 tokens of prompt overhead produced no invocation");
  });

  it("reports a recommendation that never reached execution", () => {
    const evaluation = evaluateLoadoutShadow({ observationId: "obs-2", taskId: "task-1", recommended: ["a", "b"], actual: ["a"], used: ["a"], cards });
    expect(evaluation.followed).toBe(false);
    expect(evaluation.recommendedButNotMounted).toEqual(["b"]);
    expect(evaluation.findings.join(" ")).toContain("did not reach execution");
  });

  it("reports a skill the recommendation would have missed", () => {
    const evaluation = evaluateLoadoutShadow({ observationId: "obs-3", taskId: "task-1", recommended: ["a"], actual: ["a", "b"], used: ["a", "b"], cards });
    expect(evaluation.usedButOmitted).toEqual(["b"]);
    expect(evaluation.findings.join(" ")).toContain("would have missed a skill that helped");
  });

  it("says so plainly when the advice and reality agreed", () => {
    const evaluation = evaluateLoadoutShadow({ observationId: "obs-4", taskId: "task-1", recommended: ["a"], actual: ["a"], used: ["a"], cards });
    expect(evaluation.findings.join(" ")).toContain("every mounted skill was invoked");
  });
});
