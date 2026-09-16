import { describe, expect, it } from "vitest";
import {
  COORDINATION_MEASURES,
  COORDINATION_STAGES,
  evaluateStageGuard,
  permittedPipeline,
  stageAttribution,
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
 * ## The two grains, and why they are separate
 *
 * A durable `TaskLedger` records what a TASK cost. It does not say which stage spent it. So a record
 * carries:
 *
 *  - `totals` + `measured` — the TASK grain, and the grain the source actually records;
 *  - `stages` + `stageMeasured` — the STAGE grain, present only where cost was genuinely attributable.
 *
 * An earlier version of this model put the task totals on one arbitrary "carrier" stage and required
 * every other stage to carry them too, which meant every realistic multi-stage production record was
 * refused as INSUFFICIENT_EVIDENCE. The tests below are built at the task grain by default for that
 * reason, and the stage-grain tests are explicit about being about attribution.
 *
 * The property that makes the guard worth having is unchanged: **it must answer "I cannot tell" rather
 * than approve a stage on an unmeasured figure.**
 */

const ALL: CoordinationMeasure[] = [...COORDINATION_MEASURES];

/**
 * A cohort identity two arms can share.
 *
 * Comparability is checked, not assumed, so every record taking part in a promotion decision says what
 * it is comparable to. The two arms differ in `arm` and in the planned variable only.
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

/**
 * Build a record at the TASK grain.
 *
 * Only the measures actually supplied are declared measured; the rest are null and undeclared, which
 * is how "not measured" stays distinguishable from "measured zero".
 */
function record(
  taskId: string,
  pipeline: CoordinationStage[],
  totals: Partial<Record<CoordinationMeasure, number | null>> = {},
  overrides: Partial<CoordinationRecord> = {}
): CoordinationRecord {
  const filled: Record<string, number | null> = {};
  for (const measure of COORDINATION_MEASURES) filled[measure] = measure in totals ? (totals[measure] as number | null) : null;
  const measured = COORDINATION_MEASURES.filter((measure) => filled[measure] !== null);
  return {
    taskId,
    pipeline,
    totals: filled as unknown as CoordinationRecord["totals"],
    measured,
    stages: [],
    stageMeasured: [],
    runtime: "test-runtime",
    cohort: cohort(pipeline.includes("review") ? "with-candidate" : "baseline"),
    at: "2026-09-16T00:00:00.000Z",
    ...overrides
  };
}

/** One stage's row, for the tests that are specifically about stage attribution. */
function stage(stageName: CoordinationStage, overrides: Partial<CoordinationStageRecord> = {}): CoordinationStageRecord {
  return {
    stage: stageName,
    modelCalls: 1,
    inputTokens: 1_000,
    outputTokens: null,
    wallMs: 1_000,
    coordinationMs: 100,
    executionMs: 900,
    reviewFindings: 0,
    reworkAvoided: 0,
    diffLines: 10,
    defectsEscaped: null,
    ...overrides
  };
}

/** A task that ran the baseline pipeline, expressed as a TASK TOTAL. */
function baselineTask(taskId: string, defectsEscaped: number, reworkAvoided = 0): CoordinationRecord {
  return record(taskId, ["implement", "finalize"], {
    modelCalls: 4, inputTokens: 1_000, wallMs: 1_000, executionMs: 900, coordinationMs: 100,
    reviewFindings: 0, reworkAvoided, defectsEscaped, diffLines: 10
  });
}

/** The same task with a review stage added, again as a task total. */
function reviewedTask(taskId: string, defectsEscaped: number, reworkAvoided: number): CoordinationRecord {
  return record(taskId, ["implement", "review", "finalize"], {
    modelCalls: 6, inputTokens: 3_000, wallMs: 3_000, executionMs: 2_700, coordinationMs: 300,
    reviewFindings: 2, reworkAvoided, defectsEscaped, diffLines: 10
  });
}

const BOTH_BENEFITS: CoordinationMeasure[] = ["reworkAvoided", "defectsEscaped"];

describe("Phase 05 Task D — a realistic production-shaped record is judged on its task totals", () => {
  it("REGRESSION: a five-stage record with totals and NO stage attribution still decides", () => {
    // The exact case the grain conflict broke. A ledger-derived record has task totals and an empty
    // `stages` array, because the ledger cannot attribute cost per stage. The guard must compare the
    // task totals and must NOT refuse because other stages carry no per-stage figures.
    const withStage = [record("c1", ["intake", "plan", "implement", "verify", "review", "finalize"], {
      modelCalls: 9, inputTokens: 6_000, wallMs: 6_000, coordinationMs: 600, executionMs: 5_400,
      reviewFindings: 2, reworkAvoided: 3
    })];
    const withoutStage = [record("b1", ["intake", "plan", "implement", "verify", "finalize"], {
      modelCalls: 5, inputTokens: 2_000, wallMs: 2_000, coordinationMs: 200, executionMs: 1_800,
      reviewFindings: 0, reworkAvoided: 0
    })];
    expect(withStage[0].stages).toEqual([]);
    expect(withoutStage[0].stages).toEqual([]);

    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage });
    expect(result.verdict, result.reasons.join("; ")).toBe("EARNS_PLACE");
    expect(result.comparison?.candidate.inputTokens).toBe(6_000);
    expect(result.comparison?.baseline.inputTokens).toBe(2_000);
  });

  it("REGRESSION: the guard does not require a task total to appear on the stages", () => {
    // A record whose stages array is empty must be as usable as one with rows, as long as the task
    // totals are there. Requiring both would refuse every production record.
    const withAttribution = record("with", ["implement", "review"], { reworkAvoided: 2, modelCalls: 4, inputTokens: 100, wallMs: 100 }, {
      stages: [stage("implement", { reworkAvoided: 2 })], stageMeasured: ["reworkAvoided"]
    });
    const withoutAttribution = record("without", ["implement", "review"], { reworkAvoided: 2, modelCalls: 4, inputTokens: 100, wallMs: 100 });
    const baseline = record("b", ["implement"], { reworkAvoided: 0, modelCalls: 2, inputTokens: 50, wallMs: 50 });
    for (const candidate of [withAttribution, withoutAttribution]) {
      const result = evaluateStageGuard({ stage: "review", withStage: [candidate], withoutStage: [baseline] });
      expect(result.verdict, `${candidate.taskId}: ${result.reasons.join("; ")}`).toBe("EARNS_PLACE");
    }
  });

  it("REGRESSION: a task total is not double counted when stages also carry figures", () => {
    // The hazard the grain split exists to prevent: `totalRecord` reads the task total, and `combine`
    // does not also add up the stage rows, so a task whose stages happen to be attributed still
    // contributes its cost exactly once.
    const attributed = record("a", ["implement"], { modelCalls: 7, inputTokens: 5_000, wallMs: 5_000 }, {
      stages: [stage("implement", { modelCalls: 7, inputTokens: 5_000, wallMs: 5_000 })],
      stageMeasured: ["modelCalls", "inputTokens", "wallMs"]
    });
    const totals = totalRecord(attributed);
    expect(totals.modelCalls).toBe(7);
    expect(totals.inputTokens).toBe(5_000);
    expect(totals.wallMs).toBe(5_000);

    // The stage aggregate reports the attributed parts — the same money — and is never added to it.
    const economics = totalStage([attributed], "implement");
    expect(economics.totals.modelCalls).toBe(7);
    expect(economics.unattributedTasks).toEqual([]);
  });

  it("REGRESSION: adding stages does not inflate a task total", () => {
    const twoStages = record("two", ["intake", "implement"], { inputTokens: 1_000, modelCalls: 3, wallMs: 1_000 });
    const fiveStages = record("five", ["intake", "plan", "implement", "verify", "finalize"], { inputTokens: 1_000, modelCalls: 3, wallMs: 1_000 });
    expect(totalRecord(fiveStages)).toEqual(totalRecord(twoStages));

    // Even when every stage is attributed, the task total is what is counted.
    const allAttributed = record("attributed", ["implement", "verify"], { inputTokens: 1_000, modelCalls: 3, wallMs: 1_000 }, {
      stages: [stage("implement", { inputTokens: 600, modelCalls: 2, wallMs: 600 }), stage("verify", { inputTokens: 400, modelCalls: 1, wallMs: 400 })],
      stageMeasured: ["inputTokens", "modelCalls", "wallMs"]
    });
    expect(totalRecord(allAttributed).inputTokens).toBe(1_000);
    expect(totalRecord(allAttributed).modelCalls).toBe(3);
  });
});

