import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { optionalReviewPrompt, parseOptionalReview, runOptionalReview } from "../../../src/shared/optional-review";
import { COORDINATION_STAGES, MANDATORY_GATE_STAGES, OPTIONAL_AGENT_STAGES, evaluateStageGuard, isMandatoryGateStage } from "../../../src/shared/coordination-economics";

/**
 * The optional review Agent, and the boundary that keeps a mandatory platform gate out of the
 * economics adjudication.
 *
 * A live paired experiment about `verify` returned INSUFFICIENT_EVIDENCE because the verification
 * gate is present in every completed task, so there is no "without verification" production arm. The
 * conclusion is a definition: verification is a platform invariant, and Gate 8 governs optional Agent
 * stages instead. These tests hold that boundary in place.
 */

describe("Phase 05 — the optional review Agent is a stage Gate 8 may judge", () => {
  it("is an optional Agent stage, and verification is not", () => {
    expect(OPTIONAL_AGENT_STAGES).toContain("review");
    expect(OPTIONAL_AGENT_STAGES).not.toContain("verify");
    expect(isMandatoryGateStage("verify")).toBe(true);
    expect(isMandatoryGateStage("review")).toBe(false);
    // Every stage is either a mandatory gate or an optional Agent stage — never neither, never both.
    for (const stage of COORDINATION_STAGES) {
      const mandatory = (MANDATORY_GATE_STAGES as readonly string[]).includes(stage);
      expect(OPTIONAL_AGENT_STAGES.includes(stage as never)).toBe(!mandatory);
    }
  });

  it("asks for findings without manufacturing them", () => {
    const prompt = optionalReviewPrompt({ objective: "refactor the gateway", diff: "--- a/x\n+++ b/x" });
    // The reviewer is told an empty answer is valid, because a prompt that implies findings are
    // expected produces them — and a manufactured finding would inflate the benefit this stage is
    // being judged on.
    expect(prompt).toContain("Finding nothing is a valid and expected answer");
    expect(prompt).toContain("refactor the gateway");
    expect(prompt).toContain("--- a/x");
    expect(prompt).toContain("strict JSON");
  });

  it("parses findings, and an unparseable reply yields none rather than a fabricated one", () => {
    expect(parseOptionalReview('{"findings":[{"severity":"blocking","summary":"drops the null case"}]}')).toEqual([
      { severity: "blocking", summary: "drops the null case" }
    ]);
    // Fenced JSON is what a model usually returns.
    expect(parseOptionalReview('```json\n{"findings":[{"severity":"advisory","summary":"naming"}]}\n```')).toEqual([
      { severity: "advisory", summary: "naming" }
    ]);
    // Fail-closed in the direction that matters: no findings, never an invented one.
    expect(parseOptionalReview("I think it is probably fine.")).toEqual([]);
    expect(parseOptionalReview('{"findings":"none"}')).toEqual([]);
    expect(parseOptionalReview('{"findings":[{"severity":"blocking"}]}')).toEqual([]);
    // An unknown severity is advisory, never silently blocking.
    expect(parseOptionalReview('{"findings":[{"severity":"catastrophic","summary":"x"}]}')).toEqual([{ severity: "advisory", summary: "x" }]);
  });

  it("runs the requested number of passes and keeps them independent", async () => {
    const prompts: string[] = [];
    const outcomes = await runOptionalReview({
      request: { passes: 2, acceptance: "all tests pass" },
      objective: "objective text",
      diff: "diff text",
      reviewer: async (prompt) => {
        prompts.push(prompt);
        return '{"findings":[]}';
      }
    });
    expect(outcomes).toHaveLength(2);
    expect(prompts).toHaveLength(2);
    // Both passes see the acceptance criteria and neither sees the other's findings, which is what
    // makes the second pass a review rather than an echo.
    for (const prompt of prompts) expect(prompt).toContain("all tests pass");
    expect(prompts[0]).not.toContain("findings of pass 1");
  });

  it("defaults to one pass and refuses to be asked for an unbounded number", async () => {
    const counts: number[] = [];
    const one = await runOptionalReview({ request: {}, objective: "o", diff: "d", reviewer: async () => { counts.push(1); return '{"findings":[]}'; } });
    expect(one).toHaveLength(1);
    const many = await runOptionalReview({ request: { passes: 99 }, objective: "o", diff: "d", reviewer: async () => '{"findings":[]}' });
    expect(many).toHaveLength(2);
  });

  it("reports a failing pass instead of hiding it", async () => {
    // A review that could not run is not a clean review, and the caller must be able to tell.
    await expect(runOptionalReview({ request: {}, objective: "o", diff: "d", reviewer: async () => { throw new Error("reviewer unavailable"); } }))
      .rejects.toThrow("reviewer unavailable");
  });
});

