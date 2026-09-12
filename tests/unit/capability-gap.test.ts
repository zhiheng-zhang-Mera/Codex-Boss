/**
 * checkpoint-1 §34 (checkpoint-11): the capability-gap chain.
 *
 * The cases pin aggregation by capability (repeats are one gap seen twice), the
 * "conditions met" thresholds, the chain's order, and the closure rule that makes
 * the mechanism honest: a gap closes only when the regression test passed, the
 * knowledge update was accepted AND the capability probe actually moved.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateGaps,
  CAPABILITY_CHAIN,
  chainProblems,
  closureFor,
  DEFAULT_QUALIFICATION,
  gapKeyFor,
  knowledgeCandidateFor,
  nextChainStage,
  planImprovement,
  qualifiesForImprovement,
  registryEntryFor,
  worstSeverity,
  type ChainStep,
  type GapOccurrence
} from "../../src/shared/capability-gap";
import type { CapabilityGap } from "../../src/shared/recovery";
import { gateKnowledgeWrite } from "../../src/shared/knowledge-object";

const gap = (overrides: Partial<CapabilityGap> = {}): CapabilityGap => ({
  missing_capability: "multi-file refactor planning",
  task: "repair the gateway",
  failure: "BUILD: error TS2322",
  workaround: "a human splits the change",
  frequency: 1,
  severity: "LOW",
  failure_class: "BUILD",
  ...overrides
});
const occurrence = (overrides: Partial<CapabilityGap> = {}, at = "2026-01-01T00:00:00.000Z"): GapOccurrence => ({ gap: gap(overrides), task: overrides.task ?? "repair the gateway", recorded_at: at });

describe("checkpoint-11 §34 aggregation and qualification", () => {
  it("aggregates repeats of one capability rather than piling up gaps", () => {
    const aggregates = aggregateGaps([
      occurrence({}, "2026-01-01T00:00:00.000Z"),
      occurrence({ failure: "TEST: assertion failed", failure_class: "TEST", severity: "MEDIUM", task: "repair the ledger" }, "2026-01-02T00:00:00.000Z"),
      occurrence({ missing_capability: "screenshot diffing" }, "2026-01-03T00:00:00.000Z")
    ]);
    expect(aggregates).toHaveLength(2);
    const refactor = aggregates.find((entry) => entry.capability === "multi-file refactor planning")!;
    expect(refactor.occurrences).toBe(2);
    expect(refactor.frequency).toBe(2);
    expect(refactor.severity).toBe("MEDIUM");
    expect(refactor.failure_classes).toEqual(["BUILD", "TEST"]);
    expect(refactor.tasks).toContain("repair the ledger");
    expect(refactor.first_seen).toBe("2026-01-01T00:00:00.000Z");
    expect(refactor.last_seen).toBe("2026-01-02T00:00:00.000Z");
  });

  it("keys a capability independently of the task that hit it", () => {
    expect(gapKeyFor("  Multi-File   Refactor Planning ")).toBe(gapKeyFor("multi-file refactor planning"));
    expect(gapKeyFor("a")).not.toBe(gapKeyFor("b"));
  });

  it("ignores a gap with no named capability", () => {
    expect(aggregateGaps([occurrence({ missing_capability: "   " })])).toEqual([]);
  });

  it("ranks severities", () => {
    expect(worstSeverity("LOW", "HIGH")).toBe("HIGH");
    expect(worstSeverity("CRITICAL", "MEDIUM")).toBe("CRITICAL");
  });

  it("applies the plan's 'conditions met' thresholds with reasons", () => {
    const once = aggregateGaps([occurrence()])[0]!;
    const repeated = aggregateGaps([occurrence(), occurrence()])[0]!;
    const severeOnce = aggregateGaps([occurrence({ severity: "HIGH" })])[0]!;
    expect(qualifiesForImprovement(once).qualifies).toBe(false);
    expect(qualifiesForImprovement(repeated).qualifies).toBe(true);
    expect(qualifiesForImprovement(severeOnce).qualifies).toBe(true);
    const reasons = qualifiesForImprovement(once).reasons.join(" ");
    expect(reasons).toContain(`repeat threshold ${DEFAULT_QUALIFICATION.minOccurrences}`);
    expect(reasons).toContain(`always-worth-it threshold ${DEFAULT_QUALIFICATION.alwaysSeverity}`);
  });
});

describe("checkpoint-11 §34 the improvement task and the chain", () => {
  const aggregate = aggregateGaps([occurrence({ severity: "HIGH" }), occurrence({ severity: "HIGH" })])[0]!;
  const task = planImprovement({ aggregate, previous_verdict: "MISSING", now: "2026-01-05T00:00:00.000Z" });

  it("carries the gap, the probe that will judge it and the previous verdict", () => {
    expect(task.capability).toBe("multi-file refactor planning");
    expect(task.previous_verdict).toBe("MISSING");
    expect(task.probe.capability).toBe("multi-file refactor planning");
    expect(task.severity).toBe("HIGH");
    expect(task.frequency).toBe(2);
    expect(task.failure_classes).toEqual(["BUILD"]);
    expect(task.requirement.type).toBe("DELIVERABLE");
    expect(task.requirement.text).toContain("the repository gains the capability");
    expect(task.objective).toContain("repair the gateway");
    expect(task.scope_terms).toContain("refactor");
    expect(task.id).toMatch(/^it-[0-9a-f]{16}$/);
  });

  it("is stable for the same gap and different for another", () => {
    const same = planImprovement({ aggregate, previous_verdict: "MISSING", now: "2026-01-05T00:00:00.000Z" });
    expect(same.id).toBe(task.id);
  });

  it("walks the six stages in order", () => {
    expect([...CAPABILITY_CHAIN]).toEqual(["CAPABILITY_GAP", "IMPROVEMENT_TASK", "IMPLEMENTATION", "REGRESSION_TEST", "KNOWLEDGE_UPDATE", "CAPABILITY_REGISTRY"]);
    const steps: ChainStep[] = [
      { stage: "CAPABILITY_GAP", ok: true, detail: "recorded", at: "t" },
      { stage: "IMPROVEMENT_TASK", ok: true, detail: "opened", at: "t" }
    ];
    expect(chainProblems(steps)).toEqual([]);
    expect(nextChainStage(steps)).toBe("IMPLEMENTATION");
    expect(chainProblems([...steps, { stage: "REGRESSION_TEST", ok: true, detail: "skipped ahead", at: "t" }])[0]).toContain("skipped IMPLEMENTATION");
    expect(chainProblems([{ stage: "IMPLEMENTATION", ok: true, detail: "no gap", at: "t" }]).some((problem) => problem.includes("must start at CAPABILITY_GAP"))).toBe(true);
    expect(chainProblems([...steps, { stage: "IMPROVEMENT_TASK", ok: true, detail: "twice", at: "t" }]).some((problem) => problem.includes("out of order"))).toBe(true);
  });
});

describe("checkpoint-11 §34 closure: three doors", () => {
  const aggregate = aggregateGaps([occurrence({ severity: "HIGH" })])[0]!;
  const task = planImprovement({ aggregate, previous_verdict: "MISSING", now: "2026-01-05T00:00:00.000Z" });
  const steps: ChainStep[] = CAPABILITY_CHAIN.slice(0, 5).map((stage) => ({ stage, ok: true, detail: stage, at: "t" }));
  const regression = { passed: true, gate: "UNIT", evidence_ids: ["ev-1"] };

  it("closes only when the test passed, knowledge was accepted and the probe moved", () => {
    const verdict = closureFor({ task, steps, regression, knowledge: { outcome: "ACCEPT" }, current_verdict: "EXISTS" });
    expect(verdict.closed).toBe(true);
    expect(verdict.label).toBe("CAPABILITY_GAINED");
    expect(verdict.reasons).toEqual([]);
  });

  it("refuses to close on a green test that left the capability missing", () => {
    const verdict = closureFor({ task, steps, regression, knowledge: { outcome: "ACCEPT" }, current_verdict: "MISSING" });
    expect(verdict.closed).toBe(false);
    expect(verdict.label).toBe("NOT_CLOSED");
    expect(verdict.returns_to).toBe("IMPLEMENTATION");
    expect(verdict.reasons.some((reason) => reason.includes("still reports MISSING"))).toBe(true);
  });

  it("refuses to close without a passing regression test or its evidence", () => {
    const failed = closureFor({ task, steps, regression: { passed: false, gate: "UNIT", evidence_ids: ["ev-1"], detail: "assertion failed" }, knowledge: { outcome: "ACCEPT" }, current_verdict: "EXISTS" });
    expect(failed.closed).toBe(false);
    expect(failed.reasons.some((reason) => reason.includes("regression test did not pass"))).toBe(true);
    const unevidenced = closureFor({ task, steps, regression: { passed: true, gate: "UNIT" }, knowledge: { outcome: "ACCEPT" }, current_verdict: "EXISTS" });
    expect(unevidenced.reasons.some((reason) => reason.includes("cited no §31.3 evidence row"))).toBe(true);
  });

  it("refuses to close when the knowledge update was rejected or quarantined", () => {
    const rejected = closureFor({ task, steps, regression, knowledge: { outcome: "REJECT", reasons: ["model claim cannot certify itself"] }, current_verdict: "EXISTS" });
    expect(rejected.closed).toBe(false);
    expect(rejected.reasons.some((reason) => reason.includes("knowledge update was REJECT"))).toBe(true);
  });

  it("reports partial progress when the probe moved but the capability is not reachable yet", () => {
    const verdict = closureFor({ task, steps, regression, knowledge: { outcome: "SUPERSEDE" }, current_verdict: "PARTIAL" });
    expect(verdict.closed).toBe(true);
    expect(verdict.label).toBe("PARTIAL_PROGRESS");
  });

  it("notices a chain that was recorded out of order even when everything else is green", () => {
    const broken: ChainStep[] = [
      { stage: "CAPABILITY_GAP", ok: true, detail: "recorded", at: "t" },
      { stage: "REGRESSION_TEST", ok: true, detail: "skipped the task", at: "t" }
    ];
    const verdict = closureFor({ task, steps: broken, regression, knowledge: { outcome: "ACCEPT" }, current_verdict: "EXISTS" });
    expect(verdict.closed).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes("skipped"))).toBe(true);
  });
});

describe("checkpoint-11 §34 knowledge update and registry", () => {
  const aggregate = aggregateGaps([occurrence({ severity: "HIGH" })])[0]!;
  const task = planImprovement({ aggregate, previous_verdict: "MISSING", now: "2026-01-05T00:00:00.000Z" });
  const steps: ChainStep[] = CAPABILITY_CHAIN.slice(0, 5).map((stage) => ({ stage, ok: true, detail: stage, at: "t" }));
  const regression = { passed: true, gate: "UNIT", evidence_ids: ["ev-1"] };
  const closure = closureFor({ task, steps, regression, knowledge: { outcome: "ACCEPT" }, current_verdict: "EXISTS" });

  it("builds a candidate the §5.3 gate accepts as host-verified knowledge", () => {
    const candidate = knowledgeCandidateFor({
      task, closure, regression, current_verdict: "EXISTS",
      probe_evidence: ["src/shared/x.ts#buildThing exports buildThing", "src/app.ts imports src/shared/x.ts"],
      scope: "codex-boss", captured_at: "2026-01-06T00:00:00.000Z", task_ref: task.requirement.id
    });
    expect(candidate.type).toBe("CAPABILITY_GAP");
    expect(candidate.producer).toBe("VERIFICATION");
    expect(candidate.authority).toBe("VERIFIED_HOST");
    expect(candidate.verification).toBe("VERIFIED");
    expect(candidate.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(candidate.summary).toContain("MISSING → EXISTS");
    const verdict = gateKnowledgeWrite(candidate, [], { now: "2026-01-06T00:00:00.000Z" });
    expect(verdict.outcome).toBe("ACCEPT");
  });

  it("marks an unclosed gap's knowledge as unverified so the gate cannot pass it off as fact", () => {
    const unclosed = closureFor({ task, steps, regression, knowledge: { outcome: "ACCEPT" }, current_verdict: "MISSING" });
    const candidate = knowledgeCandidateFor({
      task, closure: unclosed, regression, current_verdict: "MISSING",
      probe_evidence: ["nothing matched"], scope: "codex-boss", captured_at: "2026-01-06T00:00:00.000Z", task_ref: task.requirement.id
    });
    expect(candidate.verification).toBe("UNVERIFIED");
    expect(candidate.confidence).toBeLessThan(0.9);
  });

  it("registers a gained capability, a partial one and an open one differently", () => {
    const gained = registryEntryFor({ task, closure, current_verdict: "EXISTS", evidence: ["ev-1"], closed_at: "2026-01-06T00:00:00.000Z" });
    expect(gained.status).toBe("GAINED");
    expect(gained.previous_verdict).toBe("MISSING");
    expect(gained.verdict).toBe("EXISTS");
    const partial = registryEntryFor({ task, closure, current_verdict: "PARTIAL", evidence: [], closed_at: "t" });
    expect(partial.status).toBe("PARTIAL");
    const open = registryEntryFor({ task, closure: { ...closure, closed: false }, current_verdict: "MISSING", evidence: [], closed_at: "t" });
    expect(open.status).toBe("OPEN");
    expect(open.evidence).toEqual([]);
  });

  it("routes an unclosed gap back to implementation rather than the registry", () => {
    const steps2: ChainStep[] = [steps[0]!, steps[1]!, steps[2]!];
    const unclosed = closureFor({ task, steps: steps2, regression: { passed: true, evidence_ids: ["ev-1"] }, knowledge: { outcome: "ACCEPT" }, current_verdict: "MISSING" });
    expect(nextChainStage(steps2, unclosed)).toBe("IMPLEMENTATION");
    expect(nextChainStage(steps2)).toBe("REGRESSION_TEST");
  });
});
