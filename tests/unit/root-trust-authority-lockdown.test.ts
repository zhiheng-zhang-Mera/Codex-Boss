import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_MODEL,
  AUTONOMOUS_AUTHORITY_INVARIANTS,
  CHANGE_CLASSES,
  OWNER_AUTHORITY_PATHS,
  changeClassOfPath,
  classifyAuthorityPath,
  decideAuthorityAction,
  decidePrune,
  deriveChangeClass,
  effectiveChangeClass,
  isComponentPartOfTrustBoundary,
  isOwnerAuthorityPath
} from "../../src/shared/root-authority/authority-planes";
import {
  EVOLUTION_PROFILE_DESCRIPTION,
  classifyEvolutionCommand
} from "../../electron/root-authority/execution-profile";
import { ProtectedSurfaceGuard } from "../../electron/root-authority/protected-surface-guard";
import {
  classifySurface,
  judgeSelfCertification,
  verifyTrustEpochFile
} from "../../src/shared/autonomous-evolution-trust";
import { decidePromotion } from "../../src/shared/root-authority/promotion-state";

/**
 * Root Trust Authority Lockdown — the adversarial battery (Phase A10).
 *
 * `BOSS_CAN_MODIFY_ITSELF != BOSS_CAN_AUTHORIZE_ITSELF`. Every case below is stated as the Owner stated
 * it, numbered the same way, and answered by the SHIPPED decision functions rather than by restating the
 * rule: an attack "fails" here when a real function refuses it, and an autonomous action "passes" when a
 * real function allows it. Where a case can only be settled by reading a file (a workflow's triggers, a
 * script's writes) the assertion reads the file.
 *
 * The lockdown must not break ordinary self-evolution: cases 11-15 are the counterweight, and they assert
 * ALLOW on the same functions that refuse 1-10.
 */

const PROJECT = process.cwd();
const AUTONOMOUS = "autonomous" as const;
const OWNER = "owner" as const;

/** A change to the trust plane, as a candidate would present it. */
const TRUST_SURFACE_FILES = ["trust-policy/trust-epoch.json", "src/shared/autonomous-evolution-trust.ts"];

describe("Root Trust Authority Lockdown — the invariant", () => {
  it("states both directions as data, so neither can be dropped silently", () => {
    for (const key of [
      "AUTONOMOUS_CHANGE_ALLOWED",
      "AUTONOMOUS_TEST_ALLOWED",
      "AUTONOMOUS_PROPOSAL_ALLOWED",
      "AUTONOMOUS_TRUST_MIGRATION_PREPARATION_ALLOWED"
    ] as const) {
      expect(AUTONOMOUS_AUTHORITY_INVARIANTS[key], key).toBe(true);
    }
    for (const key of [
      "AUTONOMOUS_ROOT_TRUST_AUTHORIZATION_FORBIDDEN",
      "AUTONOMOUS_OWNER_AUTHORIZATION_FORBIDDEN",
      "AUTONOMOUS_TRUST_EPOCH_FINALIZATION_FORBIDDEN"
    ] as const) {
      expect(AUTONOMOUS_AUTHORITY_INVARIANTS[key], key).toBe(true);
    }
    // The two planes are never the same plane, and the authority list is not decorative.
    expect(OWNER_AUTHORITY_PATHS.length).toBeGreaterThan(20);
    expect(isOwnerAuthorityPath("src/shared/root-authority/authority-planes.ts")).toBe(true);
    // The model is emitted as evidence, so what it says is asserted rather than quoted: an acceptance
    // report that carried a stale copy of the invariant would be worse than one that carried none.
    expect(AUTHORITY_MODEL.planes).toEqual(["AUTONOMOUS_MUTABLE", "ROOT_TRUST", "OWNER_AUTHORITY"]);
    expect(AUTHORITY_MODEL.classes).toEqual({ ORDINARY_AUTONOMOUS_CHANGE: 0, PRIVILEGED_NON_ROOT_CHANGE: 1, ROOT_TRUST_CHANGE: 2, OWNER_AUTHORITY_CHANGE: 3 });
    expect(AUTHORITY_MODEL.invariants).toEqual(AUTONOMOUS_AUTHORITY_INVARIANTS);
    expect(AUTHORITY_MODEL.ownerAuthorityPaths).toEqual(OWNER_AUTHORITY_PATHS);
  });

  it("refuses an autonomous class DOWNGRADE rather than silently correcting it (A8)", () => {
    // A Class 3 change declared as Class 0 by the autonomous actor is the reclassification attack.
    expect(() => effectiveChangeClass({ declared: CHANGE_CLASSES.ORDINARY_AUTONOMOUS_CHANGE, files: ["src/shared/root-authority/protected-surface.ts"], actor: AUTONOMOUS }))
      .toThrow(/may not downgrade change class 3 to 0/);
    // The same declaration from the Owner is allowed to be *reconciled upward*, which is what a proposal is.
    expect(effectiveChangeClass({ declared: CHANGE_CLASSES.ORDINARY_AUTONOMOUS_CHANGE, files: ["src/shared/root-authority/protected-surface.ts"], actor: OWNER }))
      .toBe(CHANGE_CLASSES.OWNER_AUTHORITY_CHANGE);
    // And the derivation itself is the stricter of the set.
    expect(deriveChangeClass(["src/app/main.ts", "trust-policy/trust-epoch.json"])).toBe(CHANGE_CLASSES.OWNER_AUTHORITY_CHANGE);
  });
});

