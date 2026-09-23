import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  allowedTransitionsFrom,
  canTransition,
  ciEvidenceInvalidated,
  decidePromotion,
  evaluateExactShaBinding,
  isTerminalPromotionState,
  isWaitingForRootOwner,
  type ExactShaBinding,
  type PromotionEvidence
} from "../../src/shared/root-authority/promotion-state";
import { RootAuthority } from "../../electron/root-authority/root-authority";
import { ExactShaGate, invalidateStaleEvidence } from "../../electron/promotion-gate/exact-sha-gate";
import { REQUIRED_PROMOTION_CHECKS } from "../../src/shared/promotion-checks";
import { PromotionController } from "../../electron/promotion-gate/promotion-controller";
import {
  GitHubPromotionAdapter,
  isForbiddenApiUrl,
  type GitHubTransport,
  type GitHubTransportRequest
} from "../../electron/promotion-gate/github-promotion-adapter";
import {
  EnvironmentBossGitHubCredentialProvider,
  UnconfiguredBossGitHubCredentialProvider
} from "../../electron/credential-boundary/github-credential-provider";
import { cleanupFixtures, commit, gitRepo, stateFile, write, CODEOWNERS_FIXTURE } from "../helpers/root-fixtures";

/**
 * F5 — Promotion Gate acceptance (Isolation-Finalization.md §11, §23
 * RD-010..RD-012; §14 RT-14..RT-17, RT-22).
 *
 * The three claims under test:
 *   1. promotion is bound to the exact SHA that passed the gates;
 *   2. a green local run cannot become a promotion without a separate,
 *      explicit promotion step;
 *   3. a change touching a Root Surface stops at WAITING_FOR_ROOT_OWNER even
 *      when every gate is green.
 */

afterEach(cleanupFixtures);

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function binding(overrides: Partial<ExactShaBinding> = {}): ExactShaBinding {
  return { candidateHeadSha: SHA_A, ciValidatedSha: SHA_A, prHeadSha: SHA_A, promotionSha: SHA_A, ...overrides };
}

function evidence(overrides: Partial<PromotionEvidence> = {}): PromotionEvidence {
  return {
    ...binding(),
    requiredChecksPassed: true,
    branchUpToDate: true,
    reviewerClean: true,
    emergencyStopEngaged: false,
    protectedSurfaceTouched: false,
    rootOwnerApproved: false,
    externalBlocker: null,
    ...overrides
  };
}

/** A Candidate-shaped git repository carrying the real CODEOWNERS boundary. */
function candidateRepo(): { root: string; sha: string } {
  const repo = gitRepo("boss-candidate-");
  write(repo.root, ".github/CODEOWNERS", CODEOWNERS_FIXTURE);
  write(repo.root, "package.json", "{ \"name\": \"fixture\", \"scripts\": { \"test\": \"vitest run\" } }\n");
  write(repo.root, "src/app/main.ts", "export const main = 1;\n");
  return { root: repo.root, sha: commit(repo.root, "candidate baseline") };
}

