#!/usr/bin/env node
/**
 * Capability City Phase 1B-B — hosted architecture shadow.
 *
 * Specification (normative): docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md, sections 2, 3 (stage S1), 5, 8.
 * Mission: Mission-4C, Part B.
 *
 * WHAT THIS FILE IS, AND WHAT IT IS NOT
 *   It is the ORCHESTRATOR and EVIDENCE PRODUCER for the hosted `architecture` job. It is not a second
 *   evaluator: the policy decision is made by `scripts/architecture-enforcement.cjs`, the same function that
 *   serves `--mode enforce` locally, and this file never re-decides a finding.
 *
 *   It runs the three logical checks the mission names, in order:
 *
 *       1. baseline-series authorization      trust-policy/architecture-enforcement-baselines.json
 *       2. accepted-baseline self-consistency config/architecture-enforcement-baseline.json
 *       3. architecture shadow enforcement    scripts/architecture-enforcement.cjs --mode shadow
 *
 * THE ONE THING THIS FILE ADDS: FAIL-CLOSED CLASSIFICATION
 *   The engine's own contract is "policy violation -> exit 0 in shadow; engine error -> non-zero in both". That
 *   contract is right for the engine and is NOT sufficient for the hosted gate, because the fail-closed table of
 *   docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md (§5) names conditions that the engine classifies as
 *   `severity: VIOLATION` while still exiting 0 in shadow mode -- `SENSOR_INCOMPLETE` above all. A hosted shadow
 *   job that exited 0 on an incomplete sensor would be a gate that could not look, reporting that there was
 *   nothing to see, which is the exact failure mode that document's rule 1 exists to prevent.
 *
 *   So this file draws the line the hosted job needs, and draws it ON FINDING CODES rather than on the engine's
 *   exit code:
 *
 *       POLICY VIOLATION          -> reported, this process exits 0, the `architecture` job may stay green
 *       MACHINERY FAILURE         -> this process exits 1, the `architecture` job fails
 *
 *   SHADOW != IGNORE_ERRORS. Only policy violations are report-only. Broken measurement or broken governance
 *   machinery is fail-closed even in shadow.
 *
 * WHY THE ENGINE IS CALLED IN-PROCESS RATHER THAN SPAWNED
 *   The repository's engine is a library and a CLI over the same exported functions (`evaluatePolicy`,
 *   `measureTree`, ...). Calling the exports from here lets the runner hold the measurement, the baseline and
 *   the resulting findings in one set of variables, so the evidence it publishes is derived from the decision
 *   it reports rather than parsed back out of a subprocess's stdout. A subprocess whose JSON failed to parse
 *   would be a machinery failure discovered late; here it cannot happen, because there is no second encoding.
 *
 * USAGE
 *   node scripts/architecture-shadow-hosted.cjs
 *   node scripts/architecture-shadow-hosted.cjs --out <dir> --metadata <path>
 *   node scripts/architecture-shadow-hosted.cjs --baseline <path> [--authorizations <path>] \
 *        [--measurement <path>] [--declarations <path>] [--root <dir>]     # FIXTURE SEAM
 *
 * THE FIXTURE SEAM IS REFUSED ON THE GOVERNING PATH
 *   `--baseline` (or any other override that can change what is measured or what governs) selects fixture mode,
 *   and fixture mode is what the adversarial suites drive to make each fail-closed row observable. Exactly as in
 *   the engine, a fixture may name its own `--authorizations` source, but the GOVERNING run may not redirect its
 *   authorization check to a caller-chosen series: an authorization check whose source the caller picks is not a
 *   check. `--authorizations` without `--baseline` is therefore a refusal, not an override.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const enforcement = require("./architecture-enforcement.cjs");
const baselineModule = require("./architecture-enforcement-baseline.cjs");
const seriesModule = require("./architecture-baseline-series.cjs");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA = "city-phase1b-hosted-architecture-shadow/1";
const DEFAULT_OUT_DIR = path.join("artifacts", "city", "phase1");
const DEFAULT_SHADOW_NAME = "architecture-enforcement-shadow.json";
const DEFAULT_METADATA_NAME = "architecture-shadow-metadata.json";
const DIGEST_SCHEMA = "city-architecture-findings-digest/1";

// The trust epoch record, read as committed. The aggregate surface hash for the LIVE tree is deliberately NOT
// recomputed here: that needs dist-electron, and a CI job that could not measure the surface must still be able
// to publish the shadow evidence it did measure. `--require-surface` makes the caller demand it (PARITY, below).
const EPOCH_PATH = path.join("trust-policy", "trust-epoch.json");

/**
 * Where this evaluation actually ran, MEASURED from the workflow environment rather than asserted.
 *
 * An earlier revision wrote `hosted: true` as a constant, so a purely LOCAL run produced an artifact that
 * declared itself hosted, carried `commit_sha: null` and `event: null`, and could be (and in one revision of the
 * evidence ledger, was) quoted as hosted evidence before any hosted run existed. A provenance field that is always
 * true is not provenance. These values are read from the variables GitHub Actions defines, and `hosted` is true
 * only when the provider is really `GitHub Actions`.
 */
