#!/usr/bin/env node
/**
 * Capability City Phase 1A — grandfathered-debt baseline generator.
 *
 * Specification (normative): docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md, sections 5 and 6.
 *
 * WHAT THIS FILE MEANS
 *   THESE RELATIONS EXISTED BEFORE ENFORCEMENT
 * and NOT
 *   THESE RELATIONS ARE HEALTHY
 *
 * Identity is authoritative; counts are summaries. The baseline therefore records every tracked source file's
 * ownership and every resolved internal edge as an identity, not as a number, so that enforcement can tell a
 * grandfathered relation from a new one. A count-only baseline would let an attacker add debt while removing
 * the same amount of debt elsewhere (see ENF-17).
 *
 * DETERMINISM
 *   No timestamp is written into the tracked baseline, so regenerating it at the same commit is byte-identical.
 *   That is what makes ENF-16 a real check rather than a tolerance. Volatile metadata (wall time, host) goes to
 *   the runtime record artifacts/city/phase1/baseline-generation.json instead.
 *
 * USAGE
 *   node scripts/architecture-enforcement-baseline.cjs --reason "..."      regenerate
 *   node scripts/architecture-enforcement-baseline.cjs --check             is the committed baseline current?
 *   node scripts/architecture-enforcement-baseline.cjs --out <path>        write elsewhere (tests)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { parse: parseYaml } = require("yaml");

const observatory = require("./architecture-observatory.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(ROOT, "config", "architecture-enforcement-baseline.json");
const RUNTIME_RECORD = path.join(ROOT, "artifacts", "city", "phase1", "baseline-generation.json");
const SCHEMA = "city-architecture-enforcement-baseline/1";
const SENSOR_IMPLEMENTATION = "scripts/architecture-observatory.cjs";

/** Unresolved-reference classes. Phase 0's own reason strings are preserved alongside them, never rewritten. */
const NON_SOURCE_ASSET = "NON_SOURCE_ASSET";
const SOURCE_TARGET_MISSING = "SOURCE_TARGET_MISSING";
const UNSUPPORTED_SOURCE_RESOLUTION = "UNSUPPORTED_SOURCE_RESOLUTION";
const OTHER_UNKNOWN = "OTHER_UNKNOWN";

/** Defect classes Phase 1A does not model. Enforcement must label them, never call them clean (policy E-10). */
const NOT_YET_ENFORCED = [
  "dependency_cycles",
  "cross_domain_private_state_access",
  "bundle_structure_or_district_shape",
  "layer_or_depth_violations",
  "runtime_dependency_not_visible_in_source",
];