describe("Exact-SHA contract (§11.2, RD-010, RT-14/RT-15)", () => {
  it("requires all four SHAs to be present, well formed and identical", () => {
    expect(evaluateExactShaBinding(binding()).ok).toBe(true);
    expect(evaluateExactShaBinding(binding()).sha).toBe(SHA_A);

    expect(evaluateExactShaBinding(binding({ ciValidatedSha: null })).code).toBe("SHA_MISSING");
    expect(evaluateExactShaBinding(binding({ promotionSha: "" })).code).toBe("SHA_MISSING");
    expect(evaluateExactShaBinding(binding({ prHeadSha: "short" })).code).toBe("SHA_MALFORMED");
    expect(evaluateExactShaBinding(binding({ prHeadSha: SHA_B })).code).toBe("SHA_MISMATCH");
    // Any single divergence invalidates the whole binding.
    for (const key of ["candidateHeadSha", "ciValidatedSha", "prHeadSha", "promotionSha"] as const) {
      expect(evaluateExactShaBinding(binding({ [key]: SHA_B })).ok, key).toBe(false);
    }
  });

  it("invalidates a PASS as soon as the head moves (§11.2)", () => {
    expect(ciEvidenceInvalidated(SHA_A, SHA_A)).toBe(false);
    expect(ciEvidenceInvalidated(SHA_A, SHA_B)).toBe(true);
    expect(ciEvidenceInvalidated(SHA_A, null)).toBe(true);
    expect(ciEvidenceInvalidated(null, SHA_A)).toBe(true);
    const stale = invalidateStaleEvidence({ candidateHeadSha: SHA_B, ciValidatedSha: SHA_A, prHeadSha: SHA_A, promotionSha: SHA_A }, SHA_B);
    expect(stale.ciValidatedSha).toBeNull();
    expect(stale.prHeadSha).toBeNull();
  });

  it("re-reads the live workspace HEAD and reports a self-consistent lie as a mismatch", async () => {
    const repo = candidateRepo();
    const gate = new ExactShaGate(repo.root);
    // A binding that agrees with itself but not with reality is refused.
    const lie = await gate.evaluate({ candidateHeadSha: SHA_B, ciValidatedSha: SHA_B, prHeadSha: SHA_B, promotionSha: SHA_B });
    expect(lie.ok).toBe(false);
    expect(lie.code).toBe("SHA_MISMATCH");
    expect(lie.detail).toMatch(/no longer matches/);

    const honest = await gate.evaluate({ candidateHeadSha: repo.sha, ciValidatedSha: repo.sha, prHeadSha: repo.sha, promotionSha: repo.sha });
    expect(honest.ok).toBe(true);
    expect(honest.observedCandidateHeadSha).toBe(repo.sha);

    // Move the head: the previously honest binding is now stale.
    write(repo.root, "src/app/main.ts", "export const main = 2;\n");
    const moved = commit(repo.root, "moved on");
    const stale = await gate.evaluate({ candidateHeadSha: repo.sha, ciValidatedSha: repo.sha, prHeadSha: repo.sha, promotionSha: repo.sha });
    expect(stale.ok).toBe(false);
    expect(stale.observedCandidateHeadSha).toBe(moved);
  });

  it("refuses to evaluate when the workspace has no HEAD", async () => {
    // A cwd that does not exist cannot resolve a commit: git fails, the gate
    // reports SHA_MISSING, and no green signal is ever inferred.
    const missing = path.join(path.dirname(stateFile("x")), "no-such-workspace");
    const result = await new ExactShaGate(missing).evaluate(binding());
    expect(result.ok).toBe(false);
    expect(result.code).toBe("SHA_MISSING");
    expect(result.observedCandidateHeadSha).toBeNull();
  });
});

describe("Promotion state machine (§11.1)", () => {
  it("reaches PROMOTED only through PROMOTING — no worker DONE shortcut", () => {
    expect(canTransition("PROMOTING", "PROMOTED")).toBe(true);
    for (const state of ["CREATED", "WORKING", "VERIFYING", "REVIEWING", "READY_FOR_PR", "WAITING_FOR_CI", "WAITING_FOR_ROOT_OWNER", "PROMOTABLE"] as const) {
      expect(canTransition(state, "PROMOTED"), state).toBe(false);
    }
    expect(canTransition("PROMOTED", "PROMOTING")).toBe(false);
    expect(canTransition("REJECTED", "PROMOTED")).toBe(false);
    expect(canTransition("ROLLED_BACK", "PROMOTED")).toBe(false);
  });

  it("rejects illegal transitions instead of coercing them", () => {
    expect(canTransition("CREATED", "PROMOTABLE")).toBe(false);
    expect(canTransition("VERIFYING", "PROMOTING")).toBe(false);
    expect(canTransition("WAITING_FOR_ROOT_OWNER", "PROMOTING")).toBe(false);
    expect(canTransition("WAITING_FOR_ROOT_OWNER", "PROMOTED")).toBe(false);
    // Owner approval lifts the ceiling into PROMOTABLE — and no further.
    expect(canTransition("WAITING_FOR_ROOT_OWNER", "PROMOTABLE")).toBe(true);
    expect(isTerminalPromotionState("REJECTED")).toBe(true);
    expect(isTerminalPromotionState("ROLLED_BACK")).toBe(true);
    expect(isTerminalPromotionState("PROMOTABLE")).toBe(false);
    expect(isWaitingForRootOwner("WAITING_FOR_ROOT_OWNER")).toBe(true);
  });

  it("lets emergency control force REJECTED from anywhere, but never PROMOTED", () => {
    for (const state of ["WORKING", "VERIFYING", "REVIEWING", "WAITING_FOR_CI", "WAITING_FOR_ROOT_OWNER", "PROMOTABLE", "PROMOTING"] as const) {
      const allowed = allowedTransitionsFrom(state, { emergencyStop: true });
      expect(allowed, state).toContain("REJECTED");
      expect(allowed, state).not.toContain("PROMOTED");
    }
  });
});