describe("Phase 05 Task D — the stage grain is separate, and optional", () => {
  it("counts a task with no stage attribution as unattributed rather than as zero", () => {
    const attributed = record("a", ["review"], { reviewFindings: 2 }, { stages: [stage("review", { reviewFindings: 2 })], stageMeasured: ["reviewFindings"] });
    const unattributed = record("b", ["review"], { reviewFindings: 3 });
    const economics = totalStage([attributed, unattributed], "review");
    expect(economics.totals.reviewFindings).toBe(2);
    expect(economics.unattributedTasks).toEqual(["b"]);
    expect(economics.complete).toBe(false);
  });

  it("reports how much of a task's total was attributed, and whether the attribution closes", () => {
    const partial = record("partial", ["implement", "verify"], { inputTokens: 1_000, modelCalls: 3 }, {
      stages: [stage("implement", { inputTokens: 600, modelCalls: 2 })], stageMeasured: ["inputTokens", "modelCalls"]
    });
    expect(stageAttribution(partial, "inputTokens").attributed).toBe(600);
    expect(stageAttribution(partial, "inputTokens").complete).toBe(false);

    const complete = record("complete", ["implement", "verify"], { inputTokens: 1_000, modelCalls: 3 }, {
      stages: [stage("implement", { inputTokens: 600, modelCalls: 3 }), stage("verify", { inputTokens: 400, modelCalls: 0 })],
      stageMeasured: ["inputTokens", "modelCalls"]
    });
    expect(stageAttribution(complete, "inputTokens").complete).toBe(true);
  });

  it("REGRESSION: a stage declaration with a null on a required stage fails closed", () => {
    // Declaring `reviewFindings` a stage measurement and then leaving it null on the stage under test
    // is a contradiction, not a zero.
    const broken = record("broken", ["implement", "review"], { reviewFindings: 5, modelCalls: 2, inputTokens: 100, wallMs: 100 }, {
      stages: [stage("implement", { reviewFindings: 5 }), stage("review", { reviewFindings: null })],
      stageMeasured: ["reviewFindings"]
    });
    const economics = totalStage([broken], "review");
    expect(economics.complete).toBe(false);
    expect(economics.unmeasured).toContain("reviewFindings");
  });

  it("rejects a stage value that was not declared a stage measurement", () => {
    const undeclared = record("undeclared", ["review"], { reviewFindings: 4 }, {
      stages: [stage("review", { reviewFindings: 4 })], stageMeasured: []
    });
    const economics = totalStage([undeclared], "review");
    expect(economics.complete).toBe(false);
    expect(economics.unmeasured).toContain("reviewFindings");
  });
});

