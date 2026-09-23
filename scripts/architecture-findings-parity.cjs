#!/usr/bin/env node
/**
 * Capability City Phase 1B-B — local/hosted architecture findings parity.
 *
 * Specification (normative): docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md §8, and the Mission-4C brief's parity
 * requirement ("hosted/local parity", "a count match is insufficient").
 *
 * THE FAILURE THIS TOOL EXISTS TO PREVENT
 *   "Both runs reported 1677 findings, so they agree" is not parity. Two runs can report the same NUMBER of
 *   findings while disagreeing about every one of them -- the hosted runner and the local run can see different
 *   subjects, different severities, or classify the same code differently. A count therefore cannot carry the
 *   claim, and this tool refuses to let it: the comparison is over finding IDENTITY, and the headline result is
 *   `LOCAL_FINDINGS_HASH == HOSTED_FINDINGS_HASH` where both hashes are semantic digests over the normalized
 *   finding SET.
 *
 * WHAT IS COMPARED (all four are required)
 *   code             -- the machine code of the finding
 *   subject          -- the finding's subject: a relation ("a -> b") or a file, i.e. its identity
 *   severity         -- VIOLATION / INFO / ENGINE_ERROR
 *   policy_class     -- POLICY_VIOLATION / FAIL_CLOSED / INFORMATIONAL, the hosted classification
 *
 * NOT COMPARED, DELIBERATELY: counts, ordering, timestamps, wall times, file counts, and any other volatile
 * field. Ordering is normalized away by sorting, so a run that emits findings in a different order still
 * compares equal -- which is a property of the digest, not a loophole, because the digest is over the set.
 *
 * USAGE
 *   node scripts/architecture-findings-parity.cjs --local <shadow.json> --hosted <shadow.json>
 *   node scripts/architecture-findings-parity.cjs --local <dir> --hosted <dir>          # directories accepted
 *
 * EXIT
 *   0  the finding sets are identical by identity and their semantic digests are equal
 *   1  they are not: the disagreement is printed as the findings that appear on exactly one side
 *   2  the inputs could not be read or are not shadow artifacts, which is a machinery failure and not a pass
 *
 * A MISSING INPUT IS NEVER A PASS. An unavailable comparison exits 2 rather than reporting parity, because
 * "I could not compare" and "they agree" are different statements (docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md
 * §5, rule 1).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const runner = require("./architecture-shadow-hosted.cjs");

/**
 * The canonical artifact file names, one per mode.
 *
 * `scripts/architecture-enforcement.cjs` names its output by MODE -- `architecture-enforcement-shadow.json` for
 * `--mode shadow` and `architecture-enforcement-live.json` for `--mode enforce`. A directory argument is therefore
 * resolved against the names that mode actually writes, rather than against one hardcoded name: an S2 comparison
 * that looked only for the shadow name would silently report PARITY_NOT_MEASURED for every enforce input, which is
 * a fail-closed outcome but not a useful one.
 */
const SHADOW_NAME = "architecture-enforcement-shadow.json";
const ENFORCE_NAME = "architecture-enforcement-live.json";
const DIRECTORY_NAMES = [SHADOW_NAME, ENFORCE_NAME];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Accept either an artifact file or a directory containing one of the canonical artifacts. */
function resolveArtifact(candidate, preferredName) {
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const ordered = preferredName ? [preferredName, ...DIRECTORY_NAMES.filter((n) => n !== preferredName)] : DIRECTORY_NAMES;
    for (const name of ordered) {
      const inside = path.join(resolved, name);
      if (fs.existsSync(inside)) return inside;
    }
    return null;
  }
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * The normalized finding set of a shadow artifact.
 *
 * An artifact that carries `findings_normalized` (produced by scripts/architecture-shadow-hosted.cjs) is used as
 * is, because re-normalizing it here would let this tool disagree with the runner about what a policy class is.
 * An artifact that carries only raw `findings` (the engine's own output) is normalized with the runner's own
 * exported `normalizeFinding`, so both producers go through exactly one implementation.
 *
 * `detail_digest` is carried through rather than recomputed: it is part of the finding's identity (see the note
 * on `normalizeFinding`), and an artifact written by an OLDER runner would not have it. Such an artifact is
 * re-normalized from its raw `findings` instead, so a shape change cannot silently compare two different
 * identities against each other. When neither is possible the artifact is not comparable, which the caller
 * reports as `PARITY_NOT_MEASURED` rather than as agreement.
 */
