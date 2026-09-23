#!/usr/bin/env node
/**
 * Capability City Phase 1B-A — baseline series authorization.
 *
 * Specification (normative): docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md, sections 6, 7 and 13
 * (PB-AC-06..PB-AC-08).
 *
 * THE QUESTION THIS MODULE ANSWERS
 *   A baseline says "these relations existed before enforcement". Regenerating one is trivially available to
 *   any actor that can run node, so a gate built on a regenerable baseline is a gate that can be laundered:
 *
 *       CI fails -> regenerate the baseline -> new debt becomes grandfathered -> CI passes
 *
 *   This module closes that path mechanically. A baseline GOVERNS only when its
 *   (baseline_version, parent_baseline_hash, baseline_hash) triple appears in the ACCEPTED series held in
 *   `trust-policy/architecture-enforcement-baselines.json` — and that file is Root Trust Surface, so adding an
 *   entry is an Owner-reviewed governance act rather than a step in a build.
 *
 * TWO THINGS, NAMED DIFFERENTLY, BECAUSE THEY ARE DIFFERENT
 *   candidate baseline  what the generator measured. It governs nothing, grandfathers nothing, and is not
 *                       accepted until the series says so.
 *   accepted baseline   a candidate whose triple an Owner-authorized series entry names, and which satisfies
 *                       the evolution rules below (no version reuse, no skipped version, no fork, no
 *                       forgotten retirement, no reintroduced debt, no expanded NOT_YET_ENFORCED set).
 *
 * SELF-CONSISTENCY IS NOT AUTHORIZATION
 *   `--check` can prove a baseline is internally consistent and reproducible from the tree it was generated
 *   at. That is exactly what a laundered baseline is. Self-consistency is therefore necessary and never
 *   sufficient: the triple has to be authorized, and that fact lives outside the regenerable artifact.
 *
 * USAGE
 *   node scripts/architecture-baseline-series.cjs --check       # is the committed baseline authorized?
 *   node scripts/architecture-baseline-series.cjs --show        # the accepted series, as recorded
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const SERIES_PATH = path.join(ROOT, "trust-policy", "architecture-enforcement-baselines.json");
const BASELINE_PATH = path.join(ROOT, "config", "architecture-enforcement-baseline.json");
const SERIES_SCHEMA = "city-architecture-enforcement-baseline-series/1";
const SERIES_NAME = "city-architecture-enforcement-baseline";

/** Machine codes. Every refusal names itself, so a log says which rule fired rather than "invalid". */
const CODE = {
  BASELINE_SERIES_UNAUTHORISED: "BASELINE_SERIES_UNAUTHORISED",
  BASELINE_SERIES_MISSING: "BASELINE_SERIES_MISSING",
  BASELINE_SERIES_MALFORMED: "BASELINE_SERIES_MALFORMED",
  BASELINE_SERIES_EMPTY: "BASELINE_SERIES_EMPTY",
  BASELINE_TRIPLE_INCOMPLETE: "BASELINE_TRIPLE_INCOMPLETE",
  BASELINE_HASH_INVALID: "BASELINE_HASH_INVALID",
  BASELINE_HASH_MISMATCH: "BASELINE_HASH_MISMATCH",
  BASELINE_VERSION_NOT_SEQUENTIAL: "BASELINE_VERSION_NOT_SEQUENTIAL",
  BASELINE_VERSION_REUSED: "BASELINE_VERSION_REUSED",
  BASELINE_PARENT_MISMATCH: "BASELINE_PARENT_MISMATCH",
  BASELINE_FORK: "BASELINE_FORK",
  BASELINE_HEAD_NOT_TRACKED: "BASELINE_HEAD_NOT_TRACKED",
  NOT_YET_ENFORCED_EXPANDED: "NOT_YET_ENFORCED_EXPANDED",
  RETIRED_EDGE_FORGOTTEN: "RETIRED_EDGE_FORGOTTEN",
  REINTRODUCED_DEBT: "REINTRODUCED_DEBT",
};

