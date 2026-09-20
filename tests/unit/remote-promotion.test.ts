import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RootAuthority } from "../../electron/root-authority/root-authority";
import { ExactShaGate } from "../../electron/promotion-gate/exact-sha-gate";
import { PromotionController } from "../../electron/promotion-gate/promotion-controller";
import { EvolutionHostOperations, type HostOperationHandlers } from "../../electron/self-evolution/host-operations";
import { createEvolutionGovernance } from "../../electron/self-evolution/self-evolution-host";
import { promoteCandidateOverGitHub, requiredChecksArePending } from "../../electron/self-evolution/remote-promotion";
import { cleanupFixtures, commit, gitRepo, stateFile, tempDir, write } from "../helpers/root-fixtures";

/**
 * The remote promotion sequence (Isolation-Finalization.md §11.2, §11.4, §16 FI-05, RD-012).
 *
 * Two properties are pinned here, both of them about evidence rather than about states:
 *
 *   1. **CI evidence is waited for, but only for a check that has not reported.** Reading the required checks
 *      once, one second after the pull request was opened, measures the absence of evidence: against a real CI
 *      every promotion is decided `required-checks-not-passed`, and the Root-Surface ceiling behind it becomes
 *      unreachable. A check that HAS reported and is not `success` must stop the wait immediately, so the wait
 *      can never outlive a known failure.
 *   2. **A green, Root-Surface change set still stops at the Owner.** The sequence pushes, opens the pull
 *      request, reads every required check, and then refuses to merge — the merge handler is never reached.
 */

afterEach(cleanupFixtures);

interface Harness {
  host: EvolutionHostOperations;
  promotion: PromotionController;
  emergency: ReturnType<typeof createEvolutionGovernance>["emergency"];
  head: string;
  calls: string[];
  /** Replace the check answer the host reports, per call. */
  setChecks(answer: Record<string, unknown>): void;
}

/** A candidate repository whose HEAD carries one file under a Root-Surface path. */
function candidate(options: { changedPath: string }): { root: string; head: string } {
  const repo = gitRepo("boss-remote-promotion-");
  write(repo.root, ".github/CODEOWNERS", "/electron/credential-boundary/ @zhiheng-zhang-Mera\n");
  write(repo.root, "src/app/main.ts", "export const main = 1;\n");
  commit(repo.root, "candidate baseline");
  write(repo.root, options.changedPath, "harmless acceptance note\n");
  return { root: repo.root, head: commit(repo.root, "touch a Root-Surface path") };
}

function harness(changedPath: string): Harness {
  const repo = candidate({ changedPath });
  const calls: string[] = [];
  const governanceRoot = tempDir("boss-remote-promotion-governance-");
  const evolutionRoot = tempDir("boss-remote-promotion-evolution-");
  const { emergency } = createEvolutionGovernance({ governanceRoot, evolutionRoot, rootOwner: "zhiheng-zhang-Mera" });
  const ledgerFile = stateFile("ledger.jsonl");
  const authority = new RootAuthority({ root: repo.root, ledgerFile, runId: "remote-promotion-run", candidateSha: repo.head });
  const evidenceDirectory = tempDir("boss-remote-promotion-evidence-");
  let checkAnswer: Record<string, unknown> = {
    status: "OK",
    value: { name: "quality+unit+acceptance+package", conclusion: "success", status: "completed" }
  };
  const handlers: HostOperationHandlers = {
    commitCandidate: async () => { calls.push("commitCandidate"); return repo.head; },
    candidateHead: async () => repo.head,
    nameStatus: async () => [{ status: "M" as const, path: changedPath }],
    pushBranch: async ({ branch, sha }) => { calls.push("pushBranch"); return { status: "OK", value: { branch, sha } }; },
    openPullRequest: async () => { calls.push("openPullRequest"); return { status: "OK", value: { number: 77, headSha: repo.head } }; },
    readPullRequest: async ({ prNumber }) => { calls.push("readPullRequest"); return { status: "OK", value: { number: prNumber, headSha: repo.head, state: "open" } }; },
    readCheck: async () => {
      calls.push("readCheck");
      return checkAnswer as Awaited<ReturnType<HostOperationHandlers["readCheck"]>>;
    },
    // The whole point: a Root-Surface change set must never reach a merge.
    mergePullRequest: async () => { calls.push("mergePullRequest"); throw new Error("the promotion sequence attempted a merge"); },
    readBranchSha: async ({ branch }) => { calls.push("readBranchSha"); return { status: "OK", value: { sha: `tip-of-${branch}` } }; },
    persistEvidence: async ({ name }) => name,
    markNextStable: async () => {},
    recordBoot: async () => {},
    commitStablePointer: async () => {},
    rollbackStable: async () => ({ ok: true, detail: "pointer-driven" })
  };
  const host = new EvolutionHostOperations(
    { runId: "remote-promotion-run", candidateRoot: path.dirname(repo.root), candidateWorkspace: repo.root, stableRoot: repo.root, baseSha: repo.head, ledgerFile, evidenceDirectory },
    authority,
    handlers
  );
  const promotion = new PromotionController({ storeFile: stateFile("promotion.json"), runId: "remote-promotion-run", authority, exactShaGate: new ExactShaGate(repo.root), emergency });
  return { host, promotion, emergency, head: repo.head, calls, setChecks: (answer) => { checkAnswer = answer; } };
}