const HOSTED_ENVIRONMENT_VARIABLES = [
  "GITHUB_SHA",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_WORKFLOW",
  "GITHUB_JOB",
  "GITHUB_EVENT_NAME",
  "GITHUB_ACTIONS",
  "GITHUB_REPOSITORY",
  "GITHUB_REF",
  "GITHUB_SERVER_URL",
  "GITHUB_RUN_NUMBER",
  "RUNNER_OS",
  "RUNNER_ARCH",
  "RUNNER_NAME",
  "CI",
];

function hostedEnvironment() {
  const env = process.env;
  const provider = env.GITHUB_ACTIONS === "true" ? "GitHub Actions" : env.CI ? "unknown CI" : "local";
  const observed = {};
  for (const name of HOSTED_ENVIRONMENT_VARIABLES) observed[name] = env[name] ?? null;
  return {
    hosted: provider === "GitHub Actions",
    provider,
    // The raw variables, so a reader can re-derive every field above instead of trusting this file's reading.
    observed,
    absence_note: provider === "GitHub Actions" ? null : "this evaluation did NOT run on GitHub-hosted CI; the artifact describes a local run",
  };
}

/**
 * The fail-closed classification, by finding code. A code listed here is MACHINERY, not policy: the gate could
 * not measure, could not establish what governs, or the sensor is known to be incomplete. Everything else is a
 * finding about the tree, which shadow reports without blocking.
 *
 * This list is the machine-readable form of docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md §5. It is
 * asserted against that document by tests/unit/city/architecture-hosted-shadow.test.ts (S1..S4, H7).
 */
const MACHINERY_CODES = [
  "ENGINE_ERROR",
  "SENSOR_INCOMPLETE",
  "UNRESOLVED_UNSUPPORTED_SOURCE_RESOLUTION",
  "UNRESOLVED_SOURCE_TARGET_MISSING",
  "UNRESOLVED_OTHER_UNKNOWN",
  "BASELINE_SERIES_UNAUTHORISED",
  "BASELINE_SERIES_MISSING",
  "BASELINE_SERIES_MALFORMED",
  "BASELINE_SERIES_EMPTY",
  "BASELINE_TRIPLE_INCOMPLETE",
  "BASELINE_HASH_INVALID",
  "BASELINE_HASH_MISMATCH",
  "BASELINE_VERSION_NOT_SEQUENTIAL",
  "BASELINE_VERSION_REUSED",
  "BASELINE_PARENT_MISMATCH",
  "BASELINE_FORK",
  "BASELINE_HEAD_NOT_TRACKED",
  "NOT_YET_ENFORCED_EXPANDED",
  "RETIRED_EDGE_FORGOTTEN",
  "OWNERSHIP_CONFLICT",
];

const MACHINERY = new Set(MACHINERY_CODES);

/**
 * Findings that are not about the tree at all: they are the engine stating a fact about the repository or about
 * its own ability to look. They are exactly the fail-closed rows of docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md
 * whose state is "implemented" but whose hosted consequence the engine cannot express, because the engine's
 * shadow contract is policy-only.
 */
function classifyPolicy(finding) {
  if (MACHINERY.has(finding.code)) return "FAIL_CLOSED";
  if (finding.code === "NON_SOURCE_ASSET" || finding.code === "NOT_YET_ENFORCED" || finding.code === "PASS_AS_GRANDFATHERED" || finding.code === "DEBT_REDUCED" || finding.code === "NEW_DECLARED_SOURCE" || finding.code === "NEW_EDGE_DECLARED_ENDPOINT") {
    return "INFORMATIONAL";
  }
  return "POLICY_VIOLATION";
}

/**
 * Normalize one finding into the identity a parity comparison is allowed to use. Count alone is explicitly NOT
 * sufficient (docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md §8 and the Mission-4C brief's parity requirement), so
 * the shape carries code + subject identity + severity + policy class, plus a digest of the finding's DETAIL --
 * and nothing volatile: no timestamps, no file counts, no ordering.
 *
 * WHY THE DETAIL DIGEST IS PART OF THE IDENTITY (a real defect found in review, not a precaution).
 *   The first revision used `code` + `subject` + `severity` + `policy_class` alone. That is LOSSY for one family
 *   the engine really emits: `SENSOR_INCOMPLETE` findings all carry the subject `sensor` and put everything that
 *   distinguishes them in `detail` ("1 read failure(s): a.ts" vs "3 silently skipped file(s)"). Dropping `detail`
 *   made a read failure and a batch of silent skips normalize to the SAME value, so two DIFFERENT finding sets
 *   produced the same digest and `compareFindings` reported `parity: true`. Measured before the fix:
 *
 *       normalize(read-failure) === normalize(silent-skip)      -> true
 *       semanticFindingsHash([read-failure]) === [silent-skip]  -> true
 *       compareFindings([read-failure], [silent-skip]).parity   -> true
 *
 *   The detail text itself is NOT carried, because it contains file paths and a bounded artifact should not grow
 *   with the corpus. A sha256 of it is enough to keep the identity injective, which is what parity needs; the
 *   full `detail` is still published in `architecture-enforcement-shadow.json` for a human reader.
 */
