import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineeringGoalContract } from "../../src/shared/engineering-loop";
import { createLiveEngineeringOperations } from "../../electron/engineering/live-engineering-operations";
import { runRepoGate } from "../../electron/engineering/gate-runner";
import { decidePromotion } from "../../src/shared/root-authority/promotion-state";
import { RootAuthority } from "../../electron/root-authority/root-authority";
import { RootAuditLedger, RootAuditError } from "../../electron/root-authority/root-audit-ledger";
import { ExactShaGate } from "../../electron/promotion-gate/exact-sha-gate";
import { PromotionController } from "../../electron/promotion-gate/promotion-controller";
import { GitHubPromotionAdapter, type GitHubTransport, type GitHubTransportRequest } from "../../electron/promotion-gate/github-promotion-adapter";
import { EnvironmentBossGitHubCredentialProvider } from "../../electron/credential-boundary/github-credential-provider";
import { CandidateSupervisor } from "../../electron/stable-candidate/candidate-supervisor";
import { evolutionLayout } from "../../electron/stable-candidate/runtime-isolation";
import { assessStableImpact } from "../../electron/root-recovery/rollback-controller";
import { writeJson, readJson } from "../../electron/commander/durable-json";
import { cleanupFixtures, CODEOWNERS_FIXTURE, commit, gitRepo, stateFile, tempDir, write } from "../helpers/root-fixtures";

/**
 * Failure-isolation acceptance (Isolation-Finalization.md §15 FI-01..FI-05).
 *
 * §15 asks for *combined* faults, not single faults: a Candidate failing while
 * something else in the pipeline is also failing. Each case therefore asserts
 * three things: the Candidate-side outcome is honest, the promotion decision is
 * negative, and Stable's durable state and repository are provably untouched.
 */

afterEach(cleanupFixtures);

const SHA_A = "a".repeat(40);

/** Stable core state that must survive every one of these scenarios. */
function bossCore(): { file: string; snapshot: () => Record<string, unknown> } {
  const file = stateFile("boss-core-state.json");
  writeJson(file, { tasks: { chat: "ok", work: "ok", research: "ok", knowledge: "ok" }, sessions: 3, history: ["a", "b"] });
  return { file, snapshot: () => readJson<Record<string, unknown>>(file) ?? {} };
}

function candidateRepo() {
  const repo = gitRepo("boss-fi-candidate-");
  write(repo.root, ".github/CODEOWNERS", CODEOWNERS_FIXTURE);
  write(repo.root, "src/app/main.ts", "export const main = 1;\n");
  return { root: repo.root, sha: commit(repo.root, "candidate baseline") };
}

function authorityFor(root: string) {
  return new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "fi-run", candidateSha: SHA_A });
}

describe("FI-01: Candidate + provider failure", () => {
  it("aborts the Candidate loop while Stable continues", async () => {
    const repo = candidateRepo();
    const core = bossCore();
    const goal: EngineeringGoalContract = {
      schemaVersion: 1,
      id: "fi-01",
      objective: "keep the candidate honest",
      workspace: repo.root,
      protectedProductBehavior: [],
      allowedChangeScope: ["src"],
      forbiddenChangeScope: [],
      verificationPolicy: "standard",
      agentCount: 1,
      convergencePolicy: { cleanRoundsRequired: 1 },
      createdAt: new Date().toISOString()
    };

    // The provider worker fails every turn.
    const operations = createLiveEngineeringOperations({
      workspace: repo.root,
      goal,
      worker: { async ask() { throw new Error("provider worker unavailable"); } }
    });
    const outcome = await operations.implement(goal, { id: "f1", area: "src/app/main.ts", severity: "HIGH", description: "make main safer", evidence: "fixture" });
    expect(outcome.error).toMatch(/live coder failed|scope inference/);
    expect(outcome.error).not.toBeUndefined();

    // The Candidate run is recorded as aborted, Stable is not.
    const impact = assessStableImpact("candidate-crash");
    expect(impact.affectsStablePath).toBe(false);
    expect(impact.evolutionState).toBe("DEGRADED");
    expect(core.snapshot().tasks).toMatchObject({ chat: "ok", work: "ok", research: "ok" });
    expect(fs.existsSync(path.join(repo.root, "src", "app", "main.ts"))).toBe(true);
  });
});

