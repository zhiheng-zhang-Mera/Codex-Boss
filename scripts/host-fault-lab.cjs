#!/usr/bin/env node
/**
 * Host-M P2 — failure injection lab CLI.
 *
 *   node scripts/host-fault-lab.cjs [options]
 *
 * Options
 *   --fault a,b    run only these fault ids
 *   --json         print the report JSON
 *   --out PATH     also write the report here
 *   --verbose      list every inject/observe/contain step
 *
 * Each fault runs inside its own temporary directory against the real
 * subsystems, so nothing in this repository is modified and nothing has to be
 * rolled back. A fault is only clean when the injection took hold, the system
 * noticed it, and the system stayed usable — an injector that did nothing is
 * NOT_INJECTED, and a fault the system ignored is UNDETECTED. Both are failures;
 * neither is reported as a pass.
 *
 * Exit codes: 0 when every fault is CONTAINED or ACCEPTED_DEGRADATION; 1 when any
 * fault was not injected, undetected or uncontained; 2 when the lab could not run.
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function fail(message, code = 2) {
  console.error(`HOST_FAULT_LAB_ERROR ${message}`);
  process.exit(code);
}

function compiled(relative) {
  const file = path.join(repoRoot, "dist-electron", ...relative);
  if (!fs.existsSync(file)) fail(`missing ${path.relative(repoRoot, file)} — run: npx tsc -p tsconfig.electron.json`);
  return require(file);
}

function parseArgs(argv) {
  const options = { only: [], json: false, verbose: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    if (arg === "--fault") options.only.push(...next().split(",").map((entry) => entry.trim()).filter(Boolean));
    else if (arg === "--json") options.json = true;
    else if (arg === "--verbose") options.verbose = true;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return 0;
  }

  const { runFaultLab, injectorCoverage } = compiled(["electron", "host", "fault-lab.js"]);
  const { renderFaultLabReport } = compiled(["src", "shared", "fault-lab.js"]);

  const coverage = injectorCoverage();
  if (coverage.missing.length) {
    console.log(`HOST_FAULT_LAB_COVERAGE missing injectors for: ${coverage.missing.join(", ")}`);
  }
  if (coverage.undeclared.length) {
    console.log(`HOST_FAULT_LAB_COVERAGE injectors with no declaration: ${coverage.undeclared.join(", ")}`);
  }

  let report;
  try {
    report = await runFaultLab({ only: options.only });
  } catch (error) {
    return fail(String(error && error.stack ? error.stack : error));
  }

  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2), "utf8");
  }

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(renderFaultLabReport(report));
    if (options.verbose) {
      for (const result of report.results) {
        console.log("");
        console.log(`  ${result.id} (${result.verdict})`);
        for (const step of result.steps) {
          console.log(`    ${step.ok ? "ok  " : "FAIL"} ${step.step.padEnd(8)} ${step.detail}`);
        }
        if (!result.steps.length && result.detail) console.log(`    reason: ${result.detail}`);
      }
    }
    console.log("");
    if (options.out) console.log(`report: ${path.relative(repoRoot, options.out)}`);
  }

  return report.overall === "PASS" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("HOST_FAULT_LAB_ERROR " + (error && error.stack ? error.stack : String(error)));
    process.exit(2);
  });
