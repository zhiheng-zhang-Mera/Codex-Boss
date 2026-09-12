/**
 * checkpoint-1 §30/§31 (checkpoint-8): the verification engine's decision layer.
 *
 * These cases pin the ladder order, §31.2's requirement-aware selection, the
 * fail-closed refusal to run a rung the host cannot run, the §30.2 rejection of a
 * claim no observation confirms, and §30.1/§30.3's scope and atomicity rules.
 */
import { describe, expect, it } from "vitest";
import { GATE_RANK, type VerificationGate } from "../../src/shared/execution-planner";
import {
  boundedScopeFor,
  changeUnitProblems,
  evidenceGaps,
  evidenceInputsForRun,
  ladderOutcome,
  orderByLadder,
  planVerification,
  selectGates,
  verifyChangeClaims,
  VERIFICATION_LADDER,
  type GateRun,
  type VerificationCommands,
  type VerificationHarnesses
} from "../../src/shared/verification";

type Node = Parameters<typeof selectGates>[0]["requirement"];
const requirement = (overrides: Partial<Node> & Pick<Node, "id" | "text">): Node => ({
  type: "FUNCTIONAL",
  visual: false,
  ...overrides
});

const COMMANDS: VerificationCommands = {
  syntax: "node --check",
  typecheck: "pnpm run typecheck",
  unit: "pnpm test",
  build: "pnpm run build",
  tests: ["tests/checkout.test.mjs"],
  build_tools: ["tsc", "vite"]
};
const HARNESSES: VerificationHarnesses = { benchmark: true, runtime: true, blackbox: true, visual: true, fault_injection: true };

const gatesOf = (node: Node, commands: VerificationCommands = COMMANDS, harnesses: VerificationHarnesses = HARNESSES): VerificationGate[] =>
  selectGates({ requirement: node, commands, harnesses }).gates.map((decision) => decision.gate);

describe("checkpoint-8 §31.1 verification ladder", () => {
  it("lists the eleven rungs of §31.1 cheap-to-expensive", () => {
    expect([...VERIFICATION_LADDER]).toEqual([
      "SYNTAX", "TYPECHECK", "UNIT", "MODULE", "INTEGRATION", "FULL", "BUILD",
      "BENCHMARK", "RUNTIME", "BLACKBOX", "VISUAL"
    ]);
    // The ladder and the gate ranks describe one order, not two.
    const ranks = VERIFICATION_LADDER.map((gate) => GATE_RANK[gate]);
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
  });

  it("orders any gate set cheapest-first without inventing rungs", () => {
    expect(orderByLadder(["VISUAL", "SYNTAX", "UNIT", "TYPECHECK"])).toEqual(["SYNTAX", "TYPECHECK", "UNIT", "VISUAL"]);
    expect(orderByLadder(["UNIT", "UNIT"])).toEqual(["UNIT"]);
    expect(orderByLadder([])).toEqual([]);
  });
});