function normalizedOf(artifact) {
  const fromNormalized = Array.isArray(artifact?.findings_normalized) ? artifact.findings_normalized : null;
  const shapeComplete = fromNormalized !== null && fromNormalized.every((entry) => typeof entry?.detail_digest === "string" && entry.detail_digest.length > 0);
  if (fromNormalized && shapeComplete) {
    return { source: "findings_normalized", findings: runner.sortNormalized(fromNormalized.map((entry) => ({
      code: String(entry?.code ?? ""),
      severity: String(entry?.severity ?? ""),
      subject: String(entry?.subject ?? ""),
      policy_class: String(entry?.policy_class ?? ""),
      detail_digest: String(entry?.detail_digest ?? ""),
    }))) };
  }
  if (Array.isArray(artifact?.findings)) {
    return {
      source: fromNormalized ? "findings(re-normalized: findings_normalized predates the detail_digest identity)" : "findings(re-normalized)",
      findings: runner.sortNormalized(artifact.findings.map(runner.normalizeFinding)),
    };
  }
  return { source: null, findings: null };
}

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
  };
  // TWO COMPARISONS, ONE IDENTITY.
  //
  //   local-hosted   the default: is a local evaluation the same as the hosted one? The hosted/local parity
  //                  requirement of docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md §8.
  //   shadow-enforce the S2 entry proof: do the SAME inputs produce the same findings in both modes? (ENF-12)
  //
  // The second is not a relabelled first. It compares two artifacts produced by `--mode shadow` and
  // `--mode enforce` through ONE evaluator, and the property at stake is that only the EXIT CODE differs. It uses
  // exactly the same normalized identity and the same multiset comparison, because a second normalization
  // definition is how two comparisons start disagreeing about what a finding is.
  const mode = value("--mode") ?? "local-hosted";
  if (argv.includes("--shadow-enforce")) return { mode: "shadow-enforce" };
  return { mode, local: value("--local"), hosted: value("--hosted"), shadow: value("--shadow"), enforce: value("--enforce") };
}

/**
 * The shadow-versus-enforce comparison (ENF-12).
 *
 * Exit semantics mirror the local/hosted mode: agreement is 0, disagreement is 1, and an input that cannot be read
 * or is not an artifact is **2 — `PARITY_NOT_MEASURED`**, never a pass. That last rule is what keeps a broken
 * measurement from reading as "the two modes agree".
 */
