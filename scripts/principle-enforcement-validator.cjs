#!/usr/bin/env node
/**
 * THE PRINCIPLE ENFORCEMENT MATRIX VALIDATOR (docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 23)
 *
 * WHY THIS PROGRAM EXISTS
 *
 *   Section 23 of the workbook asks for an enforcement matrix over principles 15.1-15.9, one row per principle,
 *   stating for each what is actually enforced and how. A matrix like that has an obvious failure mode: it is
 *   prose, so it can claim anything. The specific lie it invites is PROMOTION -- writing MACHINE ENFORCED beside
 *   a principle whose only guard is a REGRESSION RATCHET, so that "the count cannot silently grow back" is
 *   recorded as "the count is zero". Those are different claims and the tree can tell them apart.
 *
 *   So the matrix is data (config/principle-enforcement.json), and this program checks it against the tree:
 *
 *     1  every principle 15.1 through 15.9 appears exactly once, and no invented principle appears;
 *     2  each row states the strength section 23 requires AND the strength it actually has, and any shortfall
 *        between the two carries a non-empty why_not_enforced -- the gap is recorded, not hidden;
 *     3  every guard a row names EXISTS on disk;
 *     4  every named guard is READ-ONLY by source inspection, because a check that edits the tree is not a check;
 *     5  every named guard RUNS and EXITS 0 -- a row may not cite a guard that is currently failing;
 *     6  every named guard is REACHED by a named test file that mentions it, so "enforced" means "runs in a
 *        required tier", not "exists somewhere";
 *     7  the MEASURED value is not typed into the matrix at all: it is RESOLVED from the guard's own live output
 *        for the key the row names. A number that cannot be typed cannot drift away from the instrument;
 *     8  a row claiming MACHINE_ENFORCED must resolve to measured <= target with target === 0, so a non-zero
 *        measurement cannot be recorded as enforcement;
 *     9  a row claiming MACHINE_RATCHET must resolve ABOVE its target -- if the measurement ever reaches the
 *        target the row has to be promoted, and this program fails until it is;
 *    10  a row claiming EVIDENCE_REQUIRED must name a non-empty evidenceRequirement and decision records that
 *        exist, which is the machine-enforced half of a judgement the machine cannot make;
 *    11  a row claiming NOT_GUARDED must name the stage that owns the gap.
 *
 * WHAT IT REFUSES TO DO
 *
 *   It does not decide whether a principle is SATISFIED. It decides whether the MATRIX IS HONEST: whether every
 *   claim in it survives contact with the guard it cites. Section 23's closing instruction is "do not fake
 *   semantic certainty", and the only way to obey that in a program is to make the certain part machine-checked
 *   and to make the uncertain part declare itself.
 *
 * READ-ONLY. It runs other programs, reads their output, and writes nothing to the tree.
 *
 * USAGE
 *
 *   node scripts/principle-enforcement-validator.cjs                 check and print the matrix
 *   node scripts/principle-enforcement-validator.cjs --json          the report as JSON
 *   node scripts/principle-enforcement-validator.cjs --matrix        only the generated markdown table
 *   node scripts/principle-enforcement-validator.cjs --check         check and verify the committed doc is current
 *   node scripts/principle-enforcement-validator.cjs --write         regenerate the committed doc's table
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MATRIX_PATH = path.join("config", "principle-enforcement.json");
const DOC_PATH = path.join("docs", "city", "PHASE2_PRINCIPLE_ENFORCEMENT_MATRIX.md");
const RATCHET_PATH = path.join("config", "p2b-kernel-feature-ratchet.json");

const REQUIRED_IDS = ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7", "15.8", "15.9"];
const STRENGTHS = ["MACHINE_ENFORCED", "MACHINE_RATCHET", "EVIDENCE_REQUIRED", "NOT_GUARDED"];
const MACHINE_STRENGTHS = ["MACHINE_ENFORCED", "MACHINE_RATCHET"];
const BEGIN = "<!-- BEGIN GENERATED MATRIX -->";
const END = "<!-- END GENERATED MATRIX -->";

// The guard for each resolvable measurement key, so a row cannot resolve a key from a program it did not name.
const KEY_GUARD = {
  "p2b:kernelToFeatureFileEdges": "scripts/p2b-kernel-feature-ratchet.cjs",
  "p2b:kernelToFeaturePairs": "scripts/p2b-kernel-feature-ratchet.cjs",
  "p2b:mutualCapabilityPairs": "scripts/p2b-kernel-feature-ratchet.cjs",
  "p2b:largestSccSize": "scripts/p2b-kernel-feature-ratchet.cjs",
  "p2b:addedLateralLoad": "scripts/p2b-kernel-feature-ratchet.cjs",
  "p2d:confirmedAccesses": "scripts/phase2-private-state.cjs",
  "flatness:shapeProblems": "scripts/city-flatness-validator.cjs",
  "core:growth": "scripts/core-budget-validator.cjs",
};

// Source-text proxies for "this program does not write to the tree". A guard that mutates the tree while being
// cited as evidence of a property is not evidence of that property; the proxy is deliberately over-broad.
const WRITE_TOKENS = [
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmSync",
  "unlinkSync",
  "renameSync",
  "copyFileSync",
  "createWriteStream",
  "truncateSync",
  "chmodSync",
  "symlinkSync",
  "writeFile(",
  "appendFile(",
];

function readMatrix(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, MATRIX_PATH), "utf8"));
}

/**
 * Run a guard with --json and report what happened. Guard runs are cached by path so a guard cited by several
 * rows is executed once.
 */
