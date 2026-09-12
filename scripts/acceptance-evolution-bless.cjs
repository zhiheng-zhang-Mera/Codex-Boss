#!/usr/bin/env node
/**
 * Update-Plan/self-evlo.md §4 — the Trust Epoch bootstrap.
 *
 *   node scripts/acceptance-evolution-bless.cjs --check      # is the committed epoch still the live surface?
 *   node scripts/acceptance-evolution-bless.cjs --advance    # establish EPOCH_N+1 for the current surface
 *
 * §4 forbids a run from certifying a Root Trust change it made itself: the epoch is
 * therefore (re-)established by this separate, explicit step, and the commit that
 * carries the new epoch is the one a later CI run certifies. `--advance` never
 * rewrites history — it appends the next epoch with `parent_epoch_hash` pointing at
 * the previous record, and refreshes the machine-generated surface declaration.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = process.cwd();
const args = process.argv.slice(2);
const check = args.includes("--check");
const advance = args.includes("--advance");
const dist = path.join(root, "dist-electron");
const trustModule = path.join(dist, "src", "shared", "autonomous-evolution-trust.js");
const surfaceModule = path.join(dist, "electron", "engineering", "autonomous-evolution-surface.js");
const atomicModule = path.join(dist, "electron", "engineering", "atomic-file.js");
for (const file of [trustModule, surfaceModule, atomicModule]) {
  if (!fs.existsSync(file)) {
    console.error(`[bless] the built module is missing (run \`pnpm run build\` first): ${file}`);
    process.exit(1);
  }
}
const trust = require(trustModule);
const { collectRootSurfaceEntries } = require(surfaceModule);
const { writeFileAtomicSync } = require(atomicModule);

const surface = trust.rootSurfaceManifest(collectRootSurfaceEntries(root));
const epochFile = path.join(root, trust.TRUST_EPOCH_FILENAME);
const current = (() => { try { return JSON.parse(fs.readFileSync(epochFile, "utf8")); } catch { return undefined; } })();
const git = (argv) => { try { return execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim(); } catch { return ""; } };
const commit = git(["rev-parse", "HEAD"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

console.log(`[bless] root trust surface: ${surface.count} files, aggregate ${surface.aggregate_hash}`);
console.log(`[bless] repository: ${branch} @ ${commit}`);

if (check) {
  const problems = trust.verifyTrustEpochFile({ value: current, rootSurfaceHash: surface.aggregate_hash });
  if (problems.length === 0) {
    console.log(`[bless] epoch ${current.record.trust_epoch} (${current.record.root_contract_version}) MATCHES the live surface`);
    process.exit(0);
  }
  for (const problem of problems) console.error(`[bless] ${problem.code}${problem.detail ? `: ${problem.detail}` : ""}`);
  console.error("[bless] the committed epoch does not anchor the live Root Trust Surface; --advance establishes the next epoch");
  process.exit(1);
}

if (!advance) {
  console.error("[bless] nothing to do: pass --check or --advance");
  process.exit(2);
}

// §3: the declaration is byte-stable (no timestamp, no digest of itself) because it
// is part of the surface it describes — a self-referential file could never be
// anchored. Write it first, then measure the surface it belongs to.
const declaration = trust.declaredRootTrustSurface();
writeFileAtomicSync(path.join(root, trust.ROOT_TRUST_SURFACE_FILENAME), `${JSON.stringify(declaration, null, 2)}\n`);
const blessed = trust.rootSurfaceManifest(collectRootSurfaceEntries(root));
const next = trust.advanceTrustEpoch({ previous: current?.record ?? null, rootSurfaceHash: blessed.aggregate_hash, createdAt: new Date().toISOString() });
writeFileAtomicSync(epochFile, `${JSON.stringify(trust.trustEpochFile(next), null, 2)}\n`);
console.log(`[bless] epoch ${next.trust_epoch} (${next.root_contract_version}) established for ${blessed.aggregate_hash}`);
console.log(`[bless] parent ${next.parent_epoch_hash || "(genesis)"}`);
console.log("[bless] commit these two files with the change they describe, then let CI certify that commit");
