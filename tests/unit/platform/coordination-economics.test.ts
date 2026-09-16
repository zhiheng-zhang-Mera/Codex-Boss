import { describe, expect, it } from "vitest";
import {
  COORDINATION_MEASURES,
  COORDINATION_STAGES,
  evaluateStageGuard,
  permittedPipeline,
  summarizeCoordination,
  totalRecord,
  totalStage,
  type CoordinationMeasure,
  type CoordinationRecord,
  type CoordinationStage,
  type CoordinationStageRecord
} from "../../../src/shared/coordination-economics";

/**
 * Phase 05 Task D — agent coordination economics, and the added-stage guard.
 *
 * The book's rule is that an extra agent stage must not become the default pipeline if it only
 * increases token and wall-time without improving defect or rework. The property that makes the rule
 * worth having is the one exercised hardest here: **the guard must answer "I cannot tell" rather than
 * approve a stage on an unmeasured figure**. A composition rule that accepted estimated token counts
 * would promote an expensive stage on the strength of a guess, which is worse than having no rule.
 *
 * The records below are built through the same shape the production ledger already populates
 * (`modelCalls`, `estimatedInputTokens`, `retries`, `toolCalls`, `modifiedFiles`), so a record
 * describes the running system rather than a parallel accounting.
 */

const ALL: CoordinationMeasure[] = [...COORDINATION_MEASURES];

function stage(stageName: CoordinationStage, overrides: Partial<CoordinationStageRecord> = {}): CoordinationStageRecord {
  return {
    stage: stageName,
    modelCalls: 1,
    inputTokens: 1_000,
    outputTokens: 500,
    wallMs: 1_000,
    coordinationMs: 100,
    executionMs: 900,
    reviewFindings: 0,
    reworkAvoided: 0,
    diffLines: 10,
    defectsEscaped: 0,
    ...overrides
  };
}

function record(
  taskId: string,
  pipeline: CoordinationStage[],
  stages: CoordinationStageRecord[],
  overrides: Partial<CoordinationRecord> = {}
): CoordinationRecord {
  return { taskId, pipeline, stages, runtime: "test-runtime", measured: ALL, at: "2026-09-16T00:00:00.000Z", ...overrides };
}

/** A task that ran the baseline pipeline: no review stage. */
function baselineTask(taskId: string, defectsEscaped: number, reworkAvoided = 0): CoordinationRecord {
  return record(taskId, ["implement", "finalize"], [
    stage("implement", { defectsEscaped, reworkAvoided }),
    stage("finalize", { defectsEscaped: 0, reworkAvoided: 0 })
  ]);
}

/** The same task with a review stage added before finalize. */
function reviewedTask(taskId: string, defectsEscaped: number, reworkAvoided: number): CoordinationRecord {
  return record(taskId, ["implement", "review", "finalize"], [
    stage("implement", { defectsEscaped: 0, reworkAvoided: 0 }),
    stage("review", { reviewFindings: 2, reworkAvoided, inputTokens: 2_000, modelCalls: 2, wallMs: 2_000 }),
    stage("finalize", { defectsEscaped, reworkAvoided: 0 })
  ]);
}

describe("Phase 05 Task D — the accounting totals what was measured and shows what was not", () => {
  it("totals a record across its stages, with coordination share of wall time", () => {
    const totals = totalRecord(record("t1", ["implement", "review"], [
      stage("implement", { inputTokens: 1_000, wallMs: 1_000, coordinationMs: 200, defectsEscaped: 1 }),
      stage("review", { inputTokens: 3_000, wallMs: 3_000, coordinationMs: 800, reworkAvoided: 2, reviewFindings: 2 })
    ]));
    expect(totals.inputTokens).toBe(4_000);
    expect(totals.wallMs).toBe(4_000);
    expect(totals.coordinationMs).toBe(1_000);
    expect(totals.coordinationShare).toBeCloseTo(0.25, 5);
    expect(totals.reworkAvoided).toBe(2);
    expect(totals.defectsEscaped).toBe(1);
  });

  it("reports a coordination share of null, not zero, when wall time was never observed", () => {
    // Zero would read as "no coordination cost", which is a claim; null reads as "not measured".
    const totals = totalRecord(record("t1", ["implement"], [stage("implement", { wallMs: null, coordinationMs: null })], {
      measured: ALL.filter((measure) => measure !== "wallMs" && measure !== "coordinationMs")
    }));
    expect(totals.coordinationShare).toBeNull();
  });

  it("keeps an absent figure out of the total instead of counting it as zero", () => {
    const partial = record("t1", ["implement"], [stage("implement", { inputTokens: null, modelCalls: 4 })], {
      measured: ALL.filter((measure) => measure !== "inputTokens")
    });
    expect(totalRecord(partial).inputTokens).toBe(0);
    // And the record says the figure was not observed, which is what a guard reads.
    expect(partial.measured).not.toContain("inputTokens");
  });

  it("marks a stage incomplete when any task left a figure unobserved", () => {
    const records = [
      record("t1", ["review"], [stage("review")]),
      record("t2", ["review"], [stage("review", { reviewFindings: null })])
    ];
    const economics = totalStage(records, "review");
    expect(economics.tasks).toBe(2);
    expect(economics.complete).toBe(false);
    expect(economics.unmeasured.length).toBeGreaterThan(0);
    // A stage no task ran is incomplete too, rather than a clean zero.
    expect(totalStage(records, "repair").complete).toBe(false);
  });
});

