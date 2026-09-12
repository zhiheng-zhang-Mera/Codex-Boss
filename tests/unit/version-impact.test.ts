/**
 * Update-Plan/checkpoint-1.md §37/§38 (checkpoint-13): version impact and the
 * local Git checkpoint.
 *
 * The cases pin §37's rule that the host decides the impact (a worker's conflicting
 * claim is recorded as rejected), the theme special cases, and §38's two guards:
 * no GitHub write without a checkpoint, and no rollback that would silently
 * discard commits.
 */
import { describe, expect, it } from "vitest";
import {
  assessVersionImpact,
  IMPACT_FACTORS,
  isThemeEngineContract,
  maxImpact,
  suggestedVersion,
  type ChangeObservation
} from "../../src/shared/version-impact";
import {
  checkpointIdFor,
  guardGitHubWrite,
  isUsableCheckpoint,
  planRollback,
  type CheckpointRecord
} from "../../src/shared/git-checkpoint";

const change = (overrides: Partial<ChangeObservation> & Pick<ChangeObservation, "path">): ChangeObservation => ({ kind: "MODIFIED", ...overrides });

describe("checkpoint-13 §37 version impact", () => {
  it("looks at all six §37 factors", () => {
    expect([...IMPACT_FACTORS]).toEqual(["API", "SCHEMA", "BEHAVIOR", "COMPATIBILITY", "MIGRATION", "USER_FACING"]);
    const assessment = assessVersionImpact({ changes: [change({ path: "src/a.ts", test_or_docs: false, public_surface: true, exports_before: ["a"], exports_after: ["a"] })] });
    expect(assessment.decided_by).toBe("HOST");
    expect(assessment.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(assessment.factors_examined.length + assessment.factors_not_observed.length).toBe(6);
  });

  it("is NONE when only tests and documents changed", () => {
    const assessment = assessVersionImpact({ changes: [change({ path: "tests/a.test.ts", test_or_docs: true }), change({ path: "docs/readme.md", test_or_docs: true, kind: "ADDED" })] });
    expect(assessment.impact).toBe("NONE");
    expect(assessment.findings).toEqual([]);
    expect(assessment.reason).toContain("no observed change affected");
  });

  it("is MAJOR when an exported symbol disappears", () => {
    const assessment = assessVersionImpact({
      changes: [change({ path: "src/shared/api.ts", public_surface: true, exports_before: ["build", "parse"], exports_after: ["parse"] })]
    });
    expect(assessment.impact).toBe("MAJOR");
    const api = assessment.findings.find((finding) => finding.factor === "API")!;
    expect(api.reason).toContain("disappeared");
    expect(api.evidence[0]).toBe("src/shared/api.ts#build");
  });

  it("is MINOR for an additive export and for a user-facing change", () => {
    expect(assessVersionImpact({ changes: [change({ path: "src/shared/api.ts", public_surface: true, exports_before: ["parse"], exports_after: ["parse", "format"] })] }).impact).toBe("MINOR");
    expect(assessVersionImpact({ changes: [change({ path: "src/renderer/App.tsx", user_facing: true, test_or_docs: false })] }).impact).toBe("MINOR");
  });

  it("is PATCH for an ordinary implementation change", () => {
    const assessment = assessVersionImpact({ changes: [change({ path: "src/shared/helper.ts", test_or_docs: false })] });
    expect(assessment.impact).toBe("PATCH");
    expect(assessment.findings.map((finding) => finding.factor)).toContain("BEHAVIOR");
  });

  it("is MAJOR for a migration or a public deletion", () => {
    expect(assessVersionImpact({ changes: [change({ path: "src/migrations/0002-add.ts", schema: true, test_or_docs: false })] }).impact).toBe("MAJOR");
    expect(assessVersionImpact({ changes: [change({ path: "src/shared/api.ts", kind: "DELETED", public_surface: true })] }).impact).toBe("MAJOR");
    expect(assessVersionImpact({ changes: [change({ path: "src/shared/api.ts", kind: "RENAMED", public_surface: true })] }).findings.some((finding) => finding.factor === "COMPATIBILITY")).toBe(true);
  });

  it("treats a plain custom theme as NONE/PATCH and re-evaluates when the contract changed", () => {
    const theme = assessVersionImpact({ changes: [change({ path: "artifacts/themes/neon/tokens.json", theme_package: true, kind: "ADDED" })] });
    expect(["NONE", "PATCH"]).toContain(theme.impact);
    expect(theme.reason).toContain("theme package");
    const contract = assessVersionImpact({ changes: [change({ path: "src/shared/theme.ts", theme_engine_contract: true, test_or_docs: false })] });
    expect(contract.requires_reevaluation).toBe(true);
    expect(contract.reason).toContain("re-assessed");
    expect(isThemeEngineContract("src/shared/theme.ts")).toBe(true);
    expect(isThemeEngineContract("src/renderer/theme.ts")).toBe(false);
  });

  it("refuses to let a worker decide the impact", () => {
    const assessment = assessVersionImpact({
      changes: [change({ path: "src/shared/api.ts", public_surface: true, exports_before: ["build"], exports_after: [] })],
      worker_claim: "PATCH"
    });
    expect(assessment.impact).toBe("MAJOR");
    expect(assessment.rejected_claims).toHaveLength(1);
    expect(assessment.rejected_claims[0]?.claimed).toBe("PATCH");
    expect(assessment.rejected_claims[0]?.reason).toContain("does not let a worker decide");
    const agreeing = assessVersionImpact({ changes: [change({ path: "src/shared/helper.ts", test_or_docs: false })], worker_claim: "PATCH" });
    expect(agreeing.rejected_claims).toEqual([]);
  });

  it("suggests the semver bump the assessment implies", () => {
    const major = assessVersionImpact({ changes: [change({ path: "src/shared/api.ts", public_surface: true, exports_before: ["a"], exports_after: [] })] });
    expect(suggestedVersion(major, "1.4.2")).toEqual({ from: "1.4.2", to: "2.0.0", reason: "MAJOR: a breaking change" });
    const none = assessVersionImpact({ changes: [change({ path: "tests/a.test.ts", test_or_docs: true })] });
    expect(suggestedVersion(none, "1.4.2")?.to).toBe("1.4.2");
    expect(suggestedVersion(none, "not-a-version")).toBeUndefined();
    expect(maxImpact("NONE", "MINOR")).toBe("MINOR");
  });
});

describe("checkpoint-13 §38 git checkpoint", () => {
  const checkpoint = (overrides: Partial<CheckpointRecord> = {}): CheckpointRecord => ({
    schemaVersion: 1,
    version: "git-checkpoint-1",
    id: "cp-1",
    head: "a".repeat(40),
    branch: "boss/task-1/slug",
    diff_hash: "b".repeat(64),
    diff_bytes: 120,
    task_id: "task-1",
    candidate_id: "cand-1",
    evidence: ["ev-1"],
    changed_files: ["src/a.ts"],
    created_at: "2026-01-01T00:00:00.000Z",
    dirty: true,
    ...overrides
  });

  it("records the six things §38 asks for", () => {
    const record = checkpoint({ version_impact: "PATCH" });
    expect(record.head).toHaveLength(40);
    expect(record.branch).toBe("boss/task-1/slug");
    expect(record.diff_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.task_id).toBe("task-1");
    expect(record.candidate_id).toBe("cand-1");
    expect(record.evidence).toEqual(["ev-1"]);
    expect(record.version_impact).toBe("PATCH");
    expect(checkpointIdFor({ task_id: "task-1", head: record.head, branch: record.branch, created_at: record.created_at })).toMatch(/^cp-[0-9a-f]{16}$/);
    expect(isUsableCheckpoint(record)).toBe(true);
    expect(isUsableCheckpoint({ ...record, diff_hash: "nope" })).toBe(false);
    expect(isUsableCheckpoint(undefined)).toBe(false);
    expect(isUsableCheckpoint({ ...record, version: "git-checkpoint-2" })).toBe(false);
  });

  it("plans a path restore while the branch has not moved", () => {
    const plan = planRollback({
      checkpoint: checkpoint({ changed_files: ["src/a.ts", "src/b.ts"] }),
      current: { head: checkpoint().head, branch: checkpoint().branch, diff_hash: "c".repeat(64), dirty: true }
    });
    expect(plan.ok).toBe(true);
    expect(plan.path_restore_sufficient).toBe(true);
    expect(plan.restore_paths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(plan.hard_reset).toBeUndefined();
  });

  it("refuses a rollback that would discard commits without the Owner's approval", () => {
    const plan = planRollback({
      checkpoint: checkpoint(),
      current: { head: "d".repeat(40), branch: checkpoint().branch, diff_hash: "c".repeat(64), dirty: false }
    });
    expect(plan.ok).toBe(false);
    expect(plan.hard_reset?.required).toBe(true);
    expect(plan.reasons.some((reason) => reason.includes("Owner's approval"))).toBe(true);
    const approved = planRollback({
      checkpoint: checkpoint(),
      current: { head: "d".repeat(40), branch: checkpoint().branch, diff_hash: "c".repeat(64), dirty: false },
      owner_approved_discard: true
    });
    expect(approved.ok).toBe(true);
    expect(approved.path_restore_sufficient).toBe(false);
    expect(approved.reasons[0]).toContain("Owner approved");
  });

  it("refuses a rollback on a different branch or with nothing to restore", () => {
    const otherBranch = planRollback({ checkpoint: checkpoint(), current: { head: checkpoint().head, branch: "main", diff_hash: checkpoint().diff_hash, dirty: false } });
    expect(otherBranch.ok).toBe(false);
    expect(otherBranch.reasons[0]).toContain("main");
    const nothing = planRollback({ checkpoint: checkpoint({ changed_files: [] }), current: { head: checkpoint().head, branch: checkpoint().branch, diff_hash: checkpoint().diff_hash, dirty: false } });
    expect(nothing.ok).toBe(false);
    expect(nothing.reasons.some((reason) => reason.includes("nothing to restore"))).toBe(true);
  });

  it("refuses any GitHub write without a current checkpoint", () => {
    const current = { head: checkpoint().head, branch: checkpoint().branch, diff_hash: checkpoint().diff_hash };
    expect(guardGitHubWrite({ checkpoints: [], task_id: "task-1", current, operation: "PUSH" }).allowed).toBe(false);
    expect(guardGitHubWrite({ checkpoints: [], task_id: "task-1", current, operation: "PUSH" }).reason).toContain("no local checkpoint");
    const wrongTask = guardGitHubWrite({ checkpoints: [checkpoint({ task_id: "other" })], task_id: "task-1", current, operation: "OPEN_PR" });
    expect(wrongTask.allowed).toBe(false);
    const drifted = guardGitHubWrite({ checkpoints: [checkpoint()], task_id: "task-1", current: { ...current, diff_hash: "e".repeat(64) }, operation: "PUSH" });
    expect(drifted.allowed).toBe(false);
    expect(drifted.reason).toContain("changed after the checkpoint");
    const allowed = guardGitHubWrite({ checkpoints: [checkpoint()], task_id: "task-1", current, operation: "PUSH" });
    expect(allowed.allowed).toBe(true);
    expect(allowed.checkpoint?.id).toBe("cp-1");
    expect(allowed.reason).toContain("covers this push");
    const otherBranch = guardGitHubWrite({ checkpoints: [checkpoint()], task_id: "task-1", current: { ...current, branch: "main" }, operation: "PUSH" });
    expect(otherBranch.reason).toContain("repository is on main");
  });

  it("uses the newest checkpoint for a task", () => {
    const older = checkpoint({ id: "cp-old", created_at: "2026-01-01T00:00:00.000Z", diff_hash: "9".repeat(64) });
    const newer = checkpoint({ id: "cp-new", created_at: "2026-01-02T00:00:00.000Z" });
    const verdict = guardGitHubWrite({
      checkpoints: [older, newer],
      task_id: "task-1",
      current: { head: newer.head, branch: newer.branch, diff_hash: newer.diff_hash },
      operation: "COMMIT"
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.checkpoint?.id).toBe("cp-new");
  });
});
