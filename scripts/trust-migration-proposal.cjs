#!/usr/bin/env node
/**
 * Trust migration PROPOSAL generator (Root Trust Authority Lockdown, Phase A5 STAGE A).
 *
 *   node scripts/trust-migration-proposal.cjs [--out <file>] [--reason <text>] [--risk <text>] [--rollback <text>]
 *
 * Stage A of a trust migration is AUTONOMOUS and this script is the whole of it: it MEASURES the current
 * epoch against the live Root Trust Surface, computes what the next epoch would be, lists the root-trust
 * files that changed since the epoch was last written, and writes a proposal document. It is the machine
 * form of "Boss may prepare a migration candidate".
 *
 * STAGE A MUST NOT CHANGE THE REAL EPOCH. This script therefore never writes to `trust-policy/**`: it
 * computes the candidate record with the trust module's own `advanceTrustEpoch` (a pure function) and
 * puts it in the proposal. The write happens only in `.github/workflows/trust-epoch-finalization.yml`,
 * in a job that targets the `boss-root-trust-owner` protected environment, after the Owner has approved
 * it. `tests/unit/root-trust-authority-lockdown.test.ts` asserts that running this script leaves the
 * committed epoch byte-identical, because a "proposal" that quietly advanced the epoch would be the
 * bypass the whole lockdown exists to close.
 *
 * Exit code is 0 whether or not a migration is needed: "no migration required" is a result, not an error.
 * `needsMigration=false` is what the finalization workflow branches on.
 */

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = process.cwd();
const args = process.argv.slice(2);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
};
const out = valueOf("--out") ? path.resolve(valueOf("--out")) : path.join(root, "artifacts", "platform-foundation", "trust", "trust-migration-proposal.json");

const dist = path.join(root, "dist-electron");
const trustModule = path.join(dist, "src", "shared", "autonomous-evolution-trust.js");
const surfaceModule = path.join(dist, "electron", "engineering", "autonomous-evolution-surface.js");
for (const file of [trustModule, surfaceModule]) {
  if (!fs.existsSync(file)) {
    console.error(`[proposal] the built module is missing (run \`pnpm run build\` first): ${file}`);
    process.exit(1);
  }
}
const trust = require(trustModule);
const { collectRootSurfaceEntries } = require(surfaceModule);

const git = (argv) => {
  try { return execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim(); } catch { return ""; }
};

const inventory = collectRootSurfaceEntries(root);
const surface = trust.rootSurfaceManifest(inventory);
const epochFile = path.join(root, trust.TRUST_EPOCH_FILENAME);
const epochValue = (() => { try { return JSON.parse(fs.readFileSync(epochFile, "utf8")); } catch { return undefined; } })();
const problems = trust.verifyTrustEpochFile({ value: epochValue, rootSurfaceHash: surface.aggregate_hash });
const currentEpoch = epochValue?.record ?? null;
const candidate = trust.advanceTrustEpoch({
  previous: currentEpoch,
  rootSurfaceHash: surface.aggregate_hash,
  createdAt: new Date().toISOString()
});

/**
 * The root-trust files that changed since the epoch was last committed.
 *
 * Derived from git rather than guessed: the last commit that touched the epoch file is the baseline, and
 * every changed path the trust model classifies as Root Trust Surface is reported. This is the "which
 * files are the authorised root-trust change" question the Owner has to be able to answer before approving.
 */
const base = git(["log", "-1", "--format=%H", "--", trust.TRUST_EPOCH_FILENAME]) || git(["rev-parse", "HEAD"]);
const changedSinceEpoch = (git(["diff", "--name-only", `${base}..HEAD`]) || "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => trust.classifySurface(file) === "ROOT_TRUST_SURFACE");

const proposal = {
  $comment:
    "Root Trust Authority Lockdown Phase A5 STAGE A: an autonomous TRUST_MIGRATION_PROPOSAL. This document " +
    "is a request, never an authorisation. It does not change the committed epoch; only an Owner-approved run " +
    "of .github/workflows/trust-epoch-finalization.yml (environment boss-root-trust-owner) may do that.",
  schemaVersion: 1,
  stage: "STAGE_A_AUTONOMOUS_PROPOSAL",
  authorized: false,
  generatedAt: new Date().toISOString(),
  repository: { commit: git(["rev-parse", "HEAD"]), branch: git(["rev-parse", "--abbrev-ref", "HEAD"]), epochBaselineCommit: base },
  currentEpoch: currentEpoch
    ? { trust_epoch: currentEpoch.trust_epoch, root_contract_version: currentEpoch.root_contract_version, root_surface_hash: currentEpoch.root_surface_hash, epoch_hash: epochValue?.epoch_hash ?? null }
    : null,
  candidateEpoch: {
    trust_epoch: candidate.trust_epoch,
    root_contract_version: candidate.root_contract_version,
    root_surface_hash: candidate.root_surface_hash,
    parent_epoch_hash: candidate.parent_epoch_hash
  },
  surface: {
    digest: surface.aggregate_hash,
    fileCount: surface.count,
    digestAlgorithm: "sha256 over the canonical CRLF-normalised manifest text",
    currentEpochAnchorsLiveSurface: problems.length === 0,
    problems: problems.map((problem) => ({ code: problem.code, detail: problem.detail ?? null }))
  },
  needsMigration: problems.length > 0,
  changedRootTrustFiles: changedSinceEpoch,
  affectedCapabilities: {
    note:
      "Not inferred here. A root-trust change is judged by the gates it can move, not by a capability map; the " +
      "Owner's approval decision rests on the file list and the digest above.",
    qualificationGates: ["acceptance:autonomous-evolution (graduation)", "test:platform-qualification", "verify:targeted"]
  },
  testResults: {
    note:
      "Recorded by the finalization run that carries the epoch, not by this proposal: a proposal that carried " +
      "test results the proposer had not run would be exactly the kind of self-reported evidence the gates exist " +
      "to reject."
  },
  reason: valueOf("--reason") ?? "(not supplied)",
  risk: valueOf("--risk") ?? "(not supplied)",
  rollback: valueOf("--rollback") ?? "restore the previous trust-policy/trust-epoch.json from git; the epoch chain is append-only and parent-linked, so a reverted epoch simply re-anchors the previous surface",
  proposedMetadata: {
    writes: ["trust-policy/trust-epoch.json"],
    declarationRewrittenIdentically: true,
    note: "the surface declaration is byte-stable (no timestamp, no self-digest); only the epoch record changes when no path was added or removed"
  }
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
process.stdout.write(`[proposal] epoch ${currentEpoch?.trust_epoch ?? "(none)"} -> ${candidate.trust_epoch} for surface ${surface.aggregate_hash}\n`);
process.stdout.write(`[proposal] needsMigration=${proposal.needsMigration} changedRootTrustFiles=${changedSinceEpoch.length}\n`);
process.stdout.write(`[proposal] wrote ${path.relative(root, out).split(path.sep).join("/")}\n`);
process.stdout.write(`[proposal] stage A only: the committed epoch is unchanged\n`);