function shadowEnforceMain(options) {
  const shadowFile = resolveArtifact(options.shadow, SHADOW_NAME);
  const enforceFile = resolveArtifact(options.enforce, ENFORCE_NAME);
  const unreadable = [];
  if (!shadowFile) unreadable.push(`--shadow ${options.shadow}`);
  if (!enforceFile) unreadable.push(`--enforce ${options.enforce}`);
  if (unreadable.length > 0) {
    process.stdout.write(`${JSON.stringify({ state: "PARITY_NOT_MEASURED", mode: "shadow-enforce", parity: false, reason: `could not read ${unreadable.join(", ")}`, note: "a comparison that could not be made is not a pass" }, null, 2)}\n`);
    return 2;
  }
  let shadowArtifact;
  let enforceArtifact;
  try {
    shadowArtifact = readJson(shadowFile);
    enforceArtifact = readJson(enforceFile);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ state: "PARITY_NOT_MEASURED", mode: "shadow-enforce", parity: false, reason: `an input is not JSON: ${error.message}`, note: "a comparison that could not be made is not a pass" }, null, 2)}\n`);
    return 2;
  }
  const shadow = normalizedOf(shadowArtifact);
  const enforce = normalizedOf(enforceArtifact);
  if (!shadow.findings || !enforce.findings) {
    process.stdout.write(`${JSON.stringify({ state: "PARITY_NOT_MEASURED", mode: "shadow-enforce", parity: false, reason: "an input carries no findings and no findings_normalized, so it is not an enforcement artifact", note: "a comparison that could not be made is not a pass" }, null, 2)}\n`);
    return 2;
  }
  const comparison = runner.compareFindings(shadow.findings, enforce.findings);
  const countOnlyTrap = comparison.local_count === comparison.hosted_count && comparison.local_findings_hash !== comparison.hosted_findings_hash;
  const payload = {
    state: comparison.parity ? "SHADOW_ENFORCE_PARITY" : "PARITY_DISAGREEMENT",
    mode: "shadow-enforce",
    parity: comparison.parity,
    comparison: "finding identity (code + subject + severity + policy_class + detail digest), multiset comparison with multiplicity",
    comparison_kind: comparison.comparison_kind,
    digest_schema: runner.DIGEST_SCHEMA,
    shadow: { artifact: path.resolve(shadowFile), normalized_source: shadow.source, findings_hash: comparison.local_findings_hash, findings_count: comparison.local_count, mode: shadowArtifact.mode ?? null, verdict: shadowArtifact.verdict ?? null },
    enforce: { artifact: path.resolve(enforceFile), normalized_source: enforce.source, findings_hash: comparison.hosted_findings_hash, findings_count: comparison.hosted_count, mode: enforceArtifact.mode ?? null, verdict: enforceArtifact.verdict ?? null },
    SHADOW_FINDINGS_HASH: comparison.local_findings_hash,
    ENFORCE_FINDINGS_HASH: comparison.hosted_findings_hash,
    HASHES_EQUAL: comparison.local_findings_hash === comparison.hosted_findings_hash,
    COUNTS_EQUAL: comparison.local_count === comparison.hosted_count,
    count_only_match_cannot_fake_parity: true,
    count_only_trap_observed: countOnlyTrap,
    only_shadow: comparison.only_local,
    only_enforce: comparison.only_hosted,
    multiplicity_differences: comparison.multiplicity_differences,
    semantics: {
      means: "shadow and enforce produced the same findings on the same inputs -- the ENF-12 identity, which is what makes shadow evidence about enforce",
      does_not_mean: "shadow and enforce have the same exit code; only the exit code differs between the modes",
    },
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return comparison.parity ? 0 : 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "shadow-enforce") return shadowEnforceMain(options);
  if (!options.local || !options.hosted) {
    process.stderr.write("usage: architecture-findings-parity.cjs --local <artifact|dir> --hosted <artifact|dir>\n");
    process.stderr.write("       architecture-findings-parity.cjs --mode shadow-enforce --shadow <artifact|dir> --enforce <artifact|dir>\n");
    return 2;
  }
  const localFile = resolveArtifact(options.local);
  const hostedFile = resolveArtifact(options.hosted);
  const unreadable = [];
  if (!localFile) unreadable.push(`--local ${options.local}`);
  if (!hostedFile) unreadable.push(`--hosted ${options.hosted}`);
  if (unreadable.length > 0) {
    process.stdout.write(`${JSON.stringify({ state: "PARITY_NOT_MEASURED", parity: false, reason: `could not read ${unreadable.join(", ")}`, note: "a comparison that could not be made is not a pass" }, null, 2)}\n`);
    return 2;
  }

  let localArtifact;
  let hostedArtifact;
  try {
    localArtifact = readJson(localFile);
    hostedArtifact = readJson(hostedFile);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ state: "PARITY_NOT_MEASURED", parity: false, reason: `an input is not JSON: ${error.message}`, note: "a comparison that could not be made is not a pass" }, null, 2)}\n`);
    return 2;
  }

  const local = normalizedOf(localArtifact);
  const hosted = normalizedOf(hostedArtifact);
  if (!local.findings || !hosted.findings) {
    process.stdout.write(`${JSON.stringify({ state: "PARITY_NOT_MEASURED", parity: false, reason: "an input carries no findings and no findings_normalized, so it is not a shadow artifact", note: "a comparison that could not be made is not a pass" }, null, 2)}\n`);
    return 2;
  }

  const comparison = runner.compareFindings(local.findings, hosted.findings);

  // The count-only trap, reported explicitly. A run where the counts agree and the digests do not is exactly
  // the case a count-based parity check would have called a pass.
  const countOnlyTrap = comparison.local_count === comparison.hosted_count && comparison.local_findings_hash !== comparison.hosted_findings_hash;

  const payload = {
    state: comparison.parity ? "HOSTED_LOCAL_PARITY" : "PARITY_DISAGREEMENT",
    parity: comparison.parity,
    comparison: "finding identity (code + subject + severity + policy_class + detail digest), multiset comparison with multiplicity",
    comparison_kind: comparison.comparison_kind,
    digest_schema: runner.DIGEST_SCHEMA,
    local: { artifact: path.resolve(localFile), normalized_source: local.source, findings_hash: comparison.local_findings_hash, findings_count: comparison.local_count },
    hosted: { artifact: path.resolve(hostedFile), normalized_source: hosted.source, findings_hash: comparison.hosted_findings_hash, findings_count: comparison.hosted_count },
    LOCAL_FINDINGS_HASH: comparison.local_findings_hash,
    HOSTED_FINDINGS_HASH: comparison.hosted_findings_hash,
    HASHES_EQUAL: comparison.local_findings_hash === comparison.hosted_findings_hash,
    COUNTS_EQUAL: comparison.local_count === comparison.hosted_count,
    count_only_match_cannot_fake_parity: true,
    count_only_trap_observed: countOnlyTrap,
    only_local: comparison.only_local,
    only_hosted: comparison.only_hosted,
    multiplicity_differences: comparison.multiplicity_differences,
    semantics: {
      means: "the two runs produced the same findings, by identity and with the same multiplicity",
      does_not_mean: "the two runs produced the same number of findings",
    },
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return comparison.parity ? 0 : 1;
}

module.exports = { normalizedOf, resolveArtifact, shadowEnforceMain, main };

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`architecture findings parity failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 2;
  }
}
