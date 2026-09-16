import { describe, expect, it } from "vitest";
import {
  COORDINATION_MEASURES,
  COORDINATION_STAGES,
  evaluateStageGuard,
  permittedPipeline,
  summarizeCoordination,
  totalRecord,
  totalStage,
  type CoordinationCohort,
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

/**
 * A cohort identity two arms can share.
 *
 * Comparability is checked, not assumed, so every record taking part in a promotion decision has to
 * say what it is comparable to. The two arms differ in `arm` and in the planned variable only.
 */
function cohort(arm: string, overrides: Partial<CoordinationCohort> = {}): CoordinationCohort {
  return {
    runtime: "test-runtime",
    benchmarkTaskId: "bench-1",
    inputIdentity: "input-hash-1",
    plannedVariable: "review",
    arm,
    ...overrides
  };
}

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
  return {
    taskId, pipeline, stages, runtime: "test-runtime", measured: ALL,
    cohort: cohort(pipeline.includes("review") ? "with-candidate" : "baseline"),
    at: "2026-09-16T00:00:00.000Z",
    ...overrides
  };
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

describe("Phase 05 Task D — every record is judged by its OWN declaration", () => {
  it("does not let one well-measured record vouch for a set that never measured the figure", () => {
    // THE regression this audit exists for. The first version of `totalStage` read
    // `relevant[0].measured` and applied it to every record, so a single task that declared
    // `defectsEscaped` made every OTHER task's undeclared figure look observed — and a task that had
    // never looked for escaped defects was then counted as having escaped zero. That is a missing
    // measurement wearing the label of a real one, and it silently disabled the guard's refusal.
    const declaring = record("declares", ["review"], [stage("review", { defectsEscaped: 2 })]);
    const silent = record("silent", ["review"], [stage("review", { defectsEscaped: null })], {
      measured: ALL.filter((measure) => measure !== "defectsEscaped")
    });
    const economics = totalStage([declaring, silent], "review");
    expect(economics.complete).toBe(false);
    expect(economics.unmeasured).toContain("defectsEscaped");
    // `defectsEscaped` is usable by one record and not the other, so the aggregate REFUSES to total it
    // rather than summing the half it could see. Reporting 2 would be a figure that looks like a total
    // while silently omitting a task; reporting the silent task as 0 is the old defect. Neither is
    // honest, so the aggregate carries no figure for it at all — and `unmeasured` says which.
    expect(economics.totals.defectsEscaped).toBe(0);
    const usable = COORDINATION_MEASURES.filter((measure) => !economics.unmeasured.includes(measure));
    expect(usable).toContain("wallMs");
    expect(usable).not.toContain("defectsEscaped");
  });

  it("fails closed when a measure is declared but its value is null", () => {
    // Declared-and-null is a contradiction, not a zero. Counting it as zero is the hand-filled
    // arithmetic this phase forbids.
    const broken = record("declared-null", ["review"], [stage("review", { inputTokens: null })]);
    const economics = totalStage([broken], "review");
    expect(economics.complete).toBe(false);
    expect(economics.unmeasured).toContain("inputTokens");
  });

  it("fails closed when a stage carries a value it did not declare measured", () => {
    // A figure of unclear provenance. A comparison built on it would be comparing something nobody
    // claimed to have measured.
    const undeclared = record("undeclared-value", ["review"], [stage("review", { defectsEscaped: 3 })], {
      measured: ALL.filter((measure) => measure !== "defectsEscaped")
    });
    const economics = totalStage([undeclared], "review");
    expect(economics.complete).toBe(false);
    expect(economics.unmeasured).toContain("defectsEscaped");
    expect(economics.totals.defectsEscaped).toBe(0);
  });

  it("is complete only when every record observed every measure", () => {
    const a = record("a", ["review"], [stage("review", { inputTokens: 100 })]);
    const b = record("b", ["review"], [stage("review", { inputTokens: 200 })]);
    const economics = totalStage([a, b], "review");
    expect(economics.complete).toBe(true);
    expect(economics.totals.inputTokens).toBe(300);
    expect(economics.unmeasured).toEqual([]);
  });

  it("counts a record whose pipeline names a stage its stages array omits as incomplete", () => {
    const contradictory: CoordinationRecord = record("contradictory", ["implement", "review"], [stage("implement")]);
    const economics = totalStage([contradictory], "review");
    expect(economics.tasks).toBe(1);
    expect(economics.complete).toBe(false);
  });

  it("REGRESSION: the guard refuses when ANY record lacks a decision measure", () => {
    // The mixed set is the case the old `missingDecisionMeasures` could not see, because it asked
    // whether the measure appeared in ANY record's declaration.
    const withStage = [
      record("c1", ["implement", "review"], [stage("implement", { defectsEscaped: 0 }), stage("review", { reworkAvoided: 3 })]),
      record("c2", ["implement", "review"], [stage("implement", { defectsEscaped: null }), stage("review", { reworkAvoided: 1 })], {
        measured: ALL.filter((measure) => measure !== "defectsEscaped")
      })
    ];
    const withoutStage = [record("b1", ["implement"], [stage("implement", { defectsEscaped: 4 })])];
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage, decisionMeasures: ["reworkAvoided", "defectsEscaped"] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("defectsEscaped");
    expect(result.reasons.join(" ")).toContain("c2");
  });

  it("REGRESSION: the guard refuses when a decision measure is declared but null on a stage", () => {
    const withStage = [record("c1", ["implement", "review"], [stage("implement"), stage("review", { wallMs: null })])];
    const withoutStage = [record("b1", ["implement"], [stage("implement")])];
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage, decisionMeasures: ["reworkAvoided", "defectsEscaped"] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("declared measured but is null");
    expect(result.reasons.join(" ")).toContain("review");
  });

  it("REGRESSION: the guard refuses a value whose measure was never declared", () => {
    const withStage = [record("c1", ["implement", "review"], [stage("implement"), stage("review", { defectsEscaped: 1 })], {
      measured: ALL.filter((measure) => measure !== "defectsEscaped")
    })];
    const withoutStage = [record("b1", ["implement"], [stage("implement", { defectsEscaped: 4 })], {
      measured: ALL.filter((measure) => measure !== "defectsEscaped")
    })];
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage, decisionMeasures: ["reworkAvoided", "defectsEscaped"] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("not declared measured");
  });
});

describe("Phase 05 Task D — the two arms must be a real paired comparison", () => {
  const withArm = (taskId: string, overrides: Partial<CoordinationRecord> = {}): CoordinationRecord =>
    record(taskId, ["implement", "review"], [stage("implement", { defectsEscaped: 0 }), stage("review", { reworkAvoided: 2 })], overrides);
  const withoutArm = (taskId: string, overrides: Partial<CoordinationRecord> = {}): CoordinationRecord =>
    record(taskId, ["implement"], [stage("implement", { defectsEscaped: 3 })], { cohort: cohort("baseline"), ...overrides });

  it("accepts a pair whose only difference is the candidate stage", () => {
    const result = evaluateStageGuard({ stage: "review", withStage: [withArm("c1")], withoutStage: [withoutArm("b1")] });
    expect(result.verdict).toBe("EARNS_PLACE");
  });

  it("refuses a pair drawn from different benchmark cohorts", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [withArm("c1")],
      withoutStage: [withoutArm("b1", { cohort: cohort("baseline", { benchmarkTaskId: "bench-2" }) })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("benchmarkTaskId");
  });

  it("refuses a pair whose inputs or acceptance requirements differ", () => {
    // Different inputs can have identical per-task averages and still prove nothing.
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [withArm("c1")],
      withoutStage: [withoutArm("b1", { cohort: cohort("baseline", { inputIdentity: "input-hash-2" }) })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("inputIdentity");
  });

  it("refuses a pair that disagrees about which variable was being tested", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [withArm("c1")],
      withoutStage: [withoutArm("b1", { cohort: cohort("baseline", { plannedVariable: "repair" }) })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("plannedVariable");
  });

  it("refuses when a record carries no cohort identity at all", () => {
    const bare = record("bare", ["implement", "review"], [stage("implement"), stage("review", { reworkAvoided: 2 })], { cohort: undefined });
    const result = evaluateStageGuard({ stage: "review", withStage: [bare], withoutStage: [withoutArm("b1")] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("no cohort identity");
  });

  it("refuses when a record's runtime contradicts its own cohort", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [withArm("c1", { runtime: "web:chatgpt" })],
      withoutStage: [withoutArm("b1")]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("disagrees with its cohort");
  });

  it("refuses a pair labelled as one arm, because that is not a comparison", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [withArm("c1")],
      withoutStage: [withoutArm("b1", { cohort: cohort("with-candidate") })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("one arm rather than a pair");
  });

  it("refuses when MORE than the candidate stage differs between the arms", () => {
    // The candidate pipeline also gained a `verify` stage, so the experiment changed two variables.
    const withExtra: CoordinationRecord = record("c-extra", ["implement", "verify", "review"], [
      stage("implement", { defectsEscaped: 0 }), stage("verify", { defectsEscaped: 0 }), stage("review", { reworkAvoided: 2 })
    ]);
    const result = evaluateStageGuard({ stage: "review", withStage: [withExtra], withoutStage: [withoutArm("b1")] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("more than the candidate stage differs");
  });

  it("refuses a cohort whose planned variable is a different stage than the one being judged", () => {
    const wrongVariable = record("c-wrong", ["implement", "review"], [stage("implement"), stage("review", { reworkAvoided: 2 })], {
      cohort: cohort("with-candidate", { plannedVariable: "repair" })
    });
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [wrongVariable],
      withoutStage: [withoutArm("b1", { cohort: cohort("baseline", { plannedVariable: "repair" }) })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("not an experiment about review");
  });
});

describe("Phase 05 Task D — a measured cost with no measurable benefit is a RESULT", () => {
  it("returns COST_ONLY and leaves the stage out, which is Gate 8 succeeding", () => {
    // The book's purpose is to stop an unprofitable stage becoming default. A stage that measurably
    // buys nothing and costs more has been correctly evaluated, so this is a completed experiment with
    // a negative answer — not an experiment that failed to run.
    const withStage = [record("c1", ["implement", "review"], [stage("implement", { defectsEscaped: 2 }), stage("review", { reworkAvoided: 0, inputTokens: 4_000, modelCalls: 3 })])];
    const withoutStage = [record("b1", ["implement"], [stage("implement", { defectsEscaped: 2, inputTokens: 1_000 })])];
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage, decisionMeasures: ["reworkAvoided", "defectsEscaped"] });
    expect(result.verdict).toBe("COST_ONLY");
    const decision = permittedPipeline({ current: ["implement", "finalize"], candidate: "review", verdict: result.verdict });
    expect(decision.changed).toBe(false);
    expect(decision.reason).toContain("COST_ONLY");
  });
});

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
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage, decisionMeasures: ["reworkAvoided", "defectsEscaped"] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("defectsEscaped");
  });

  it("names EVERY missing figure, not the first one it stumbles on", () => {
    const sparse = ALL.filter((measure) => measure !== "defectsEscaped" && measure !== "reworkAvoided");
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [record("a", ["implement", "review"], [stage("implement"), stage("review")], { measured: sparse })],
      withoutStage: [record("b", ["implement"], [stage("implement")], { measured: sparse })],
      decisionMeasures: ["reworkAvoided", "defectsEscaped"]
    });
    // Both requested benefit measures are named as unobserved, so a refusal says everything it is
    // missing rather than the first gap it met.
    expect(result.reasons.join(" ")).toContain("reworkAvoided");
    expect(result.reasons.join(" ")).toContain("defectsEscaped");
  });

  it("decides on rework alone when escapes were never measured, which no ledger can do", () => {
    // Escapes are discovered AFTER a task finishes, outside any run, so no ledger can report them.
    // The default decision measure is therefore rework, and the reason says which measures were judged
    // so a reader is not told about a figure that played no part.
    const withStage = [record("c1", ["implement", "review"], [stage("implement", { reworkAvoided: 0 }), stage("review", { reworkAvoided: 3, inputTokens: 3_000 })])];
    const withoutStage = [record("b1", ["implement"], [stage("implement", { reworkAvoided: 0, inputTokens: 1_000 })])];
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage });
    expect(result.verdict).toBe("EARNS_PLACE");
    expect(result.reasons.join(" ")).toContain("judged on reworkAvoided");
    expect(result.reasons.join(" ")).not.toContain("escaped defects");
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
      decisionMeasures: ["reworkAvoided", "defectsEscaped"],
      withStage: [reviewedTask("a", 0, 2), reviewedTask("b", 0, 1)],
      withoutStage: [baselineTask("c", 3), baselineTask("d", 2)]
    });
    expect(result.verdict).toBe("EARNS_PLACE");
    expect(result.comparison?.changeInDefectsEscaped).toBeLessThan(0);
    // The reason names the measures the decision was actually made on.
    expect(result.reasons.join(" ")).toContain("escaped defects");
    expect(result.reasons.join(" ")).toContain("judged on reworkAvoided and defectsEscaped");
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