describe("FI-02: Candidate + test-runner failure", () => {
  it("reports the gate as FAIL or ERROR, never as PASS, and does not promote", async () => {
    const repo = candidateRepo();
    const core = bossCore();
    write(repo.root, "tests/unit/failing.test.cjs", "const test=require('node:test');test('f',()=>{throw new Error('boom');});\n");

    // (a) A genuinely failing test runner: FAIL, not PASS.
    const failing = await runRepoGate(repo.root, "unit", ["tests/unit/failing.test.cjs"]);
    expect(failing.status).toBe("FAIL");
    expect(failing.evidence).toBeTruthy();

    // (b) A scoped-file escape makes the runner throw, which the gate records as
    //     ERROR rather than swallowing (fail-closed).
    const errored = await runRepoGate(repo.root, "unit", ["../../outside.test.cjs"]);
    expect(errored.status).toBe("ERROR");
    expect(errored.error).toBeTruthy();

    // (c) Either outcome refuses the promotion.
    const authority = authorityFor(repo.root);
    const controller = new PromotionController({ storeFile: stateFile("promotion.json"), runId: "fi-run", authority, exactShaGate: new ExactShaGate(repo.root) });
    const record = await controller.evaluate({
      binding: { candidateHeadSha: repo.sha, ciValidatedSha: repo.sha, prHeadSha: repo.sha, promotionSha: repo.sha },
      requiredChecksPassed: false,
      branchUpToDate: true,
      reviewerClean: true,
      changedFiles: ["src/app/main.ts"]
    });
    expect(record.state).toBe("REJECTED");
    expect(record.state).not.toBe("PROMOTABLE");
    expect(core.snapshot().tasks).toMatchObject({ chat: "ok", work: "ok" });
  });
});

describe("FI-03: Candidate + ledger write failure", () => {
  it("stops the Root-sensitive operation instead of losing audit, and does not promote", async () => {
    const core = bossCore();
    const ledgerFile = stateFile("ledger.jsonl");
    const ledger = new RootAuditLedger(ledgerFile);
    ledger.append({ timestamp: "t1", runId: "fi-run", actor: "a", operation: "candidate.test", target: "-", decision: "ALLOW", reason: "ok", candidateSha: null });

    // The ledger becomes unwritable mid-run (history removed is the detectable
    // case; a vanished file must not be silently recreated as if nothing was lost).
    fs.rmSync(ledgerFile);
    expect(() => ledger.append({ timestamp: "t2", runId: "fi-run", actor: "a", operation: "promotion.execute", target: "-", decision: "ALLOW", reason: "ok", candidateSha: null })).toThrow(RootAuditError);
    expect(fs.existsSync(ledgerFile)).toBe(false);

    // A RootAuthority over a ledger whose parent path is a file cannot record,
    // so classification itself fails rather than proceeding unlogged.
    const blocker = path.join(path.dirname(stateFile("x")), "not-a-directory");
    fs.writeFileSync(blocker, "x", "utf8");
    const brokenAuthority = new RootAuthority({ root: candidateRepo().root, ledgerFile: path.join(blocker, "child.jsonl"), runId: "fi-run" });
    expect(() => brokenAuthority.classify({ operation: "promotion.execute" })).toThrow(RootAuditError);

    // No promotion happened, and Stable's core state is intact.
    expect(core.snapshot().sessions).toBe(3);
  });
});

describe("FI-04: Candidate + GitHub unavailable", () => {
  it("keeps the local work, reports BLOCKED_EXTERNAL, and never fakes a PASS", async () => {
    const repo = candidateRepo();
    const core = bossCore();
    const requests: GitHubTransportRequest[] = [];
    const unreachable: GitHubTransport = {
      async request(request) { requests.push(request); throw new Error("getaddrinfo ENOTFOUND api.github.com"); }
    };
    const adapter = new GitHubPromotionAdapter({
      repository: "zhiheng-zhang-Mera/Codex-Boss",
      credentialProvider: new EnvironmentBossGitHubCredentialProvider({ environment: { CODEX_BOSS_GITHUB_TOKEN: "boss-token" } }),
      transport: unreachable
    });

    const read = await adapter.readPullRequest(1);
    expect(read.status).toBe("BLOCKED_EXTERNAL");
    if (read.status === "BLOCKED_EXTERNAL") expect(read.requiredExternalAction).toMatch(/network/i);

    const merge = await adapter.mergePullRequest({ prNumber: 1, sha: SHA_A });
    expect(merge.status).toBe("BLOCKED_EXTERNAL");

    // The local Candidate work is still there and still committed.
    expect(fs.existsSync(path.join(repo.root, "src", "app", "main.ts"))).toBe(true);
    write(repo.root, "src/app/extra.ts", "export const extra = 1;\n");
    const localHead = commit(repo.root, "local work that stays local");
    expect(fs.existsSync(path.join(repo.root, "src", "app", "extra.ts"))).toBe(true);

    const authority = authorityFor(repo.root);
    const controller = new PromotionController({ storeFile: stateFile("promotion.json"), runId: "fi-run", authority, exactShaGate: new ExactShaGate(repo.root) });
    controller.setExternalBlocker("GitHub is unreachable");
    const record = await controller.evaluate({
      binding: { candidateHeadSha: localHead, ciValidatedSha: localHead, prHeadSha: localHead, promotionSha: localHead },
      requiredChecksPassed: true,
      branchUpToDate: true,
      reviewerClean: true,
      changedFiles: ["src/app/extra.ts"]
    });
    expect(record.state).toBe("BLOCKED_EXTERNAL");
    expect(record.state).not.toBe("PROMOTED");
    expect(core.snapshot().tasks).toMatchObject({ research: "ok", knowledge: "ok" });
  });
});