function normalizeFinding(finding) {
  const detail = finding?.detail === null || finding?.detail === undefined ? "" : String(finding.detail);
  return {
    code: String(finding?.code ?? ""),
    severity: String(finding?.severity ?? ""),
    subject: String(finding?.subject ?? ""),
    policy_class: classifyPolicy(finding ?? {}),
    detail_digest: sha256(detail),
  };
}

/** Deterministic order: code, then subject, then the detail identity. Two identical sets order identically. */
function sortNormalized(entries) {
  return [...entries].sort((left, right) => {
    if (left.code !== right.code) return left.code < right.code ? -1 : 1;
    if (left.subject !== right.subject) return left.subject < right.subject ? -1 : 1;
    if (left.detail_digest !== right.detail_digest) return left.detail_digest < right.detail_digest ? -1 : 1;
    return left.severity < right.severity ? -1 : left.severity > right.severity ? 1 : 0;
  });
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** The canonical, injective rendering of one normalized finding. Every field goes through JSON.stringify. */
function canonicalFinding(entry) {
  return `{"code":${JSON.stringify(entry.code)},"severity":${JSON.stringify(entry.severity)},"subject":${JSON.stringify(entry.subject)},"policy_class":${JSON.stringify(entry.policy_class)},"detail_digest":${JSON.stringify(entry.detail_digest)}}`;
}

/** The identity key of a normalized finding: the canonical rendering, so two entries are equal iff they match. */
function findingKey(entry) {
  return canonicalFinding(entry);
}

/**
 * The semantic digest over the normalized findings set.
 *
 * "Deterministic" here means the same findings produce the same digest across runs, platforms and process
 * orderings; it does NOT mean two different finding sets are hashed by count. Keys are emitted in a fixed order
 * and the entries are sorted, so the digest is a function of the MULTISET, not of the array it arrived in.
 *
 * MULTISET, NOT SET, and the distinction is load-bearing. The engine emits one finding per condition, so a run
 * that saw the same condition three times and a run that saw it once are different measurements. The digest
 * therefore counts occurrences; `compareFindings` below compares with the same multiplicity, so the two agree
 * about what "the same findings" means. An earlier revision hashed the multiset but compared de-duplicated
 * groups, so `findings_semantic_hash` and `compareFindings().parity` could disagree about one input pair.
 */
function semanticFindingsHash(normalizedFindings) {
  const canonical = sortNormalized(normalizedFindings).map(canonicalFinding);
  return sha256(JSON.stringify({ schema: DIGEST_SCHEMA, findings: canonical }));
}

/**
 * Compare a local normalized findings set with a hosted one, by identity. Returns the disagreement rather than a
 * boolean, so an operator can read WHICH finding differed instead of being told the hashes are not equal.
 *
 * The comparison is a MULTISET comparison: counts of identical entries matter, because "the same finding twice"
 * and "the same finding once" are different observations. `parity` is true only when both sides have exactly the
 * same entries with exactly the same multiplicities -- which is the same statement the digest makes, so the two
 * can never disagree.
 */
function compareFindings(localNormalized, hostedNormalized) {
  const tally = (entries) => {
    const counts = new Map();
    for (const entry of sortNormalized(entries)) {
      const key = findingKey(entry);
      const seen = counts.get(key);
      if (seen) seen.count += 1;
      else counts.set(key, { entry, count: 1 });
    }
    return counts;
  };
  const localCounts = tally(localNormalized);
  const hostedCounts = tally(hostedNormalized);
  const onlyLocal = [];
  const onlyHosted = [];
  const multiplicityDifferences = [];
  const keys = new Set([...localCounts.keys(), ...hostedCounts.keys()]);
  for (const key of keys) {
    const local = localCounts.get(key);
    const hosted = hostedCounts.get(key);
    const localCount = local?.count ?? 0;
    const hostedCount = hosted?.count ?? 0;
    if (localCount === hostedCount) continue;
    const entry = local?.entry ?? hosted?.entry;
    if (localCount > 0 && hostedCount === 0) onlyLocal.push(entry);
    else if (hostedCount > 0 && localCount === 0) onlyHosted.push(entry);
    else multiplicityDifferences.push({ finding: entry, local_count: localCount, hosted_count: hostedCount });
  }
  const localHash = semanticFindingsHash([...localCounts.values()].flatMap(({ entry, count }) => Array.from({ length: count }, () => entry)));
  const hostedHash = semanticFindingsHash([...hostedCounts.values()].flatMap(({ entry, count }) => Array.from({ length: count }, () => entry)));
  const localTotal = [...localCounts.values()].reduce((total, item) => total + item.count, 0);
  const hostedTotal = [...hostedCounts.values()].reduce((total, item) => total + item.count, 0);
  return {
    parity: onlyLocal.length === 0 && onlyHosted.length === 0 && multiplicityDifferences.length === 0 && localHash === hostedHash,
    comparison_kind: "multiset (identity + multiplicity)",
    local_findings_hash: localHash,
    hosted_findings_hash: hostedHash,
    local_count: localTotal,
    hosted_count: hostedTotal,
    count_only_match: localTotal === hostedTotal && localHash !== hostedHash,
    only_local: sortNormalized(onlyLocal),
    only_hosted: sortNormalized(onlyHosted),
    multiplicity_differences: multiplicityDifferences,
  };
}

function readJsonIfPresent(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")), error: null };
  } catch (error) {
    return { value: null, error: error.message };
  }
}