const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_HEX = /^[0-9a-f]{40}$/;

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function isSha256Hex(value) {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function problem(code, detail) {
  return { code, detail: detail ?? null };
}

/** The triple that identifies a baseline in the series. */
function tripleOf(baseline) {
  return {
    baseline_version: Number.isInteger(baseline?.baseline_version) ? baseline.baseline_version : null,
    parent_baseline_hash: baseline?.parent_baseline_hash ?? null,
    baseline_hash: baseline?.baseline_hash ?? null,
  };
}

function tripleKey(triple) {
  return `${triple.baseline_version}\u0000${triple.parent_baseline_hash ?? "null"}\u0000${triple.baseline_hash}`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Load the series. A missing or unreadable series is a REFUSAL with its own code, never an empty series: an
 * absent authorization file must not read as "nothing is authorized, carry on".
 */
function loadSeries(file = SERIES_PATH) {
  if (!fs.existsSync(file)) return { path: file, value: null, problems: [problem(CODE.BASELINE_SERIES_MISSING, file)] };
  try {
    return { path: file, value: readJson(file), problems: [] };
  } catch (error) {
    return { path: file, value: null, problems: [problem(CODE.BASELINE_SERIES_MALFORMED, `${file}: ${error.message}`)] };
  }
}

/**
 * Structural + chain validation of the series itself.
 *
 * The chain rules are what make "version N+1" mean something: exactly one ACCEPTED entry per version, versions
 * contiguous from 1, each entry's parent equal to the previous entry's hash, and no hash used twice. A series
 * that forks or skips cannot be used to authorize anything, so a fork is refused before a triple is looked up.
 */
function validateSeries(value) {
  const problems = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [problem(CODE.BASELINE_SERIES_MALFORMED, "the series is not an object")];
  }
  if (value.schema !== SERIES_SCHEMA) problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `schema is ${JSON.stringify(value.schema)}, expected ${SERIES_SCHEMA}`));
  if (value.series !== SERIES_NAME) problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `series is ${JSON.stringify(value.series)}, expected ${SERIES_NAME}`));
  const accepted = value.accepted;
  if (!Array.isArray(accepted)) return problems.concat([problem(CODE.BASELINE_SERIES_MALFORMED, "accepted is not an array")]);
  if (accepted.length === 0) return problems.concat([problem(CODE.BASELINE_SERIES_EMPTY, "the series names no accepted baseline")]);

  for (const entry of accepted) {
    const where = `version ${entry?.baseline_version ?? "(missing)"}`;
    if (!Number.isInteger(entry?.baseline_version) || entry.baseline_version < 1) {
      problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `${where}: baseline_version is not a positive integer`));
    }
    if (!isSha256Hex(entry?.baseline_hash)) problems.push(problem(CODE.BASELINE_HASH_INVALID, `${where}: baseline_hash is not a sha256 hex digest`));
    if (entry?.baseline_version === 1) {
      if (entry?.parent_baseline_hash !== null) problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `${where}: version 1 must have a null parent`));
    } else if (!isSha256Hex(entry?.parent_baseline_hash)) {
      problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `${where}: parent_baseline_hash is not a sha256 hex digest`));
    }
    if (entry?.status !== "ACCEPTED") problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `${where}: status is ${JSON.stringify(entry?.status)}, expected ACCEPTED`));
    if (typeof entry?.authorization_reference !== "string" || entry.authorization_reference.trim().length < 12) {
      problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `${where}: authorization_reference is missing or says nothing`));
    }
    if (typeof entry?.evidence_reference !== "string" || entry.evidence_reference.trim().length < 8) {
      problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `${where}: evidence_reference is missing or says nothing`));
    }
    if (typeof entry?.accepted_at !== "string" || Number.isNaN(Date.parse(entry.accepted_at))) {
      problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `${where}: accepted_at is not a timestamp`));
    }
    if (typeof entry?.source_commit !== "string" || !COMMIT_HEX.test(entry.source_commit)) {
      problems.push(problem(CODE.BASELINE_SERIES_MALFORMED, `${where}: source_commit is not a git object id`));
    }
  }
  if (problems.length > 0) return problems;

  const byVersion = new Map();
  const seenHashes = new Map();
  for (const entry of accepted) {
    if (byVersion.has(entry.baseline_version)) problems.push(problem(CODE.BASELINE_VERSION_REUSED, `version ${entry.baseline_version} appears more than once`));
    byVersion.set(entry.baseline_version, entry);
    if (seenHashes.has(entry.baseline_hash)) problems.push(problem(CODE.BASELINE_VERSION_REUSED, `baseline hash ${entry.baseline_hash.slice(0, 12)}… is used by two versions`));
    seenHashes.set(entry.baseline_hash, entry.baseline_version);
  }

  const ordered = [...byVersion.values()].sort((left, right) => left.baseline_version - right.baseline_version);
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    if (entry.baseline_version !== index + 1) {
      problems.push(problem(CODE.BASELINE_VERSION_NOT_SEQUENTIAL, `the series jumps to version ${entry.baseline_version} where ${index + 1} was expected`));
      break;
    }
    if (index === 0) continue;
    const previous = ordered[index - 1];
    if (entry.parent_baseline_hash !== previous.baseline_hash) {
      problems.push(problem(CODE.BASELINE_FORK, `version ${entry.baseline_version} names parent ${String(entry.parent_baseline_hash).slice(0, 12)}… but version ${previous.baseline_version} is ${previous.baseline_hash.slice(0, 12)}…`));
    }
  }
  return problems;
}

