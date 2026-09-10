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
  const recordingTransport: GitHubTransport = {
    async request(request) {
      requests.push(request);
      if (request.url.includes("/pulls/") && request.method === "GET") return { status: 200, body: JSON.stringify({ number: 1, state: "open", head: { sha: SHA_A } }) };
      if (request.url.includes("/check-runs")) return { status: 200, body: JSON.stringify({ check_runs: [{ name: "validate", conclusion: "success", status: "completed", head_sha: SHA_A }] }) };
      if (request.url.includes("/pulls")) return { status: 201, body: JSON.stringify({ number: 7, head: { sha: SHA_A } }) };
      if (request.url.includes("/merge")) return { status: 200, body: JSON.stringify({ merged: true, sha: SHA_A }) };
      return { status: 200, body: "{}" };
    }
  };
  function adapter(configured = true) {
    requests.length = 0;
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

  it("creates a PR, reads its head SHA and reads only the required check for that SHA", async () => {
    const configured = adapter();
    const created = await configured.createPullRequest({ head: "evolution/run-1", title: "Candidate", body: "body" });
    expect(created.status).toBe("OK");
    if (created.status === "OK") expect(created.value.number).toBe(7);

    const read = await configured.readPullRequest(7);
    expect(read.status).toBe("OK");
    if (read.status === "OK") expect(read.value.headSha).toBe(SHA_A);

    const check = await configured.readRequiredCheck(SHA_A);
    expect(check.status).toBe("OK");
    if (check.status === "OK") expect(check.value.conclusion).toBe("success");

    // A check reported for a different SHA is not evidence for this SHA.
    const wrongSha = await configured.readRequiredCheck(SHA_B);
    expect(wrongSha.status).toBe("FAILED");
    expect(wrongSha.status === "FAILED" && wrongSha.reason).toMatch(/reported for/);

    // The merge is an ordinary merge carrying the exact SHA — never an admin one.
    const merged = await configured.mergePullRequest({ prNumber: 7, sha: SHA_A });
    expect(merged.status).toBe("OK");
    const mergeRequest = requests.find((request) => request.url.includes("/merge"));
    expect(mergeRequest?.method).toBe("PUT");
    expect(mergeRequest?.body).toMatchObject({ sha: SHA_A, merge_method: "squash" });
    expect(JSON.stringify(mergeRequest)).not.toMatch(/admin|bypass/);
    expect(JSON.stringify(requests)).not.toMatch(/ruleset|protection|secrets/);
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
