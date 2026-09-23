import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProtectedSurfaceGuard } from "../../../electron/root-authority/protected-surface-guard";
import { collectRootSurfaceEntries } from "../../../electron/engineering/autonomous-evolution-surface";
import {
  ROOT_SURFACE_HASH_EXCLUSIONS,
  TRUST_EPOCH_FILENAME,
  advanceTrustEpoch,
  classifySurface,
  declaredRootTrustSurface,
  rootSurfaceManifest,
  rootTrustSurfaceFiles,
  trustEpochFile,
  verifyTrustEpochFile,
  type RootSurfaceFile,
} from "../../../src/shared/autonomous-evolution-trust";
import { classifyAuthorityPath } from "../../../src/shared/root-authority/authority-planes";
import { assessProtectedPaths, codeownersPatternToRegExp, parseCodeownersPatterns } from "../../../src/shared/root-authority/protected-surface";

/**
 * Phase 1B-A — is the judge Owner-bound, and did the boundary stay narrow? (B1..B6, C1..C4, negative control)
 *
 * Specification: docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md sections 7 and 10 (PB-AC-09, PB-AC-10).
 *
 * The question this file answers is not "does a line exist in a file". A CODEOWNERS line that GitHub does not
 * match, or a trust-surface entry whose file the classifier never reaches, protects nothing while looking like
 * protection — so every case below is driven through the matchers the host actually uses:
 *
 *   classifySurface          the trust tier, from the trust module's own compiled rules
 *   classifyAuthorityPath     the authority plane, from the same boundary the promotion gate consults
 *   assessProtectedPaths      the compiled manifest AND the real .github/CODEOWNERS parsed with GitHub's
 *                            matching semantics
 *   ProtectedSurfaceGuard     the guard the promotion path constructs at boot
 *
 * And the other half of the claim is asserted too: the boundary must not have swallowed the repository. An
 * Owner gate that protects everything is as useless as one that protects nothing, so ordinary product code is
 * required to stay ordinary, and the surface hash is required to ignore it.
 */

const PROJECT = process.cwd();
const CODEOWNERS = path.join(PROJECT, ".github", "CODEOWNERS");
const CODEOWNERS_PATTERNS = parseCodeownersPatterns(fs.readFileSync(CODEOWNERS, "utf8"));
const GUARD = new ProtectedSurfaceGuard({ root: PROJECT });

/** The judge, its baselines, and the record that decides which baseline governs. */
const JUDGE_PATHS: ReadonlyArray<{ id: string; role: string; path: string }> = [
  { id: "B1", role: "the enforcement engine", path: "scripts/architecture-enforcement.cjs" },
  { id: "B2", role: "the accepted baseline", path: "config/architecture-enforcement-baseline.json" },
  { id: "B3", role: "the baseline generator", path: "scripts/architecture-enforcement-baseline.cjs" },
  { id: "B4", role: "the observatory sensor", path: "scripts/architecture-observatory.cjs" },
  { id: "B5", role: "the legacy architecture sensor", path: "scripts/architecture.cjs" },
  { id: "B6", role: "the baseline authorization record", path: "trust-policy/architecture-enforcement-baselines.json" },
  { id: "B7", role: "the authorizing series module", path: "scripts/architecture-baseline-series.cjs" },
  { id: "B8", role: "the legacy baseline and its only writer", path: "scripts/architecture-baseline.cjs" },
  { id: "B9", role: "the legacy ratchet baseline", path: "config/architecture-baseline.json" },
];

/** Ordinary paths that must stay in the autonomous plane: the negative control for every claim above. */
const ORDINARY_PATHS = [
  "src/renderer/App.tsx",
  "src/shared/knowledge.ts",
  "electron/knowledge/deep/new-file.ts",
  "electron/adapters/openai.ts",
  "scripts/architecture-phase1a-experiments.cjs",
  "config/capabilities/engineering.yaml",
  "tests/unit/city/architecture-enforcement.test.ts",
  "docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md",
  "README.md",
  "Update-Log.md",
];