describe("Promotion decision precedence (§11.3, §11.4)", () => {
  it("promotes an ordinary green candidate", () => {
    expect(decidePromotion(evidence()).state).toBe("PROMOTABLE");
  });

  it("outranks everything with the Owner emergency stop (RT-20/RT-21)", () => {
    expect(decidePromotion(evidence({ emergencyStopEngaged: true })).state).toBe("REJECTED");
    expect(decidePromotion(evidence({ emergencyStopEngaged: true, protectedSurfaceTouched: true })).state).toBe("REJECTED");
  });

  it("parks an external blocker instead of faking a PASS (RT-22, FI-04)", () => {
    const outcome = decidePromotion(evidence({ externalBlocker: "no dedicated Boss GitHub credential" }));
    expect(outcome.state).toBe("BLOCKED_EXTERNAL");
    expect(outcome.reasons[0]).toMatch(/external:/);
  });

  it("refuses a stale or mismatched SHA before trusting any green signal (RT-14/RT-15)", () => {
    expect(decidePromotion(evidence({ ciValidatedSha: SHA_B })).state).toBe("REJECTED");
    // One SHA lagging behind the others is enough, whichever one it is.
    expect(decidePromotion(evidence({ candidateHeadSha: SHA_B, ciValidatedSha: SHA_A, prHeadSha: SHA_A, promotionSha: SHA_A })).state).toBe("REJECTED");
    expect(decidePromotion(evidence({ promotionSha: null })).reasons[0]).toMatch(/SHA_MISSING/);
    expect(decidePromotion(evidence({ prHeadSha: null })).reasons[0]).toMatch(/SHA_MISSING/);
  });

  it("refuses promotion when checks fail or the reviewer found something (RT-16/RT-17)", () => {
    expect(decidePromotion(evidence({ requiredChecksPassed: false })).state).toBe("REJECTED");
    expect(decidePromotion(evidence({ reviewerClean: false })).state).toBe("REJECTED");
  });

  it("waits rather than rejecting when the branch is merely behind", () => {
    expect(decidePromotion(evidence({ branchUpToDate: false })).state).toBe("WAITING_FOR_CI");
  });

  it("stops a fully green Root Surface change on the Owner (RD-012)", () => {
    const outcome = decidePromotion(evidence({ protectedSurfaceTouched: true }));
    expect(outcome.state).toBe("WAITING_FOR_ROOT_OWNER");
    // …and proceeds once the Owner has approved that exact SHA.
    expect(decidePromotion(evidence({ protectedSurfaceTouched: true, rootOwnerApproved: true })).state).toBe("PROMOTABLE");
  });
});

function controller(candidateRoot: string, durable?: { storeFile: string; ledgerFile: string }): { authority: RootAuthority; controller: PromotionController } {
  const storeFile = durable?.storeFile ?? stateFile("promotion.json");
  const ledgerFile = durable?.ledgerFile ?? stateFile("ledger.jsonl");
  const authority = new RootAuthority({ root: candidateRoot, ledgerFile, runId: "promotion-run", candidateSha: SHA_A });
  const controller = new PromotionController({
    storeFile,
    runId: "promotion-run",
    authority,
    exactShaGate: new ExactShaGate(candidateRoot)
  });
  return { authority, controller };
}