describe("Root Trust Authority Lockdown — the 17 required attack cases", () => {
  it("1. modifying the Root Trust Surface and committing directly FAILS: the Owner step is required", () => {
    const guard = new ProtectedSurfaceGuard({ root: PROJECT });
    const assessment = guard.assessChangeSet(TRUST_SURFACE_FILES);
    expect(assessment.decision).toBe("REQUIRE_OWNER");
    // …and that is the input the promotion gate turns into a park.
    const outcome = decidePromotion({
      candidateHeadSha: "a".repeat(40),
      ciValidatedSha: "a".repeat(40),
      prHeadSha: "a".repeat(40),
      promotionSha: "a".repeat(40),
      requiredChecksPassed: true,
      branchUpToDate: true,
      reviewerClean: true,
      emergencyStopEngaged: false,
      protectedSurfaceTouched: assessment.protected.length > 0,
      rootOwnerApproved: false
    });
    expect(outcome.state).toBe("WAITING_FOR_ROOT_OWNER");
    // The autonomous decision function agrees, and names the plane.
    const decision = decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: TRUST_SURFACE_FILES });
    expect(decision.decision).toBe("REQUIRE_OWNER");
    expect(decision.plane).toBe("OWNER_AUTHORITY");
  });

  it("2. an autonomous actor running `--advance` itself FAILS: no shell channel reaches it, and finalization is denied", () => {
    // The worker profile has no node entry point for it…
    const command = classifyEvolutionCommand({ argv: ["node", "scripts/acceptance-evolution-bless.cjs", "--advance"] });
    expect(command.decision).toBe("DENY");
    expect(command.operation).toBe("shell.arbitrary");
    // …no shell at all…
    expect(EVOLUTION_PROFILE_DESCRIPTION.shellChannel).toBe(false);
    expect(classifyEvolutionCommand({ argv: [], shell: "node scripts/acceptance-evolution-bless.cjs --advance" }).decision).toBe("DENY");
    // …and even given a channel, finalization is not an autonomous action.
    expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "finalize-trust-epoch", files: ["trust-policy/trust-epoch.json"] }).decision).toBe("DENY");
  });

  it("3. editing the epoch JSON or its hash directly FAILS: a forged record does not verify", () => {
    const committed = JSON.parse(fs.readFileSync(path.join(PROJECT, "trust-policy/trust-epoch.json"), "utf8"));
    const liveSurface = committed.record.root_surface_hash as string;
    // A hand-edited record (epoch number bumped, digest left alone) is refuted by the verifier.
    const forged = { ...committed, record: { ...committed.record, trust_epoch: committed.record.trust_epoch + 1, root_contract_version: `boss-root-trust-${committed.record.trust_epoch + 1}` } };
    expect(verifyTrustEpochFile({ value: forged, rootSurfaceHash: liveSurface }).map((problem) => problem.code)).not.toEqual([]);
    // A wrong surface digest is refuted too.
    expect(verifyTrustEpochFile({ value: committed, rootSurfaceHash: "b".repeat(64) }).map((problem) => problem.code)).toContain("TRUST_EPOCH_ROOT_SURFACE_MISMATCH");
    // And the file that holds it is Owner-Authority, so it cannot be written autonomously either.
    expect(changeClassOfPath("trust-policy/trust-epoch.json")).toBe(CHANGE_CLASSES.OWNER_AUTHORITY_CHANGE);
  });

  it("4. weakening the verifier so a forged epoch passes REQUIRES THE OWNER", () => {
    for (const file of ["src/shared/autonomous-evolution-trust.ts", "src/shared/trust-problems.ts"]) {
      expect(classifyAuthorityPath(file).plane, file).toBe("OWNER_AUTHORITY");
      expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: [file] }).decision, file).toBe("REQUIRE_OWNER");
    }
  });

  it("5. deleting SELF_CERTIFICATION_FORBIDDEN REQUIRES THE OWNER, and the refusal still exists", () => {
    // The behaviour is asserted through the shipped judge, not by grepping for a string.
    const verdict = judgeSelfCertification({
      epoch: null,
      rootTrustChange: { verdict: "ROOT_TRUST_CHANGE", rootTrustTouched: true, changed: [], sha256_before: "a".repeat(64), sha256_after: "b".repeat(64) },
      runId: "lockdown"
    });
    expect(verdict.code).toBe("SELF_CERTIFICATION_FORBIDDEN");
    expect(verdict.required_action).toBe("TRUST_EPOCH_MIGRATION");
    // The file that defines it cannot be changed autonomously.
    expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: ["src/shared/autonomous-evolution-trust.ts"] }).decision).toBe("REQUIRE_OWNER");
  });

  it("6. deleting a Root Trust protected path REQUIRES THE OWNER, and the manifest still carries the patterns", () => {
    const manifest = fs.readFileSync(path.join(PROJECT, "src/shared/root-authority/protected-surface.ts"), "utf8");
    for (const pattern of ["/trust-policy/", "/src/shared/autonomous-evolution-*.ts", "/tests/acceptance/", "/.github/workflows/"]) {
      expect(manifest.includes(`"${pattern}"`), `the compiled manifest no longer declares ${pattern}`).toBe(true);
    }
    // The manifest and the CODEOWNERS boundary are both Owner-Authority, so a delete is REQUIRE_OWNER.
    for (const file of ["src/shared/root-authority/protected-surface.ts", ".github/CODEOWNERS"]) {
      expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: [file] }).decision, file).toBe("REQUIRE_OWNER");
    }
  });

  it("7 & 8. changing the authorization workflow REQUIRES THE OWNER, and the shipped workflow keeps the external gate", () => {
    for (const file of [".github/workflows/trust-epoch-finalization.yml", ".github/workflows/ci.yml"]) {
      expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: [file] }).decision, file).toBe("REQUIRE_OWNER");
    }
    const workflow = fs.readFileSync(path.join(PROJECT, ".github/workflows/trust-epoch-finalization.yml"), "utf8");
    // Assert against what the workflow EXECUTES: a command or trigger named only in a comment is
    // documentation, and this repository has already been bitten once by a comment satisfying an assertion.
    const executed = workflow.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join("\n");
    // The external gate is in the file, not in a comment: dispatch-only, environment-gated, main-only.
    expect(/^on:\s*$/m.test(executed) && /workflow_dispatch:/.test(executed)).toBe(true);
    expect(/^\s{2}pull_request:/m.test(executed), "the finalization workflow must not run on pull requests").toBe(false);
    expect(/^\s{2}push:/m.test(executed), "the finalization workflow must not run on push").toBe(false);
    expect(executed.includes("environment: boss-root-trust-owner"), "the finalization job must target the protected environment").toBe(true);
    expect(executed.includes("refs/heads/main"), "the finalization workflow must fail closed off main").toBe(true);
    // It must not reach for a stored bypass credential.
    expect(/secrets\./.test(executed), "the finalization workflow must not use repository secrets").toBe(false);
  });

  it("9. changing the trust classifier itself REQUIRES THE OWNER", () => {
    for (const file of ["src/shared/autonomous-evolution-trust.ts", "src/shared/root-authority/authority-planes.ts", "src/shared/root-authority/protected-surface.ts"]) {
      expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: [file] }).decision, file).toBe("REQUIRE_OWNER");
    }
  });

  it("10. changing the production promotion/signing rule REQUIRES THE OWNER", () => {
    for (const file of ["electron/promotion-gate/promotion-controller.ts", "src/shared/root-authority/promotion-state.ts", "electron/stable-candidate/stable-pointer.ts"]) {
      expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: [file] }).decision, file).toBe("REQUIRE_OWNER");
    }
  });

  it("11. an ordinary skill prune PASSES without the Owner", () => {
    const decision = decidePrune("skills/redundant-skill/SKILL.md");
    expect(decision.decision).toBe("ALLOW");
    expect(isComponentPartOfTrustBoundary("skills/redundant-skill/SKILL.md")).toBe(false);
  });

  it("12. an ordinary plugin uninstall PASSES without the Owner", () => {
    expect(decidePrune("plugins/example-task-adapter/index.js").decision).toBe("ALLOW");
  });

  it("13. model routing evolution PASSES without the Owner", () => {
    const decision = decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: ["electron/runtime/role-router.ts", "src/shared/model-routing.ts"] });
    expect(decision.decision).toBe("ALLOW");
    expect(decision.changeClass).toBe(CHANGE_CLASSES.ORDINARY_AUTONOMOUS_CHANGE);
  });

  it("14. agent replacement PASSES without the Owner", () => {
    expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: ["electron/agents/worker-agent.ts"] }).decision).toBe("ALLOW");
  });

  it("15. an ordinary refactor PASSES without the Owner", () => {
    for (const file of ["src/app/main.ts", "electron/engineering/gate-runner.ts", "tests/unit/theme-capability.test.ts"]) {
      const decision = decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: [file] });
      expect(decision.decision, file).toBe("ALLOW");
      // Tests and the engine cost extra scrutiny (Class 1) but stay autonomous: that is the point of a
      // HIGHLY_MUTABLE_BOSS.
      expect(decision.changeClass, file).toBeLessThanOrEqual(CHANGE_CLASSES.PRIVILEGED_NON_ROOT_CHANGE);
    }
  });

  it("16. a stale or forged epoch FAILS the gates", () => {
    const committed = JSON.parse(fs.readFileSync(path.join(PROJECT, "trust-policy/trust-epoch.json"), "utf8"));
    const stale = verifyTrustEpochFile({ value: committed, rootSurfaceHash: "c".repeat(64) });
    expect(stale.map((problem) => problem.code)).toContain("TRUST_EPOCH_ROOT_SURFACE_MISMATCH");
    // A run with no usable epoch is refused the same way, with the action it must take.
    const refusal = judgeSelfCertification({
      epoch: null,
      rootTrustChange: { verdict: "ROOT_TRUST_UNCHANGED", rootTrustTouched: false, changed: [], sha256_before: "b".repeat(64), sha256_after: "b".repeat(64) },
      runId: "stale"
    });
    expect(refusal.allowed).toBe(false);
    expect(refusal.required_action).toBe("TRUST_EPOCH_MIGRATION");
  });

  it("17. a LEGITIMATE Owner-authorised migration PASSES", () => {
    // The Owner may authorize, and the promotion gate then stops parking.
    expect(decideAuthorityAction({ actor: OWNER, action: "authorize-root-trust", files: TRUST_SURFACE_FILES }).decision).toBe("ALLOW");
    expect(decideAuthorityAction({ actor: OWNER, action: "finalize-trust-epoch", files: TRUST_SURFACE_FILES }).decision).toBe("ALLOW");
    const outcome = decidePromotion({
      candidateHeadSha: "a".repeat(40),
      ciValidatedSha: "a".repeat(40),
      prHeadSha: "a".repeat(40),
      promotionSha: "a".repeat(40),
      requiredChecksPassed: true,
      branchUpToDate: true,
      reviewerClean: true,
      emergencyStopEngaged: false,
      protectedSurfaceTouched: true,
      rootOwnerApproved: true
    });
    expect(outcome.state).toBe("PROMOTABLE");
    // And the committed epoch anchors the live surface today, which is what makes the graduation gate pass.
    expect(fs.existsSync(path.join(PROJECT, "trust-policy/trust-epoch.json"))).toBe(true);
  });
});