describe("phase 1b-a: the judge is Owner-bound in BOTH boundaries (B1..B9)", () => {
  it.each(JUDGE_PATHS)("$id $role ($path) requires the Root Owner", ({ path: target }) => {
    // 1. the trust tier
    expect(classifySurface(target), `${target} must be Root Trust Surface`).toBe("ROOT_TRUST_SURFACE");
    // 2. the authority plane the promotion gate consults
    expect(classifyAuthorityPath(target).plane, `${target} must be in the Owner Authority plane`).toBe("OWNER_AUTHORITY");
    // 3. the compiled-in manifest, on its own
    const manifestOnly = assessProtectedPaths([target]);
    expect(manifestOnly.protected, `${target} must be protected by the compiled manifest`).toBe(true);
    expect(
      manifestOnly.hits.every((hit) => hit.source === "immutable-manifest"),
      `${target}: the manifest-only assessment must not depend on CODEOWNERS being read`,
    ).toBe(true);
    // 4. the REAL .github/CODEOWNERS, matched with GitHub's own semantics. Tested through the pattern compiler
    //    directly rather than through the union: `assessProtectedPaths` stops at the first matching rule, and
    //    the manifest is compiled first, so a hit's `source` says nothing about whether CODEOWNERS also covers
    //    the path. A pattern list that only LOOKS right would pass a substring search and fail this.
    const ownersPatterns = CODEOWNERS_PATTERNS.filter((pattern) => codeownersPatternToRegExp(pattern).test(target));
    expect(ownersPatterns, `${target} must be matched by a pattern that exists in .github/CODEOWNERS`).not.toEqual([]);
    // Either a line names this exact file, or a pre-existing directory rule already covers it
    // (`/trust-policy/`). A blanket `/scripts/` or `/config/` rule is NOT acceptable and would fail here.
    const exact = `/${target}`;
    const directory = `/${target.split("/")[0]}/`;
    expect(
      ownersPatterns.some((pattern) => pattern === exact || pattern === directory),
      `${target} matched only by ${ownersPatterns.join(", ")}, which is neither the exact path nor a pre-existing directory rule`,
    ).toBe(true);
    // 5. the guard the promotion path actually constructs
    expect(GUARD.assessChangeSet([target]).decision, `${target} must be REQUIRE_OWNER`).toBe("REQUIRE_OWNER");
  });

  it("the protection comes from a pattern, not from a comment: the matched rule is inspectable", () => {
    for (const { path: target } of JUDGE_PATHS) {
      const ownersPatterns = CODEOWNERS_PATTERNS.filter((pattern) => codeownersPatternToRegExp(pattern).test(target));
      expect(ownersPatterns.length, `${target} produced no CODEOWNERS match at all`).toBeGreaterThan(0);
      for (const pattern of ownersPatterns) expect(pattern.startsWith("/")).toBe(true);
    }
    // A pattern list that matched everything would pass every assertion above for the wrong reason.
    const everything = ORDINARY_PATHS.some((target) => CODEOWNERS_PATTERNS.some((pattern) => codeownersPatternToRegExp(pattern).test(target)));
    expect(everything, "CODEOWNERS must not have a pattern that matches ordinary product code").toBe(false);
  });

  it("the boundary stayed narrow: ordinary product code is not Owner-gated, and the judge list is finite", () => {
    for (const target of ORDINARY_PATHS) {
      expect(assessProtectedPaths([target]).protected, `${target} must not be Owner-gated`).toBe(false);
      expect(GUARD.assessChangeSet([target]).decision, `${target} must stay autonomous (or at most verification surface)`).not.toBe("REQUIRE_OWNER");
    }
    // The judge list is a list of files, not a directory sweep: no `/config/` or `/scripts/` blanket rule.
    const patterns = GUARD.patterns().map((rule) => rule.pattern);
    expect(patterns).not.toContain("*");
    expect(patterns).not.toContain("/*");
    expect(patterns).not.toContain("/");
    expect(patterns).not.toContain("/config/");
    expect(patterns).not.toContain("/scripts/");
  });
});