describe("PromotionController is durable and cannot be shortcut (§11, §15 FI-05, RD-011)", () => {
  it("promotes an ordinary candidate only after an explicit begin/complete", async () => {
    const repo = candidateRepo();
    write(repo.root, "src/app/main.ts", "export const main = 99;\n");
    const head = commit(repo.root, "ordinary improvement");
    const { controller: control } = controller(repo.root);

    const evaluated = await control.evaluate({
      binding: { candidateHeadSha: head, ciValidatedSha: head, prHeadSha: head, promotionSha: head },
      requiredChecksPassed: true,
      branchUpToDate: true,
      reviewerClean: true,
      changedFiles: ["src/app/main.ts"]
    });
    expect(evaluated.state).toBe("PROMOTABLE");
    expect(evaluated.protectedPaths).toEqual([]);

    // Evaluating never promotes.
    expect(control.record().state).not.toBe("PROMOTED");
    expect(control.beginPromotion().state).toBe("PROMOTING");
    expect(control.completePromotion(head).state).toBe("PROMOTED");
  });

  it("refuses to complete a promotion from any state other than PROMOTING", async () => {
    const repo = candidateRepo();
    const { controller: control } = controller(repo.root);
    const record = control.completePromotion(repo.sha);
    expect(record.state).toBe("CREATED");
    expect(record.reasons[0]).toMatch(/cannot complete promotion from CREATED/);
  });

  it("refuses to begin a promotion that is not PROMOTABLE", async () => {
    const repo = candidateRepo();
    const { controller: control } = controller(repo.root);
    const record = control.beginPromotion();
    expect(record.state).toBe("CREATED");
    expect(record.reasons[0]).toMatch(/cannot begin promotion from CREATED/);
  });

  it("stops a Root Surface change at WAITING_FOR_ROOT_OWNER even with every gate green (RD-012)", async () => {
    const repo = candidateRepo();
    write(repo.root, "package.json", "{ \"name\": \"fixture\", \"scripts\": { \"test\": \"echo skipped\" } }\n");
    const head = commit(repo.root, "weaken the test script");
    const { controller: control } = controller(repo.root);

    const evaluated = await control.evaluate({
      binding: { candidateHeadSha: head, ciValidatedSha: head, prHeadSha: head, promotionSha: head },
      requiredChecksPassed: true,
      branchUpToDate: true,
      reviewerClean: true,
      changedFiles: ["package.json"]
    });
    expect(evaluated.state).toBe("WAITING_FOR_ROOT_OWNER");
    expect(evaluated.protectedPaths).toContain("package.json");

    // Beginning a promotion is refused while the Owner wait stands.
    const attempt = control.beginPromotion();
    expect(attempt.state).toBe("WAITING_FOR_ROOT_OWNER");
    expect(attempt.reasons[0]).toMatch(/owner-approval-missing-or-bound-to-another-sha/);
  });

  it("keeps the Owner wait sticky and idempotent across re-evaluation and restart (FI-05)", async () => {
    const repo = candidateRepo();
    write(repo.root, ".github/workflows/ci.yml", "name: weak\non: push\n");
    const head = commit(repo.root, "touch the CI gate");
    const durable = { storeFile: stateFile("promotion.json"), ledgerFile: stateFile("ledger.jsonl") };
    const { controller: control } = controller(repo.root, durable);
    const evaluateInput = {
      binding: { candidateHeadSha: head, ciValidatedSha: head, prHeadSha: head, promotionSha: head },
      requiredChecksPassed: true,
      branchUpToDate: true,
      reviewerClean: true,
      changedFiles: [".github/workflows/ci.yml"]
    };

    expect((await control.evaluate(evaluateInput)).state).toBe("WAITING_FOR_ROOT_OWNER");
    // Repeated evaluation must not be read as stagnation and bypassed.
    for (let round = 0; round < 3; round++) {
      expect((await control.evaluate(evaluateInput)).state).toBe("WAITING_FOR_ROOT_OWNER");
    }
    // A restart (a fresh controller over the same durable store) still waits.
    const restarted = controller(repo.root, durable).controller;
    expect(restarted.record().state).toBe("WAITING_FOR_ROOT_OWNER");
    expect(restarted.record().protectedPaths).toContain(".github/workflows/ci.yml");

    // Approval bound to a different SHA does not release the wait.
    const wrongSha = await restarted.evaluate({ ...evaluateInput, rootOwnerApprovedSha: SHA_B });
    expect(wrongSha.state).toBe("WAITING_FOR_ROOT_OWNER");
    // Approval for this exact SHA does.
    const approved = await restarted.evaluate({ ...evaluateInput, rootOwnerApprovedSha: head, rootOwnerApprovedBy: "zhiheng-zhang-Mera" });
    expect(approved.state).toBe("PROMOTABLE");
    expect(approved.rootOwnerApproval?.sha).toBe(head);
  });

  it("parks on BLOCKED_EXTERNAL when the remote capability is absent (FI-04)", async () => {
    const repo = candidateRepo();
    write(repo.root, "src/app/main.ts", "export const main = 5;\n");
    const head = commit(repo.root, "work");
    const { controller: control } = controller(repo.root);
    control.setExternalBlocker("no dedicated Boss GitHub credential is configured");
    const evaluated = await control.evaluate({
      binding: { candidateHeadSha: head, ciValidatedSha: head, prHeadSha: head, promotionSha: head },
      requiredChecksPassed: true,
      branchUpToDate: true,
      reviewerClean: true,
      changedFiles: ["src/app/main.ts"]
    });
    expect(evaluated.state).toBe("BLOCKED_EXTERNAL");
    expect(evaluated.reasons.join(" ")).toMatch(/external:/);
  });

  it("rejects a change set that escapes the candidate root (RT-01)", async () => {
    const repo = candidateRepo();
    const { authority, controller: control } = controller(repo.root);
    const evaluated = await control.evaluate({
      binding: { candidateHeadSha: repo.sha, ciValidatedSha: repo.sha, prHeadSha: repo.sha, promotionSha: repo.sha },
      requiredChecksPassed: true,
      branchUpToDate: true,
      reviewerClean: true,
      changedFiles: ["../stable/package.json"]
    });
    expect(evaluated.state).toBe("REJECTED");
    expect(evaluated.reasons).toContain("change-set-escape");
    expect(authority.history().some((entry) => entry.operation === "workspace.escape" && entry.decision === "DENY")).toBe(true);
  });

  it("reuses a recorded pull request instead of opening a second one (FI-05)", async () => {
    const repo = candidateRepo();
    const durable = { storeFile: stateFile("promotion.json"), ledgerFile: stateFile("ledger.jsonl") };
    const { controller: control } = controller(repo.root, durable);
    expect(control.hasPullRequest()).toBe(false);
    control.recordPullRequest(4242, repo.sha);
    expect(control.hasPullRequest()).toBe(true);
    expect(controller(repo.root, durable).controller.record().pullRequest).toEqual({ number: 4242, headSha: repo.sha });
  });
});