describe("checkpoint-8 §31.2 requirement-aware verification", () => {
  it("always starts a functional requirement at the cheap rungs", () => {
    const gates = gatesOf(requirement({ id: "R-1", text: "the checkout endpoint returns a receipt" }));
    expect(gates.slice(0, 2)).toEqual(["SYNTAX", "TYPECHECK"]);
    expect(gates).toContain("UNIT");
  });

  it("routes a performance requirement to the benchmark", () => {
    const selection = selectGates({ requirement: requirement({ id: "R-perf", text: "the checkout response must stay under 100 ms", type: "NON_FUNCTIONAL" }), commands: COMMANDS, harnesses: HARNESSES });
    expect(selection.gates.map((decision) => decision.gate)).toContain("BENCHMARK");
    expect(selection.signals).toContain("performance");
  });

  it("routes persistence to a restart and failure recovery to fault injection", () => {
    const persistence = selectGates({ requirement: requirement({ id: "R-2", text: "the ledger survives a restart", type: "NON_FUNCTIONAL" }), commands: COMMANDS, harnesses: HARNESSES });
    expect(persistence.gates.map((decision) => decision.gate)).toContain("RUNTIME");
    const recovery = selectGates({ requirement: requirement({ id: "R-3", text: "the gateway falls back to full payment when the adapter fails" }), commands: COMMANDS, harnesses: HARNESSES });
    expect(recovery.gates.map((decision) => decision.gate)).toContain("INTEGRATION");
    expect(recovery.signals).toContain("recovery");
  });

  it("routes a theme requirement to the sandbox preview plus the fallback test", () => {
    const selection = selectGates({ requirement: requirement({ id: "R-theme", text: "the built-in dark theme keeps its accent colour", visual: true }), commands: COMMANDS, harnesses: HARNESSES });
    const gates = selection.gates.map((decision) => decision.gate);
    expect(gates).toContain("VISUAL");
    expect(gates).toContain("UNIT");
    expect(gates).toContain("BUILD");
  });

  it("proves a desktop UI requirement with the real application", () => {
    const selection = selectGates({ requirement: requirement({ id: "R-ui", text: "the desktop window shows the theme panel", visual: true }), commands: COMMANDS, harnesses: HARNESSES });
    expect(selection.gates.map((decision) => decision.gate)).toContain("BLACKBOX");
  });

  it("never claims a rung the host cannot climb", () => {
    const selection = selectGates({ requirement: requirement({ id: "R-perf", text: "the response must stay under 100 ms", type: "NON_FUNCTIONAL" }), commands: COMMANDS, harnesses: {} });
    expect(selection.gates.map((decision) => decision.gate)).not.toContain("BENCHMARK");
    expect(selection.unavailable.map((entry) => entry.gate)).toContain("BENCHMARK");
    expect(selection.unavailable.find((entry) => entry.gate === "BENCHMARK")?.reason).toMatch(/no benchmark harness/);
  });

  it("reports no rung at all when the workspace declares no tooling", () => {
    const selection = selectGates({ requirement: requirement({ id: "R-bare", text: "change the checkout" }), commands: {}, harnesses: {} });
    expect(selection.gates).toEqual([]);
    expect(selection.unavailable.length).toBeGreaterThan(0);
  });

  it("keeps REVIEW/PREVIEW/SCREENSHOT outside the engine's own evidence", () => {
    const acceptance = selectGates({ requirement: requirement({ id: "R-acc", text: "AC-1 the adapter falls back", type: "ACCEPTANCE" }), commands: COMMANDS, harnesses: HARNESSES });
    expect(acceptance.external_evidence).toContain("REVIEW");
    expect(evidenceGaps(acceptance)).toContain("REVIEW");
    const visual = selectGates({ requirement: requirement({ id: "R-vis", text: "the panel is visible", type: "VISUAL", visual: true }), commands: COMMANDS, harnesses: HARNESSES });
    expect(visual.external_evidence).toContain("SCREENSHOT");
    expect(visual.external_evidence).toContain("PREVIEW");
    // The rungs it can climb still provide implementation/test/visual evidence.
    expect(visual.external_evidence).not.toContain("IMPLEMENTATION");
  });

  it("plans a whole graph and flags quarantined requirements", () => {
    const plan = planVerification({
      requirements: { nodes: [{ ...requirement({ id: "R-1", text: "checkout works" }), state: "QUARANTINED" } as never] },
      commands: COMMANDS,
      harnesses: HARNESSES,
      now: "2026-01-01T00:00:00.000Z"
    });
    expect(plan.version).toBe("verification-plan-1");
    expect(plan.requirements).toHaveLength(1);
    expect(plan.diagnostics.some((line) => line.includes("QUARANTINED"))).toBe(true);
  });
});

