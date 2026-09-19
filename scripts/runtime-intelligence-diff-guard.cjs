#!/usr/bin/env node
/**
 * The mandatory diff guard, run as a script over the COMPLETE change set of one branch.
 *
 * It calls the repository's real boundaries rather than a private pattern:
 *
 *   - `assessProtectedPaths` and `ProtectedSurfaceGuard` for the Owner-review boundary
 *     (the immutable manifest plus the parsed `.github/CODEOWNERS`),
 *   - `deriveChangeClass` for the authority plane,
 *   - `classifySurface` for the Root Trust Surface aggregate.
 *
 * Exits non-zero if any changed path needs Owner review, escapes the repository, or is
 * classified above PRODUCT_SURFACE. Run after `pnpm run build`, because it loads the
 * compiled modules out of `dist-electron/`.
 *
 *   node scripts/runtime-intelligence-diff-guard.cjs [--base <sha>]
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function load(relative) {
  return require(path.join(ROOT, "dist-electron", ...relative.split("/")));
}

function changedFilesSince(base) {
  return execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: ROOT, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
}

/**
 * Assesses a branch's change set with the repository's own boundaries.
 *
 * Exported so the evaluation report can state its boundary facts from the SAME assessment the
 * guard enforces, rather than restating the rule in a second place.
 */
function assessBranchBoundary(base = "origin/main") {
  const changed = changedFilesSince(base);

  const { assessProtectedPaths } = load("src/shared/root-authority/protected-surface.js");
  const { CHANGE_CLASSES, decideAuthorityAction, deriveChangeClass } = load("src/shared/root-authority/authority-planes.js");
  const { classifySurface } = load("src/shared/autonomous-evolution-trust.js");
  const { ProtectedSurfaceGuard } = load("electron/root-authority/protected-surface-guard.js");

  const guard = new ProtectedSurfaceGuard({ root: ROOT });
  const surfaces = changed.map((file) => ({ file, surface: classifySurface(file) }));
  const ownerReview = changed.filter((file) => guard.assessChangeSet([file]).decision === "REQUIRE_OWNER");
  const denied = changed.filter((file) => guard.assessChangeSet([file]).decision === "DENY");
  const assessment = assessProtectedPaths(changed);
  const authorityChangeClass = deriveChangeClass(changed);
  const rootTrustPaths = surfaces.filter((entry) => entry.surface === "ROOT_TRUST_SURFACE");

  /**
   * The authoritative decision, not a private opinion about it: the same function the
   * trust model uses, asked whether an autonomous actor may make this change.
   *
   * Its rule is that a change is autonomous below `ROOT_TRUST_CHANGE`. Test files classify
   * as VERIFICATION_SURFACE (privileged, class 1) and are still autonomous, which is why
   * this script asks the decision function rather than requiring class 0.
   */
  const authority = decideAuthorityAction({ actor: "autonomous", action: "change", files: changed });

  const firstClass = Object.entries(CHANGE_CLASSES).find(([, value]) => value === authorityChangeClass);
  const problems = [
    ...(authority.decision !== "ALLOW" ? [`authority decision ${authority.decision}: ${authority.reasons.join("; ")}`] : []),
    ...(ownerReview.length > 0 ? [`paths requiring Owner review: ${ownerReview.join(", ")}`] : []),
    ...(denied.length > 0 ? [`denied paths: ${denied.join(", ")}`] : []),
    ...(assessment.escapes.length > 0 ? [`path escapes: ${assessment.escapes.join(", ")}`] : []),
    ...(rootTrustPaths.length > 0 ? [`Root Trust Surface paths changed: ${rootTrustPaths.map((entry) => entry.file).join(", ")}`] : [])
  ];

  return {
    base,
    changedFiles: changed.length,
    protectedSurfaceDecision: guard.assessChangeSet(changed).decision,
    ownerReviewPaths: ownerReview,
    deniedPaths: denied,
    protectedHits: assessment.hits.map((hit) => `${hit.path} (${hit.rule}, ${hit.source})`),
    escapes: assessment.escapes,
    authority: {
      action: authority.action,
      actor: authority.actor,
      decision: authority.decision,
      plane: authority.plane,
      changeClass: `${firstClass ? firstClass[0] : "UNKNOWN"} (${authorityChangeClass})`,
      reasons: authority.reasons
    },
    rootTrustSurfacePathsChanged: rootTrustPaths.map((entry) => entry.file),
    qualificationPathsTouched: changed.filter((file) => QUALIFICATION_SURFACE_PATHS.includes(file)),
    verificationSurfacePaths: surfaces.filter((entry) => entry.surface === "VERIFICATION_SURFACE").map((entry) => entry.file),
    verdict: problems.length === 0 ? "ORDINARY_AUTONOMOUS_CHANGE" : "BLOCKED_BY_ROOT_TRUST_BOUNDARY",
    problems
  };
}

/**
 * The files that DECIDE qualification semantics: the qualification workflow, the tier
 * declarations that name which suites the qualification tier is, and the qualification vitest
 * config. A change to any of them changes what qualification means, which is the question the
 * report has to answer honestly. This is a definition, not a heuristic list.
 */
const QUALIFICATION_SURFACE_PATHS = [".github/workflows/platform-qualification.yml", "vitest.tiers.mjs", "vitest.qualification.config.mjs"];

module.exports = { assessBranchBoundary, QUALIFICATION_SURFACE_PATHS };

function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : "origin/main";
  const report = assessBranchBoundary(base);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.verdict === "ORDINARY_AUTONOMOUS_CHANGE" ? 0 : 1;
}

if (require.main === module) main();