/**
 * Read the committed trust epoch. This is a READ of a governance record, never a write: nothing in this file may
 * advance an epoch, and the mission forbids `--advance` in this phase outright.
 */
function readTrustEpoch(root) {
  const file = path.join(root, EPOCH_PATH);
  const loaded = readJsonIfPresent(file);
  if (!loaded.value) return { path: EPOCH_PATH.split(path.sep).join("/"), trust_epoch: null, root_surface_hash: null, read_error: loaded.error };
  return {
    path: EPOCH_PATH.split(path.sep).join("/"),
    trust_epoch: loaded.value?.record?.trust_epoch ?? null,
    root_contract_version: loaded.value?.record?.root_contract_version ?? null,
    root_surface_hash: loaded.value?.record?.root_surface_hash ?? null,
    epoch_hash: loaded.value?.epoch_hash ?? null,
    read_error: null,
  };
}

/**
 * The accept-side control: is the baseline's own content hash the hash the series accepted? This is `--check`'s
 * `hash_matches` question, asked here from the same two values the series authorizes, so a baseline edited in
 * place after acceptance is caught by the hosted job even before the separate `--check` step runs.
 */
function baselineSelfConsistency(root, baselineOverride) {
  const baselinePath = baselineOverride ? path.resolve(baselineOverride) : baselineModule.BASELINE_PATH;
  const loaded = readJsonIfPresent(baselinePath);
  if (!loaded.value) {
    return {
      path: path.relative(root, baselinePath).split(path.sep).join("/"),
      exists: false,
      self_consistent: false,
      code: "ENGINE_ERROR",
      detail: `the baseline could not be read: ${loaded.error}`,
      baseline_version: null,
      baseline_hash: null,
      recomputed_baseline_hash: null,
    };
  }
  const baseline = loaded.value;
  let recomputed = null;
  let buildError = null;
  try {
    // Recompute from the same tree the baseline describes. `buildBaseline` is the generator the accepted
    // baseline came from, so this is a genuine re-derivation and not a comparison of a file with itself.
    //
    // The four inputs below are held to the committed file exactly as `--check` holds them, and that is
    // deliberate rather than convenient: the version, the parent, the reason, the recorded source commit and
    // the prior edge/retired-edge sets are all fields the FILE owns, and deriving any of them from the measured
    // tree instead is how the generator's own first revision made `--check` report a false mismatch. Only the
    // measured content (files, edges, unresolved, sensor identity) is re-derived here.
    recomputed = baselineModule.buildBaseline({
      root,
      reason: typeof baseline.reason === "string" ? baseline.reason : "hosted shadow self-consistency probe (never written)",
      parentBaselineHash: baseline.parent_baseline_hash ?? null,
      baselineVersion: Number(baseline.baseline_version ?? 1),
      prior: { edges: baseline.edges ?? [], retired_edges: baseline.retired_edges ?? [] },
      sourceCommit: typeof baseline.source_commit === "string" ? baseline.source_commit : null,
    }).baselineHash;
  } catch (error) {
    buildError = error && error.message ? error.message : String(error);
  }
  const declared = baseline.baseline_hash ?? null;
  const selfConsistent = buildError === null && recomputed !== null && declared !== null && recomputed === declared;
  return {
    path: path.relative(root, baselinePath).split(path.sep).join("/"),
    exists: true,
    self_consistent: selfConsistent,
    code: selfConsistent ? null : "BASELINE_HASH_MISMATCH",
    detail: selfConsistent ? null : (buildError !== null ? `the baseline could not be re-derived: ${buildError}` : `the declared baseline hash ${String(declared).slice(0, 12)}… is not the recomputed content hash ${String(recomputed).slice(0, 12)}…`),
    baseline_version: Number(baseline.baseline_version ?? 1),
    baseline_hash: declared,
    recomputed_baseline_hash: recomputed,
  };
}

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
  };
  return {
    baseline: value("--baseline"),
    authorizations: value("--authorizations"),
    measurement: value("--measurement"),
    declarations: value("--declarations"),
    root: value("--root"),
    out: value("--out"),
    metadata: value("--metadata"),
    requireSurface: argv.includes("--require-surface"),
    // Fixture-only seam: the adversarial suites need to drive the POLICY decision with synthetic inputs, and a
    // synthetic baseline can never be self-consistent with the real tree. Without this the policy rows (S5, S6)
    // could not be tested at all; with it, a fixture states out loud that it is not exercising check 2.
    skipSelfConsistency: argv.includes("--skip-self-consistency"),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  const started = Date.now();
  const root = options.root ? path.resolve(options.root) : ROOT;

  // Fixture mode is selected by any override that changes what is measured or what governs.
  const fixtureMode = Boolean(options.baseline || options.measurement || options.declarations || options.root);

  // The governing path may not choose its own authorization source. Refused rather than honoured, for the same
  // reason the engine refuses it: a check whose source the caller picks is indistinguishable from no check.
  if (options.authorizations && !options.baseline) {
    process.stderr.write("architecture-shadow-hosted: --authorizations is a fixture seam and requires an explicit --baseline; the governing check must read trust-policy/architecture-enforcement-baselines.json\n");
    return 2;
  }
  // ...and neither may the governing path skip a check that the hosted job exists to run.
  if (options.skipSelfConsistency && !fixtureMode) {
    process.stderr.write("architecture-shadow-hosted: --skip-self-consistency is a fixture seam and requires an explicit fixture override; the governing check always re-derives the accepted baseline\n");
    return 2;
  }

  const machinery = [];
  const notes = [];

  // ---------------------------------------------------------------------------------------------
  // check 1 -- baseline-series authorization
  // ---------------------------------------------------------------------------------------------
  const authorizationsPath = options.authorizations ? path.resolve(options.authorizations) : null;
  const seriesLoaded = seriesModule.loadSeries(authorizationsPath ?? seriesModule.SERIES_PATH);
  const baselineForTriple = (() => {
    const file = options.baseline ? path.resolve(options.baseline) : baselineModule.BASELINE_PATH;
    const loaded = readJsonIfPresent(file);
    return loaded.value;
  })();
  const triple = baselineForTriple ? seriesModule.tripleOf(baselineForTriple) : null;
  const structuralProblems = seriesLoaded.problems.length > 0 ? seriesLoaded.problems : seriesModule.validateSeries(seriesLoaded.value);
  const authorization = triple ? seriesModule.authorizeTriple(seriesLoaded.value, triple) : { authorized: false, entry: null, problems: [{ code: "BASELINE_HEAD_NOT_TRACKED", detail: "the baseline could not be read, so no triple could be authorized" }] };

  if (structuralProblems.length > 0 || !authorization.authorized) {
    const problems = structuralProblems.length > 0 ? structuralProblems : authorization.problems;
    for (const entry of problems) machinery.push({ code: entry.code, subject: "baseline", detail: entry.detail ?? null });
  }
  notes.push(`series ${path.relative(root, seriesLoaded.path).split(path.sep).join("/")} -> ${authorization.authorized && structuralProblems.length === 0 ? "AUTHORISED" : "NOT_AUTHORISED"}`);

  // ---------------------------------------------------------------------------------------------
  // check 2 -- accepted-baseline self-consistency
  // ---------------------------------------------------------------------------------------------
  const selfConsistency = options.skipSelfConsistency
    ? {
        path: options.baseline ? path.relative(root, path.resolve(options.baseline)).split(path.sep).join("/") : path.relative(root, baselineModule.BASELINE_PATH).split(path.sep).join("/"),
        exists: true,
        // NOT `true`. A check that was not performed is `null` -- "not measured" -- never a pass. The first
        // revision fabricated `self_consistent: true` here, which is the same class of defect as the hardcoded
        // `hosted: true`: a fixture-mode artifact asserted a verification it had not run, and a reader (or the
        // hosted job's own evidence assertion) could not tell it from a real one.
        self_consistent: null,
        code: null,
        detail: null,
        skipped_by_fixture: true,
        baseline_version: null,
        baseline_hash: null,
        recomputed_baseline_hash: null,
      }
    : baselineSelfConsistency(root, options.baseline);
  if (selfConsistency.self_consistent === false) {
    machinery.push({ code: selfConsistency.code ?? "ENGINE_ERROR", subject: selfConsistency.path, detail: selfConsistency.detail });
  }
  const selfConsistencyStatus = selfConsistency.skipped_by_fixture === true
    ? "NOT_MEASURED_FIXTURE_SEAM"
    : selfConsistency.self_consistent === true
      ? "VERIFIED"
      : "FAILED";

  // ---------------------------------------------------------------------------------------------
  // check 3 -- architecture shadow enforcement
  // ---------------------------------------------------------------------------------------------
  let baseline = null;
  let measurement = null;
  let declarations = null;
  let findings = [];
  let verdict = "ENGINE_ERROR";

  const baselinePath = options.baseline ? path.resolve(options.baseline) : baselineModule.BASELINE_PATH;
  const loadedBaseline = readJsonIfPresent(baselinePath);
  if (!loadedBaseline.value) {
    machinery.push({ code: "ENGINE_ERROR", subject: "baseline", detail: `the baseline could not be read: ${loadedBaseline.error}` });
  } else {
    baseline = loadedBaseline.value;
  }

  if (baseline) {
    try {
      measurement = options.measurement ? JSON.parse(fs.readFileSync(path.resolve(options.measurement), "utf8")) : enforcement.measureTree(root);
    } catch (error) {
      machinery.push({ code: "ENGINE_ERROR", subject: "measurement", detail: `the measurement could not be produced: ${error && error.message ? error.message : String(error)}` });
    }
  }
  if (baseline && measurement) {
    try {
      declarations = options.declarations ? JSON.parse(fs.readFileSync(path.resolve(options.declarations), "utf8")) : enforcement.loadDeclarationsFromTree(root);
    } catch (error) {
      machinery.push({ code: "ENGINE_ERROR", subject: "declarations", detail: `the declarations could not be read: ${error && error.message ? error.message : String(error)}` });
    }
  }

  if (baseline && measurement && declarations && machinery.length === 0) {
    // The series refusal is already recorded above; evaluating policy against a baseline that does not govern
    // would produce findings about a policy that is not in force, so it is not evaluated at all.
    const evaluated = enforcement.evaluatePolicy({ baseline, measurement, declarations });
    findings = enforcement.sortFindings(evaluated.findings);
    verdict = evaluated.verdict;
  } else if (machinery.length > 0) {
    verdict = "ENGINE_ERROR";
  }

  const normalized = sortNormalized(findings.map(normalizeFinding));
  const findingsHash = semanticFindingsHash(normalized);

  const policyFindings = normalized.filter((entry) => entry.policy_class === "POLICY_VIOLATION");
  const informational = normalized.filter((entry) => entry.policy_class === "INFORMATIONAL");
  const failClosedFindings = normalized.filter((entry) => entry.policy_class === "FAIL_CLOSED");

  /**
   * The unmodelled-defect-class list, read from the BASELINE rather than from the module default.
   *
   * Three states, and they must stay distinguishable: READABLE (the baseline carries the field -- possibly as an
   * empty list, which is a meaningful answer), EMPTY (carried and empty, also meaningful), and UNREAD (the
   * baseline does not carry the field, or no baseline was read at all -- which is a machinery failure, because
   * the gate cannot publish a list it never read).
   */
  const notYetEnforced = (() => {
    if (!baseline) return { readable: false, status: "BASELINE_UNREAD", value: null, error: "no baseline was read, so the unmodelled-defect-class list could not be read either" };
    if (!Array.isArray(baseline.not_yet_enforced)) return { readable: false, status: "FIELD_ABSENT", value: null, error: "the baseline carries no `not_yet_enforced` array; an unread list must not be published as an empty one" };
    const value = [...baseline.not_yet_enforced].map(String).sort();
    return { readable: true, status: value.length === 0 ? "READABLE_EMPTY" : "READABLE", value, error: null };
  })();
  if (!notYetEnforced.readable) {
    machinery.push({ code: "ENGINE_ERROR", subject: "baseline.not_yet_enforced", detail: notYetEnforced.error });
  }

  /**
   * The engine-error record, gathered from BOTH places an engine error can appear.
   *
   *   - `machinery` -- the orchestrator's own failures: an unreadable or non-self-consistent baseline, an
   *     unauthorized series, a measurement that could not be produced. These occur BEFORE policy evaluation, so
   *     they never become findings, and a reader of the evidence must still be able to name them.
   *   - `failClosedFindings` -- conditions the ENGINE reports as findings that this file escalates, of which
   *     `SENSOR_INCOMPLETE` is the one that matters: the engine calls it a policy violation precisely so its own
   *     shadow mode stays report-only, and the hosted gate must still fail on it.
   *
   * Both are engine errors in the hosted sense -- the gate could not establish a trustworthy measurement -- so
   * both are recorded here and both are counted. A record that carried only the first would report
   * `engine_error_count: 0` while failing the job, which is evidence that contradicts its own verdict.
   */
  const engineErrorRecords = [
    ...machinery.map((entry) => ({ code: entry.code, subject: entry.subject, detail: entry.detail ?? null, origin: "orchestrator" })),
    ...failClosedFindings
      .filter((entry) => entry.severity !== "ENGINE_ERROR")
      .map((entry) => ({ code: entry.code, subject: entry.subject, detail: null, origin: "engine_finding_escalated" })),
  ];
  const engineErrors = [
    ...normalized.filter((entry) => entry.severity === "ENGINE_ERROR"),
    ...engineErrorRecords.map((entry) => ({ code: entry.code, subject: entry.subject })),
  ];

  // The hosted verdict: the engine's verdict, raised to FAIL_CLOSED when the machinery itself is broken. A
  // policy violation stays a policy violation and therefore stays report-only.
  const machineryFailure = machinery.length > 0 || failClosedFindings.length > 0;
  const hostedVerdict = machineryFailure ? "MACHINERY_FAILURE" : verdict;
  const shadowVerdict = machineryFailure ? "MACHINERY_FAILURE" : verdict === "PASS" ? "PASS" : "POLICY_VIOLATION_REPORTED";

  const epoch = readTrustEpoch(root);
  const host = hostedEnvironment();

  const outDir = options.out
    ? (path.isAbsolute(options.out) ? options.out : path.join(root, options.out))
    : path.join(root, DEFAULT_OUT_DIR);

  const metadata = {
    schema: SCHEMA,
    generator: "scripts/architecture-shadow-hosted.cjs",
    mode: "shadow",
    hosted: host.hosted,
    hosted_provider: host.provider,
    hosted_environment: host.observed,
    hosted_absence_note: host.absence_note,
    fixture_mode: fixtureMode,
    commit_sha: process.env.GITHUB_SHA ?? null,
    workflow_run_id: process.env.GITHUB_RUN_ID ?? null,
    workflow_run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    job: process.env.GITHUB_JOB ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? null,
    runner_os: process.env.RUNNER_OS ?? null,
    baseline_version: baseline?.baseline_version ?? null,
    baseline_hash: baseline?.baseline_hash ?? null,
    baseline_series_status: authorization.authorized && structuralProblems.length === 0 ? "AUTHORISED" : "NOT_AUTHORISED",
    baseline_series_path: path.relative(root, seriesLoaded.path).split(path.sep).join("/"),
    baseline_series_authorization_reference: authorization.entry?.authorization_reference ?? null,
    baseline_self_consistent: selfConsistency.self_consistent,
    baseline_self_consistency_status: selfConsistencyStatus,
    baseline_self_consistency_skipped_by_fixture: Boolean(selfConsistency.skipped_by_fixture),
    baseline_recomputed_hash: selfConsistency.recomputed_baseline_hash,
    root_trust_epoch: epoch.trust_epoch,
    root_trust_surface_hash: epoch.root_surface_hash,
    root_trust_epoch_path: epoch.path,
    root_trust_epoch_read_error: epoch.read_error,
    shadow_verdict: shadowVerdict,
    engine_verdict: verdict,
    engine_error_count: engineErrors.length,
    machinery_failure_count: machinery.length + failClosedFindings.length,
    new_regressions: null,
    findings_semantic_hash: findingsHash,
    findings_digest_schema: DIGEST_SCHEMA,
    findings_count: normalized.length,
    findings_by_policy_class: {
      POLICY_VIOLATION: policyFindings.length,
      FAIL_CLOSED: failClosedFindings.length,
      INFORMATIONAL: informational.length,
    },
    policy_violation_count: policyFindings.length,
    engine_errors: engineErrors,
    engine_error_records: engineErrorRecords,
    // The unmodelled defect classes, READ FROM THE BASELINE AND NOT SUBSTITUTED.
    //
    // An earlier revision wrote `baseline?.not_yet_enforced ?? baselineModule.NOT_YET_ENFORCED`, which made an
    // ABSENT/UNREAD list indistinguishable from the module's default -- and the default is byte-identical to what
    // the committed baseline carries, so the published list was always the right five whatever the baseline said.
    // That silently defeated the spec's rule (docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md §5, rule 2) that "an
    // empty list and an unread list must be distinguishable", and it made the hosted job's own `not_yet_enforced`
    // assertion dead code. It is now reported as the baseline actually has it: the list when present (including
    // an EMPTY list, which is a real and meaningful value), and `null` plus a named engine error when the
    // baseline does not carry the field at all.
    not_yet_enforced: notYetEnforced.readable ? notYetEnforced.value : null,
    not_yet_enforced_status: notYetEnforced.status,
    not_yet_enforced_read_error: notYetEnforced.error,
    shadow_does_not_mean_ignore_errors: true,
    policy_note: "policy violations are reported and do not block; broken measurement or governance machinery fails closed",
    // The normalized set itself, so a LOCAL run of the same commit can be compared by identity rather than by
    // count. This is what makes HOSTED_LOCAL_PARITY a comparison of findings and not a comparison of numbers.
    findings_normalized: normalized,
    volatile: { generated_at: new Date().toISOString(), wall_time_ms: Date.now() - started },
  };

  // `new_regressions` is derived from the normalized set rather than left null: it is the count of policy
  // findings that are about the tree, which is the quantity the soak condition (a) speaks about.
  metadata.new_regressions = policyFindings.length;

  const shadowArtifact = {
    schema: enforcement.SCHEMA,
    mode: "shadow",
    // Measured provenance, not a constant -- see `hostedEnvironment`.
    hosted: host.hosted,
    hosted_provider: host.provider,
    orchestrated_by: SCHEMA,
    verdict,
    policy: {
      roles: { ratchet: "legacy control", observe: "truth sensor", enforce: "prospective policy" },
      hosted_line: "policy violation -> report-only; machinery failure -> fail-closed",
    },
    baseline: {
      path: path.relative(root, baselinePath).split(path.sep).join("/"),
      baseline_version: baseline?.baseline_version ?? null,
      baseline_hash: baseline?.baseline_hash ?? null,
      parent_baseline_hash: baseline?.parent_baseline_hash ?? null,
      source_commit: baseline?.source_commit ?? null,
    },
    series_authorization: {
      authorized: authorization.authorized && structuralProblems.length === 0,
      path: path.relative(root, seriesLoaded.path).split(path.sep).join("/"),
      authorization_reference: authorization.entry?.authorization_reference ?? null,
      problems: structuralProblems.length > 0 ? structuralProblems : authorization.problems,
    },
    measurement: measurement
      ? {
          files: Object.keys(measurement.files ?? {}).length,
          edges: (measurement.edges ?? []).length,
          unresolved: (measurement.unresolved ?? []).length,
          silent_skips: measurement.silent_skips ?? null,
        }
      : null,
    summary: {
      findings_total: normalized.length,
      violations: normalized.filter((entry) => entry.severity === "VIOLATION").length,
      engine_errors: engineErrors.length,
      policy_violations: policyFindings.length,
      fail_closed: failClosedFindings.length,
      informational: informational.length,
      new_regressions: metadata.new_regressions,
      findings_semantic_hash: findingsHash,
    },
    findings,
    // Both halves of "the gate could not measure": the orchestrator's own refusals, and the engine-reported
    // conditions this file escalates. See the note beside `engineErrorRecords`.
    machinery_failures: engineErrorRecords,
    hosted_verdict: hostedVerdict,
    volatile: { generatedAt: new Date().toISOString(), wall_time_ms: Date.now() - started },
  };

  fs.mkdirSync(outDir, { recursive: true });
  const shadowPath = path.join(outDir, DEFAULT_SHADOW_NAME);
  const metadataPath = options.metadata
    ? (path.isAbsolute(options.metadata) ? options.metadata : path.join(root, options.metadata))
    : path.join(outDir, DEFAULT_METADATA_NAME);
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(shadowPath, `${JSON.stringify(shadowArtifact, null, 2)}\n`, "utf8");
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  const summary = {
    schema: SCHEMA,
    hosted: host.hosted,
    hosted_provider: host.provider,
    not_yet_enforced_status: metadata.not_yet_enforced_status,
    fixture_mode: fixtureMode,
    shadow_verdict: shadowVerdict,
    engine_verdict: verdict,
    baseline_series_status: metadata.baseline_series_status,
    baseline_self_consistent: metadata.baseline_self_consistent,
    baseline_self_consistency_status: metadata.baseline_self_consistency_status,
    engine_error_count: metadata.engine_error_count,
    machinery_failure_count: metadata.machinery_failure_count,
    policy_violation_count: metadata.policy_violation_count,
    new_regressions: metadata.new_regressions,
    findings_count: metadata.findings_count,
    findings_semantic_hash: findingsHash,
    root_trust_epoch: metadata.root_trust_epoch,
    shadow_artifact: path.relative(root, shadowPath).split(path.sep).join("/"),
    metadata_artifact: path.relative(root, metadataPath).split(path.sep).join("/"),
    notes,
    exit_code: machineryFailure ? 1 : 0,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (options.requireSurface && metadata.root_trust_surface_hash === null) {
    process.stderr.write("architecture-shadow-hosted: --require-surface was requested but no trust epoch surface hash could be read\n");
    return 1;
  }
  return machineryFailure ? 1 : 0;
}

module.exports = {
  SCHEMA,
  DIGEST_SCHEMA,
  MACHINERY_CODES,
  classifyPolicy,
  normalizeFinding,
  sortNormalized,
  canonicalFinding,
  findingKey,
  semanticFindingsHash,
  compareFindings,
  hostedEnvironment,
  baselineSelfConsistency,
  readTrustEpoch,
  main,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`hosted architecture shadow failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