describe("GitHub promotion adapter is the only remote path (§9.4, §11.5, RT-22)", () => {
  const requests: GitHubTransportRequest[] = [];
  /**
   * The check-runs the fake GitHub reports. Mutable so each case can present a different CI state — the point
   * of the anti-drift block below is that EVERY way of not having four green checks on this exact SHA refuses.
   */
  let checkRuns: { name: string; conclusion: string | null; status: string | null; head_sha: string }[] = [];
  const green = (sha: string) => REQUIRED_PROMOTION_CHECKS.map((name) => ({ name, conclusion: "success", status: "completed", head_sha: sha }));
  const recordingTransport: GitHubTransport = {
    async request(request) {
      requests.push(request);
      if (request.url.includes("/pulls/") && request.method === "GET") return { status: 200, body: JSON.stringify({ number: 1, state: "open", head: { sha: SHA_A } }) };
      if (request.url.includes("/check-runs")) return { status: 200, body: JSON.stringify({ check_runs: checkRuns }) };
      if (request.url.includes("/pulls")) return { status: 201, body: JSON.stringify({ number: 7, head: { sha: SHA_A } }) };
      if (request.url.includes("/merge")) return { status: 200, body: JSON.stringify({ merged: true, sha: SHA_A }) };
      return { status: 200, body: "{}" };
    }
  };
  function adapter(configured = true) {
    requests.length = 0;
    checkRuns = green(SHA_A);
    return new GitHubPromotionAdapter({
      repository: "zhiheng-zhang-Mera/Codex-Boss",
      credentialProvider: configured
        ? new EnvironmentBossGitHubCredentialProvider({ environment: { CODEX_BOSS_GITHUB_TOKEN: "boss-token", CODEX_BOSS_GITHUB_IDENTITY: "codex-boss-bot" } })
        : new UnconfiguredBossGitHubCredentialProvider(),
      transport: recordingTransport
    });
  }

  it("makes no request at all when there is no dedicated Boss credential", async () => {
    const configured = adapter(false);
    for (const result of [
      await configured.createPullRequest({ head: "evolution/x", title: "t", body: "b" }),
      await configured.readPullRequest(1),
      await configured.readRequiredCheck(SHA_A),
      await configured.mergePullRequest({ prNumber: 1, sha: SHA_A }),
      await configured.readBranchSha("main")
    ]) {
      expect(result.status).toBe("BLOCKED_EXTERNAL");
    }
    expect(requests).toHaveLength(0);
  });

  it("never calls a repository administration endpoint", async () => {
    const configured = adapter();
    expect(isForbiddenApiUrl("https://api.github.com/repos/o/r/rulesets")).toBe(true);
    expect(isForbiddenApiUrl("https://api.github.com/repos/o/r/branches/main/protection")).toBe(true);
    expect(isForbiddenApiUrl("https://api.github.com/repos/o/r/actions/secrets")).toBe(true);
    expect(isForbiddenApiUrl("https://api.github.com/repos/o/r/pulls/1/merge")).toBe(false);
    expect(isForbiddenApiUrl("https://api.github.com/repos/o/r/commits/x/check-runs")).toBe(false);

    const branch = await configured.readBranchSha("main/rulesets");
    expect(branch.status).toBe("FAILED");
    expect(requests).toHaveLength(0);
  });

  it("creates a PR, reads its head SHA and reads EVERY required check for that SHA", async () => {
    const configured = adapter();
    const created = await configured.createPullRequest({ head: "evolution/run-1", title: "Candidate", body: "body" });
    expect(created.status).toBe("OK");
    if (created.status === "OK") expect(created.value.number).toBe(7);

    const read = await configured.readPullRequest(7);
    expect(read.status).toBe("OK");
    if (read.status === "OK") expect(read.value.headSha).toBe(SHA_A);

    const check = await configured.readRequiredCheck(SHA_A);
    expect(check.status).toBe("OK");
    if (check.status === "OK") {
      expect(check.value.conclusion).toBe("success");
      expect(check.value.allRequiredChecksSuccessful).toBe(true);
      expect(check.value.sha).toBe(SHA_A);
      // ALL FOUR, not one of them under a different name.
      expect(check.value.requiredChecks).toEqual(REQUIRED_PROMOTION_CHECKS);
      expect(check.value.checks.map((entry) => entry.name)).toEqual(REQUIRED_PROMOTION_CHECKS);
    }

    // A check reported for a different SHA is not evidence for this SHA.
    checkRuns = green(SHA_B);
    const wrongSha = await configured.readRequiredCheck(SHA_A);
    expect(wrongSha.status).toBe("FAILED");
    expect(wrongSha.status === "FAILED" && wrongSha.reason).toMatch(/different sha/);

    // The merge is an ordinary merge carrying the exact SHA — never an admin one.
    checkRuns = green(SHA_A);
    const merged = await configured.mergePullRequest({ prNumber: 7, sha: SHA_A });
    expect(merged.status).toBe("OK");
    const mergeRequest = requests.find((request) => request.url.includes("/merge"));
    expect(mergeRequest?.method).toBe("PUT");
    expect(mergeRequest?.body).toMatchObject({ sha: SHA_A, merge_method: "squash" });
    expect(JSON.stringify(mergeRequest)).not.toMatch(/admin|bypass/);
    expect(JSON.stringify(requests)).not.toMatch(/ruleset|protection|secrets/);
  });

  /**
   * The required-check contract, pinned in the direction that matters: every way of NOT having four green
   * checks on the exact candidate refuses, and the legacy literal is not the contract.
   *
   * The adapter used to read ONE hard-coded name, `validate`, which no workflow has produced since the
   * ruleset was repaired. Replacing that string with `quality` would have been the same defect with a
   * different spelling, so these cases exist to make "ALL of them, on THIS sha" the only passing shape.
   */
  it("refuses promotion unless every required check is green on the exact candidate SHA", async () => {
    const configured = adapter();

    // The baseline this block measures deviations from.
    expect((await configured.readRequiredCheck(SHA_A)).status, "four green checks must be eligible").toBe("OK");

    // One missing, named one at a time.
    for (const absent of REQUIRED_PROMOTION_CHECKS) {
      checkRuns = green(SHA_A).filter((run) => run.name !== absent);
      const result = await configured.readRequiredCheck(SHA_A);
      expect(result.status, `a missing ${absent} check must refuse`).toBe("FAILED");
      expect(result.status === "FAILED" && result.reason, `the refusal must name ${absent}`).toContain(absent);
    }

    // One failed…
    checkRuns = green(SHA_A).map((run) => (run.name === "unit" ? { ...run, conclusion: "failure" } : run));
    const failed = await configured.readRequiredCheck(SHA_A);
    expect(failed.status).toBe("FAILED");
    expect(failed.status === "FAILED" && failed.reason).toMatch(/not successful: unit/);

    // …one still running (a pending check is not a pass)…
    checkRuns = green(SHA_A).map((run) => (run.name === "acceptance" ? { ...run, status: "in_progress", conclusion: null } : run));
    const pending = await configured.readRequiredCheck(SHA_A);
    expect(pending.status).toBe("FAILED");
    expect(pending.status === "FAILED" && pending.reason).toMatch(/acceptance=in_progress\/pending/);

    // …and the legacy literal, alone, is not the contract.
    checkRuns = [{ name: "validate", conclusion: "success", status: "completed", head_sha: SHA_A }];
    const legacy = await configured.readRequiredCheck(SHA_A);
    expect(legacy.status, "a green `validate` must not satisfy the repaired contract").toBe("FAILED");
    expect(legacy.status === "FAILED" && legacy.reason).toMatch(/no run reported for quality, unit, acceptance, package/);

    // All four green on the exact SHA is the only eligible shape.
    checkRuns = green(SHA_A);
    const eligible = await configured.readRequiredCheck(SHA_A);
    expect(eligible.status).toBe("OK");
    if (eligible.status === "OK") expect(eligible.value.requiredChecks).toEqual(REQUIRED_PROMOTION_CHECKS);
  });

  it("declares the required checks from one source, and says where they come from", async () => {
    const configured = adapter();
    const described = configured.describe();
    // The adapter does not keep its own copy: the list it reports IS the shared declaration.
    expect(described.requiredChecks).toEqual(REQUIRED_PROMOTION_CHECKS);
    expect(described.requiredChecksSource).toContain(".github/workflows/ci.yml");
    // …and the legacy single name is gone from the adapter entirely.
    expect(REQUIRED_PROMOTION_CHECKS).not.toContain("validate");

    // Measured, not remembered: the declaration is checked against the repository, so the gate and the CI it
    // gates cannot drift into two opinions. (The LIVE ruleset is a platform fact and is measured by
    // `scripts/verify-authority-separation.cjs --platform`, not by a unit test.)
    //
    // WHAT IS COMPARED, AND WHY IT IS NO LONGER "EVERY JOB ID". This assertion used to require the declaration
    // to equal the workflow's job ids, which was true only while every job in `ci.yml` was required. Phase 1B-B
    // added the `architecture` shadow job, which is deliberately NOT required — that is the whole point of
    // hosted stage S1: the check must exist, report and accumulate evidence BEFORE anyone makes it block. The
    // old form would have demanded `architecture` be added to `REQUIRED_PROMOTION_CHECKS`, which would have made
    // it required by the autonomous gate and, worse, would have encoded "every job is required" as the contract.
    //
    // So the comparison is now against the two places that actually say which contexts are REQUIRED — the
    // repository's own statement of the ruleset (`.github/CODEOWNERS`, which would have to be edited to change
    // it) and the workflow's own `required_status_checks` absence — plus the requirement that each of the four
    // is really produced as a job. A non-required job is allowed to exist; a required context that no job
    // produces is still a failure, and a required context missing from the declaration is still a failure.
    const workflowText = fs.readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
    const workflow = workflowText.split(/\r?\n/);
    const jobsAt = workflow.findIndex((line) => /^jobs:\s*$/.test(line));
    expect(jobsAt, "ci.yml must declare a jobs block").toBeGreaterThanOrEqual(0);
    const jobIds: string[] = [];
    for (const line of workflow.slice(jobsAt + 1)) {
      const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
      if (job) jobIds.push(job[1]);
    }
    expect(jobIds.length, "the workflow must declare its jobs").toBeGreaterThan(0);

    // Every required context is really produced by a job in this workflow.
    for (const check of REQUIRED_PROMOTION_CHECKS) {
      expect(jobIds, `the declaration names \`${check}\` but no job in ci.yml produces that context`).toContain(check);
    }

    // The required set, as the repository states it. CODEOWNERS is the tracked record of the ruleset contract;
    // a workflow cannot make a check required, so this is the only in-repository authority for the list.
    const codeowners = fs.readFileSync(path.join(process.cwd(), ".github", "CODEOWNERS"), "utf8");
    const requiredLine = codeowners.split(/\r?\n/).find((line) => /Required status checks\s*=/.test(line));
    expect(requiredLine, "CODEOWNERS no longer states the required status-check contract").toBeTruthy();
    for (const check of REQUIRED_PROMOTION_CHECKS) {
      expect(requiredLine, `\`${check}\` is in the declaration but not in the ruleset contract CODEOWNERS states`).toMatch(new RegExp(`\\b${check}\\b`));
    }
    // ...and the declaration names nothing the ruleset does not require. A check required by the autonomous gate
    // but not by the platform would park every promotion on a gate the platform never demanded.
    const statedRequired = (requiredLine ?? "").match(/\b(quality|unit|acceptance|package|architecture|validate)\b/g) ?? [];
    expect([...new Set(statedRequired)].sort(), "the declaration and the ruleset contract disagree").toEqual([...REQUIRED_PROMOTION_CHECKS].sort());

    // The non-required shadow job exists and is NOT required: present as a job, absent from the declaration and
    // from the ruleset contract. This is the property Phase 1B-B is about, asserted where the drift would show.
    expect(jobIds, "the hosted `architecture` shadow job is gone from ci.yml").toContain("architecture");
    expect(REQUIRED_PROMOTION_CHECKS as readonly string[]).not.toContain("architecture");
    expect(requiredLine ?? "", "the architecture check was added to the required set").not.toMatch(/architecture/);
  });

  it("refuses to push the protected base branch directly", async () => {
    const configured = adapter();
    const pushed = await configured.pushCandidateBranch({ workspace: process.cwd(), branch: "main", sha: SHA_A });
    expect(pushed.status).toBe("FAILED");
    expect(pushed.status === "FAILED" && pushed.reason).toMatch(/refusing to push the protected base branch/);
  });

  it("reports a network failure as BLOCKED_EXTERNAL, never as a green result (FI-04)", async () => {
    const failing = new GitHubPromotionAdapter({
      repository: "zhiheng-zhang-Mera/Codex-Boss",
      credentialProvider: new EnvironmentBossGitHubCredentialProvider({ environment: { CODEX_BOSS_GITHUB_TOKEN: "boss-token" } }),
      transport: { async request() { throw new Error("ENOTFOUND api.github.com"); } }
    });
    const result = await failing.readPullRequest(1);
    expect(result.status).toBe("BLOCKED_EXTERNAL");
    if (result.status === "BLOCKED_EXTERNAL") expect(result.requiredExternalAction).toMatch(/network/i);
  });
});
