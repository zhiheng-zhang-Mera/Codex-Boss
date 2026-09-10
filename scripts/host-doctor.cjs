#!/usr/bin/env node
/**
 * Host-M P7 — Boss Doctor CLI.
 *
 *   node scripts/host-doctor.cjs [options]
 *
 * Options
 *   --data-root PATH   Boss data root (default <repo>/runtime-data, or --boss-data-dir=)
 *   --skip-network     do not probe outbound connectivity
 *   --timeout MS       network probe budget (default 6000)
 *   --json             print the report JSON
 *   --out PATH         also write the report here
 *
 * Advisory only. The doctor never blocks Boss: nothing in the app consults it, and
 * its verdict has no "stop" value. Every probe is fault-isolated, so a probe that
 * throws, a corrupt store or a missing prerequisite becomes one check's verdict and
 * the remaining checks still report. A probe that cannot be evaluated on this
 * machine is SKIPPED with the reason — never a silent READY and never a blocking
 * FAIL, because "we could not check" is not "this machine cannot run Boss".
 *
 * Exit codes: 0 READY, 1 DEGRADED, 3 BLOCKED, 2 the doctor itself could not run.
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function fail(message, code = 2) {
  console.error(`HOST_DOCTOR_ERROR ${message}`);
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
    if (arg === "--data-root") options.dataRoot = path.resolve(next());
    else if (arg === "--skip-network") options.skipNetwork = true;
    else if (arg === "--timeout") options.networkTimeoutMs = Number(next());
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

const EXIT = { READY: 0, DEGRADED: 1, BLOCKED: 3 };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return 0;
  }

  let runDoctor;
  let renderDoctorReport;
  let doctorRevision;
  try {
    ({ runDoctor, renderDoctorReport, doctorRevision } = {
      ...compiled(["electron", "host", "doctor.js"]),
      ...compiled(["src", "shared", "doctor.js"])
    });
  } catch (error) {
    return fail(String(error && error.message ? error.message : error));
  }

  const fromArgv = process.argv.find((arg) => arg.startsWith("--boss-data-dir="));
  const dataRoot = options.dataRoot || (fromArgv ? path.resolve(fromArgv.slice("--boss-data-dir=".length)) : path.join(repoRoot, "runtime-data"));

  // The doctor must not be able to prevent startup, so even its own failure is
  // reported as a report rather than as a crash.
  let report;
  try {
    report = await runDoctor({
      repoRoot,
      dataRoot,
      skipNetwork: options.skipNetwork,
      networkTimeoutMs: options.networkTimeoutMs
    });
  } catch (error) {
    fail(`the doctor could not run at all: ${String(error && error.stack ? error.stack : error)}`);
  }

  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify({ ...report, revision: doctorRevision(repoRoot) }, null, 2), "utf8");
  }

  if (options.json) console.log(JSON.stringify({ ...report, revision: doctorRevision(repoRoot) }, null, 2));
  else {
    console.log(renderDoctorReport(report));
    console.log("");
    console.log(`revision: ${doctorRevision(repoRoot)}`);
    console.log(`summary:  ${report.summary.ready} READY, ${report.summary.degraded} DEGRADED, ${report.summary.fail} FAIL, ${report.summary.skipped} SKIPPED`);
    if (options.out) console.log(`report:   ${path.relative(repoRoot, options.out)}`);
  }

  return EXIT[report.overall] ?? 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("HOST_DOCTOR_ERROR " + (error && error.stack ? error.stack : String(error)));
    process.exit(2);
  });