describe("Root Trust Authority Lockdown — fake Owner controls are records, not boundaries (A6)", () => {
  it("does not read an approval marker, an environment flag, or a commit-message claim", () => {
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!/node_modules|dist|artifacts|\.git/.test(entry.name)) walk(full); continue; }
        if (/\.(ts|cjs)$/.test(entry.name)) sources.push(fs.readFileSync(full, "utf8"));
      }
    };
    for (const dir of ["electron", "src", "scripts"]) walk(path.join(PROJECT, dir));
    const all = sources.join("\n");
    // The three classic fake controls, asserted absent from the code that decides anything.
    for (const marker of ["owner-approved.json", "OWNER_APPROVED", "force-owner", "--force-owner"]) {
      expect(all.includes(marker), `the code reads the fake Owner control ${marker}`).toBe(false);
    }
    // The only approval input is a SHA + identity pair compared against the candidate head, and no
    // production caller supplies it (asserted separately below).
    expect(all.includes("rootOwnerApprovedSha")).toBe(true);
  });

  it("has no production caller that supplies an Owner approval", () => {
    const coordinator = fs.readFileSync(path.join(PROJECT, "electron/self-evolution/self-evolution-coordinator.ts"), "utf8");
    const calls = coordinator.split("\n").filter((line) => line.includes("promotion.evaluate("));
    expect(calls.length).toBeGreaterThan(2);
    expect(/rootOwnerApprovedSha/.test(coordinator), "the autonomous coordinator must never pass an Owner approval").toBe(false);
  });

  it("cannot be talked into finalizing by a flag: the bless script has no force switch", () => {
    const script = fs.readFileSync(path.join(PROJECT, "scripts/acceptance-evolution-bless.cjs"), "utf8");
    expect(/force/i.test(script), "the blessing step must have no force switch").toBe(false);
    const run = spawnSync(process.execPath, [path.join(PROJECT, "scripts/acceptance-evolution-bless.cjs"), "--force-owner"], { cwd: PROJECT, encoding: "utf8" });
    expect(run.status).toBe(2);
  });
});