describe("the remote promotion sequence", () => {
  it("stops a green Root-Surface change set at WAITING_FOR_ROOT_OWNER and never merges it (RD-012)", async () => {
    const fixture = harness("electron/credential-boundary/live-acceptance.md");
    const result = await promoteCandidateOverGitHub({
      host: fixture.host,
      promotion: fixture.promotion,
      emergency: fixture.emergency,
      candidateHeadSha: fixture.head,
      branch: "evolution/remote-promotion-run",
      request: { runId: "remote-promotion-run", objective: "harmless Root-Surface acceptance" },
      changedFiles: ["electron/credential-boundary/live-acceptance.md"],
      reviewerClean: true
    });

    expect(result.outcome).toBe("WAITING_FOR_ROOT_OWNER");
    expect(fixture.promotion.record().state).toBe("WAITING_FOR_ROOT_OWNER");
    expect(fixture.promotion.record().protectedPaths).toEqual(["electron/credential-boundary/live-acceptance.md"]);
    expect(fixture.promotion.record().pullRequest).toEqual({ number: 77, headSha: fixture.head });
    // The four steps that must happen did; the one that must not, did not.
    expect(fixture.calls).toEqual(["pushBranch", "openPullRequest", "readCheck"]);
    expect(fixture.promotion.record().rootOwnerApproval).toBeNull();
  });

  it("waits for a check that has not reported yet, then decides on the evidence", async () => {
    const fixture = harness("electron/credential-boundary/live-acceptance.md");
    let reads = 0;
    const sleeps: number[] = [];
    // First read: nothing has reported. Second read: all four are green.
    const host = {
      execute: async (operation: { kind: string }) => {
        if (operation.kind !== "promote.readCheck") return (fixture.host.execute as (op: unknown) => Promise<unknown>)(operation);
        reads += 1;
        if (reads === 1) return { status: "FAILED", reason: "no run reported for quality, unit, acceptance, package", pending: ["quality", "unit", "acceptance", "package"], missing: ["quality", "unit", "acceptance", "package"] };
        return { status: "OK", value: { name: "quality+unit+acceptance+package", conclusion: "success", status: "completed" } };
      }
    } as unknown as EvolutionHostOperations;

    const result = await promoteCandidateOverGitHub({
      host,
      promotion: fixture.promotion,
      emergency: fixture.emergency,
      candidateHeadSha: fixture.head,
      branch: "evolution/remote-promotion-run",
      request: { runId: "remote-promotion-run", objective: "harmless Root-Surface acceptance" },
      changedFiles: ["electron/credential-boundary/live-acceptance.md"],
      reviewerClean: true
    }, { sleep: async (ms) => { sleeps.push(ms); }, now: () => 0, ciWaitMs: 60_000, ciPollMs: 15_000 });

    expect(reads).toBe(2);
    expect(sleeps).toEqual([15_000]);
    expect(result.outcome).toBe("WAITING_FOR_ROOT_OWNER");
    expect(fixture.calls).not.toContain("mergePullRequest");
  });

  it("stops waiting the moment a check has reported a non-success conclusion", async () => {
    const fixture = harness("electron/credential-boundary/live-acceptance.md");
    const sleeps: number[] = [];
    fixture.setChecks({ status: "FAILED", reason: "not successful: quality=completed/failure", pending: ["unit"], notSuccessful: ["quality=completed/failure"] });

    const result = await promoteCandidateOverGitHub({
      host: fixture.host,
      promotion: fixture.promotion,
      emergency: fixture.emergency,
      candidateHeadSha: fixture.head,
      branch: "evolution/remote-promotion-run",
      request: { runId: "remote-promotion-run", objective: "harmless Root-Surface acceptance" },
      changedFiles: ["electron/credential-boundary/live-acceptance.md"],
      reviewerClean: true
    }, { sleep: async (ms) => { sleeps.push(ms); }, now: () => 0, ciWaitMs: 60_000 });

    // A known failure is never waited out: no sleep happened at all.
    expect(sleeps).toEqual([]);
    expect(result.outcome).toBe("REJECTED");
    expect(fixture.calls).not.toContain("mergePullRequest");
  });
});

describe("requiredChecksArePending", () => {
  it("is true only for a check that has not reached a terminal conclusion", () => {
    expect(requiredChecksArePending({ status: "FAILED", pending: ["quality"], missing: [] })).toBe(true);
    expect(requiredChecksArePending({ status: "FAILED", missing: ["unit"], pending: ["unit"] })).toBe(true);
    // Reported and failed: not pending.
    expect(requiredChecksArePending({ status: "FAILED", pending: [], notSuccessful: ["quality=completed/failure"] })).toBe(false);
    // A run reporting another SHA is not this candidate's evidence at all.
    expect(requiredChecksArePending({ status: "FAILED", pending: ["quality"], foreignSha: ["quality@deadbeef"] })).toBe(false);
    // Nothing pending: the answer is final.
    expect(requiredChecksArePending({ status: "FAILED", pending: [], missing: [] })).toBe(false);
    expect(requiredChecksArePending({ status: "OK" })).toBe(false);
  });
});