describe("checkpoint-8 §31.1 climbing and the §31.3 ledger rows", () => {
  const selection = selectGates({ requirement: requirement({ id: "R-1", text: "the checkout endpoint returns a receipt" }), commands: COMMANDS, harnesses: HARNESSES });
  const run = (gate: VerificationGate, result: GateRun["result"]): GateRun => ({ gate, command: `run ${gate}`, result, exit_code: result === "PASS" ? 0 : 1 });

  it("keeps the cheapest failure and skips everything above it", () => {
    const outcome = ladderOutcome(selection, [run("SYNTAX", "FAIL"), run("TYPECHECK", "PASS"), run("UNIT", "PASS")]);
    expect(outcome.outcome).toBe("FAIL");
    expect(outcome.failed_at).toBe("SYNTAX");
    const inputs = evidenceInputsForRun(selection, outcome, { host: "h", platform: "p" }, "2026-01-01T00:00:00.000Z");
    const typecheck = inputs.find((entry) => entry.gate === "TYPECHECK")!;
    expect(typecheck.result).toBe("PASS");
    // A rung above a failure is recorded as SKIPPED rather than dropped.
    const above = inputs.filter((entry) => entry.result === "SKIPPED");
    expect(above.length).toBeGreaterThan(0);
  });

  it("passes only when every chosen rung ran and passed", () => {
    const outcome = ladderOutcome(selection, selection.gates.map((decision) => run(decision.gate, "PASS")));
    expect(outcome.outcome).toBe("PASS");
    expect(outcome.ran.map((entry) => entry.gate)).toEqual(selection.gates.map((decision) => decision.gate));
    const inputs = evidenceInputsForRun(selection, outcome, { host: "h", platform: "p" }, "2026-01-01T00:00:00.000Z");
    expect(inputs.every((entry) => entry.requirement_ids.includes("R-1"))).toBe(true);
  });

  it("reports NOT_RUN rather than a pass when nothing could run", () => {
    const outcome = ladderOutcome(selection, []);
    expect(outcome.outcome).toBe("NOT_RUN");
    const inputs = evidenceInputsForRun(selection, outcome, { host: "h", platform: "p" }, "2026-01-01T00:00:00.000Z");
    expect(inputs.every((entry) => entry.result === "NOT_RUN")).toBe(true);
  });
});

describe("checkpoint-8 §30.2/§30.3 worker claims, scope and change units", () => {
  it("refuses a claim that git and the disk do not confirm", () => {
    const verdicts = verifyChangeClaims(
      [{ path: "src/a.ts", claimed_sha256: "aaa" }, { path: "src/b.ts" }, { path: "src/c.ts" }],
      [
        { path: "src/a.ts", exists: true, sha256: "bbb", modified: true },
        { path: "src/b.ts", exists: true, sha256: "ccc", modified: false },
        { path: "src/c.ts", exists: false, modified: true }
      ]
    );
    expect(verdicts[0]).toMatchObject({ ok: false, problem: expect.stringContaining("content hash mismatch") });
    expect(verdicts[1]).toMatchObject({ ok: false, problem: expect.stringContaining("git reports the file unchanged") });
    expect(verdicts[2]).toMatchObject({ ok: false, problem: expect.stringContaining("does not exist") });
  });

  it("accepts a claim the disk and git agree with", () => {
    const verdicts = verifyChangeClaims([{ path: "src/a.ts", claimed_sha256: "aaa" }], [{ path: "src/a.ts", exists: true, sha256: "aaa", modified: true }]);
    expect(verdicts).toEqual([{ path: "src/a.ts", ok: true }]);
  });

  it("fails a change unit that leaves the granted scope", () => {
    const scope = { allowed_files: ["src/gateway.ts"] };
    const problems = changeUnitProblems({ changes: [{ path: "src/gateway.ts", content: "ok" }, { path: "src/other.ts", content: "no" }] }, scope);
    expect(problems.some((problem) => problem.includes("outside the granted scope"))).toBe(true);
    expect(changeUnitProblems({ changes: [{ path: "src/gateway.ts", content: "ok" }] }, scope)).toEqual([]);
  });

  it("refuses protected metadata, duplicates and empty units", () => {
    const scope = { allowed_files: [".git/config", "src/a.ts"] };
    expect(changeUnitProblems({ changes: [] }, scope).some((problem) => problem.includes("empty"))).toBe(true);
    expect(changeUnitProblems({ changes: [{ path: ".git/config", content: "x" }] }, scope).some((problem) => problem.includes("protected"))).toBe(true);
    expect(changeUnitProblems({ changes: [{ path: "src/a.ts", content: "x" }, { path: "src/a.ts", content: "y" }] }, scope).some((problem) => problem.includes("twice"))).toBe(true);
  });

  it("grants a worker only the commands its plan node carried", () => {
    const scope = boundedScopeFor({ allowed_files: [], requirements: ["R-1"], verification: { commands: ["pnpm run build"] } });
    expect(scope.allowed_commands).toContain("build");
    expect(scope.allowed_commands).not.toContain("test");
    // No granted files ⇒ no write permission, and no syntax/typecheck either.
    expect(scope.allowed_files).toEqual([]);
    expect(scope.allowed_commands).not.toContain("syntax");
  });
});