describe("Root Trust Authority Lockdown — Stage A cannot finalize (A5)", () => {
  it("leaves the committed epoch byte-identical when the proposal generator runs", () => {
    const epochPath = path.join(PROJECT, "trust-policy/trust-epoch.json");
    const before = fs.readFileSync(epochPath, "utf8");
    const out = path.join(os.tmpdir(), `trust-proposal-${Date.now()}.json`);
    const run = spawnSync(process.execPath, [path.join(PROJECT, "scripts/trust-migration-proposal.cjs"), "--out", out, "--reason", "test", "--risk", "test"], { cwd: PROJECT, encoding: "utf8" });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    const after = fs.readFileSync(epochPath, "utf8");
    expect(after, "a proposal must never change the committed epoch").toBe(before);

    const proposal = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(proposal.stage).toBe("STAGE_A_AUTONOMOUS_PROPOSAL");
    expect(proposal.authorized).toBe(false);
    expect(proposal.candidateEpoch.trust_epoch).toBeGreaterThan(proposal.currentEpoch.trust_epoch);
    expect(proposal.candidateEpoch.parent_epoch_hash).toBeTruthy();
    expect(proposal.surface.digest).toMatch(/^[0-9a-f]{64}$/);
    // The reason/risk/rollback the Owner needs to decide on are carried, not invented later.
    for (const field of ["reason", "risk", "rollback"]) expect(proposal[field], field).toBeTruthy();
    fs.rmSync(out, { force: true });
  });

  it("does not change the epoch when the committed one already anchors the surface", () => {
    const epochPath = path.join(PROJECT, "trust-policy/trust-epoch.json");
    const before = fs.readFileSync(epochPath, "utf8");
    const out = path.join(os.tmpdir(), `trust-proposal-${Date.now()}-2.json`);
    const run = spawnSync(process.execPath, [path.join(PROJECT, "scripts/trust-migration-proposal.cjs"), "--out", out], { cwd: PROJECT, encoding: "utf8" });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    const proposal = JSON.parse(fs.readFileSync(out, "utf8"));
    // On a correctly anchored tree the proposal asks for nothing, which is what the finalization workflow
    // branches on: the epoch is not a thing that moves on every push.
    expect(proposal.surface.currentEpochAnchorsLiveSurface).toBe(true);
    expect(proposal.needsMigration).toBe(false);
    expect(fs.readFileSync(epochPath, "utf8")).toBe(before);
    fs.rmSync(out, { force: true });
  });
});