/** The accepted entries, sorted by version. */
function acceptedEntries(value) {
  if (!Array.isArray(value?.accepted)) return [];
  return [...value.accepted].sort((left, right) => left.baseline_version - right.baseline_version);
}

/** The head of the accepted series: the baseline that governs right now. */
function headEntry(value) {
  const entries = acceptedEntries(value);
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

/**
 * Is this exact triple authorized? Structural validity of the series is a precondition: a malformed or
 * forked series authorizes nothing, even if it happens to contain a matching line.
 */
function authorizeTriple(value, triple) {
  const problems = validateSeries(value);
  if (problems.length > 0) return { authorized: false, entry: null, problems };
  const wanted = tripleKey(triple);
  const entry = acceptedEntries(value).find((candidate) => tripleKey(candidate) === wanted) ?? null;
  if (!entry) {
    return {
      authorized: false,
      entry: null,
      problems: [problem(CODE.BASELINE_SERIES_UNAUTHORISED, `(${triple.baseline_version}, ${String(triple.parent_baseline_hash).slice(0, 12)}…, ${String(triple.baseline_hash).slice(0, 12)}…) is not in ${path.relative(ROOT, SERIES_PATH).split(path.sep).join("/")}`)],
    };
  }
  return { authorized: true, entry, problems: [] };
}

function edgeKey(edge) {
  return `${edge?.[0]}\u0000${edge?.[1]}`;
}

function edgeSet(edges) {
  return new Set((Array.isArray(edges) ? edges : []).map(edgeKey));
}

/**
 * What an accepted evolution would change, enumerated by identity. Counts are printed for legibility, but the
 * accounting is a list: "the debt grew by 3" is not a reviewable statement, "these three relations became
 * grandfathered" is.
 */
function diffBaselines(parent, candidate) {
  const parentEdges = edgeSet(parent?.edges);
  const candidateEdges = edgeSet(candidate?.edges);
  const parentRetired = edgeSet(parent?.retired_edges);
  const candidateRetired = edgeSet(candidate?.retired_edges);
  const parentFiles = new Set(Object.keys(parent?.files ?? {}));
  const candidateFiles = new Set(Object.keys(candidate?.files ?? {}));
  const setDiff = (left, right) => [...left].filter((key) => !right.has(key)).sort();
  return {
    added_edges: setDiff(candidateEdges, parentEdges).map((key) => key.split("\u0000")),
    removed_edges: setDiff(parentEdges, candidateEdges).map((key) => key.split("\u0000")),
    added_files: [...candidateFiles].filter((file) => !parentFiles.has(file)).sort(),
    removed_files: [...parentFiles].filter((file) => !candidateFiles.has(file)).sort(),
    retired_added: setDiff(candidateRetired, parentRetired).map((key) => key.split("\u0000")),
    retired_forgotten: setDiff(parentRetired, candidateRetired).map((key) => key.split("\u0000")),
    reintroduced_retired_edges: [...parentRetired].filter((key) => candidateEdges.has(key)).map((key) => key.split("\u0000")).sort(),
    not_yet_enforced_added: (candidate?.not_yet_enforced ?? []).filter((klass) => !(parent?.not_yet_enforced ?? []).includes(klass)),
    not_yet_enforced_removed: (parent?.not_yet_enforced ?? []).filter((klass) => !(candidate?.not_yet_enforced ?? []).includes(klass)),
  };
}

/**
 * The rules an evolution must satisfy to be accepted (docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md, section 7):
 *   - the candidate's version/parent must be the next link in the ACCEPTED chain, and the candidate must BE
 *     the newest accepted version — an older version cannot be re-accepted over a newer one;
 *   - the triple is named by an ACCEPTED series entry — authorization precedes acceptance, never follows it;
 *   - the committed baseline must be the chain link the candidate builds on (otherwise the acceptance would be
 *     measured against a state the chain does not recognise);
 *   - the recomputed content hash equals the declared one;
 *   - debt may disappear and retirement is remembered, but retired debt may not return and the
 *     NOT_YET_ENFORCED set may only stay the same or shrink.
 *
 * The head rule is the one that is easy to get backwards. Authorization must exist BEFORE acceptance, so at the
 * moment of acceptance the series already contains the candidate's entry and the candidate is therefore the
 * head — the state the candidate builds on is its PARENT entry, not the head. Requiring the committed baseline
 * to equal the head made acceptance impossible, which this function originally did; the test that caught it is
 * `control: a properly authorized, monotone evolution IS accepted`.
 */
function assessAcceptance(input) {
  const { series, candidate, currentBaseline, computedHash } = input;
  const problems = [];
  const seriesProblems = validateSeries(series);
  if (seriesProblems.length > 0) return { ok: false, problems: seriesProblems, diff: null };

  const entries = acceptedEntries(series);
  const triple = tripleOf(candidate);
  const candidateEntry = entries.find((entry) => tripleKey(entry) === tripleKey(triple)) ?? null;

  if (!candidateEntry) {
    // Distinguish "your parent is wrong" from "nothing authorized this", because a reader has to be able to
    // tell an unrecorded baseline from a mis-linked one.
    const sameVersionAndHash = entries.find((entry) => entry.baseline_version === triple.baseline_version && entry.baseline_hash === triple.baseline_hash) ?? null;
    if (sameVersionAndHash) {
      problems.push(problem(CODE.BASELINE_PARENT_MISMATCH, `version ${triple.baseline_version} is accepted with parent ${String(sameVersionAndHash.parent_baseline_hash).slice(0, 12)}… but the candidate names ${String(triple.parent_baseline_hash).slice(0, 12)}…`));
    } else {
      const authorization = authorizeTriple(series, triple);
      problems.push(...authorization.problems);
    }
  } else {
    const highest = entries[entries.length - 1];
    if (candidateEntry.baseline_version !== highest.baseline_version) {
      problems.push(problem(CODE.BASELINE_VERSION_NOT_SEQUENTIAL, `version ${candidateEntry.baseline_version} cannot be accepted while version ${highest.baseline_version} is the accepted head`));
    }
    const parentEntry = entries.find((entry) => entry.baseline_version === candidateEntry.baseline_version - 1) ?? null;
    const expectedParentHash = parentEntry ? parentEntry.baseline_hash : null;
    if (candidateEntry.baseline_version > 1) {
      if (!currentBaseline) {
        problems.push(problem(CODE.BASELINE_HEAD_NOT_TRACKED, `version ${candidateEntry.baseline_version} builds on ${String(expectedParentHash).slice(0, 12)}… but no committed baseline exists`));
      } else if (currentBaseline.baseline_version !== parentEntry.baseline_version || currentBaseline.baseline_hash !== expectedParentHash) {
        problems.push(problem(CODE.BASELINE_HEAD_NOT_TRACKED, `the committed baseline is version ${currentBaseline.baseline_version} (${String(currentBaseline.baseline_hash).slice(0, 12)}…) but version ${candidateEntry.baseline_version} builds on version ${parentEntry.baseline_version} (${String(expectedParentHash).slice(0, 12)}…)`));
      }
    }
    if (candidate?.parent_baseline_hash !== expectedParentHash) {
      problems.push(problem(CODE.BASELINE_PARENT_MISMATCH, `the candidate names parent ${String(candidate?.parent_baseline_hash).slice(0, 12)}… but the accepted chain says ${String(expectedParentHash).slice(0, 12)}…`));
    }
  }

  if (isSha256Hex(computedHash) && candidate?.baseline_hash !== computedHash) {
    problems.push(problem(CODE.BASELINE_HASH_MISMATCH, `the declared hash ${String(candidate?.baseline_hash).slice(0, 12)}… is not the content hash ${computedHash.slice(0, 12)}…`));
  }

  // Monotonicity is measured against the accepted parent, which is the state the candidate builds on.
  const parentEntry = candidateEntry ? entries.find((entry) => entry.baseline_version === candidateEntry.baseline_version - 1) ?? null : null;
  const comparisonBase = currentBaseline ?? null;
  const diff = comparisonBase ? diffBaselines(comparisonBase, candidate) : null;
  if (diff && parentEntry) {
    if (diff.not_yet_enforced_added.length > 0) {
      problems.push(problem(CODE.NOT_YET_ENFORCED_EXPANDED, `the candidate adds defect classes Phase 1A does not model: ${diff.not_yet_enforced_added.join(", ")}`));
    }
    if (diff.retired_forgotten.length > 0) {
      problems.push(problem(CODE.RETIRED_EDGE_FORGOTTEN, `the candidate forgets retired debt: ${diff.retired_forgotten.map((edge) => edge.join(" -> ")).join(", ")}`));
    }
    if (diff.reintroduced_retired_edges.length > 0) {
      problems.push(problem(CODE.REINTRODUCED_DEBT, `the candidate re-grandfathers retired debt: ${diff.reintroduced_retired_edges.map((edge) => edge.join(" -> ")).join(", ")}`));
    }
  }
  return { ok: problems.length === 0, problems, diff };
}

/**
 * The governing check: is the committed baseline authorized?
 *
 * This is the function the engine and the generator both call for the DEFAULT baseline. It answers the three
 * questions separately, because they fail differently and a reader has to be able to tell which one fired:
 * is the series well formed, is the committed baseline in it, and does the baseline's own series identity
 * agree with what the series records.
 */
function verifyGoverningBaseline(options = {}) {
  const seriesFile = options.seriesFile ?? SERIES_PATH;
  const baselinePath = options.baselinePath ?? BASELINE_PATH;
  const loaded = loadSeries(seriesFile);
  if (loaded.problems.length > 0) {
    return { ok: false, code: loaded.problems[0].code, problems: loaded.problems, triple: null, entry: null, seriesPath: seriesFile, baselinePath };
  }
  let baseline;
  try {
    baseline = readJson(baselinePath);
  } catch (error) {
    return {
      ok: false,
      code: CODE.BASELINE_HEAD_NOT_TRACKED,
      problems: [problem(CODE.BASELINE_HEAD_NOT_TRACKED, `the committed baseline could not be read: ${error.message}`)],
      triple: null,
      entry: null,
      seriesPath: seriesFile,
      baselinePath,
    };
  }
  const triple = tripleOf(baseline);
  const authorization = authorizeTriple(loaded.value, triple);
  return {
    ok: authorization.authorized,
    code: authorization.problems.length > 0 ? authorization.problems[0].code : null,
    problems: authorization.problems,
    triple,
    entry: authorization.entry,
    seriesPath: seriesFile,
    baselinePath,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const show = argv.includes("--show");
  const check = argv.includes("--check");
  if (!show && !check) {
    process.stderr.write("usage: architecture-baseline-series.cjs --check|--show\n");
    return 2;
  }
  const loaded = loadSeries();
  if (show) {
    const problems = validateSeries(loaded.value);
    process.stdout.write(`${JSON.stringify({
      path: path.relative(ROOT, loaded.path).split(path.sep).join("/"),
      schema: loaded.value?.schema ?? null,
      accepted_versions: acceptedEntries(loaded.value).map((entry) => entry.baseline_version),
      head: headEntry(loaded.value)?.baseline_hash ?? null,
      structurally_valid: problems.length === 0,
      problems,
    }, null, 2)}\n`);
    return problems.length === 0 ? 0 : 1;
  }
  const result = verifyGoverningBaseline();
  const payload = {
    state: result.ok ? "BASELINE_SERIES_AUTHORISED" : (result.code ?? CODE.BASELINE_SERIES_UNAUTHORISED),
    authorized: result.ok,
    series: path.relative(ROOT, result.seriesPath).split(path.sep).join("/"),
    baseline: path.relative(ROOT, result.baselinePath).split(path.sep).join("/"),
    triple: result.triple,
    authorization_reference: result.entry?.authorization_reference ?? null,
    problems: result.problems,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

module.exports = {
  ROOT,
  SERIES_PATH,
  BASELINE_PATH,
  SERIES_SCHEMA,
  SERIES_NAME,
  CODE,
  sha256,
  isSha256Hex,
  tripleOf,
  tripleKey,
  loadSeries,
  validateSeries,
  acceptedEntries,
  headEntry,
  authorizeTriple,
  diffBaselines,
  assessAcceptance,
  verifyGoverningBaseline,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`baseline series check failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
