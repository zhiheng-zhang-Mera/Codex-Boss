import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANDIDATE_FAILURE_CLASSES,
  RollbackController,
  RollbackError,
  assessStableImpact,
  type CandidateFailureClass,
  type GitRunner
} from "../../electron/root-recovery/rollback-controller";
import { cleanupFixtures, commit, gitRepo, revParse, stateFile, tempDir, write } from "../helpers/root-fixtures";

/**
 * F6 — Rollback and Root Recovery acceptance (Isolation-Finalization.md §12, §23
 * RD-013 "Rollback deterministic"; §14 RT-18/RT-19/RT-25).
 *
 * Two claims:
 *   1. every Candidate failure class is contained to the Candidate, and the
 *      *evolution module* — not Stable — is what degrades or aborts;
 *   2. a promotion that turns out badly is reversible from a recorded
 *      checkpoint, deterministically, without rewriting history and without
 *      asking a model what the previous version was.
 */

afterEach(cleanupFixtures);

describe("Candidate failure never reaches Stable (§12.1, §12.3)", () => {
  it("contains every failure class the plan enumerates", () => {
    expect(CANDIDATE_FAILURE_CLASSES).toHaveLength(9);
    for (const failure of CANDIDATE_FAILURE_CLASSES) {
      const impact = assessStableImpact(failure);
      expect(impact.affectsStablePath, failure).toBe(false);
      expect(impact.requiresRollback, failure).toBe(false);
      // The evolution module carries the consequence: a failure the Candidate's
      // own work caused aborts the run; a machinery failure degrades it.
      expect(["DEGRADED", "ABORTED"], failure).toContain(impact.evolutionState);
    }
  });

  it("aborts on the Candidate's own work and degrades on machinery faults", () => {
    const aborting: CandidateFailureClass[] = ["compile-fail", "test-fail", "reviewer-blocker", "ci-fail", "stale-sha", "protected-surface-unapproved"];
    for (const failure of aborting) expect(assessStableImpact(failure).evolutionState, failure).toBe("ABORTED");
    const degrading: CandidateFailureClass[] = ["candidate-crash", "timeout", "state-corruption"];
    for (const failure of degrading) expect(assessStableImpact(failure).evolutionState, failure).toBe("DEGRADED");
  });

  it("never requires a rollback for a Candidate failure — Stable was never touched", () => {
    for (const failure of CANDIDATE_FAILURE_CLASSES) {
      const impact = assessStableImpact(failure);
      expect(impact.requiresRollback, failure).toBe(false);
      expect(impact.detail, failure).toMatch(/contained to the Candidate/);
    }
  });
});