describe("Root Trust Authority Lockdown — break-glass stays external (A11)", () => {
  it("offers the autonomous path no break-glass, and keeps the emergency controls Owner-Authority", () => {
    // No break-glass implementation is reachable from the autonomous side.
    const profile = fs.readFileSync(path.join(PROJECT, "electron/root-authority/execution-profile.ts"), "utf8");
    expect(/break.?glass|breakglass/i.test(profile), "the autonomous profile must not implement a break-glass path").toBe(false);
    // The emergency control and credential boundary are Owner-Authority, so Boss cannot weaken them either.
    for (const file of ["electron/emergency-control/emergency-stop.ts", "electron/credential-boundary/github-credential-provider.ts"]) {
      expect(isComponentPartOfTrustBoundary(file), file).toBe(true);
    }
    // An owner-authority action is denied to the autonomous actor unconditionally.
    expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "authorize-owner-authority" }).decision).toBe("DENY");
  });
});

describe("Root Trust Authority Lockdown — the qualification lane cannot be reached by untrusted code", () => {
  const WORKFLOW_DIR = path.join(PROJECT, ".github/workflows");
  const workflows = fs.readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith(".yml"));

  it("routes the real-soak labels from exactly one workflow, and uploads no corpus", () => {
    const usingRealSoak = workflows.filter((name) => fs.readFileSync(path.join(WORKFLOW_DIR, name), "utf8").includes("boss-real-soak"));
    expect(usingRealSoak, `only the qualification workflow may target the Owner's host, found: ${usingRealSoak.join(", ")}`).toEqual(["platform-qualification.yml"]);

    const workflow = fs.readFileSync(path.join(WORKFLOW_DIR, "platform-qualification.yml"), "utf8");
    const executed = workflow.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join("\n");

    // The real-host job fails closed on the wrong ref, the wrong runner class, and the wrong commit.
    for (const guard of ["refs/heads/main", "QUALIFICATION_REQUIRES_REAL_SOAK_HOST", "QUALIFICATION_REQUIRES_MAIN_HEAD", "QUALIFICATION_REQUIRES_LABEL"]) {
      expect(executed.includes(guard), `the real-host lane no longer fails closed on ${guard}`).toBe(true);
    }
    // Untrusted triggers stay out: no push, no pull_request in an executed line.
    expect(/^\s{2}pull_request:/m.test(executed), "the qualification workflow must not run on pull requests").toBe(false);
    expect(/^\s{2}push:/m.test(executed), "the qualification workflow must not run on push").toBe(false);

    // The upload may only take the redacted evidence directory, which lives OUTSIDE every corpus root.
    const uploadBlock = executed.slice(executed.indexOf("upload-artifact"));
    expect(uploadBlock.includes("runner.temp"), "the upload must come from the runner temp directory").toBe(true);
    const uploadPaths = uploadBlock.split(/\r?\n/).filter((line) => /path:/.test(line) || /runner\.temp/.test(line)).join("\n");
    for (const corpusRoot of ["artifacts/", "runtime-data", "history/", ".codex-boss"]) {
      expect(uploadPaths.includes(corpusRoot), `the upload path block mentions the corpus root ${corpusRoot}`).toBe(false);
    }

    // The evidence itself is produced in redacted mode.
    expect(executed.includes("--redacted"), "the provenance written for upload must be redacted").toBe(true);

    // B3 is enforced at run time, not remembered: the lane refuses to run where a self-hosted runner is
    // unsafe (a public repository), by measuring the platform rather than trusting whoever installed it.
    expect(executed.includes("--require-self-hosted-safe"), "the real-host lane no longer refuses an unsafe platform").toBe(true);

    // And the platform verdict itself is a measured fact.
    const platform = spawnSync(process.execPath, [path.join(PROJECT, "scripts/verify-authority-separation.cjs"), "--platform", "--json"], { cwd: PROJECT, encoding: "utf8" });
    expect(platform.status, `${platform.stdout}${platform.stderr}`).toBe(0);
    const report = JSON.parse(platform.stdout.slice(platform.stdout.indexOf("{")));
    expect(report.verdict.selfHostedRunnerSafe).toBe(report.repository.private);
    if (!report.repository.private) {
      expect(report.verdict.findings).toContain("PUBLIC_REPOSITORY_CANNOT_HOST_A_SELF_HOSTED_RUNNER");
      // …and the fail-closed mode must refuse, which is exactly what the workflow step relies on.
      const refused = spawnSync(process.execPath, [path.join(PROJECT, "scripts/verify-authority-separation.cjs"), "--platform", "--require-self-hosted-safe"], { cwd: PROJECT, encoding: "utf8" });
      expect(refused.status, "a public repository must refuse to host a self-hosted runner").toBe(1);
    }
    // The repository has exactly one always-bypass actor, and it is a User (the Owner): that is the fact the
    // whole separation rests on, so it is asserted rather than described.
    if (report.ruleset) {
      expect(report.ruleset.bypassActors.length).toBe(1);
      expect(report.ruleset.bypassActors[0].mode).toBe("always");
      expect(report.ruleset.bypassActors[0].type).toBe("User");
      expect(report.environments.some((entry: { name: string; rules: string[] }) => entry.name === "boss-root-trust-owner" && entry.rules.includes("required_reviewers"))).toBe(true);
    }
  });

  it("never emits a manifest in redacted mode, and offers a digest for quiescence", () => {
    const out = path.join(os.tmpdir(), `prov-redacted-${Date.now()}.json`);
    const run = spawnSync(process.execPath, [path.join(PROJECT, "scripts/qualification-corpus-provenance.cjs"), "--json", "--redacted", "--out", out], { cwd: PROJECT, encoding: "utf8" });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    const record = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(record.redacted).toBe(true);
    expect(record.manifest, "a redacted record must not carry the full manifest").toBeUndefined();
    expect(record.corpus.commitmentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.corpus.totalFiles).toBeGreaterThan(0);
    expect(record.corpus.perRoot.every((root: { files: number }) => typeof root.files === "number")).toBe(true);
    const digest = spawnSync(process.execPath, [path.join(PROJECT, "scripts/qualification-corpus-provenance.cjs"), "--digest"], { cwd: PROJECT, encoding: "utf8" });
    expect(digest.status).toBe(0);
    expect(digest.stdout.trim()).toMatch(/^[0-9a-f]{64}$/);
    fs.rmSync(out, { force: true });
  });
});