describe("Phase 05 Task D — a declared task total that is null fails closed", () => {
  it("REGRESSION: a declared-but-null task total is refused, not counted as zero", () => {
    // `measured` claims the figure; `totals` supplies nothing. Trusting the declaration would count a
    // missing measurement as a real 0 and let the comparison proceed on a fabricated baseline.
    const shaped = record("shaped", ["implement"], {}).totals;
    const lying: CoordinationRecord = {
      ...record("lying", ["implement"], { modelCalls: 3, wallMs: 100 }),
      measured: [...ALL],
      totals: { ...shaped, modelCalls: 3, wallMs: 100, inputTokens: null }
    };
    const withStage = [record("c", ["implement", "review"], { reworkAvoided: 2, modelCalls: 4, inputTokens: 100, wallMs: 100 })];
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage: [lying] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("inputTokens");
    expect(result.reasons.join(" ")).toContain("lying");
    // And `totalRecord` refuses to fold the null in as a zero.
    expect(totalRecord(lying).inputTokens).toBe(0);
  });

  it("refuses a task total present without a declaration", () => {
    const shaped = record("shaped", ["implement"], {}).totals;
    const sneaky: CoordinationRecord = {
      ...record("sneaky", ["implement"], { modelCalls: 3, wallMs: 100 }),
      totals: { ...shaped, modelCalls: 3, wallMs: 100, inputTokens: 5_000 }
    };
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [record("c", ["implement", "review"], { reworkAvoided: 2, modelCalls: 4, inputTokens: 100, wallMs: 100 })],
      withoutStage: [sneaky]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("not declared measured");
  });
});

