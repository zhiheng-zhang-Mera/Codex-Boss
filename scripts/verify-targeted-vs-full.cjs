#!/usr/bin/env node
/**
 * Phase 05 gate 2 — the targeted/full agreement record.
 *
 * The book's requirement has two halves, and the second is the one that can be faked:
 *
 *   1. a typical small change's fast verification runs only the affected suites;
 *   2. **the full gate for the same commit agrees** — the selector is a way to wait less, never a way
 *      to merge with less evidence.
 *
 * ## How the second half is checked here, rather than asserted
 *
 * The full suite is run first and its result recorded per file (`--reporter=json`). The selector then
 * decides which suites that commit would have run. The pairing is a comparison of two REAL lists:
 *
 *   - any file the selector SKIPPED that FAILED in the full run is a missed defect. That is the failure
 *     mode the book's rollback rule exists for, and it fails this script;
 *   - any file the full run did not contain, but the selector chose, is a phantom — the selection would
 *     have "passed" by pointing at nothing;
 *   - a file outside the catalogue entirely is reported, because the selector cannot speak about it.
 *
 * Usage:
 *   node scripts/verify-targeted-vs-full.cjs [--base <commit>] [--changed <path>]... [--run <json>]
 *
 * `--run` reuses a recorded full-suite result; without it the full unit tier is executed first, which
 * takes minutes. Either way the record written is derived from a real run rather than from a summary.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
/**
 * Where the pairing record is written.
 *
 * Overridable so a test can exercise the generator — including its refusal paths — without writing
 * over the record a reader trusts. The first version had a fixed path and a probe's rejected run
 * still overwrote the real record, so the "the probe did not disturb the record" assertion failed and
 * was right to.
 */
const OUT = process.env.GATE2_OUT
  ? path.resolve(process.env.GATE2_OUT)
  : path.join(ROOT, "artifacts", "platform-foundation", "phase-05", "targeted-vs-full.json");
const COMPILED = path.join(ROOT, "dist-electron");

function parseArgs(argv) {
  const options = { changed: [], base: undefined, run: undefined };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--base") options.base = argv[++index];
    else if (token === "--changed") options.changed.push(argv[++index]);
    else if (token === "--run") options.run = argv[++index];
    else { process.stderr.write(`unknown argument: ${token}\n`); process.exitCode = 2; return undefined; }
  }
  return options;
}

