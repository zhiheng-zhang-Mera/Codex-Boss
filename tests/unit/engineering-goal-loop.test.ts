import { describe, expect, it, vi } from "vitest";
import { runEngineeringGoalLoop, type EngineeringGoalLoopOperations } from "../../electron/engineering/engineering-goal-loop";
import type { EngineeringFinding, EngineeringGoalContract } from "../../src/shared/engineering-loop";

/**
 * PF-DEBT-010 — the goal-driven loop's semantics, which are the whole point of it existing.
 *
 * The repair loop asks the workspace what is wrong and fixes the first thing it finds. Given a GOAL,
 * that means working whatever was already failing — on a real run it chased a pre-existing
 * environment-blocked suite and never touched the objective. These tests pin the inversion: the audit
 * is a precondition and a record, and the OBJECTIVE is the work list.
 */

const AT = "2026-09-16T00:00:00.000Z";

function goal(): EngineeringGoalContract {
  return {
    schemaVersion: 1,
    id: "goal-1",
    objective: "add the round-trip test for the intervention contract",
    workspace: "/workspace",
    protectedProductBehavior: [],
    allowedChangeScope: ["tests/"],
    forbiddenChangeScope: [],
    verificationPolicy: "standard",
    agentCount: 1,
    convergencePolicy: { cleanRoundsRequired: 1 },
    createdAt: AT
  };
}

const codeFinding = (id: string): EngineeringFinding => ({ id, area: "tests", description: `${id} was already failing`, severity: "HIGH", kind: "code" });
const environmentFinding = (id: string): EngineeringFinding => ({ id, area: "environment", description: `${id} could not run`, severity: "HIGH", kind: "environment" });

function operations(overrides: Partial<EngineeringGoalLoopOperations> = {}): EngineeringGoalLoopOperations {
  return {
    audit: async () => [],
    implement: async () => ({ changedFiles: ["tests/a.test.ts"], status: "PASS" as const, checks: [{ kind: "test", passed: true }] }),
    ...overrides
  };
}

describe("Phase 06 — the audit is a precondition, not a work list", () => {
  it("refuses the run when the workspace cannot build or test itself", async () => {
    // Nothing measured in a workspace whose own tooling cannot run means anything, including the
    // judgement that the goal succeeded. Refuse by name, before attempting anything.
    const implement = vi.fn();
    const summary = await runEngineeringGoalLoop({
      goal: goal(),
      operations: operations({ audit: async () => [environmentFinding("environment:typecheck")], implement })
    });

    expect(summary.state).toBe("PRECONDITION_FAILED");
    expect(summary.iterations).toBe(0);
    expect(summary.changedFiles).toEqual([]);
    expect(implement, "an attempt must not be made in an unbuildable workspace").not.toHaveBeenCalled();
    expect(summary.terminalReason).toContain("workspace precondition failed");
    // The reason names the actual fault rather than reporting an unscopable code finding.
    expect(summary.terminalReason).toContain("could not run");
    // The environment finding is carried as evidence, not discarded.
    expect(summary.preExisting.map((finding) => finding.id)).toContain("environment:typecheck");
  });

  it("records pre-existing CODE findings and does not work them", async () => {
    // The inversion. A repair loop would target `command:test`; this loop must record it and work the
    // objective instead.
    const implement = vi.fn(async () => ({ changedFiles: ["tests/a.test.ts"], status: "PASS" as const, checks: [{ kind: "test", passed: true }] }));
    const summary = await runEngineeringGoalLoop({
      goal: goal(),
      operations: operations({ audit: async () => [codeFinding("command:test")], implement })
    });

    expect(summary.state).toBe("CONVERGED");
    expect(summary.preExisting.map((finding) => finding.id)).toEqual(["command:test"]);
    expect(implement).toHaveBeenCalledTimes(1);
    // The objective — not the pre-existing finding — is what the implementer was given.
    expect(implement.mock.calls[0]![1]).toBe(goal().objective);
  });

  it("treats a workspace with only code findings as usable, because those can be judged around", async () => {
    const summary = await runEngineeringGoalLoop({
      goal: goal(),
      operations: operations({ audit: async () => [codeFinding("a"), codeFinding("b")] })
    });
    expect(summary.state).toBe("CONVERGED");
    expect(summary.preExisting).toHaveLength(2);
  });
});