function classifyUnresolved(item) {
  switch (item.reason) {
    case "non-source-extension":
      return NON_SOURCE_ASSET;
    case "no-tracked-candidate":
    case "root-relative-no-candidate":
      return SOURCE_TARGET_MISSING;
    case "unsupported-resolution":
    case "computed-specifier":
      return UNSUPPORTED_SOURCE_RESOLUTION;
    default:
      return OTHER_UNKNOWN;
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function git(root, argv) {
  return execFileSync("git", argv, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).trim();
}

function listTracked(root) {
  return git(root, ["ls-files", "-z"]).split("\0").filter(Boolean).map((entry) => entry.split(path.sep).join("/")).sort();
}

function loadOwnership(root) {
  const dir = path.join(root, "config", "capabilities");
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(ya?ml|json)$/i.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  const manifests = files.map((file) =>
    observatory.parseManifestText(path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8"))
  );
  return { ownership: observatory.ownershipFromManifests(manifests), manifestCount: manifests.length };
}

/**
 * Measure the tree and build the baseline content. Pure with respect to the filesystem apart from reading the
 * scan set, so a test can point it at the same tree and compare byte-for-byte.
 */
function buildBaseline({ root = ROOT, reason = "", parentBaselineHash = null, baselineVersion = 1, prior = null, sourceCommit = null } = {}) {
  const tracked = listTracked(root);
  const scanSet = observatory.selectScanSet(tracked);
  const trackedSet = new Set(scanSet);
  const { ownership, manifestCount } = loadOwnership(root);

  const graph = observatory.buildObserverGraph({
    root,
    files: scanSet,
    trackedSet,
    ownership,
    readFile: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
  });

  const semantic = {
    scan: { roots: observatory.SCAN_ROOTS, source: "git ls-files", tracked_source_files: scanSet.length },
    ownership: {
      manifests: manifestCount,
      declared_modules: ownership.declaredModules.size,
      declared_owned_files: scanSet.filter((file) => ownership.moduleOwner.has(file)).length,
      undeclared_files: scanSet.filter((file) => !ownership.moduleOwner.has(file)).length,
      conflicts: ownership.conflicts,
    },
    edges: graph.edges.length,
    unresolved: graph.unresolved.length,
  };

  const files = {};
  for (const file of scanSet) files[file] = ownership.moduleOwner.get(file) ?? observatory.OWNER_UNDECLARED;

  const edges = graph.edges.map((edge) => [edge.from, edge.to]);

  // E-03 / ENF-18: the series remembers what an ACCEPTED baseline retired, so a relation that comes back can be
  // labelled as a reintroduction rather than mistaken for something that never existed. It is carried forward
  // across regenerations (retired stays retired until the edge actually returns), which is what makes
  // "reintroduced is new, never eternally grandfathered" enforceable rather than a slogan.
  const currentPairs = new Set(edges.map((edge) => `${edge[0]}\u0000${edge[1]}`));
  const priorPairs = [...(prior?.edges ?? []), ...(prior?.retired_edges ?? [])];
  const retiredSeen = new Set();
  const retired = [];
  for (const pair of priorPairs) {
    const key = `${pair[0]}\u0000${pair[1]}`;
    if (currentPairs.has(key) || retiredSeen.has(key)) continue;
    retiredSeen.add(key);
    retired.push([pair[0], pair[1]]);
  }
  retired.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));

  const unresolved = graph.unresolved
    .map((item) => ({
      from: item.from,
      specifier: item.specifier,
      phase0_reason: item.reason,
      classification: classifyUnresolved(item),
    }))
    .sort((a, b) => (a.from === b.from ? (a.specifier < b.specifier ? -1 : 1) : a.from < b.from ? -1 : 1));

  const unresolvedByClass = {
    [NON_SOURCE_ASSET]: 0,
    [SOURCE_TARGET_MISSING]: 0,
    [UNSUPPORTED_SOURCE_RESOLUTION]: 0,
    [OTHER_UNKNOWN]: 0,
  };
  for (const item of unresolved) unresolvedByClass[item.classification] += 1;

  const content = {
    schema: SCHEMA,
    baseline_version: baselineVersion,
    parent_baseline_hash: parentBaselineHash,
    // Provenance is an input so that --check can hold it fixed. Otherwise the recorded commit would change the
    // moment the baseline is committed, and "regeneration is reproducible" would be true only at the instant of
    // generation — which is not a property worth having. The content identity is what --check actually verifies.
    source_commit: sourceCommit ?? git(root, ["rev-parse", "HEAD"]),
    generated_by: 'node scripts/architecture-enforcement-baseline.cjs --reason "<reason>"',
    reason,
    sensor: {
      spec_path: "docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md",
      spec_commit: observatory.SPEC_COMMIT,
      implementation_path: SENSOR_IMPLEMENTATION,
      implementation_sha256: sha256(fs.readFileSync(path.join(root, SENSOR_IMPLEMENTATION), "utf8")),
      scan_set_hash: sha256(scanSet.join("\n")),
      semantic: semantic,
    },
    scan: { roots: observatory.SCAN_ROOTS, source: "git ls-files", tracked_source_files: scanSet.length, scan_set_hash: sha256(scanSet.join("\n")) },
    ownership: {
      manifests: manifestCount,
      declared_modules: ownership.declaredModules.size,
      declared_owned_files: semantic.ownership.declared_owned_files,
      undeclared_files: semantic.ownership.undeclared_files,
      conflicts: ownership.conflicts,
    },
    files,
    edges,
    retired_edges: retired,
    unresolved,
    unresolved_by_class: unresolvedByClass,
    not_yet_enforced: NOT_YET_ENFORCED,
    counts: {
      note: "SUMMARIES ONLY. Identity above is authoritative; counts are never the ratchet.",
      tracked_source_files: scanSet.length,
      declared_owned_files: semantic.ownership.declared_owned_files,
      undeclared_files: semantic.ownership.undeclared_files,
      internal_edges: edges.length,
      unresolved_references: unresolved.length,
    },
  };

  // The hash covers the content without the hash field itself, so it is a stable identity for this baseline.
  const baselineHash = sha256(observatory.canonicalJson(content));
  return { baseline: { ...content, baseline_hash: baselineHash }, baselineHash };
}

function serialize(baseline) {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const existing = (() => {
    try { return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")); } catch { return undefined; }
  })();
  // Refresh the runtime generation record for the CURRENTLY COMMITTED baseline without touching it. Needed
  // because a rejected regeneration attempt overwrites the record while the tracked file is reverted, which
  // would otherwise leave the runtime evidence describing a baseline that does not exist. Regenerating the
  // tracked file is a deliberate act; refreshing its record is not.
  const recordOnly = argv.includes("--record-only");
  const reasonIndex = argv.indexOf("--reason");
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : BASELINE_PATH;
  const reason =
    reasonIndex >= 0 && argv[reasonIndex + 1]
      ? argv[reasonIndex + 1]
      : "Phase 1A initial grandfathered-debt baseline: every relation the qualified sensor measured at the promoted Phase 0 state is debt that existed before enforcement.";

  if (recordOnly) {
    if (!existing) {
      process.stderr.write("--record-only requires an existing committed baseline\n");
      return 1;
    }
    const started = Date.now();
    const { baseline: recomputed, baselineHash } = buildBaseline({
      reason: existing.reason,
      baselineVersion: existing.baseline_version,
      parentBaselineHash: existing.parent_baseline_hash ?? null,
      prior: { edges: existing.edges ?? [], retired_edges: existing.retired_edges ?? [] },
      sourceCommit: existing.source_commit,
    });
    const matches = recomputed.baseline_hash === baselineHash && baselineHash === existing.baseline_hash;
    const record = {
      schema: `${SCHEMA}#generation`,
      generatedAt: new Date().toISOString(),
      wall_time_ms: Date.now() - started,
      output_path: path.relative(ROOT, BASELINE_PATH).split(path.sep).join("/"),
      output_bytes: fs.statSync(BASELINE_PATH).size,
      reason: existing.reason,
      baseline_version: existing.baseline_version,
      parent_baseline_hash: existing.parent_baseline_hash ?? null,
      baseline_hash: existing.baseline_hash,
      source_commit: existing.source_commit,
      record_only_refresh: true,
      content_reverified_against_tree: matches,
      semantics: {
        means: "THESE RELATIONS EXISTED BEFORE ENFORCEMENT",
        does_not_mean: "THESE RELATIONS ARE HEALTHY",
        identity_is_authoritative: true,
        counts_are_summaries: true,
      },
    };
    fs.mkdirSync(path.dirname(RUNTIME_RECORD), { recursive: true });
    fs.writeFileSync(RUNTIME_RECORD, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ state: "RUNTIME_RECORD_REFRESHED", baseline_version: record.baseline_version, baseline_hash: record.baseline_hash, content_reverified_against_tree: matches }, null, 2)}\n`);
    return matches ? 0 : 1;
  }

  const started = Date.now();

  // Series identity is an INPUT, not something recomputed from the file being checked. Recomputing it is how the
  // first revision of this generator made --check report a false mismatch: a normal regeneration bumps the
  // version and adopts the previous baseline_hash as its parent, so deriving those from the current file and
  // then comparing would never match. In check mode the committed file's own version and parent are held fixed
  // and only the measured content is recomputed.
  const version = check
    ? (existing && Number.isInteger(existing.baseline_version) ? existing.baseline_version : 1)
    : (existing && Number.isInteger(existing.baseline_version) ? existing.baseline_version + 1 : 1);
  const parent = check
    ? (existing ? existing.parent_baseline_hash ?? null : null)
    : (existing ? existing.baseline_hash ?? null : null);
  const effectiveReason = check && existing && typeof existing.reason === "string" ? existing.reason : reason;

  const { baseline, baselineHash } = buildBaseline({
    reason: effectiveReason,
    baselineVersion: version,
    parentBaselineHash: parent,
    prior: existing ? { edges: existing.edges ?? [], retired_edges: existing.retired_edges ?? [] } : null,
    sourceCommit: check && existing && typeof existing.source_commit === "string" ? existing.source_commit : null,
  });
  const text = serialize(baseline);

  if (check) {
    // Line endings are a checkout property, not baseline content: git checks this file out with CRLF on
    // Windows (core.autocrlf=true, no .gitattributes), while the generator writes LF. The first revision
    // compared raw text and therefore reported a false mismatch for every fresh clone on this platform — the
    // same CRLF trap the Phase 0 record already documents for the pre-city freeze manifest. Comparison is
    // therefore normalised, and an independent canonical-hash comparison is reported alongside it.
    const normalize = (text) => text.replace(/\r\n/g, "\n");
    const current = fs.existsSync(BASELINE_PATH) ? fs.readFileSync(BASELINE_PATH, "utf8") : null;
    const identical = current !== null && normalize(current) === normalize(text);
    const hashMatches = Boolean(existing) && existing.baseline_hash === baselineHash;
    const summary = {
      mode: "check",
      path: BASELINE_PATH,
      exists: current !== null,
      identical,
      recorded_baseline_hash: existing?.baseline_hash ?? null,
      recomputed_baseline_hash: baselineHash,
      hash_matches: hashMatches,
      line_endings_normalised_for_comparison: true,
      baseline_version: baseline.baseline_version,
      tracked_source_files: baseline.counts.tracked_source_files,
      internal_edges: baseline.counts.internal_edges,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return identical && hashMatches ? 0 : 1;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text, "utf8");

  const runtime = {
    schema: `${SCHEMA}#generation`,
    generatedAt: new Date().toISOString(),
    wall_time_ms: Date.now() - started,
    output_path: path.relative(ROOT, outPath).split(path.sep).join("/"),
    output_bytes: Buffer.byteLength(text, "utf8"),
    reason,
    baseline_version: baseline.baseline_version,
    parent_baseline_hash: baseline.parent_baseline_hash,
    baseline_hash: baselineHash,
    source_commit: baseline.source_commit,
    semantics: {
      means: "THESE RELATIONS EXISTED BEFORE ENFORCEMENT",
      does_not_mean: "THESE RELATIONS ARE HEALTHY",
      identity_is_authoritative: true,
      counts_are_summaries: true,
    },
  };
  if (outPath === BASELINE_PATH) {
    fs.mkdirSync(path.dirname(RUNTIME_RECORD), { recursive: true });
    fs.writeFileSync(RUNTIME_RECORD, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify({
    state: "BASELINE_WRITTEN",
    path: runtime.output_path,
    bytes: runtime.output_bytes,
    baseline_version: baseline.baseline_version,
    baseline_hash: baselineHash,
    tracked_source_files: baseline.counts.tracked_source_files,
    declared_owned_files: baseline.counts.declared_owned_files,
    undeclared_files: baseline.counts.undeclared_files,
    internal_edges: baseline.counts.internal_edges,
    unresolved_by_class: baseline.unresolved_by_class,
  }, null, 2)}\n`);
  return 0;
}

module.exports = {
  SCHEMA,
  BASELINE_PATH,
  NOT_YET_ENFORCED,
  NON_SOURCE_ASSET,
  SOURCE_TARGET_MISSING,
  UNSUPPORTED_SOURCE_RESOLUTION,
  OTHER_UNKNOWN,
  classifyUnresolved,
  buildBaseline,
  serialize,
  listTracked,
  loadOwnership,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`baseline generation failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
