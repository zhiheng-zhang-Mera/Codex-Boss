import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCandidateGuardian, type CandidateEvaluationInput } from "../../electron/engineering/candidate-guardian";
import { evaluateGuardian, type GuardianContext } from "../../src/shared/candidate-gate";
import { emptyLedger } from "../../src/shared/evidence-ledger";

/**
 * Phase H 鈥?"we could not look" is not "there was nothing to see".
 *
 * The guardian's destructive-change check is the one place in this phase where the
 * swallow was fail-OPEN rather than fail-safe: when git could not report deletions,
 * or `package.json` could not be parsed, the host passed the empty lists it had and
 * the check answered PASS. A candidate that deleted a test file and left the
 * manifest unreadable was therefore checked by nothing and told it was clean.
 *
 * The fix uses the mechanism the evaluator already had: a check the host could not
 * run is reported NOT_RUN with its reason (the same shape as "the change set was
 * not supplied"), so the gate stops claiming a check it never performed.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-guardian-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const CONTEXT: GuardianContext = {
  goal: { text: "ship the gateway", served_by_requirements: ["R-1"], deliverables: ["a receipt"] },
  coverage: { required: ["R-1"], covered: ["R-1"], unimplemented: [] },
  secrets: { scanned_files: [], hits: [] },
  scope: { allowed_files: ["src/gateway.ts"], written_files: ["src/gateway.ts"], refused: [] },
  evidence: { outstanding_requirements: [], failed_requirements: [], ledger_rows: 1, review_covered: true },
  destructive: { deleted_files: [], deleted_tests: [], removed_scripts: [], approved_by_owner: [] }
};

function destructiveCheck(context: GuardianContext) {
  const evaluation = evaluateGuardian(context);
  const check = evaluation.verdict.checks.find((entry) => entry.check === "DESTRUCTIVE_CHANGE_CHECK");
  if (!check) throw new Error("the destructive-change check is missing from the verdict");
  return { evaluation, check };
}

describe("Phase H 鈥?the candidate guardian's removal checks", () => {
  it("passes the destructive check only when the host really looked", () => {
    const { check } = destructiveCheck(CONTEXT);
    expect(check.verdict).toBe("PASS");
  });

  it("reports the check as not run when the host could not look", () => {
    const unchecked = ["git could not report what the candidate deleted: git status was unavailable"];
    const { evaluation, check } = destructiveCheck({ ...CONTEXT, destructive: { ...CONTEXT.destructive!, unchecked } });
    expect(check.verdict).toBe("NOT_RUN");
    expect(check.reasons.join(" ")).toContain("git status was unavailable");
    // A check that did not run cannot be a check that passed.
    expect(evaluation.verdict.blocking).toContain("DESTRUCTIVE_CHANGE_CHECK");
  });

  it("still fails a removal that really happened", () => {
    // The contrast that makes the new state meaningful: a real, unapproved removal
    // is FAIL, not NOT_RUN.
    const { check } = destructiveCheck({ ...CONTEXT, destructive: { ...CONTEXT.destructive!, deleted_tests: ["tests/unit/x.test.ts"] } });
    expect(check.verdict).toBe("FAIL");
  });

  it("names what it could not read instead of answering clean", () => {
    const root = makeTree();
    // A manifest that exists and cannot be parsed: the scripts could not be checked
    // at all, and no git repository means the deletions could not be either.
    fs.writeFileSync(path.join(root, "package.json"), "{ not json", "utf8");
    const guardian = createCandidateGuardian({ root, ledger: () => emptyLedger() });
    const input: CandidateEvaluationInput = {
      taskId: "t1",
      state: "REVIEWING",
      requirements: [{ id: "R-1", text: "the gateway returns a receipt", type: "CONSTRAINT", state: "VERIFIED", visual: false }],
      goal: { text: "ship the gateway", deliverables: ["a receipt"] },
      written_files: ["src/gateway.ts"],
      allowed_files: ["src/gateway.ts"],
      baseline_scripts: ["test", "build"]
    };
    const outcome = guardian.evaluate(input);
    const unchecked = outcome.context.destructive?.unchecked ?? [];
    expect(unchecked.some((reason) => reason.includes("package.json"))).toBe(true);
    const check = outcome.evaluation.verdict.checks.find((entry) => entry.check === "DESTRUCTIVE_CHANGE_CHECK");
    expect(check?.verdict).toBe("NOT_RUN");
    expect(outcome.repair).toContain("DESTRUCTIVE_CHANGE_CHECK");
  });

  it("tells a corrupt candidate record apart from a gate that never recorded one", () => {
    const root = makeTree();
    const recordPath = path.join(root, "record.json");
    const never = createCandidateGuardian({ root, ledger: () => emptyLedger(), recordPath });
    expect(never.record()).toBeUndefined();
    expect(never.recordDiagnostic()).toBeUndefined();

    fs.writeFileSync(recordPath, "{ truncated", "utf8");
    const corrupt = createCandidateGuardian({ root, ledger: () => emptyLedger(), recordPath });
    expect(corrupt.record()).toBeUndefined();
    expect(corrupt.recordDiagnostic()).toBeTruthy();
  });
});
