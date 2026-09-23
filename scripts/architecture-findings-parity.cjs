#!/usr/bin/env node
/**
 * Capability City Phase 1B-B — local/hosted architecture findings parity.
 *
 * Specification (normative): docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md section 8;
 * Mission-4C section 8 ("hosted/local parity", "a count match is insufficient").
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
 * "I could not compare" and "they agree" are different statements (spec section 5, rule 1).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const runner = require("./architecture-shadow-hosted.cjs");

const SHADOW_NAME = "architecture-enforcement-shadow.json";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Accept either the artifact itself or the directory that contains it. */
function resolveArtifact(candidate) {
  if (!candidate) return null;
  const resolved = path.resolve(candidate);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const inside = path.join(resolved, SHADOW_NAME);
    return fs.existsSync(inside) ? inside : null;
  }
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * The normalized finding set of a shadow artifact.
 *
 * A artifact that carries `findings_normalized` (produced by scripts/architecture-shadow-hosted.cjs) is used as
 * is, because re-normalizing it here would let this tool disagree with the runner about what a policy class is.
 * An artifact that carries only raw `findings` (the engine's own output) is normalized with the runner's own
 * exported classifier, so both producers go through exactly one implementation.
 */
function normalizedOf(artifact) {
  if (Array.isArray(artifact?.findings_normalized)) {
    return { source: "findings_normalized", findings: runner.sortNormalized(artifact.findings_normalized.map((entry) => ({
      code: String(entry?.code ?? ""),
      severity: String(entry?.severity ?? ""),
      subject: String(entry?.subject ?? ""),
      policy_class: String(entry?.policy_class ?? ""),
    }))) };
  }
  if (Array.isArray(artifact?.findings)) {
    return { source: "findings(re-normalized)", findings: runner.sortNormalized(artifact.findings.map(runner.normalizeFinding)) };
  }
  return { source: null, findings: null };
}

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
  };
  return { local: value("--local"), hosted: value("--hosted") };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.local || !options.hosted) {
    process.stderr.write("usage: architecture-findings-parity.cjs --local <shadow.json|dir> --hosted <shadow.json|dir>\n");
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
    comparison: "finding identity (code + subject + severity + policy_class), not count",
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
    semantics: {
      means: "the two runs produced the same findings, by identity",
      does_not_mean: "the two runs produced the same number of findings",
    },
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return comparison.parity ? 0 : 1;
}

module.exports = { normalizedOf, resolveArtifact, main };

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`architecture findings parity failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 2;
  }
}