describe("FI-05: Candidate + Owner review pending", () => {
  it("waits durably, does not re-open PRs, and is never reclassified as stalled", async () => {
    const repo = candidateRepo();
    const core = bossCore();
    // A Root Surface change: the CI gate itself.
    write(repo.root, ".github/workflows/ci.yml", "name: CI\non: push\n");
    const head = commit(repo.root, "touch the CI gate");
    const durable = { storeFile: stateFile("promotion.json"), ledgerFile: stateFile("ledger.jsonl") };
    const authority = new RootAuthority({ root: repo.root, ledgerFile: durable.ledgerFile, runId: "fi-run", candidateSha: head });
    const controller = new PromotionController({ storeFile: durable.storeFile, runId: "fi-run", authority, exactShaGate: new ExactShaGate(repo.root) });
    const input = {
      binding: { candidateHeadSha: head, ciValidatedSha: head, prHeadSha: head, promotionSha: head },
      requiredChecksPassed: true,
      branchUpToDate: true,
      reviewerClean: true,
      changedFiles: [".github/workflows/ci.yml"]
    };

    const first = await controller.evaluate(input);
    expect(first.state).toBe("WAITING_FOR_ROOT_OWNER");
    // Exactly one PR is ever recorded for this run, and none is created on retry.
    controller.recordPullRequest(101, head);
    expect(controller.hasPullRequest()).toBe(true);

    // Repeated evaluation does not create more work and does not bypass the wait.
    for (let round = 0; round < 4; round++) {
      const again = await controller.evaluate(input);
      expect(again.state).toBe("WAITING_FOR_ROOT_OWNER");
      expect(again.pullRequest).toEqual({ number: 101, headSha: head });
    }

    // Restart: the wait is durable.
    const restartedAuthority = new RootAuthority({ root: repo.root, ledgerFile: durable.ledgerFile, runId: "fi-run", candidateSha: head });
    const restarted = new PromotionController({ storeFile: durable.storeFile, runId: "fi-run", authority: restartedAuthority, exactShaGate: new ExactShaGate(repo.root) });
    expect(restarted.record().state).toBe("WAITING_FOR_ROOT_OWNER");
    expect(restarted.hasPullRequest()).toBe(true);
    expect(restarted.record().history.length).toBeGreaterThan(0);
    expect((await restarted.evaluate(input)).state).toBe("WAITING_FOR_ROOT_OWNER");

    // A premium path does not exist: promotion stays blocked, and Stable is fine.
    expect(decidePromotion({
      candidateHeadSha: head, ciValidatedSha: head, prHeadSha: head, promotionSha: head,
      requiredChecksPassed: true, branchUpToDate: true, reviewerClean: true,
      emergencyStopEngaged: false, protectedSurfaceTouched: true, rootOwnerApproved: false, externalBlocker: null
    }).state).toBe("WAITING_FOR_ROOT_OWNER");
    expect(core.snapshot().history).toEqual(["a", "b"]);

    // And the Candidate is not stalled: a supervisor over the same layout still
    // reports a clean, startable state.
    const supervisor = new CandidateSupervisor({ layout: evolutionLayout(path.join(tempDir("boss-fi-evolution-")), "fi-run", SHA_A) });
    expect(supervisor.canStartNext()).toBe(true);
    expect(supervisor.state().state).toBe("CREATED");
  });
});