describe("Deterministic rollback from a recorded checkpoint (§12.2, RD-013)", () => {
  function rollbackFor(repoRoot: string) {
    return new RollbackController({
      checkpointFile: stateFile("rollback-checkpoint.json"),
      recordFile: stateFile("rollback-record.json"),
      stableRoot: repoRoot,
      baseBranch: "main"
    });
  }

  it("refuses to roll back without a checkpoint", async () => {
    const repo = gitRepo("boss-stable-repo-");
    const controller = rollbackFor(repo.root);
    expect(controller.checkpoint()).toBeUndefined();
    await expect(controller.rollback("post-promotion fault")).rejects.toThrow(RollbackError);
    await expect(controller.rollback("again")).rejects.toThrow(/no rollback checkpoint exists/);
  });

  it("rejects a malformed checkpoint and a checkpoint inside the Stable tree", () => {
    const repo = gitRepo("boss-stable-repo-");
    const controller = rollbackFor(repo.root);
    expect(() => controller.createCheckpoint({ runId: "r", previousStableSha: "short", promotedSha: repo.sha, evidenceDir: repo.root })).toThrow(/full previous Stable SHA/);
    expect(() => controller.createCheckpoint({ runId: "r", previousStableSha: repo.sha, promotedSha: "short", evidenceDir: repo.root })).toThrow(/full promoted SHA/);
    expect(() => new RollbackController({ checkpointFile: path.join(repo.root, "c.json"), recordFile: stateFile("r.json"), stableRoot: repo.root })).toThrow(/outside the Stable working tree/);
  });

  it("produces the same command plan for the same checkpoint", () => {
    const repo = gitRepo("boss-stable-repo-");
    const controller = rollbackFor(repo.root);
    const checkpoint = controller.createCheckpoint({ runId: "run-x", previousStableSha: repo.sha, promotedSha: "b".repeat(40), evidenceDir: tempDir("boss-evidence-") });
    const first = controller.planRollback(checkpoint);
    const second = controller.planRollback(checkpoint);
    expect(first).toEqual(second);
    expect(first).toContainEqual(["fetch", "--all", "--prune"]);
    expect(first).toContainEqual(["switch", "main"]);
    expect(first[2]).toEqual(["revert", "--no-commit", "b".repeat(40)]);
    // No force push and no history rewrite appears anywhere in the plan.
    expect(JSON.stringify(first)).not.toMatch(/--force|push|reset/);
  });

  it("dry-runs the plan without touching the repository", async () => {
    const repo = gitRepo("boss-stable-repo-");
    const controller = rollbackFor(repo.root);
    controller.createCheckpoint({ runId: "run-dry", previousStableSha: repo.sha, promotedSha: repo.sha, evidenceDir: tempDir("boss-evidence-") });
    const result = await controller.rollback("dry run", { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.plan.length).toBeGreaterThan(0);
    expect(revParse(repo.root, "HEAD")).toBe(repo.sha);
    expect(controller.lastRollback()).toBeUndefined();
  });

  it("reverts a bad promotion with a new commit, leaving history intact", async () => {
    const repo = gitRepo("boss-stable-repo-");
    const previousStableSha = repo.sha;

    // A "promotion": an ordinary commit that turns out to be faulty.
    write(repo.root, "feature.ts", "export const broken = true;\n");
    const promotedSha = commit(repo.root, "promote candidate");
    expect(fs.existsSync(path.join(repo.root, "feature.ts"))).toBe(true);

    const controller = rollbackFor(repo.root);
    controller.createCheckpoint({ runId: "run-rollback", previousStableSha, promotedSha, evidenceDir: tempDir("boss-evidence-") });
    const result = await controller.rollback("post-promotion fault: feature broke Stable");

    expect(result.ok).toBe(true);
    expect(result.record.previousStableSha).toBe(previousStableSha);
    expect(result.record.promotedSha).toBe(promotedSha);
    expect(result.record.reason).toMatch(/post-promotion fault/);
    expect(result.record.revertSha).toBeTruthy();

    // The faulty change is reverted…
    expect(fs.existsSync(path.join(repo.root, "feature.ts"))).toBe(false);
    // …the original commit is still reachable (history was not rewritten)…
    expect(revParse(repo.root, promotedSha)).toBe(promotedSha);
    expect(revParse(repo.root, previousStableSha)).toBe(previousStableSha);
    // …and the branch simply has one more, additive commit.
    expect(result.record.revertSha).not.toBe(promotedSha);
    expect(revParse(repo.root, "HEAD")).toBe(result.record.revertSha);
  });

  it("records a failed rollback instead of pretending it succeeded", async () => {
    const repo = gitRepo("boss-stable-repo-");
    const failingGit: GitRunner = {
      async run(cwd, args, timeout) {
        if (args[0] === "revert") throw new Error("conflict during revert");
        // Every other step is a real git call, so the failure is a genuine one
        // caused by the revert, not by a stubbed-out runner.
        return new Promise((resolve, reject) => {
          execFile("git", args, { cwd, windowsHide: true, timeout: timeout ?? 60000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim())));
        });
      }
    };
    const controller = new RollbackController({
      checkpointFile: stateFile("rollback-checkpoint.json"),
      recordFile: stateFile("rollback-record.json"),
      stableRoot: repo.root,
      git: failingGit
    });
    controller.createCheckpoint({ runId: "run-fail", previousStableSha: repo.sha, promotedSha: repo.sha, evidenceDir: tempDir("boss-evidence-") });
    const result = await controller.rollback("conflicting revert");
    expect(result.ok).toBe(false);
    expect(result.record.error).toMatch(/conflict during revert/);
    expect(controller.lastRollback()?.error).toBeTruthy();
  });

  it("retains the run's evidence across a rollback", () => {
    const repo = gitRepo("boss-stable-repo-");
    const evidenceDir = tempDir("boss-evidence-");
    write(evidenceDir, "F5-promotion.json", "{}");
    const controller = rollbackFor(repo.root);
    const checkpoint = controller.createCheckpoint({ runId: "run-evidence", previousStableSha: repo.sha, promotedSha: repo.sha, evidenceDir });
    const retained = controller.retainEvidence(checkpoint);
    expect(retained.retained).toBe(true);
    expect(retained.directory).toBe(evidenceDir);
    expect(fs.existsSync(path.join(evidenceDir, "F5-promotion.json"))).toBe(true);
  });
});
