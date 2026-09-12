/**
 * checkpoint-1 §35/§36 (checkpoint-12): the candidate lifecycle and the Guardian.
 *
 * The cases pin §35's rule that a task never jumps RUNNING → COMPLETED, that
 * CANDIDATE means complete-but-unreleased, and §36's rule that a check which could
 * not be run is a blocker rather than a pass — so ACCEPTED is unreachable without
 * an evidenced verdict for all eleven checks.
 */
import { describe, expect, it } from "vitest";
import {
  advanceLifecycle,
  candidateIdFor,
  candidateRecordFor,
  evaluateGuardian,
  GUARDIAN_CHECKS,
  requiredGuardianChecks,
  TASK_LIFECYCLE,
  TASK_TRANSITIONS,
  THEME_GUARDIAN_CHECKS,
  type GuardianContext,
  type LifecycleEvent,
  type TaskLifecycleState
} from "../../src/shared/candidate-gate";

const cleanContext = (): GuardianContext => ({
  goal: { text: "let users choose installments", served_by_requirements: ["R-1"], deliverables: ["gateway adapter"] },
  coverage: { required: ["R-1"], covered: ["R-1"], unimplemented: [] },
  secrets: { scanned_files: ["src/gateway.ts"], hits: [] },
  scope: { allowed_files: ["src/gateway.ts"], written_files: ["src/gateway.ts"], refused: [] },
  evidence: { outstanding_requirements: [], failed_requirements: [], ledger_rows: 4, review_covered: true },
  destructive: { deleted_files: [], deleted_tests: [], removed_scripts: [], approved_by_owner: [] },
  overrides: [],
  obligations: ["the gateway adapter returns a receipt"]
});

describe("checkpoint-12 §35 the task lifecycle", () => {
  it("never moves RUNNING → ACCEPTED", () => {
    expect([...TASK_LIFECYCLE]).toEqual(["RUNNING", "IMPLEMENTED", "VERIFYING", "REVIEWING", "CANDIDATE", "ACCEPTED"]);
    expect(TASK_TRANSITIONS.RUNNING).toEqual(["IMPLEMENTED"]);
    expect(TASK_TRANSITIONS.ACCEPTED).toEqual([]);
    const refused = advanceLifecycle("RUNNING", "ACCEPTED");
    expect(refused.accepted).toBe(false);
    expect(refused.state).toBe("RUNNING");
    expect(refused.reason).toContain("not legal from RUNNING");
    expect(refused.reason).toContain("RUNNING → IMPLEMENTED");
  });

  it("walks the six states with the plan's events", () => {
    const events: LifecycleEvent[] = ["IMPLEMENTED", "VERIFIED", "REVIEWED", "CANDIDATED", "ACCEPTED"];
    let state: TaskLifecycleState = "RUNNING";
    const trail: string[] = [state];
    for (const event of events) {
      const step = advanceLifecycle(state, event);
      expect(step.accepted).toBe(true);
      state = step.state;
      trail.push(state);
    }
    expect(trail).toEqual([...TASK_LIFECYCLE]);
  });

  it("sends a rejected candidate back to review instead of forward", () => {
    const step = advanceLifecycle("CANDIDATE", "REPAIR");
    expect(step.accepted).toBe(true);
    expect(step.state).toBe("REVIEWING");
    expect(step.reason).toContain("repair");
    expect(advanceLifecycle("ACCEPTED", "REPAIR").accepted).toBe(false);
  });

  it("records CANDIDATE as still awaiting a release permission", () => {
    const evaluation = evaluateGuardian(cleanContext());
    const record = candidateRecordFor({
      task_id: "task-1",
      state: "CANDIDATE",
      requirements: ["R-1"],
      completion_evidence: ["ev-1"],
      guardian: evaluation.verdict,
      steps: [{ state: "CANDIDATE", at: "2026-01-01T00:00:00.000Z", reason: "review done", evidence: ["review-1"] }],
      now: "2026-01-01T00:00:00.000Z"
    });
    expect(record.awaiting_release_permission).toBe(true);
    expect(record.version).toBe("candidate-gate-1");
    expect(record.guardian.released).toBe(true);
    const accepted = candidateRecordFor({ task_id: "task-1", state: "ACCEPTED", requirements: [], completion_evidence: [], guardian: evaluation.verdict, steps: [] });
    expect(accepted.awaiting_release_permission).toBe(false);
    expect(candidateIdFor("task-1", ["R-2", "R-1"])).toBe(candidateIdFor("task-1", ["R-1", "R-2"]));
    expect(candidateIdFor("task-1", ["R-1"])).toMatch(/^cand-[0-9a-f]{16}$/);
  });
});