function runGuard(relPath, root = ROOT) {
  const absolute = path.join(root, relPath);
  const result = {
    path: relPath,
    exists: fs.existsSync(absolute),
    readOnly: null,
    writeTokens: [],
    exitCode: null,
    json: null,
    parseError: null,
    stdout: "",
    stderr: "",
  };
  if (!result.exists) return result;

  const source = fs.readFileSync(absolute, "utf8");
  result.writeTokens = WRITE_TOKENS.filter((token) => source.includes(token));
  result.readOnly = result.writeTokens.length === 0;

  const run = spawnSync(process.execPath, [absolute, "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  result.exitCode = run.status;
  result.stdout = run.stdout ?? "";
  result.stderr = run.stderr ?? "";
  if (result.exitCode === 0) {
    try {
      result.json = JSON.parse(result.stdout);
    } catch (error) {
      result.parseError = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

function guardCache(root, cache) {
  return (relPath) => {
    if (!cache.has(relPath)) cache.set(relPath, runGuard(relPath, root));
    return cache.get(relPath);
  };
}

/**
 * Resolve a measurement key from the LIVE output of the guard that publishes it. Nothing is typed into the
 * matrix, so nothing in the matrix can drift away from the instrument.
 */
function resolveMeasured(key, getGuard, root = ROOT) {
  const guardPath = KEY_GUARD[key];
  if (!guardPath) return { key, ok: false, reason: `no guard is registered as publishing ${key}` };
  const guard = getGuard(guardPath);
  if (!guard.exists) return { key, ok: false, reason: `${guardPath} does not exist` };
  if (guard.exitCode !== 0) return { key, ok: false, reason: `${guardPath} exited ${guard.exitCode}` };
  if (guard.json === null) return { key, ok: false, reason: `${guardPath} --json produced no parseable report (${guard.parseError})` };

  const [source, field] = key.split(":");
  if (source === "p2b") {
    if (field === "addedLateralLoad") {
      // Added load is not a count the instruments publish; it is the RISE above the recorded accepted state,
      // summed over the three quantities the ratchet holds. A fall contributes zero, so the value is 0 exactly
      // when the tree carries no more lateral load than it was accepted carrying.
      const recorded = JSON.parse(fs.readFileSync(path.join(root, RATCHET_PATH), "utf8")).recorded;
      const measured = guard.json.measured ?? {};
      const parts = [
        ["kernel_to_feature_file_edges", measured.kernelToFeatureFileEdges],
        ["kernel_to_feature_pairs", measured.kernelToFeaturePairs],
        ["mutual_capability_pairs", measured.mutualCapabilityPairs],
      ];
      let added = 0;
      const detail = [];
      for (const [name, value] of parts) {
        const rise = Math.max(0, (value ?? 0) - (recorded[name] ?? 0));
        added += rise;
        detail.push(`${name} ${value} vs recorded ${recorded[name]} (+${rise})`);
      }
      return { key, ok: true, value: added, detail: detail.join("; ") };
    }
    const value = guard.json.measured?.[field];
    if (typeof value !== "number") return { key, ok: false, reason: `${guardPath} --json publishes no measured.${field}` };
    return { key, ok: true, value };
  }
  if (source === "core") {
    // The core budget publishes the quantity principle 15.9 is about: growth NOT covered by an Owner-approved
    // exception. An approved exception leaves this at 0, because docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 22 permits excepted growth; unapproved
    // growth raises it, and the guard fails at the same time.
    const value = guard.json.decision?.measured?.[field];
    if (typeof value !== "number") return { key, ok: false, reason: `${guardPath} --json publishes no decision.measured.${field}` };
    return { key, ok: true, value };
  }
  if (source === "p2d") {
    const value = guard.json.report?.[field];
    if (typeof value !== "number") return { key, ok: false, reason: `${guardPath} --json publishes no report.${field}` };
    return { key, ok: true, value };
  }
  if (source === "flatness") {
    if (field === "shapeProblems") {
      const problems = guard.json.problems;
      if (!Array.isArray(problems)) return { key, ok: false, reason: `${guardPath} --json publishes no problems array` };
      return { key, ok: true, value: problems.length };
    }
    const value = guard.json[field];
    if (typeof value !== "number") return { key, ok: false, reason: `${guardPath} --json publishes no ${field}` };
    return { key, ok: true, value };
  }
  return { key, ok: false, reason: `key ${key} has an unknown source` };
}

function mentionsGuard(root, testPath, guardPath) {
  const absolute = path.join(root, testPath);
  if (!fs.existsSync(absolute)) return false;
  const stem = path.basename(guardPath).replace(/\.cjs$/, "");
  return fs.readFileSync(absolute, "utf8").includes(stem);
}

/**
 * Validate the matrix. `options.getGuard` and `options.resolve` are seams for tests: they let the rules be
 * exercised against fabricated guards and measurements without running real programs.
 */
function validateMatrix(matrix, root = ROOT, options = {}) {
  const problems = [];
  const getGuard = options.getGuard ?? guardCache(root, new Map());
  const resolve = options.resolve ?? ((key) => resolveMeasured(key, getGuard, root));
  const rows = [];

  const principles = Array.isArray(matrix.principles) ? matrix.principles : [];
  const seen = principles.map((entry) => entry.id);
  for (const id of REQUIRED_IDS) {
    const count = seen.filter((value) => value === id).length;
    if (count === 0) problems.push(`principle ${id} has no row in the matrix`);
    if (count > 1) problems.push(`principle ${id} has ${count} rows; a principle has exactly one`);
  }
  for (const id of seen) if (!REQUIRED_IDS.includes(id)) problems.push(`row ${id} is not one of 15.1-15.9`);

  for (const entry of principles) {
    const id = entry.id;
    const row = { id, strength: entry.strength, requiredStrength: entry.requiredStrength, measured: [], guards: [] };
    rows.push(row);

    if (typeof entry.requiredStrength !== "string" || entry.requiredStrength.trim().length === 0) {
      problems.push(`${id}: requiredStrength is empty, so the row does not say what section 23 asks for`);
    }
    if (!STRENGTHS.includes(entry.strength)) {
      problems.push(`${id}: strength ${JSON.stringify(entry.strength)} is not one of ${STRENGTHS.join(", ")}`);
      continue;
    }
    // `requiredStrength` is section 23's own wording in docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md and is prose, so it is never compared to the enum. The rule
    // is positional instead: anything short of MACHINE_ENFORCED is a row that does NOT reach what docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 23 asks
    // for, and must therefore say why in its own words.
    if (entry.strength !== "MACHINE_ENFORCED" && (typeof entry.why_not_enforced !== "string" || entry.why_not_enforced.trim().length < 30)) {
      problems.push(`${id}: strength ${entry.strength} falls short of the required ${JSON.stringify(entry.requiredStrength)} and why_not_enforced does not explain it`);
    }

    const guards = Array.isArray(entry.guards) ? entry.guards : [];
    const wiredBy = Array.isArray(entry.wiredBy) ? entry.wiredBy : [];
    if (MACHINE_STRENGTHS.includes(entry.strength) && guards.length === 0) {
      problems.push(`${id}: claims ${entry.strength} and names no guard`);
    }
    if (guards.length > 0 && wiredBy.length === 0) {
      problems.push(`${id}: names guard(s) ${guards.join(", ")} but no test that reaches them`);
    }

    for (const guardPath of guards) {
      const guard = getGuard(guardPath);
      row.guards.push(guardPath);
      if (!guard.exists) {
        problems.push(`${id}: guard ${guardPath} does not exist`);
        continue;
      }
      if (guard.readOnly === false) {
        problems.push(`${id}: guard ${guardPath} writes to the tree (${guard.writeTokens.join(", ")}), so it cannot be cited as a check`);
      }
      if (guard.exitCode !== 0) {
        problems.push(`${id}: guard ${guardPath} exits ${guard.exitCode} -- a row may not cite a guard that is failing`);
      }
      if (guard.exitCode === 0 && guard.parseError) {
        problems.push(`${id}: guard ${guardPath} --json produced no parseable report (${guard.parseError})`);
      }
    }
    // Each cited test must reach at least one cited guard, and together the cited tests must reach ALL of them.
    // The union is what matters: a row with two guards usually has one test each, and demanding the cross-product
    // would force a row to under-report its guards to satisfy a rule about bookkeeping.
    const reached = new Set();
    for (const testPath of wiredBy) {
      if (!fs.existsSync(path.join(root, testPath))) {
        problems.push(`${id}: wiredBy names ${testPath}, which does not exist`);
        continue;
      }
      const hit = guards.filter((guardPath) => mentionsGuard(root, testPath, guardPath));
      if (guards.length > 0 && hit.length === 0) {
        problems.push(`${id}: wiredBy ${testPath} mentions none of the guards it is cited for (${guards.join(", ")})`);
      }
      for (const guardPath of hit) reached.add(guardPath);
    }
    for (const guardPath of guards) {
      if (wiredBy.length > 0 && !reached.has(guardPath)) {
        problems.push(`${id}: guard ${guardPath} is reached by no cited test, so nothing in a required tier invokes it`);
      }
    }

    const keys = [];
    if (typeof entry.measuredFrom === "string") keys.push({ part: null, key: entry.measuredFrom, target: entry.target });
    if (Array.isArray(entry.composite)) {
      if (entry.composite.length === 0) problems.push(`${id}: composite is empty`);
      for (const part of entry.composite) {
        if (typeof part?.measuredFrom !== "string" || typeof part?.target !== "number") {
          problems.push(`${id}: a composite part is missing measuredFrom or target`);
          continue;
        }
        keys.push({ part: part.part ?? null, key: part.measuredFrom, target: part.target });
      }
    }
    if (MACHINE_STRENGTHS.includes(entry.strength) && keys.length === 0) {
      problems.push(`${id}: claims ${entry.strength} but names nothing to measure it against`);
    }
    if (entry.strength === "MACHINE_ENFORCED" && typeof entry.target === "number" && entry.target !== 0) {
      problems.push(`${id}: claims MACHINE_ENFORCED with target ${entry.target}; enforcement means the target is 0`);
    }

    for (const { part, key, target } of keys) {
      const registered = KEY_GUARD[key];
      if (registered && !guards.includes(registered)) {
        problems.push(`${id}: resolves ${key} from ${registered}, which the row does not name as a guard`);
      }
      const resolved = resolve(key);
      if (!resolved.ok) {
        problems.push(`${id}: cannot resolve ${key} -- ${resolved.reason}`);
        continue;
      }
      row.measured.push({ part, key, value: resolved.value, target, detail: resolved.detail ?? null });
      if (entry.strength === "MACHINE_ENFORCED" && resolved.value > target) {
        problems.push(`${id}: claims MACHINE_ENFORCED but ${key} measures ${resolved.value} against target ${target}`);
      }
      if (entry.strength === "MACHINE_RATCHET" && typeof target === "number" && resolved.value <= target) {
        problems.push(`${id}: is recorded as MACHINE_RATCHET but ${key} measures ${resolved.value} at target ${target}; promote the row to MACHINE_ENFORCED`);
      }
    }

    if (entry.strength === "EVIDENCE_REQUIRED") {
      if (typeof entry.evidenceRequirement !== "string" || entry.evidenceRequirement.trim().length < 40) {
        problems.push(`${id}: EVIDENCE_REQUIRED without a substantive evidenceRequirement`);
      }
      const records = Array.isArray(entry.decisionRecords) ? entry.decisionRecords : [];
      if (records.length === 0) problems.push(`${id}: EVIDENCE_REQUIRED without a decision record`);
      for (const record of records) {
        if (!fs.existsSync(path.join(root, record))) problems.push(`${id}: decision record ${record} does not exist`);
      }
    }
    if (entry.strength === "NOT_GUARDED") {
      if (typeof entry.gap !== "string" || entry.gap.trim().length < 10) problems.push(`${id}: NOT_GUARDED without naming the stage that owns the gap`);
    }
  }

  const counts = {};
  for (const strength of STRENGTHS) counts[strength] = rows.filter((row) => row.strength === strength).length;

  return {
    schema: "city-principle-enforcement-report/1",
    matrix: MATRIX_PATH,
    ok: problems.length === 0,
    problems,
    rows,
    counts,
  };
}

function renderTable(report, matrix = readMatrix()) {
  const lines = [];
  lines.push("| principle | claim | section 23 requires | measured strength | guard | measured | target |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  const byId = new Map(matrix.principles.map((entry) => [entry.id, entry]));
  for (const row of report.rows) {
    const entry = byId.get(row.id) ?? {};
    const measured = row.measured.length === 0
      ? (row.strength === "NOT_GUARDED" ? "--" : "see decision record")
      : row.measured.map((item) => `${item.part ? `${item.part}: ` : ""}${item.value}${item.key === "p2b:addedLateralLoad" ? " (added)" : ""}`).join("; ");
    const target = row.measured.length === 0 ? "--" : row.measured.map((item) => item.target).join("; ");
    lines.push(`| ${row.id} | ${entry.claim ?? ""} | ${row.requiredStrength ?? ""} | ${row.strength} | ${row.guards.length > 0 ? row.guards.map((guard) => `\`${guard}\``).join(", ") : "--"} | ${measured} | ${target} |`);
  }
  return lines.join("\n");
}

function renderSummary(report) {
  const lines = [];
  lines.push(`[principles] matrix ${report.matrix}`);
  for (const row of report.rows) {
    const measured = row.measured.length === 0 ? "" : `  measured ${row.measured.map((item) => `${item.key}=${item.value}`).join(", ")}`;
    lines.push(`[principles]   ${row.id}  ${row.strength}  (requires: ${row.requiredStrength})${measured}`);
  }
  lines.push(`[principles] strengths ${Object.entries(report.counts).map(([key, value]) => `${key}=${value}`).join(" ")}`);
  if (report.ok) {
    lines.push("[principles] VERDICT=HONEST (every claim survives contact with the guard it cites)");
    return lines.join("\n");
  }
  lines.push(`[principles] VERDICT=DISHONEST (${report.problems.length} problem(s))`);
  for (const problem of report.problems) lines.push(`[principles]   - ${problem}`);
  return lines.join("\n");
}

function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

function docRegion(root) {
  const absolute = path.join(root, DOC_PATH);
  if (!fs.existsSync(absolute)) return null;
  const text = fs.readFileSync(absolute, "utf8");
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  return {
    text,
    start,
    end,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    current: normalizeEol(text.slice(start + BEGIN.length, end)).trim(),
  };
}

/**
 * Whether the committed document's generated region is the table this program generates.
 *
 * The comparison is LINE-ENDING AGNOSTIC, and that is not a convenience: the table is generated with LF, while
 * `git` checks the document out with CRLF on Windows, so a byte comparison passes on the machine that wrote the
 * file and fails on the runner that verifies it. The first CI run of this stage failed exactly that way. The
 * check still bites on real staleness, which is what the cases for this function pin.
 */
function regionMatches(text, table) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) return false;
  return normalizeEol(text.slice(start + BEGIN.length, end)).trim() === normalizeEol(table).trim();
}

function writeDoc(report, matrix = readMatrix(), root = ROOT) {
  const absolute = path.join(root, DOC_PATH);
  const table = renderTable(report, matrix);
  const region = docRegion(root);
  if (!region) {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `${BEGIN}\n${table}\n${END}\n`, "utf8");
    return { written: true, created: true };
  }
  // Preserve the document's own line ending so regenerating it on a CRLF checkout does not rewrite every line.
  const body = region.eol === "\r\n" ? table.replace(/\n/g, "\r\n") : table;
  const next = `${region.text.slice(0, region.start + BEGIN.length)}${region.eol}${body}${region.eol}${region.text.slice(region.end)}`;
  fs.writeFileSync(absolute, next, "utf8");
  return { written: true, created: false };
}

function main(argv, root = ROOT) {
  const matrix = readMatrix(root);
  const report = validateMatrix(matrix, root);

  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (argv.includes("--matrix")) {
    process.stdout.write(`${renderTable(report, matrix)}\n`);
  } else {
    process.stdout.write(`${renderSummary(report)}\n`);
  }

  if (argv.includes("--write")) {
    const result = writeDoc(report, matrix, root);
    if (!argv.includes("--json") && !argv.includes("--matrix")) {
      process.stderr.write(`[principles] wrote ${DOC_PATH}${result.created ? " (created)" : ""}\n`);
    }
    return report.ok ? 0 : 1;
  }

  if (argv.includes("--check")) {
    const absolute = path.join(root, DOC_PATH);
    if (!fs.existsSync(absolute) || docRegion(root) === null) {
      process.stderr.write(`[principles] ${DOC_PATH} has no ${BEGIN} ... ${END} region\n`);
      return 1;
    }
    if (!regionMatches(fs.readFileSync(absolute, "utf8"), renderTable(report, matrix))) {
      process.stderr.write(`[principles] ${DOC_PATH} is STALE; run --write\n`);
      return 1;
    }
  }

  return report.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`principle-enforcement-validator failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  validateMatrix,
  renderTable,
  renderSummary,
  readMatrix,
  runGuard,
  resolveMeasured,
  mentionsGuard,
  docRegion,
  regionMatches,
  normalizeEol,
  writeDoc,
  KEY_GUARD,
  REQUIRED_IDS,
  STRENGTHS,
  MATRIX_PATH,
  DOC_PATH,
  RATCHET_PATH,
};
