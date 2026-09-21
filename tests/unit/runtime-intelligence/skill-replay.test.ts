import { describe, expect, it } from "vitest";
import {
  MIN_SKILL_REPLAYS_FOR_EVIDENCE,
  replaySkillLoadout,
  replaySkillLoadouts,
  type SkillReplayAggregate,
  type SkillReplayInput,
  type SkillReplayResult,
  type UnderLoadingRisk
} from "../../../src/shared/runtime-intelligence/skill-replay";
import type { SkillCard, SkillHealthSummary, TaskProfile } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Phase H. A replay must never propose dropping a skill that did work, and it must never
 * claim a saving it cannot prove. Both are asserted, along with the control that shows the
 * aggregate would notice a defect if the union with the used set were removed.
 */

const AT = "2026-01-01T00:00:00.000Z";

function card(skillId: string, contextTokens = 500, capabilities: string[] = ["coding"]): SkillCard {
  return { schemaVersion: 1, skillId, name: skillId, providesCapabilities: capabilities, contextTokens, baseLatencyMs: 100, tags: [] };
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

function input(overrides: Partial<SkillReplayInput> = {}): SkillReplayInput {
  return { task: task(), originalSkillIds: ["a", "b"], usedSkillIds: ["a"], cards: [card("a"), card("b")], ...overrides };
}

describe("a replay preserves everything that did work", () => {
  it("keeps an invoked skill even when the advisor would not have mounted it", () => {
    const cards = [card("wanted"), card("used-but-unwanted", 800, ["research"])];
    const result = replaySkillLoadout({ task: task(), originalSkillIds: ["wanted", "used-but-unwanted"], usedSkillIds: ["used-but-unwanted"], cards });
    expect(result.recommendedSkillIds).toContain("used-but-unwanted");
    expect(result.droppedUsedSkillIds).toEqual([]);
    expect(result.preservedUsedSkillIds).toEqual(["used-but-unwanted"]);
    expect(result.riskOfUnderLoading).not.toBe("HIGH");
  });

  it("never reports a dropped invoked skill, and says so as a defect if it ever would", () => {
    const results = [replaySkillLoadout(input()), replaySkillLoadout(input({ usedSkillIds: ["a", "b"] }))];
    for (const result of results) expect(result.droppedUsedSkillIds).toEqual([]);
    const aggregate = replaySkillLoadouts(results);
    expect(aggregate.droppedUsedSkillCount).toBe(0);
    expect(aggregate.notes.join(" ")).not.toContain("replay defect");
  });

  it("fires the control: injecting a dropped invoked skill IS caught by the aggregate", () => {
    const broken: SkillReplayResult = { ...replaySkillLoadout(input()), droppedUsedSkillIds: ["a"], riskOfUnderLoading: "HIGH" };
    const aggregate = replaySkillLoadouts([broken]);
    expect(aggregate.droppedUsedSkillCount).toBe(1);
    expect(aggregate.notes.join(" ")).toContain("replay defect");
    expect(aggregate.riskCounts.HIGH).toBe(1);
  });

  it("preserves an invoked skill that has no card, and refuses to cost it", () => {
    const result = replaySkillLoadout(input({ usedSkillIds: ["a", "mystery"] }));
    expect(result.recommendedSkillIds).toContain("mystery");
    expect(result.uncostedSkillIds).toEqual(["mystery"]);
    expect(result.reasons.join(" ")).toContain("preserved without costing them");
  });
});

describe("the counterfactual reports the saving, and only when it is proven", () => {
  it("drops a mounted-but-unused skill and reports the context and latency saved", () => {
    const result = replaySkillLoadout({ task: task(), originalSkillIds: ["a", "b"], usedSkillIds: ["a"], cards: [card("a", 400), card("b", 900)] });
    expect(result.droppedSkillIds).toEqual(["b"]);
    expect(result.unusedOriginalSkillIds).toEqual(["b"]);
    expect(result.estimatedContextSaved).toBe(900);
    expect(result.estimatedTokenSaved).toBe(900);
    expect(result.estimatedLatencySaved).toBe(100);
    expect(result.usageObserved).toBe(true);
    expect(result.riskOfUnderLoading).toBe("LOW");
  });

  it("reports no saving and UNKNOWN risk when nothing about usage was recorded", () => {
    const result = replaySkillLoadout({ task: task(), originalSkillIds: ["a", "b"], usedSkillIds: [], cards: [card("a"), card("b")] });
    expect(result.usageObserved).toBe(false);
    expect(result.riskOfUnderLoading).toBe("UNKNOWN");
    expect(result.reasons.join(" ")).toContain("unproven");
    expect(result.reasons.join(" ")).toContain("UNKNOWN rather than LOW");
  });

  it("keeps the original loadout exactly when it was already minimal", () => {
    const result = replaySkillLoadout({ task: task(), originalSkillIds: ["a"], usedSkillIds: ["a"], cards: [card("a")] });
    expect(result.droppedSkillIds).toEqual([]);
    expect(result.recommendedSkillIds).toEqual(["a"]);
    expect(result.estimatedTokenSaved).toBe(0);
    expect(result.riskOfUnderLoading).toBe("NONE");
    expect(result.reasons.join(" ")).toContain("exactly what the real run mounted");
  });

  it("marks suspected redundant skills from their own telemetry", () => {
    const summaries: SkillHealthSummary[] = [
      { skillId: "b", selections: 3, uses: 0, invocations: 0, unusedSelections: 3, usageRate: 0, contextTokensMounted: 1500, latencyMsMounted: 300, successes: 0, failures: 0, successContribution: 0, failureAssociation: 0, conflicts: [], redundancy: 2 }
    ];
    const result = replaySkillLoadout({ ...input(), summaries });
    expect(result.suspectedRedundantSkillIds).toEqual(["b"]);
  });
});

describe("the aggregate separates proven savings from unproven ones", () => {
  function provenReplays(count: number): SkillReplayResult[] {
    return Array.from({ length: count }, (_, index) =>
      replaySkillLoadout({ task: task({ taskId: `task-${index}` }), originalSkillIds: ["a", "b"], usedSkillIds: ["a"], cards: [card("a", 400), card("b", 900)] })
    );
  }

  it("sums only the proven savings into the quotable total", () => {
    const unproven = replaySkillLoadout({ task: task({ taskId: "no-usage" }), originalSkillIds: ["a", "b"], usedSkillIds: [], cards: [card("a", 400), card("b", 900)] });
    const aggregate: SkillReplayAggregate = replaySkillLoadouts([...provenReplays(5), unproven]);
    expect(aggregate.estimatedTokenSaved).toBe(5 * 900);
    expect(aggregate.unprovenContextSaved).toBe(900);
    expect(aggregate.replays).toBe(6);
    expect(aggregate.replaysWithUsageObserved).toBe(5);
    expect(aggregate.riskCounts.UNKNOWN).toBe(1);
    expect(aggregate.notes.join(" ")).toContain("not quoted");
  });

  it("reports the load reduction over proven replays only", () => {
    const aggregate = replaySkillLoadouts(provenReplays(5));
    // Two mounted, one recommended: a halving of the mounted set.
    expect(aggregate.originalSkillCount).toBe(10);
    expect(aggregate.recommendedSkillCount).toBe(5);
    expect(aggregate.loadReduction).toBe(0.5);
    expect(aggregate.unusedOriginalSkillCount).toBe(5);
  });

  it("refuses to call a small sample evidence", () => {
    const aggregate = replaySkillLoadouts(provenReplays(MIN_SKILL_REPLAYS_FOR_EVIDENCE - 1));
    expect(aggregate.reason).toBe("INSUFFICIENT_EVIDENCE");
    expect(aggregate.notes.join(" ")).toContain(`needs ${MIN_SKILL_REPLAYS_FOR_EVIDENCE}`);
  });

  it("calls it evidence once enough usage-observed replays exist", () => {
    const aggregate = replaySkillLoadouts(provenReplays(MIN_SKILL_REPLAYS_FOR_EVIDENCE));
    expect(aggregate.reason).toBe("OK");
  });

  it("reports nothing to reduce, and no reduction, for an empty corpus", () => {
    const aggregate = replaySkillLoadouts([]);
    expect(aggregate.replays).toBe(0);
    expect(aggregate.loadReduction).toBe(0);
    expect(aggregate.reason).toBe("INSUFFICIENT_EVIDENCE");
    const risks: UnderLoadingRisk[] = ["NONE", "LOW", "HIGH", "UNKNOWN"];
    expect(risks.map((risk) => aggregate.riskCounts[risk])).toEqual([0, 0, 0, 0]);
  });
});