describe("Phase 05 — the guard refuses to adjudicate a mandatory platform gate", () => {
  const record = (taskId: string, pipeline: string[], rework: number) => ({
    taskId,
    pipeline: pipeline as never,
    totals: { modelCalls: 1, inputTokens: 100, outputTokens: 50, wallMs: 10, coordinationMs: 0, executionMs: 0, reviewFindings: null, reworkAvoided: rework, diffLines: null, defectsEscaped: null },
    measured: ["modelCalls", "inputTokens", "wallMs", "reworkAvoided"] as never,
    stages: [] as never,
    stageMeasured: [] as never,
    runtime: "api:deepseek",
    // The guard refuses a pairing it cannot check, so the arms carry the identity a real experiment
    // gives them: same runtime, benchmark, input, planned variable — differing only in arm label.
    cohort: { runtime: "api:deepseek", benchmarkTaskId: "bench", inputIdentity: "input-1", plannedVariable: "review", arm: taskId } as never,
    at: "2026-01-01T00:00:00.000Z"
  });

  it("returns INSUFFICIENT_EVIDENCE for `verify`, whatever the records look like", () => {
    // Even with two apparently well-formed arms, a mandatory gate is not a candidate: the platform
    // property is what decides, not the sample.
    const result = evaluateStageGuard({
      stage: "verify",
      withStage: [record("with", ["intake", "verify"], 1)],
      withoutStage: [record("without", ["intake"], 0)]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.comparison).toBeNull();
    expect(result.reasons.join(" ")).toContain("mandatory platform contract gate");
    expect(result.reasons.join(" ")).toContain("no legal production pipeline runs without it");
  });

  it("still adjudicates a real optional Agent stage on the same records", () => {
    // The same shape with `review` instead is a legitimate experiment, so the refusal is about the
    // stage's KIND and not about the data.
    const result = evaluateStageGuard({
      stage: "review",
      withStage: [record("with", ["intake", "implement", "review"], 1)],
      withoutStage: [record("without", ["intake", "implement"], 0)]
    });
    expect(result.verdict).toBe("EARNS_PLACE");
  });
});

describe("Phase 05 — a mandatory gate is never a legal experiment variable", () => {
  it("every stage the guard will adjudicate is an optional Agent stage", () => {
    const stages = [...COORDINATION_STAGES];
    for (const stage of stages) {
      const result = evaluateStageGuard({
        stage,
        withStage: [],
        withoutStage: []
      });
      const refusedAsMandatory = result.reasons.some((reason) => reason.includes("mandatory platform contract gate"));
      expect(refusedAsMandatory, `${stage}: mandatory=${isMandatoryGateStage(stage)}`).toBe(isMandatoryGateStage(stage));
    }
  });

  it("the guard source names the boundary, so it cannot be quietly widened", () => {
    // A cheap structural check: the vocabulary lives in one place and the guard reads it.
    const source = fs.readFileSync(path.join(process.cwd(), "src", "shared", "coordination-economics.ts"), "utf8");
    expect(source).toContain("MANDATORY_GATE_STAGES");
    expect(source).toContain('"intake", "verify", "finalize"');
    expect(source).toContain("isMandatoryGateStage(stage)");
  });
});