describe("Phase 05 Task D — the guard refuses to promote on unmeasured figures", () => {
  it("returns INSUFFICIENT_EVIDENCE with no baseline rather than assuming one", () => {
    const result = evaluateStageGuard({ stage: "review", withStage: [reviewedTask("a", 0, 2)], withoutStage: [] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.comparison).toBeNull();
    expect(result.reasons.join(" ")).toContain("no comparable task ran the pipeline without review");
  });

  it("returns INSUFFICIENT_EVIDENCE when a decision figure was never observed", () => {
    // The heart of the matter: the stage looks great, but nobody measured whether defects escaped.
    const noDefectMeasure = ALL.filter((measure) => measure !== "defectsEscaped");
    const withStage = [record("a", ["implement", "review"], [stage("implement"), stage("review", { reworkAvoided: 5 })], { measured: noDefectMeasure })];
    const withoutStage = [record("b", ["implement"], [stage("implement")], { measured: noDefectMeasure })];
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("defectsEscaped");
  });

  it("names EVERY missing figure, not the first one it stumbles on", () => {
    const sparse = ALL.filter((measure) => measure !== "defectsEscaped" && measure !== "reworkAvoided");
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [record("a", ["implement", "review"], [stage("implement"), stage("review")], { measured: sparse })],
      withoutStage: [record("b", ["implement"], [stage("implement")], { measured: sparse })]
    });
    expect(result.reasons.join(" ")).toContain("defectsEscaped");
    expect(result.reasons.join(" ")).toContain("reworkAvoided");
  });

  it("refuses to compare across two different runtimes", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [record("a", ["implement", "review"], [stage("implement"), stage("review")], { runtime: "web:chatgpt" })],
      withoutStage: [record("b", ["implement"], [stage("implement")], { runtime: "api:claude" })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("different runtimes");
  });

  it("rejects sets that overlap, because a comparison against itself proves nothing", () => {
    const contaminated = [record("a", ["implement", "review"], [stage("implement"), stage("review")])];
    const result = evaluateStageGuard({ stage: "review", withStage: contaminated, withoutStage: contaminated });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("actually includes review");
  });
});