describe("checkpoint-12 §36 the Guardian's seven checks", () => {
  it("requires the seven base checks, plus four for a theme change", () => {
    expect([...GUARDIAN_CHECKS]).toHaveLength(7);
    expect([...THEME_GUARDIAN_CHECKS]).toHaveLength(4);
    expect(requiredGuardianChecks(cleanContext())).toEqual([...GUARDIAN_CHECKS]);
    const themed = requiredGuardianChecks({ ...cleanContext(), themes: [{ id: "t", references_other_theme: false, error_diagnostics: 0, executable_payload_diagnostics: 0, fallback_plan_valid: true, built_in: false, built_in_intact: true }] });
    expect(themed).toEqual([...GUARDIAN_CHECKS, ...THEME_GUARDIAN_CHECKS]);
  });

  it("accepts only a candidate whose every check passed", () => {
    const evaluation = evaluateGuardian(cleanContext());
    expect(evaluation.verdict.released).toBe(true);
    expect(evaluation.verdict.verdict).toBe("ACCEPTED");
    expect(evaluation.verdict.blocking).toEqual([]);
    expect(evaluation.verdict.checks).toHaveLength(7);
    expect(evaluation.verdict.checks.every((check) => check.inspected.length > 0)).toBe(true);
  });

  it("refuses to release when a check could not be run", () => {
    const evaluation = evaluateGuardian({});
    expect(evaluation.verdict.released).toBe(false);
    expect(evaluation.verdict.verdict).toBe("REPAIR");
    expect(evaluation.verdict.blocking).toEqual([...GUARDIAN_CHECKS]);
    expect(evaluation.verdict.reason).toContain("could not be run");
    expect(evaluation.not_inspected).toEqual([...GUARDIAN_CHECKS]);
    expect(evaluation.verdict.checks.every((check) => check.verdict === "NOT_RUN")).toBe(true);
  });

  it("fails goal compliance when nothing traces to the goal", () => {
    const evaluation = evaluateGuardian({ ...cleanContext(), goal: { text: "let users choose installments", served_by_requirements: [], deliverables: ["gateway adapter"] } });
    const check = evaluation.verdict.checks.find((entry) => entry.check === "GOAL_COMPLIANCE")!;
    expect(check.verdict).toBe("FAIL");
    expect(check.reasons.some((reason) => reason.includes("no requirement serves the goal"))).toBe(true);
    expect(evaluation.verdict.blocking).toContain("GOAL_COMPLIANCE");
  });

  it("fails requirement coverage below 100%", () => {
    const evaluation = evaluateGuardian({ ...cleanContext(), coverage: { required: ["R-1", "R-2"], covered: ["R-1"], unimplemented: ["R-2"] } });
    const check = evaluation.verdict.checks.find((entry) => entry.check === "REQUIREMENT_COVERAGE")!;
    expect(check.verdict).toBe("FAIL");
    expect(check.reasons.some((reason) => reason.includes("R-2 has no binding"))).toBe(true);
    expect(check.reasons.some((reason) => reason.includes("below 100%"))).toBe(true);
  });

  it("fails on a credential shape the scanner found", () => {
    const evaluation = evaluateGuardian({ ...cleanContext(), secrets: { scanned_files: ["src/creds.ts"], hits: [{ path: "src/creds.ts", shapes: ["aws-access-key"] }] } });
    const check = evaluation.verdict.checks.find((entry) => entry.check === "SECRET_SCAN")!;
    expect(check.verdict).toBe("FAIL");
    expect(check.reasons[0]).toContain("aws-access-key");
  });

  it("fails when a file was written outside the granted scope", () => {
    const evaluation = evaluateGuardian({ ...cleanContext(), scope: { allowed_files: ["src/a.ts"], written_files: ["src/a.ts", "src/b.ts"], refused: ["src/c.ts is outside the granted scope"] } });
    const check = evaluation.verdict.checks.find((entry) => entry.check === "SCOPE_VALIDATION")!;
    expect(check.verdict).toBe("FAIL");
    expect(check.reasons.some((reason) => reason.includes("src/b.ts was written outside"))).toBe(true);
    expect(check.reasons.some((reason) => reason.includes("src/c.ts is outside"))).toBe(true);
  });

  it("fails evidence completeness on owed evidence, failed verification or an uncovered review", () => {
    const owed = evaluateGuardian({ ...cleanContext(), evidence: { outstanding_requirements: ["R-3"], failed_requirements: [], ledger_rows: 2, review_covered: true } });
    expect(owed.verdict.checks.find((entry) => entry.check === "EVIDENCE_COMPLETENESS")?.verdict).toBe("FAIL");
    const failed = evaluateGuardian({ ...cleanContext(), evidence: { outstanding_requirements: [], failed_requirements: ["R-9"], ledger_rows: 2, review_covered: true } });
    expect(failed.verdict.checks.find((entry) => entry.check === "EVIDENCE_COMPLETENESS")?.reasons.some((reason) => reason.includes("R-9 failed"))).toBe(true);
    const uncovered = evaluateGuardian({ ...cleanContext(), evidence: { outstanding_requirements: [], failed_requirements: [], ledger_rows: 2, review_covered: false } });
    expect(uncovered.verdict.checks.find((entry) => entry.check === "EVIDENCE_COMPLETENESS")?.reasons.some((reason) => reason.includes("§32 review did not cover"))).toBe(true);
    const empty = evaluateGuardian({ ...cleanContext(), evidence: { outstanding_requirements: [], failed_requirements: [], ledger_rows: 0, review_covered: true } });
    expect(empty.verdict.checks.find((entry) => entry.check === "EVIDENCE_COMPLETENESS")?.reasons.some((reason) => reason.includes("no rows at all"))).toBe(true);
  });

  it("fails a removal the Owner never approved, and passes an approved one", () => {
    const unapproved = evaluateGuardian({ ...cleanContext(), destructive: { deleted_files: ["src/old.ts"], deleted_tests: ["tests/old.test.mjs"], removed_scripts: ["build"], approved_by_owner: [] } });
    const check = unapproved.verdict.checks.find((entry) => entry.check === "DESTRUCTIVE_CHANGE_CHECK")!;
    expect(check.verdict).toBe("FAIL");
    expect(check.reasons).toHaveLength(3);
    expect(check.reasons[0]).toContain("without an Owner approval");
    const approved = evaluateGuardian({ ...cleanContext(), destructive: { deleted_files: ["src/old.ts"], deleted_tests: [], removed_scripts: [], approved_by_owner: ["src/old.ts"] } });
    expect(approved.verdict.checks.find((entry) => entry.check === "DESTRUCTIVE_CHANGE_CHECK")?.verdict).toBe("PASS");
  });

  it("fails when the Owner's own override is not reflected in the work", () => {
    const evaluation = evaluateGuardian({
      ...cleanContext(),
      overrides: [{ text: "use installments of 3, not 12", supersedes: ["DELIVERABLES"], expected_in_requirements: ["installments of 3"] }]
    });
    const check = evaluation.verdict.checks.find((entry) => entry.check === "OWNER_OVERRIDE_COMPLIANCE")!;
    expect(check.verdict).toBe("FAIL");
    expect(check.reasons[0]).toContain("installments of 3");
    const reflected = evaluateGuardian({
      ...cleanContext(),
      obligations: ["support installments of 3 at checkout"],
      overrides: [{ text: "use installments of 3, not 12", supersedes: ["DELIVERABLES"], expected_in_requirements: ["installments of 3"] }]
    });
    expect(reflected.verdict.checks.find((entry) => entry.check === "OWNER_OVERRIDE_COMPLIANCE")?.verdict).toBe("PASS");
  });
});