function git(args) {
  const result = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8", windowsHide: true });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * Every test file the build-dependent and slow tiers own, so a full-run miss is visible.
 *
 * Scoped to the ACTUAL tier declarations rather than to every quoted test path in the file: an earlier
 * version matched any `"tests/..."` string and so counted the desktop black-box contract — which is
 * claimed by its own primary layer and does run in the unit tier — as an other-tier suite, and then
 * reported it as a defect. The tier arrays are extracted by name instead.
 */
function tierFiles() {
  const text = fs.readFileSync(path.join(ROOT, "vitest.tiers.mjs"), "utf8");
  const blockFor = (name) => {
    const start = text.indexOf(`export const ${name}`);
    if (start < 0) return "";
    const end = text.indexOf("\n];", start);
    return end < 0 ? text.slice(start) : text.slice(start, end);
  };
  const slow = [...blockFor("SLOW_ACCEPTANCE_TESTS").matchAll(/"(tests\/[^"]+\.test\.tsx?)":/g)].map((match) => match[1]);
  const postbuild = [...blockFor("BUILD_DEPENDENT_TESTS").matchAll(/"(tests\/[^"]+\.test\.tsx?)"/g)].map((match) => match[1]);
  return { slow: [...new Set(slow)].sort(), postbuild: [...new Set(postbuild)].sort() };
}

function runFullSuite() {
  const outputFile = path.join(ROOT, "artifacts", "platform-foundation", "phase-05", "full-suite-run.json");
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  process.stdout.write("[gate2] running the full unit tier (this takes minutes)\n");
  const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
  const result = spawnSync(process.execPath, [vitest, "run", "--config", "vitest.unit.config.mjs", "--reporter=json", `--outputFile=${outputFile}`], {
    cwd: ROOT, stdio: "inherit", windowsHide: true
  });
  if (result.status !== 0) {
    process.stderr.write(`[gate2] the full suite did not pass (exit ${result.status}); a pairing against a failing run proves nothing\n`);
    process.exitCode = 1;
    return undefined;
  }
  return outputFile;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return 2;

  const runFile = options.run ? path.resolve(options.run) : runFullSuite();
  if (!runFile) return 1;
  if (!fs.existsSync(runFile)) {
    process.stderr.write(`[gate2] no full-suite record at ${runFile}\n`);
    return 1;
  }

  // The full run, per file, exactly as vitest reported it.
  const run = JSON.parse(fs.readFileSync(runFile, "utf8"));
  const ran = new Map();
  for (const result of run.testResults ?? []) {
    const file = path.relative(ROOT, result.name).split(path.sep).join("/");
    ran.set(file, { status: result.status, tests: (result.assertionResults ?? []).length });
  }

  // What the selector would have chosen for this commit.
  const impact = path.join(COMPILED, "electron", "platform", "test-impact.js");
  if (!fs.existsSync(impact)) {
    process.stderr.write("[gate2] the compiled impact selector is missing; run `pnpm run build:electron` first\n");
    return 1;
  }
  const platform = require(impact);
  const repository = platform.loadImpactRepository(ROOT);

  // The changed files: an explicit list, or what git reports against a base.
  let changedFiles = [...options.changed];
  let changedSetKnown = true;
  if (changedFiles.length === 0) {
    const base = options.base ?? "HEAD";
    const isAncestor = git(["merge-base", "--is-ancestor", base, "HEAD"]).status === 0;
    const diff = isAncestor ? git(["diff", "--name-only", `${base}...HEAD`]) : { status: 1, output: "" };
    if (!isAncestor || diff.status !== 0) {
      changedSetKnown = false;
    } else {
      changedFiles = diff.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }
  }

  const selection = platform.selectForChange(repository, changedFiles, changedSetKnown ? {} : { changedSetUnknown: true });
  const chosen = new Set(selection.selected.map((suite) => suite.file));
  const catalogue = new Set(repository.catalogue.map((suite) => suite.file));
  const tiers = tierFiles();
  /**
   * Suites that live in another tier.
   *
   * The pairing is against the UNIT tier as recorded, and seven catalogued suites deliberately run
   * elsewhere (`test:slow` and `test:postbuild`). Treating them as phantom was the first version's
   * mistake: the selector is right to choose them, and this run was never going to contain them. They
   * are reported as covered-by-another-tier instead, so the exclusion is visible rather than silent.
   */
  const outsideThisTier = new Set([...tiers.slow, ...tiers.postbuild]);

  // The pairing.
  const failedFiles = [...ran.entries()].filter(([, entry]) => entry.status !== "passed").map(([file]) => file).sort();
  const skippedThatFailed = failedFiles.filter((file) => catalogue.has(file) && !chosen.has(file));
  const chosenThatDidNotRun = [...chosen].filter((file) => !ran.has(file) && !outsideThisTier.has(file));
  const chosenInAnotherTier = [...chosen].filter((file) => !ran.has(file) && outsideThisTier.has(file)).sort();
  const ranOutsideCatalogue = [...ran.keys()].filter((file) => !catalogue.has(file)).sort();
  const skippedThatRan = [...ran.keys()].filter((file) => catalogue.has(file) && !chosen.has(file)).sort();

  const problems = [];
  if (failedFiles.length > 0) problems.push(`${failedFiles.length} file(s) failed in the full run: ${failedFiles.slice(0, 5).join(", ")}`);
  if (skippedThatFailed.length > 0) {
    problems.push(`the selector skipped ${skippedThatFailed.length} suite(s) that FAILED in the full run: ${skippedThatFailed.join(", ")}`);
  }
  if (chosenThatDidNotRun.length > 0) {
    problems.push(`the selector chose ${chosenThatDidNotRun.length} suite(s) that exist in no tier the full run covers: ${chosenThatDidNotRun.join(", ")}`);
  }
  // The tier split has to be a real partition, or "it runs in another tier" becomes an excuse for a
  // suite that runs nowhere. Checked as an invariant over the LISTS, not over how many were selected:
  // a given change legitimately selects only some of the other-tier suites.
  for (const file of outsideThisTier) {
    if (ran.has(file)) problems.push(`${file} is declared in another tier but ran in the unit run`);
  }
  for (const file of [...chosen]) {
    if (!ran.has(file) && !outsideThisTier.has(file)) problems.push(`${file} was chosen but is in no recorded tier and did not run`);
  }

  const record = {
    $comment: "Phase 05 gate 2. Derived from a REAL full-suite run recorded per file plus the selector's decision for the same commit; see scripts/verify-targeted-vs-full.cjs. A skipped-and-failed suite fails the generator.",
    generatedAt: new Date().toISOString(),
    phase: "05-scale-verification-soak",
    fullRun: {
      source: path.relative(ROOT, runFile).split(path.sep).join("/"),
      tier: "unit",
      files: ran.size,
      tests: run.numTotalTests ?? null,
      failedFiles,
      passed: failedFiles.length === 0
    },
    selection: {
      changedFiles,
      changedSetKnown,
      seeds: selection.seeds,
      affected: selection.affected,
      selected: [...chosen].sort(),
      selectedCount: chosen.size,
      skippedCount: selection.skipped.length,
      fullRunRequired: selection.fullRunRequired,
      fullRunReasons: selection.fullRunReasons,
      decisionReason: selection.decisionReason
    },
    pairing: {
      skippedThatFailed,
      chosenThatDidNotRun,
      /** Chosen and catalogued, but run by `test:slow` or `test:postbuild` rather than in this tier. */
      chosenInAnotherTier,
      ranOutsideCatalogue,
      skippedThatRan,
      skippedThatRanPassed: skippedThatRan.length
    },
    agreement: { agrees: problems.length === 0, problems }
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  process.stdout.write(`[gate2] full run: ${ran.size} file(s), ${run.numTotalTests ?? "?"} test(s), failed ${failedFiles.length}\n`);
  process.stdout.write(`[gate2] selection: ${chosen.size} chosen, ${selection.skipped.length} skipped, fullRunRequired=${selection.fullRunRequired}\n`);
  process.stdout.write(`[gate2] skipped-but-failed: ${skippedThatFailed.length}; chosen-but-absent: ${chosenThatDidNotRun.length}; outside catalogue: ${ranOutsideCatalogue.length}\n`);
  process.stdout.write(`[gate2] record: ${path.relative(ROOT, OUT)}\n`);

  if (problems.length > 0) {
    process.stderr.write(`[gate2] FAILED:\n  ${problems.join("\n  ")}\n`);
    return 1;
  }
  process.stdout.write("[gate2] the targeted selection and the full gate agree\n");
  return 0;
}

try {
  const code = main();
  if (typeof code === "number") process.exitCode = code;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