describe("Root Trust Authority Lockdown — the separation harness is itself verified (A4)", () => {
  it("proves the four verdicts offline, and reports UNPROVEN rather than a fake pass without a credential", () => {
    const script = path.join(PROJECT, "scripts/verify-authority-separation.cjs");
    // The instrument that measures `worker authority < owner authority` must be part of the boundary…
    expect(isComponentPartOfTrustBoundary("scripts/verify-authority-separation.cjs")).toBe(true);
    expect(decideAuthorityAction({ actor: AUTONOMOUS, action: "change", files: ["scripts/verify-authority-separation.cjs"] }).decision).toBe("REQUIRE_OWNER");

    // …and its own classification table must be exercised, or "proven" would be a word rather than a result.
    const selfCheck = spawnSync(process.execPath, [script, "--self-check"], { cwd: PROJECT, encoding: "utf8" });
    expect(selfCheck.status, `${selfCheck.stdout}${selfCheck.stderr}`).toBe(0);
    expect(selfCheck.stdout).toContain("self-check passed");

    // Live mode with no Boss credential configured: a safe STATUS, exit 0 — never a fake PROVEN, and never
    // a spurious failure. This is the state the repository is actually in today.
    const live = spawnSync(process.execPath, [script], { cwd: PROJECT, encoding: "utf8", env: { ...process.env, CODEX_BOSS_GITHUB_TOKEN: "", BOSS_GITHUB_TOKEN: "" } });
    expect(live.status).toBe(0);
    expect(live.stdout).toContain("UNPROVEN_NO_CREDENTIAL");
    expect(live.stdout).not.toContain("AUTHORITY_SEPARATION_PROVEN");
  });
});