describe("checkpoint-12 §36 the Guardian's four theme checks", () => {
  const theme = (overrides: Partial<Parameters<typeof requiredGuardianChecks>[0]["themes"] extends (infer T)[] | undefined ? T : never> = {}) => ({
    id: "user/neon",
    references_other_theme: false,
    error_diagnostics: 0,
    executable_payload_diagnostics: 0,
    fallback_plan_valid: true,
    built_in: false,
    built_in_intact: true,
    ...overrides
  });

  it("passes a self-contained, valid, non-executable theme", () => {
    const evaluation = evaluateGuardian({ ...cleanContext(), themes: [theme()] });
    expect(evaluation.verdict.released).toBe(true);
    expect(evaluation.verdict.checks).toHaveLength(11);
  });

  it("fails isolation, payload, fallback and built-in integrity separately", () => {
    const isolation = evaluateGuardian({ ...cleanContext(), themes: [theme({ references_other_theme: true })] });
    expect(isolation.verdict.checks.find((entry) => entry.check === "THEME_ISOLATION")?.verdict).toBe("FAIL");
    expect(isolation.verdict.blocking).toContain("THEME_ISOLATION");

    const payload = evaluateGuardian({ ...cleanContext(), themes: [theme({ executable_payload_diagnostics: 2 })] });
    expect(payload.verdict.checks.find((entry) => entry.check === "NO_EXECUTABLE_PAYLOAD")?.reasons[0]).toContain("executable-content");

    const fallback = evaluateGuardian({ ...cleanContext(), themes: [theme({ fallback_plan_valid: false })] });
    expect(fallback.verdict.checks.find((entry) => entry.check === "FALLBACK_VALIDATION")?.verdict).toBe("FAIL");

    const builtIn = evaluateGuardian({ ...cleanContext(), themes: [theme({ id: "builtin-dark", built_in: true, built_in_intact: false })] });
    expect(builtIn.verdict.checks.find((entry) => entry.check === "BUILT_IN_THEME_INTEGRITY")?.verdict).toBe("FAIL");

    const invalidBuiltIn = evaluateGuardian({ ...cleanContext(), themes: [theme({ id: "builtin-dark", built_in: true, error_diagnostics: 1 })] });
    expect(invalidBuiltIn.verdict.released).toBe(false);
  });

  it("does not require theme checks for a change that touches no theme", () => {
    const evaluation = evaluateGuardian(cleanContext());
    expect(evaluation.verdict.checks.some((entry) => THEME_GUARDIAN_CHECKS.includes(entry.check as never))).toBe(false);
  });
});