describe("phase 1b-a: the Root Trust Surface moved with the boundary (C1, C2)", () => {
  const inventory = collectRootSurfaceEntries(PROJECT);
  const live = rootSurfaceManifest(inventory);
  const liveFiles = rootTrustSurfaceFiles(inventory);

  it("C1 every protected enforcement surface is INSIDE the surface, and each one moves the aggregate", () => {
    for (const { path: target, role } of JUDGE_PATHS) {
      const present = liveFiles.some((entry) => entry.path.toLowerCase() === target.toLowerCase());
      expect(present, `${target} (${role}) is not in the Root Trust inventory, so its edits would not move the epoch`).toBe(true);
    }
    // One changed byte in any of them changes the aggregate — measured, not argued.
    for (const { path: target } of JUDGE_PATHS) {
      const tampered: RootSurfaceFile[] = inventory.map((entry) =>
        entry.path.toLowerCase() === target.toLowerCase() ? { path: entry.path, sha256: "f".repeat(64) } : entry,
      );
      const after = rootSurfaceManifest(tampered);
      expect(after.aggregate_hash, `changing ${target} must move the Root Trust aggregate`).not.toBe(live.aggregate_hash);
    }
    // The exclusion list is exactly the epoch record, and nothing the judge depends on.
    expect(ROOT_SURFACE_HASH_EXCLUSIONS).toEqual([TRUST_EPOCH_FILENAME]);
    expect(liveFiles.some((entry) => JUDGE_PATHS.some((judge) => judge.path.toLowerCase() === entry.path.toLowerCase()))).toBe(true);
  });

  it("C1b an ordinary file does not move the aggregate, even added to the inventory by hand", () => {
    const withOrdinary: RootSurfaceFile[] = [...inventory, { path: "src/app/brand-new-ordinary.ts", sha256: "a".repeat(64) }];
    expect(rootSurfaceManifest(rootTrustSurfaceFiles(withOrdinary)).aggregate_hash).toBe(live.aggregate_hash);
  });

  it("C2 the surface list itself is Root Trust, and so is the declaration it generates", () => {
    // The trust module and the data it declares are Root Trust Surface...
    for (const target of ["src/shared/autonomous-evolution-trust.ts", "trust-policy/root-trust-surface.json", "trust-policy/trust-epoch.json"]) {
      expect(classifySurface(target), target).toBe("ROOT_TRUST_SURFACE");
      expect(GUARD.assessChangeSet([target]).decision, target).toBe("REQUIRE_OWNER");
    }
    // ...and the review boundary that enforces all of it is Owner-gated too, at the verification tier rather
    // than the trust tier (measured: VERIFICATION_SURFACE, and `.github/**` is in that tier by construction).
    expect(classifySurface(".github/CODEOWNERS")).toBe("VERIFICATION_SURFACE");
    expect(GUARD.assessChangeSet([".github/CODEOWNERS"]).decision).toBe("REQUIRE_OWNER");
    // The committed declaration is the module's own generator output, byte for byte — so a hand edit is refused.
    const committed = JSON.parse(fs.readFileSync(path.join(PROJECT, "trust-policy", "root-trust-surface.json"), "utf8")) as unknown;
    expect(committed).toEqual(declaredRootTrustSurface());
    for (const { path: target } of JUDGE_PATHS) {
      // Covered by the DECLARATION, which may be a literal file or a glob (`trust-policy/**`) — the
      // declaration is a pattern list, so coverage is decided by the same matcher, not by string equality.
      const declared = declaredRootTrustSurface().declared.paths;
      expect(
        declared.some((pattern) => codeownersPatternToRegExp(pattern).test(target)),
        `${target} must be covered by the surface DECLARATION`,
      ).toBe(true);
    }
  });
});

describe("phase 1b-a: the epoch (C3, C4) — the machine may prepare, and may not finalize", () => {
  const inventory = collectRootSurfaceEntries(PROJECT);
  const live = rootSurfaceManifest(inventory);
  const epochPath = path.join(PROJECT, TRUST_EPOCH_FILENAME);

  it("C3 a stale or forged epoch cannot certify this surface", () => {
    const committed = JSON.parse(fs.readFileSync(epochPath, "utf8")) as { record: { trust_epoch: number; root_contract_version: string; root_surface_hash: string; parent_epoch_hash: string; created_at: string } };
    const forged = trustEpochFile({
      trust_epoch: committed.record.trust_epoch,
      root_contract_version: committed.record.root_contract_version,
      root_surface_hash: "f".repeat(64),
      parent_epoch_hash: committed.record.parent_epoch_hash,
      created_at: committed.record.created_at,
    });
    const problems = verifyTrustEpochFile({ value: forged, rootSurfaceHash: live.aggregate_hash });
    expect(problems.map((problem) => problem.code)).toContain("TRUST_EPOCH_ROOT_SURFACE_MISMATCH");
    // An epoch that does NOT match the live surface must never verify as anchoring it.
    expect(problems.length).toBeGreaterThan(0);
  });

  it("C4 the prepared candidate chains to the committed epoch, and preparing it writes nothing", () => {
    const before = fs.readFileSync(epochPath, "utf8");
    const committed = JSON.parse(before) as { record: { trust_epoch: number; root_contract_version: string; root_surface_hash: string; parent_epoch_hash: string; created_at: string }; epoch_hash: string };
    const candidate = advanceTrustEpoch({
      previous: committed.record,
      rootSurfaceHash: live.aggregate_hash,
      createdAt: "2026-09-22T00:00:00.000Z",
    });
    // The chain is append-only and parent-linked: the candidate names the committed epoch as its parent.
    expect(candidate.trust_epoch).toBe(committed.record.trust_epoch + 1);
    expect(candidate.parent_epoch_hash).toBe(committed.epoch_hash);
    // And the candidate DOES anchor the extended surface, which is the whole point of the ceremony.
    expect(verifyTrustEpochFile({ value: trustEpochFile(candidate), rootSurfaceHash: live.aggregate_hash })).toEqual([]);
    // The machine may compute that candidate. It may not write it: the epoch file is byte-identical after.
    expect(fs.readFileSync(epochPath, "utf8")).toBe(before);
    // Stated as an invariant rather than as today's value: an unanchored committed epoch is a refusal, and
    // whether the committed epoch currently anchors the surface is a fact about the ceremony's progress.
    const committedProblems = verifyTrustEpochFile({ value: committed, rootSurfaceHash: live.aggregate_hash });
    expect(committedProblems.map((problem) => problem.code).every((code) => code === "TRUST_EPOCH_ROOT_SURFACE_MISMATCH")).toBe(true);
  });
});
