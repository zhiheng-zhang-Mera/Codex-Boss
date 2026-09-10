#!/usr/bin/env node
/**
 * Host-M P6 — regression sentinel CLI.
 *
 *   node scripts/host-regression.cjs [options]
 *
 * Options
 *   --capture PATH     capture the current checkout into PATH and stop
 *   --baseline PATH    baseline snapshot to compare against (required for compare)
 *   --candidate PATH   candidate snapshot (default: a fresh in-memory capture)
 *   --tests F,T,X      test measurement for the capture: files,tests,failed
 *   --update-baseline  write the capture to --baseline instead of failing when it is missing
 *   --json             print the report JSON
 *   --out PATH         also write the report here
 *
 * REPORT ONLY. The sentinel measures, compares and classifies; it never edits
 * production code, and nothing in it accepts a "fix" argument. Drift (an interface
 * or dependency changed) is reported and does not fail the run; a regression (a
 * failing or vanished acceptance check, fewer tests, a worse benchmark, a lower
 * provider success rate) does. A dimension with no measurement on either side is
 * UNAVAILABLE — a missing measurement is never treated as stability.
 *
 * Exit codes: 0 PASS, 1 FAIL (a regression), 2 the sentinel could not run,
 * 4 DRIFT (reported, non-fatal).
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function fail(message, code = 2) {
  console.error(`HOST_REGRESSION_ERROR ${message}`);
  process.exit(code);
}

function compiled(relative) {
  const file = path.join(repoRoot, "dist-electron", ...relative);
  if (!fs.existsSync(file)) fail(`missing ${path.relative(repoRoot, file)} — run: npx tsc -p tsconfig.electron.json`);
  return require(file);
}

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    if (arg === "--capture") options.capture = path.resolve(next());
    else if (arg === "--baseline") options.baseline = path.resolve(next());
    else if (arg === "--candidate") options.candidate = path.resolve(next());
    else if (arg === "--tests") options.tests = next();
    else if (arg === "--update-baseline") options.updateBaseline = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--help" || arg === "-h") options.help = true;
    else fail(`unknown option ${arg}`);
  }
  return options;
}

function helpText() {
  const source = fs.readFileSync(__filename, "utf8");
  const block = source.slice(source.indexOf("/**") + 3, source.indexOf("*/"));
  return block.split("\n").map((line) => line.replace(/^\s*\* ?/, "")).join("\n");
}

function parseTests(value) {
  if (!value) return undefined;
  const [files, tests, failed] = value.split(",").map((entry) => Number(entry.trim()));
  if (![files, tests, failed].every((entry) => Number.isFinite(entry))) fail(`--tests needs files,tests,failed (got "${value}")`);
  return { files, tests, failed };
}

const EXIT = { PASS: 0, FAIL: 1, DRIFT: 4 };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return 0;
  }

  const { captureSnapshot, tryReadSnapshot, writeSnapshot } = compiled(["electron", "host", "sentinel-capture.js"]);
  const { compareSnapshots, buildSentinelReport, renderSentinelReport, missingDimensions } = compiled([
    "src",
    "shared",
    "regression-sentinel.js"
  ]);

  const tests = parseTests(options.tests);

  // Capture mode: record what this checkout looks like, write nothing else.
  if (options.capture && !options.baseline) {
    const snapshot = captureSnapshot({ repoRoot, tests });
    writeSnapshot(options.capture, snapshot);
    const missing = missingDimensions(snapshot);
    console.log(`HOST_REGRESSION_CAPTURED ${options.capture}`);
    console.log(`revision ${snapshot.revision} (${snapshot.branch})`);
    console.log(`interfaces ${Object.keys(snapshot.interfaces ?? {}).length}, schemas ${Object.keys(snapshot.schemas ?? {}).length}, dependencies ${Object.keys(snapshot.dependencies ?? {}).length}`);
    if (missing.length) console.log(`UNAVAILABLE dimensions: ${missing.join(", ")}`);
    return 0;
  }

  let baseline = options.baseline ? tryReadSnapshot(options.baseline) : undefined;
  const candidate = options.candidate ? tryReadSnapshot(options.candidate) : captureSnapshot({ repoRoot, tests });

  if (!baseline) {
    if (options.updateBaseline && options.baseline && candidate) {
      writeSnapshot(options.baseline, candidate);
      console.log(`HOST_REGRESSION_BASELINE_WRITTEN ${options.baseline}`);
      console.log("no comparison was made: the baseline was just created");
      return 0;
    }
    // Without a baseline there is nothing to regress against — say so rather than
    // reporting a green comparison of a snapshot with itself.
    console.log("HOST_REGRESSION_NO_BASELINE no baseline snapshot exists; capturing one is the only honest outcome");
    if (options.baseline && candidate) writeSnapshot(options.baseline, candidate);
    console.log(`candidate revision ${candidate ? candidate.revision : "unknown"}`);
    return 2;
  }
  if (!candidate) fail("no candidate snapshot could be produced");

  const findings = compareSnapshots(baseline, candidate);
  const report = buildSentinelReport({ baseline, candidate, findings, generatedAt: new Date().toISOString() });

  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2), "utf8");
  }

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(renderSentinelReport(report));
    if (options.out) console.log(`\nreport: ${path.relative(repoRoot, options.out)}`);
  }

  return EXIT[report.overall] ?? 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("HOST_REGRESSION_ERROR " + (error && error.stack ? error.stack : String(error)));
    process.exit(2);
  });