describe("Phase 05 Task D — the two arms must be a real paired comparison", () => {
  const withArm = (taskId: string, overrides: Partial<CoordinationRecord> = {}): CoordinationRecord =>
    record(taskId, ["implement", "review"], { reworkAvoided: 2, defectsEscaped: 0, modelCalls: 6, inputTokens: 3_000, wallMs: 3_000 }, overrides);
  const withoutArm = (taskId: string, overrides: Partial<CoordinationRecord> = {}): CoordinationRecord =>
    record(taskId, ["implement"], { reworkAvoided: 0, defectsEscaped: 3, modelCalls: 4, inputTokens: 1_000, wallMs: 1_000 }, { cohort: cohort("baseline"), ...overrides });

  it("accepts a pair whose only difference is the candidate stage", () => {
    const result = evaluateStageGuard({ stage: "review", withStage: [withArm("c1")], withoutStage: [withoutArm("b1")] });
    expect(result.verdict, result.reasons.join("; ")).toBe("EARNS_PLACE");
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
    const bare = record("bare", ["implement", "review"], { reworkAvoided: 2, modelCalls: 6, inputTokens: 3_000, wallMs: 3_000 }, { cohort: undefined });
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
    const withExtra: CoordinationRecord = record("c-extra", ["implement", "verify", "review"], { reworkAvoided: 2, modelCalls: 6, inputTokens: 3_000, wallMs: 3_000 });
    const result = evaluateStageGuard({ stage: "review", withStage: [withExtra], withoutStage: [withoutArm("b1")] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("more than the candidate stage differs");
  });

  it("refuses a cohort whose planned variable is a different stage than the one being judged", () => {
    const wrongVariable = record("c-wrong", ["implement", "review"], { reworkAvoided: 2, modelCalls: 6, inputTokens: 3_000, wallMs: 3_000 }, {
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

  it("refuses two sets that overlap", () => {
    const contaminated = [withArm("a")];
    const result = evaluateStageGuard({ stage: "review", withStage: contaminated, withoutStage: contaminated });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("actually includes review");
  });

  it("refuses to compare across two different runtimes", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [withArm("c1", { runtime: "web:chatgpt", cohort: cohort("with-candidate", { runtime: "web:chatgpt" }) })],
      withoutStage: [withoutArm("b1", { runtime: "api:claude", cohort: cohort("baseline", { runtime: "api:claude" }) })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("different runtimes");
  });
});

describe("Phase 05 Task D — the verdicts", () => {
  it("EARNS_PLACE when the stage cuts escaped defects", () => {
    const result = evaluateStageGuard({
      stage: "review",
      decisionMeasures: BOTH_BENEFITS,
      withStage: [reviewedTask("a", 0, 2), reviewedTask("b", 0, 1)],
      withoutStage: [baselineTask("c", 3), baselineTask("d", 2)]
    });
    expect(result.verdict, result.reasons.join("; ")).toBe("EARNS_PLACE");
    expect(result.comparison?.changeInDefectsEscaped).toBeLessThan(0);
    expect(result.reasons.join(" ")).toContain("escaped defects");
    expect(result.reasons.join(" ")).toContain("judged on reworkAvoided and defectsEscaped");
  });

  it("EARNS_PLACE when the stage increases rework avoided", () => {
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [reviewedTask("a", 1, 5), reviewedTask("b", 1, 5)],
      withoutStage: [baselineTask("c", 1, 0), baselineTask("d", 1, 0)]
    });
    expect(result.verdict, result.reasons.join("; ")).toBe("EARNS_PLACE");
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
    const same = (taskId: string): CoordinationRecord => record(taskId, ["implement", "review"], {
      reworkAvoided: 0, defectsEscaped: 1, modelCalls: 4, inputTokens: 1_000, wallMs: 1_000
    });
    const baseline = record("b", ["implement"], { reworkAvoided: 0, defectsEscaped: 1, modelCalls: 4, inputTokens: 1_000, wallMs: 1_000 });
    const result = evaluateStageGuard({ stage: "review", withStage: [same("a")], withoutStage: [baseline] });
    expect(result.verdict).toBe("COST_ONLY");
    expect(result.reasons.join(" ")).toContain("tie on benefit is decided against");
  });

  it("COST_ONLY and leaves the stage out, which is Gate 8 succeeding", () => {
    const withStage = [record("c1", ["implement", "review"], { reworkAvoided: 0, defectsEscaped: 2, modelCalls: 3, inputTokens: 4_000, wallMs: 4_000 })];
    const withoutStage = [record("b1", ["implement"], { reworkAvoided: 0, defectsEscaped: 2, modelCalls: 1, inputTokens: 1_000, wallMs: 1_000 })];
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage });
    expect(result.verdict).toBe("COST_ONLY");
    const decision = permittedPipeline({ current: ["implement", "finalize"], candidate: "review", verdict: result.verdict });
    expect(decision.changed).toBe(false);
    expect(decision.reason).toContain("COST_ONLY");
  });

  it("INSUFFICIENT_EVIDENCE when a decision figure was never observed", () => {
    const result = evaluateStageGuard({
      stage: "review",
      decisionMeasures: BOTH_BENEFITS,
      withStage: [record("a", ["implement", "review"], { reworkAvoided: 5, modelCalls: 4, inputTokens: 100, wallMs: 100 })],
      withoutStage: [record("b", ["implement"], { reworkAvoided: 0, modelCalls: 2, inputTokens: 50, wallMs: 50 })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("defectsEscaped");
  });

  it("names every missing figure, not the first one it stumbles on", () => {
    const result = evaluateStageGuard({
      stage: "review",
      decisionMeasures: BOTH_BENEFITS,
      withStage: [record("a", ["implement", "review"], { modelCalls: 4, inputTokens: 100, wallMs: 100 })],
      withoutStage: [record("b", ["implement"], { modelCalls: 2, inputTokens: 50, wallMs: 50 })]
    });
    expect(result.reasons.join(" ")).toContain("reworkAvoided");
    expect(result.reasons.join(" ")).toContain("defectsEscaped");
  });

  it("decides on rework alone when escapes were never measured, which no ledger can do", () => {
    // Escapes are discovered AFTER a task finishes, outside any run, so no ledger can report them.
    const withStage = [record("c1", ["implement", "review"], { reworkAvoided: 3, modelCalls: 4, inputTokens: 3_000, wallMs: 3_000 })];
    const withoutStage = [record("b1", ["implement"], { reworkAvoided: 0, modelCalls: 2, inputTokens: 1_000, wallMs: 1_000 })];
    const result = evaluateStageGuard({ stage: "review", withStage, withoutStage });
    expect(result.verdict, result.reasons.join("; ")).toBe("EARNS_PLACE");
    expect(result.reasons.join(" ")).toContain("judged on reworkAvoided");
    expect(result.reasons.join(" ")).not.toContain("escaped defects");
  });

  it("returns INSUFFICIENT_EVIDENCE with no baseline rather than assuming one", () => {
    const result = evaluateStageGuard({ stage: "review", withStage: [reviewedTask("a", 0, 2)], withoutStage: [] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.comparison).toBeNull();
    expect(result.reasons.join(" ")).toContain("no comparable task ran the pipeline without review");
  });

  it("compares PER TASK, so running a stage more often cannot make it look better", () => {
    const result = evaluateStageGuard({
      stage: "review",
      decisionMeasures: BOTH_BENEFITS,
      withStage: [reviewedTask("a", 1, 1), reviewedTask("b", 1, 1)],
      withoutStage: [baselineTask("c", 4)]
    });
    expect(result.comparison).not.toBeNull();
    expect(result.verdict).toBe("EARNS_PLACE");
    expect(result.comparison?.candidate.defectsEscaped).toBe(2);
    expect(result.comparison?.baseline.defectsEscaped).toBe(4);
  });

  it("is reproducible: the same records give the same guard result", () => {
    const input = { stage: "review" as const, withStage: [reviewedTask("a", 0, 2)], withoutStage: [baselineTask("c", 3)] };
    expect(evaluateStageGuard(input)).toEqual(evaluateStageGuard(input));
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
    const current: CoordinationStage[] = ["implement", "verify", "finalize"];
    for (const verdict of ["EARNS_PLACE", "COST_ONLY", "INSUFFICIENT_EVIDENCE"] as const) {
      const decision = permittedPipeline({ current, candidate: "review", verdict, required: ["verify"] });
      expect(decision.pipeline).toContain("verify");
    }
  });
});

describe("Phase 05 Task D — the accounting totals what was measured and shows what was not", () => {
  it("totals a record from its task totals, with coordination share of wall time", () => {
    const totals = totalRecord(record("t1", ["implement", "review"], {
      inputTokens: 4_000, wallMs: 4_000, coordinationMs: 1_000, reworkAvoided: 2, defectsEscaped: 1
    }));
    expect(totals.inputTokens).toBe(4_000);
    expect(totals.wallMs).toBe(4_000);
    expect(totals.coordinationMs).toBe(1_000);
    expect(totals.coordinationShare).toBeCloseTo(0.25, 5);
    expect(totals.reworkAvoided).toBe(2);
    expect(totals.defectsEscaped).toBe(1);
  });

  it("reports a coordination share of null, not zero, when wall time was never observed", () => {
    const totals = totalRecord(record("t1", ["implement"], { coordinationMs: 100 }));
    expect(totals.coordinationShare).toBeNull();
  });

  it("keeps an absent task total out of the total instead of counting it as zero", () => {
    const partial = record("t1", ["implement"], { modelCalls: 4 });
    expect(totalRecord(partial).inputTokens).toBe(0);
    expect(partial.measured).not.toContain("inputTokens");
  });

  it("summarises a run without dumping the raw records", () => {
    const summary = summarizeCoordination([reviewedTask("a", 0, 2), reviewedTask("b", 0, 1)]);
    expect(summary).toContain("2 task(s)");
    expect(summary).toContain("model calls");
    expect(summary).toContain("coordination share of wall time");
    expect(summarizeCoordination([])).toBe("no coordination records");
  });

  it("declares the stages and measures the book names", () => {
    expect([...COORDINATION_STAGES]).toEqual(["intake", "plan", "implement", "verify", "review", "repair", "finalize"]);
    for (const measure of ["modelCalls", "inputTokens", "outputTokens", "wallMs", "coordinationMs", "executionMs", "reviewFindings", "reworkAvoided", "diffLines", "defectsEscaped"] as const) {
      expect(COORDINATION_MEASURES).toContain(measure);
    }
  });
});