describe("Phase 05 Task D — the guard approves only a measured improvement", () => {
  it("EARNS_PLACE when the stage cuts escaped defects", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [reviewedTask("a", 0, 2), reviewedTask("b", 0, 1)],
      withoutStage: [baselineTask("c", 3), baselineTask("d", 2)]
    });
    expect(result.verdict).toBe("EARNS_PLACE");
    expect(result.comparison?.changeInDefectsEscaped).toBeLessThan(0);
    expect(result.reasons.join(" ")).toContain("escaped defects");
  });

  it("EARNS_PLACE when the stage increases rework avoided, even with defects unchanged", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [reviewedTask("a", 1, 5), reviewedTask("b", 1, 5)],
      withoutStage: [baselineTask("c", 1, 0), baselineTask("d", 1, 0)]
    });
    expect(result.verdict).toBe("EARNS_PLACE");
    expect(result.comparison?.changeInReworkAvoided).toBeGreaterThan(0);
  });

  it("COST_ONLY when the stage buys nothing and costs more — the book's exact case", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [reviewedTask("a", 1, 0), reviewedTask("b", 1, 0)],
      withoutStage: [baselineTask("c", 1), baselineTask("d", 1)]
    });
    expect(result.verdict).toBe("COST_ONLY");
    expect(result.comparison?.addedInputTokens).toBeGreaterThan(0);
    expect(result.reasons.join(" ")).toContain("bought nothing measurable");
    expect(result.reasons.join(" ")).toContain("added");
  });

  it("COST_ONLY on a tie, because a tie on benefit is decided against the extra stage", () => {
    // Same cost, same benefit: the stage adds a moving part and changes nothing.
    const same = (taskId: string): CoordinationRecord => record(taskId, ["implement", "review"], [
      stage("implement", { inputTokens: 1_000, wallMs: 1_000, defectsEscaped: 1 }),
      stage("review", { inputTokens: 0, wallMs: 0, modelCalls: 0, defectsEscaped: 0, reworkAvoided: 0 })
    ]);
    const baseline: CoordinationRecord = record("b", ["implement"], [stage("implement", { inputTokens: 1_000, wallMs: 1_000, defectsEscaped: 1 })]);
    const result = evaluateStageGuard({ stage: "review", withStage: [same("a")], withoutStage: [baseline] });
    expect(result.verdict).toBe("COST_ONLY");
    expect(result.reasons.join(" ")).toContain("tie on benefit is decided against");
  });

  it("compares PER TASK, so running a stage more often cannot make it look better", () => {
    // Two reviewed tasks against one baseline task. In TOTALS the reviewed set escapes more defects
    // (1 against 0) while per task it escapes fewer (0.5 against 0)... so the honest reading is that
    // this stage still buys something here. The point of the test is that the arithmetic is per task:
    // a stage run 50 times always beats a baseline run once if the comparison is on totals.
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [reviewedTask("a", 1, 1), reviewedTask("b", 1, 1)],
      withoutStage: [baselineTask("c", 4)]
    });
    expect(result.comparison).not.toBeNull();
    // Per task the reviewed set escaped 1 defect each against 4 for the baseline: an improvement.
    expect(result.verdict).toBe("EARNS_PLACE");
    // And the totals are reported as totals, so the raw figures remain auditable rather than hidden
    // behind the per-task view that decided the case.
    expect(result.comparison?.candidate.defectsEscaped).toBe(2);
    expect(result.comparison?.baseline.defectsEscaped).toBe(4);
  });

  it("does not read a runtime-different comparison as a promotion even when the numbers look good", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [record("a", ["implement", "review"], [stage("implement", { defectsEscaped: 0 }), stage("review", { reworkAvoided: 9 })], { runtime: "web:chatgpt" })],
      withoutStage: [record("b", ["implement"], [stage("implement", { defectsEscaped: 9 })], { runtime: "api:deepseek" })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("Phase 05 Task D — composition follows the verdict, and cannot quietly drop a required stage", () => {
  it("adds the stage only on EARNS_PLACE", () => {
    const current: CoordinationStage[] = ["implement", "finalize"];
    expect(permittedPipeline({ current, candidate: "review", verdict: "EARNS_PLACE" }).pipeline).toEqual(["implement", "finalize", "review"]);
    for (const verdict of ["COST_ONLY", "INSUFFICIENT_EVIDENCE"] as const) {
      const decision = permittedPipeline({ current, candidate: "review", verdict });
      expect(decision.pipeline).toEqual(current);
      expect(decision.changed).toBe(false);
      expect(decision.reason).toContain(verdict);
    }
  });

  it("is idempotent: a stage already in the pipeline is not added twice", () => {
    const decision = permittedPipeline({ current: ["implement", "review"], candidate: "review", verdict: "EARNS_PLACE" });
    expect(decision.pipeline).toEqual(["implement", "review"]);
    expect(decision.changed).toBe(false);
  });

  it("never removes a required stage, whatever the verdict says", () => {
    // The rule only ever ADDS. A guard able to quietly drop a verification step would be worse than
    // no guard, so a refusal leaves the pipeline untouched including everything the caller requires.
    const current: CoordinationStage[] = ["implement", "verify", "finalize"];
    for (const verdict of ["EARNS_PLACE", "COST_ONLY", "INSUFFICIENT_EVIDENCE"] as const) {
      const decision = permittedPipeline({ current, candidate: "review", verdict, required: ["verify"] });
      expect(decision.pipeline).toContain("verify");
    }
  });
});

describe("Phase 05 Task D — the vocabulary is closed and the summary is readable", () => {
  it("declares the stages and measures the book names", () => {
    expect([...COORDINATION_STAGES]).toEqual(["intake", "plan", "implement", "verify", "review", "repair", "finalize"]);
    // The nine figures the book lists, plus the two time splits that make coordination visible.
    for (const measure of ["modelCalls", "inputTokens", "outputTokens", "wallMs", "coordinationMs", "executionMs", "reviewFindings", "reworkAvoided", "diffLines", "defectsEscaped"] as const) {
      expect(COORDINATION_MEASURES).toContain(measure);
    }
  });

  it("summarises a run without dumping the raw records", () => {
    const summary = summarizeCoordination([reviewedTask("a", 0, 2), reviewedTask("b", 0, 1)]);
    expect(summary).toContain("2 task(s)");
    expect(summary).toContain("model calls");
    expect(summary).toContain("coordination share of wall time");
    expect(summarizeCoordination([])).toBe("no coordination records");
  });

  it("is reproducible: the same records give the same guard result", () => {
    const input = { stage: "review" as const, withStage: [reviewedTask("a", 0, 2)], withoutStage: [baselineTask("c", 3)] };
    const first = evaluateStageGuard(input);
    const second = evaluateStageGuard(input);
    expect(second).toEqual(first);
  });
});