describe("Phase 06 — convergence requires the host's verification over a real change", () => {
  it("converges only when the host's checks pass over a non-empty change", async () => {
    const summary = await runEngineeringGoalLoop({ goal: goal(), operations: operations() });
    expect(summary.state).toBe("CONVERGED");
    expect(summary.changedFiles).toEqual(["tests/a.test.ts"]);
    expect(summary.verification?.passed).toBe(true);
    expect(summary.terminalReason).toContain("the host's checks passed");
  });

  it("does NOT call it converged when nothing changed, even if the checks pass", async () => {
    // A verified workspace the run did not change is a real answer — the goal needed no change — but it
    // is not the goal having been implemented, and conflating the two would report success for a no-op.
    const summary = await runEngineeringGoalLoop({
      goal: goal(),
      operations: operations({ implement: async () => ({ changedFiles: [], status: "PASS" as const, checks: [{ kind: "test", passed: true }] }) })
    });
    expect(summary.state).toBe("NOT_CONVERGED");
    expect(summary.terminalReason).toContain("produced no change");
  });

  it("reports a failed attempt with the host's evidence and retries only within the attempt budget", async () => {
    let attempts = 0;
    const summary = await runEngineeringGoalLoop({
      goal: goal(),
      maxAttempts: 2,
      operations: operations({
        implement: async () => {
          attempts += 1;
          return { changedFiles: ["tests/a.test.ts"], status: "FAIL" as const, checks: [{ kind: "test", passed: false }] };
        }
      })
    });
    expect(attempts).toBe(2);
    expect(summary.state).toBe("NOT_CONVERGED");
    expect(summary.verification?.passed).toBe(false);
    expect(summary.terminalReason).toContain("did not pass");
  });

  it("stops at the first passing attempt rather than spending the whole budget", async () => {
    let attempts = 0;
    const summary = await runEngineeringGoalLoop({
      goal: goal(),
      maxAttempts: 5,
      operations: operations({
        implement: async () => {
          attempts += 1;
          return { changedFiles: ["tests/a.test.ts"], status: "PASS" as const, checks: [{ kind: "test", passed: true }] };
        }
      })
    });
    expect(attempts).toBe(1);
    expect(summary.state).toBe("CONVERGED");
  });
});

describe("Phase 06 — a failure is reported as itself", () => {
  it("reports an implementer failure without inventing a scope change", async () => {
    const summary = await runEngineeringGoalLoop({
      goal: goal(),
      operations: operations({ implement: async () => ({ changedFiles: [], status: "FAIL" as const, checks: [], error: "the coder is unavailable" }) })
    });
    expect(summary.state).toBe("NO_EDITOR");
    expect(summary.terminalReason).toContain("the coder is unavailable");
    expect(summary.changedFiles).toEqual([]);
  });

  it("keeps partial progress visible when a later attempt fails", async () => {
    // A run that changed files and then failed must not look like a run that did nothing.
    let attempt = 0;
    const summary = await runEngineeringGoalLoop({
      goal: goal(),
      maxAttempts: 2,
      operations: operations({
        implement: async () => {
          attempt += 1;
          if (attempt === 1) return { changedFiles: ["tests/first.test.ts"], status: "FAIL" as const, checks: [{ kind: "test", passed: false }] };
          return { changedFiles: [], status: "FAIL" as const, checks: [], error: "the coder gave up" };
        }
      })
    });
    expect(summary.state).toBe("NOT_CONVERGED");
    expect(summary.changedFiles).toEqual(["tests/first.test.ts"]);
  });
});

describe("Phase 06 — the independent review travels with the result", () => {
  it("runs the reviewer over the applied change and reports its findings", async () => {
    const review = vi.fn(async () => ({ findings: [{ severity: "MEDIUM" as const, summary: "the fixture is not cleaned up" }] }));
    const summary = await runEngineeringGoalLoop({ goal: goal(), operations: operations({ review }) });
    expect(summary.state).toBe("CONVERGED");
    expect(review).toHaveBeenCalledTimes(1);
    expect(summary.reviewFindings).toHaveLength(1);
  });

  it("does not review when nothing was applied", async () => {
    const review = vi.fn(async () => ({ findings: [] }));
    await runEngineeringGoalLoop({
      goal: goal(),
      operations: operations({ review, implement: async () => ({ changedFiles: [], status: "PASS" as const, checks: [{ kind: "test", passed: true }] }) })
    });
    expect(review).not.toHaveBeenCalled();
  });
});
