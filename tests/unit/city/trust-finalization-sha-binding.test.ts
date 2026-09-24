import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * Section 9 B1/B3 — the trust-epoch finalization TOCTOU counterfactual.
 *
 * THE DEFECT, STATED AS A COUNTERFACTUAL
 *
 *   The finalization workflow checked out `ref: main`. A `workflow_dispatch` job that targets an environment with
 *   required reviewers does not start until the named reviewer approves it, and `main` can move between the dispatch
 *   and that approval. Under the old semantic shape this sequence was possible and silent:
 *
 *       dispatch at SHA A  ->  main becomes SHA B  ->  the Owner approves the waiting run  ->  the run measures and
 *       anchors SHA B, while its run id and head_sha say SHA A
 *
 *   The epoch record's declared subject is "the Root Trust Surface at this commit". A run that measures a different
 *   commit anchors a surface it was never dispatched or approved for, and NOTHING in the artifact said so.
 *
 * HOW THIS FILE PROVES THE REPAIR
 *
 *   The proof is a PARAMETERISED MODEL of the checkout decision, not a re-reading of the YAML. The model is the same
 *   shape the workflow implements (`ref` expression -> which commit is checked out -> does the run's declared subject
 *   equal the tree it measured), and the same test body is run against both shapes:
 *
 *       old shape   `ref: main`           -> the model reports NOT bound after main moves
 *       repaired    `ref: ${{ github.sha }}` -> the model reports bound, and asserts bound-ness by name
 *
 *   A test that only asserted the presence of a string in the YAML would pass against a workflow whose assertion step
 *   had been deleted, and would say nothing about the property. This one fails if EITHER half regresses: the shape
 *   (the workflow's own checkout ref, measured from the parsed YAML) or the assertion (the job must contain the
 *   fail-closed step that refuses a mismatch).
 *
 * WHAT THIS FILE CANNOT PROVE, STATED SO IT IS NOT OVER-CLAIMED
 *
 *   It cannot run the protected ceremony: a live dispatch plus an Owner approval is not something a unit test may
 *   perform. The live proof is the epoch-30 run, recorded in the ledger when it happens. What is established here is
 *   that the workflow's checkout is bound to the dispatch SHA, that a mismatch fails closed by name, and that the
 *   artifact the ceremony produces states BOTH SHAs and refuses to validate when they disagree.
 */

const PROJECT = process.cwd();
const WORKFLOW = ".github/workflows/trust-epoch-finalization.yml";
const HANDOFF_MODULE = "scripts/trust-epoch-finalization-handoff.cjs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handoff = require(path.join(PROJECT, HANDOFF_MODULE)) as {
  HANDOFF_SCHEMA: string;
  STATE: Record<string, string>;
  buildHandoff: (input: unknown) => Record<string, unknown>;
  validateHandoff: (value: unknown) => { ok: boolean; problems: string[] };
  normalizeCommit: (value: unknown) => string | null;
  provenanceOf: (dispatchSha: unknown, checkedOutSha: unknown) => { dispatch_sha: string | null; checked_out_sha: string | null; bound: boolean };
};

type Step = { name?: string; uses?: string; with?: Record<string, unknown>; run?: string };
type Workflow = { jobs?: Record<string, { environment?: string; steps?: Step[] }> };

function parsedWorkflow(): Workflow {
  return parseYaml(fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8")) as Workflow;
}

function finalizeSteps(): Step[] {
  const job = parsedWorkflow().jobs?.finalize;
  if (!job) throw new Error(`the finalize job is absent from ${WORKFLOW}`);
  return job.steps ?? [];
}

function checkoutStep(): Step {
  const step = finalizeSteps().find((candidate) => String(candidate.uses ?? "").startsWith("actions/checkout"));
  if (!step) throw new Error(`the finalize job no longer checks anything out`);
  return step;
}

/** Every non-comment line: what the workflow EXECUTES, not what it explains. A comment must not satisfy a guard. */
function executableLines(text: string): string {
  return text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join("\n");
}

/**
 * The checkout decision, as a pure function. This is the shape the workflow implements, and it is the object under
 * test: `refExpression` -> which commit ends up checked out, given what the dispatch SHA and `main` were.
 *
 * `ref: main` resolves to whatever main is AT CHECKOUT TIME (that is what makes it a TOCTOU hole); an expression
 * naming the dispatch SHA resolves to that SHA no matter how far main has moved.
 */
function resolveCheckedOut(refExpression: string, context: { dispatchSha: string; mainAtDispatch: string; mainAtApproval: string }): string {
  const expression = String(refExpression).trim();
  if (expression === "main" || expression === "refs/heads/main") return context.mainAtApproval;
  if (expression.includes("github.sha")) return context.dispatchSha;
  return `<unresolved:${expression}>`;
}

function checkoutBinding(refExpression: string, context: { dispatchSha: string; mainAtDispatch: string; mainAtApproval: string }) {
  const checkedOut = resolveCheckedOut(refExpression, context);
  return { dispatchSha: context.dispatchSha, checkedOut, bound: checkedOut === context.dispatchSha };
}

/** The same assertion the workflow's pwsh step makes, so the test asserts semantics rather than a spelling. */
function assertBound(binding: { dispatchSha: string; checkedOut: string; bound: boolean }): { ok: boolean; code: string | null } {
  if (binding.bound) return { ok: true, code: null };
  return { ok: false, code: "TRUST_EPOCH_FINALIZATION_SHA_MISMATCH" };
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

/** dispatch at A, main moves to B before the approval lands. */
const movedMain = { dispatchSha: SHA_A, mainAtDispatch: SHA_A, mainAtApproval: SHA_B };

// =============================================================================================
// The counterfactual: the old shape fails, the repair holds
// =============================================================================================

describe("Trust epoch finalization: the checkout is bound to the dispatch SHA (section 9 B1)", () => {
  it("the OLD shape (`ref: main`) is NOT bound once main moves — this is the defect, reproduced", () => {
    const binding = checkoutBinding("main", movedMain);
    // Reproducing the defect is the point: a repair that cannot show what it repaired is an assertion of intent.
    expect(binding.checkedOut, "the old shape no longer resolves to the moved main, so this counterfactual is stale").toBe(SHA_B);
    expect(binding.bound, "the old shape reported itself bound, which is the defect failing to reproduce").toBe(false);
    const assertion = assertBound(binding);
    expect(assertion.ok).toBe(false);
    expect(assertion.code, "the old shape has no fail-closed code to fail with").toBe("TRUST_EPOCH_FINALIZATION_SHA_MISMATCH");
  });

  it("the REPAIR (`ref: ${{ github.sha }}`) stays on the dispatch SHA no matter how far main moved", () => {
    const binding = checkoutBinding("${{ github.sha }}", movedMain);
    expect(binding.checkedOut, "the repaired shape followed main instead of the dispatch SHA").toBe(SHA_A);
    expect(binding.bound, "the repaired shape does not report itself bound").toBe(true);
    expect(assertBound(binding).ok).toBe(true);
    // And the property must hold for an arbitrary number of intervening main commits, not just one: the repair must
    // not depend on how far main drifted, or on whether anything landed at all.
    for (const mainAtApproval of [SHA_A, SHA_B, SHA_C, "f".repeat(40)]) {
      expect(checkoutBinding("${{ github.sha }}", { ...movedMain, mainAtApproval }).bound, `the repair lost the binding when main was ${mainAtApproval}`).toBe(true);
    }
  });

  it("the workflow really uses the repaired shape: the checkout ref is measured from the parsed YAML", () => {
    // The static half. `with.ref` is the mechanism; the counterfactual above is the property. This case is what makes
    // a revert of the YAML -- not just of this module -- fail.
    const ref = checkoutStep().with?.ref;
    expect(ref, `the checkout no longer declares a ref: ${JSON.stringify(checkoutStep().with)}`).toBeTruthy();
    expect(String(ref).trim(), "the checkout ref is bound to the dispatch SHA but this test no longer reads the workflow's own ref").toBe("${{ github.sha }}");
    // No bare `main`: the fetch-depth must stay, because the advance reads history and the assertion reads HEAD.
    expect(checkoutStep().with?.["fetch-depth"], "the checkout lost fetch-depth, so the assertion and the advance cannot read history").toBe(0);
  });

  it("the mismatch FAILS CLOSED, and by name, as the first step after the checkout", () => {
    const steps = finalizeSteps();
    const names = steps.map((step) => String(step.name ?? ""));
    const assertionIndex = names.findIndex((name) => name.includes("IS the dispatch SHA"));
    expect(assertionIndex, `the fail-closed assertion step is gone: ${JSON.stringify(names)}`).toBeGreaterThanOrEqual(0);

    const assertionStep = steps[assertionIndex];
    const run = String(assertionStep.run ?? "");
    expect(run, "the assertion step is present but has no body").not.toBe("");
    // The failure code is its own, so a reader can tell "the checkout was bound and the runner disagreed" from the
    // ordinary "this is not main" refusal.
    expect(run, "the assertion does not fail closed with its own code").toContain("TRUST_EPOCH_FINALIZATION_SHA_MISMATCH");
    // It compares the two facts it is about. A step that asserted neither, or only one, would be decorative.
    expect(run, "the assertion no longer reads the dispatch SHA").toContain("${{ github.sha }}");
    expect(run, "the assertion no longer reads the checked-out commit").toContain("git rev-parse HEAD");
    // It must not merely warn: `exit 1` is what makes the later measure/advance/verify sequence unreachable.
    expect(run, "the assertion warns instead of failing").toMatch(/exit 1/);

    // Order: the assertion must be the first thing after the checkout. A run that can measure before establishing
    // which commit it is measuring has the defect back, whatever the assertion says later.
    const checkoutIndex = steps.findIndex((step) => String(step.uses ?? "").startsWith("actions/checkout"));
    expect(assertionIndex, "the assertion runs BEFORE the checkout, so it cannot be asserting anything").toBeGreaterThan(checkoutIndex);
    const between = steps.slice(checkoutIndex + 1, assertionIndex);
    expect(between.map((step) => step.name ?? step.uses ?? "?"), "a step runs between the checkout and the assertion, so the first measured thing may not be the dispatched tree").toEqual([]);
    // And both SHAs are published for the artifact, not only logged.
    expect(run, "the assertion does not publish the SHAs it proved equal").toMatch(/DISPATCH_SHA=/);
    expect(run, "the assertion does not publish the checked-out SHA").toMatch(/CHECKED_OUT_SHA=/);
  });

  it("the job still refuses anything that is not main, before it checks anything out", () => {
    const steps = finalizeSteps();
    const refusalIndex = steps.findIndex((step) => String(step.run ?? "").includes("TRUST_EPOCH_FINALIZATION_REQUIRES_MAIN"));
    const checkoutIndex = steps.findIndex((step) => String(step.uses ?? "").startsWith("actions/checkout"));
    expect(refusalIndex, "the main-only refusal is gone").toBeGreaterThanOrEqual(0);
    expect(refusalIndex, "the main-only refusal now runs after the checkout").toBeLessThan(checkoutIndex);
  });
});

// =============================================================================================
// The artifact side: the handoff states both SHAs and refuses a disagreement
// =============================================================================================

const handoffInput = (over: Record<string, unknown> = {}) => ({
  repository: "zhiheng-zhang-Mera/Codex-Boss",
  finalizationRunId: 35962014554,
  baseBranch: "main",
  baseSha: SHA_A,
  epoch: 30,
  epochBranch: "trust-epoch/boss-root-trust-30",
  epochCommit: "e".repeat(40),
  rootSurfaceHash: "1".repeat(64),
  epochHash: "2".repeat(64),
  prRequired: true,
  result: { state: handoff.STATE.EPOCH_BRANCH_READY, success: true, message: "ready" },
  dispatchSha: SHA_A,
  checkedOutSha: SHA_A,
  ...over,
});

describe("Trust epoch finalization: the handoff states the checkout binding (section 9 B1)", () => {
  it("a bound handoff states dispatch_sha and checked_out_sha, and validates", () => {
    const built = handoff.buildHandoff(handoffInput()) as { provenance: Record<string, unknown> };
    const result = handoff.validateHandoff(built);
    expect(result.problems, `a bound handoff failed its own validator: ${result.problems.join("; ")}`).toEqual([]);
    expect(built.provenance.dispatch_sha).toBe(SHA_A);
    expect(built.provenance.checked_out_sha).toBe(SHA_A);
    expect(built.provenance.checkout_is_sha_bound, "the handoff does not state that the binding was established").toBe(true);
  });

  it("a handoff whose two SHAs disagree is REFUSED — the defect cannot be expressed in a valid artifact", () => {
    // This is the artifact-level form of the counterfactual: under the old shape the disagreement was silent.
    const built = handoff.buildHandoff(handoffInput({ dispatchSha: SHA_A, checkedOutSha: SHA_B }));
    const result = handoff.validateHandoff(built);
    expect(result.ok, "a handoff that measured a different commit than it was dispatched on was accepted").toBe(false);
    expect(result.problems.join(" "), "the refusal did not name the disagreement").toMatch(/disagree/);
  });

  it("half a binding is refused rather than tolerated", () => {
    // A single stated SHA would let a reader believe the binding was checked when only one side was recorded.
    for (const half of [{ dispatchSha: SHA_A, checkedOutSha: null }, { dispatchSha: null, checkedOutSha: SHA_A }]) {
      const built = handoff.buildHandoff(handoffInput(half));
      const result = handoff.validateHandoff(built);
      expect(result.ok, `a half-stated binding (${JSON.stringify(half)}) was accepted`).toBe(false);
      expect(result.problems.join(" ")).toMatch(/half-stated/);
    }
  });

  it("a malformed SHA is refused, and `normalizeCommit` accepts only a git object id", () => {
    expect(handoff.normalizeCommit(SHA_A)).toBe(SHA_A);
    for (const bad of ["main", "abc", "", null, undefined, "A".repeat(40), 42, {}]) {
      expect(handoff.normalizeCommit(bad), `normalizeCommit accepted ${JSON.stringify(bad)}`).toBeNull();
    }
    const built = handoff.buildHandoff(handoffInput({ dispatchSha: "main", checkedOutSha: "main" }));
    const result = handoff.validateHandoff(built);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/not a git object id/);
  });

  it("a caller that states no binding produces an artifact that is visibly silent about it, not one that claims it", () => {
    // Absence is honest when a caller has not been taught the binding; a fabricated `bound: true` would not be.
    const built = handoff.buildHandoff(handoffInput({ dispatchSha: null, checkedOutSha: null })) as { provenance: Record<string, unknown> };
    expect(handoff.validateHandoff(built).ok, "an unstated binding must still validate: absence is not a disagreement").toBe(true);
    expect(built.provenance.checkout_is_sha_bound, "an unstated binding reported itself bound").toBe(false);
    expect(built.provenance.dispatch_sha).toBeNull();
  });

  it("the provenance function is total: it never throws and never invents a value", () => {
    for (const value of [null, undefined, 0, "", {}, [], "main"]) {
      const provenance = handoff.provenanceOf(value, value);
      expect(provenance.dispatch_sha, `provenanceOf invented a dispatch SHA for ${JSON.stringify(value)}`).toBeNull();
      expect(provenance.bound).toBe(false);
    }
  });
});

// =============================================================================================
// The workflow's handoff step passes what it proved
// =============================================================================================

describe("Trust epoch finalization: the workflow passes the binding it asserted into the artifact", () => {
  const handoffStep = () => {
    const step = finalizeSteps().find((candidate) => String(candidate.name ?? "").includes("write the PR handoff"));
    if (!step) throw new Error("the terminal handoff step is gone");
    return step;
  };

  it("the handoff step passes --dispatch-sha and --checked-out-sha from the assertion", () => {
    const run = String(handoffStep().run ?? "");
    expect(run, "the handoff step no longer passes the dispatch SHA into the artifact").toContain('--dispatch-sha "$dispatchSha"');
    expect(run, "the handoff step no longer passes the checked-out SHA into the artifact").toContain('--checked-out-sha "$checkedOutSha"');
    // The values must come from what the assertion PUBLISHED, not from a re-reading of git inside this step: a second
    // reading could disagree with the one that gated the run, which is the defect in miniature.
    expect(run, "the handoff step re-derives the dispatch SHA instead of using the asserted one").toContain("$env:DISPATCH_SHA");
    expect(run, "the handoff step re-derives the checked-out SHA instead of using the asserted one").toContain("$env:CHECKED_OUT_SHA");
    // And a missing value is a refusal, not an artifact with an absent binding.
    expect(run, "the handoff step tolerates a missing provenance value").toContain("TRUST_EPOCH_FINALIZATION_NO_PROVENANCE");
  });

  it("the CLI accepts the binding and reports it, end to end through the real process", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-finalize-bound-"));
    const record = {
      record: { trust_epoch: 30, root_contract_version: "boss-root-trust-30", root_surface_hash: "1".repeat(64), parent_epoch_hash: "9".repeat(64), epoch_hash: "2".repeat(64) },
      epoch_hash: "2".repeat(64),
    };
    const expected = path.join(dir, "expected.json");
    fs.writeFileSync(expected, JSON.stringify(record), "utf8");
    const out = path.join(dir, "epoch-pr-handoff.json");
    const result = spawnSync(process.execPath, [
      "scripts/trust-epoch-finalize-handoff.cjs",
      "--repository", "zhiheng-zhang-Mera/Codex-Boss", "--run-id", "35962014554",
      "--base-sha", SHA_A, "--candidate-epoch", "30",
      "--branch", "trust-epoch/boss-root-trust-30", "--root-surface-hash", "1".repeat(64),
      "--expected-record", expected, "--epoch-commit", "e".repeat(40), "--epoch-hash", "2".repeat(64),
      "--dispatch-sha", SHA_A, "--checked-out-sha", SHA_A,
      "--out", out,
    ], { cwd: PROJECT, encoding: "utf8", timeout: 120000, env: { ...process.env, EPOCH_COMMIT: "e".repeat(40) } });
    expect(result.status, `a bound handoff must succeed: ${result.stderr}`).toBe(0);
    const built = JSON.parse(fs.readFileSync(out, "utf8")) as { provenance: Record<string, unknown> };
    expect(built.provenance.dispatch_sha).toBe(SHA_A);
    expect(built.provenance.checked_out_sha).toBe(SHA_A);
  });

  it("the CLI REFUSES a disagreement between the two SHAs rather than writing a valid-looking artifact", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-finalize-unbound-"));
    const record = {
      record: { trust_epoch: 30, root_contract_version: "boss-root-trust-30", root_surface_hash: "1".repeat(64), parent_epoch_hash: "9".repeat(64), epoch_hash: "2".repeat(64) },
      epoch_hash: "2".repeat(64),
    };
    const expected = path.join(dir, "expected.json");
    fs.writeFileSync(expected, JSON.stringify(record), "utf8");
    const out = path.join(dir, "epoch-pr-handoff.json");
    const result = spawnSync(process.execPath, [
      "scripts/trust-epoch-finalize-handoff.cjs",
      "--repository", "zhiheng-zhang-Mera/Codex-Boss", "--run-id", "35962014554",
      "--base-sha", SHA_A, "--candidate-epoch", "30",
      "--branch", "trust-epoch/boss-root-trust-30", "--root-surface-hash", "1".repeat(64),
      "--expected-record", expected, "--epoch-commit", "e".repeat(40), "--epoch-hash", "2".repeat(64),
      "--dispatch-sha", SHA_A, "--checked-out-sha", SHA_B,
      "--out", out,
    ], { cwd: PROJECT, encoding: "utf8", timeout: 120000, env: { ...process.env, EPOCH_COMMIT: "e".repeat(40) } });
    expect(result.status, "a handoff whose stated SHAs disagree must fail closed, not be written as valid").toBe(1);
    expect(String(result.stderr)).toMatch(/disagree/);
  });
});
