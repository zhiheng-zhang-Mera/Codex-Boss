#!/usr/bin/env node
/**
 * Host-M P3 — long-run / soak harness CLI.
 *
 *   node scripts/host-soak.cjs --tier 30m [options]
 *
 * Options
 *   --tier smoke|30m|2h|8h|overnight   which tier to run (required)
 *   --seconds N        override the wall-clock budget (does not lower the tier's audit bar)
 *   --interval MS      sampling interval (default 5000)
 *   --work-dir PATH    where the run's ledger/breaker/heartbeat live (default: a temp dir)
 *   --heartbeat PATH   heartbeat file (default <work-dir>/heartbeat.json)
 *   --out PATH         write the report here
 *   --json             print the report JSON
 *   --quiet            suppress per-sample progress lines
 *
 * What this actually runs: real load through the real ExecutionSupervisor over a
 * durable TaskLedger, Scheduler, RecoveryScheduler and CircuitBreaker, with
 * synthetic runtimes. It is NOT a live browser/provider run, and the report says
 * so by listing renderer health as UNAVAILABLE with a reason.
 *
 * A run only passes when the tier's own duration was completed AND every measured
 * invariant held. Stopping early yields INCOMPLETE_WITH_PARTIAL_EVIDENCE — the
 * partial evidence is preserved and the exit code is non-zero. A host that cannot
 * sustain the run yields BLOCKED_EXTERNAL. Neither is ever PASS.
 *
 * Exit codes: 0 PASS, 1 FAIL, 3 BLOCKED_EXTERNAL, 4 INCOMPLETE_WITH_PARTIAL_EVIDENCE,
 * 2 when the harness could not run at all.
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function fail(message, code = 2) {
  console.error(`HOST_SOAK_ERROR ${message}`);
  process.exit(code);
}

function compiled(relative) {
  const file = path.join(repoRoot, "dist-electron", ...relative);
  if (!fs.existsSync(file)) fail(`missing ${path.relative(repoRoot, file)} — run: npx tsc -p tsconfig.electron.json`);
  return require(file);
}

function parseArgs(argv) {
  const options = { json: false, quiet: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    if (arg === "--tier") options.tier = next();
    else if (arg === "--seconds") options.budgetSeconds = Number(next());
    else if (arg === "--interval") options.sampleIntervalMs = Number(next());
    else if (arg === "--work-dir") options.workDir = path.resolve(next());
    else if (arg === "--heartbeat") options.heartbeatPath = path.resolve(next());
    else if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--json") options.json = true;
    else if (arg === "--quiet") options.quiet = true;
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

const EXIT = { PASS: 0, FAIL: 1, BLOCKED_EXTERNAL: 3, INCOMPLETE_WITH_PARTIAL_EVIDENCE: 4 };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return 0;
  }
  if (!options.tier) fail("--tier is required (smoke|30m|2h|8h|overnight)");

  const { runSoak, summarizeForLog } = compiled(["electron", "host", "soak-harness.js"]);
  const { soakTierSpec, renderSoakReport } = compiled(["src", "shared", "soak-harness.js"]);

  let spec;
  try {
    spec = soakTierSpec(options.tier);
  } catch (error) {
    return fail(String(error && error.message ? error.message : error));
  }

  // An interrupted host must still leave usable evidence, so the report is written
  // on every exit path.
  let interrupted = false;
  const onSignal = (signal) => {
    interrupted = true;
    console.log(`HOST_SOAK_SIGNAL ${signal} — finishing up and writing partial evidence`);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  const started = Date.now();
  const { report } = await runSoak({
    tier: spec.tier,
    workDir: options.workDir,
    sampleIntervalMs: options.sampleIntervalMs,
    budgetSeconds: options.budgetSeconds,
    heartbeatPath: options.heartbeatPath,
    shouldStop: () => interrupted,
    onSample: (sample, heartbeat) => {
      if (options.quiet) return;
      const seconds = Math.round(sample.elapsedMs / 1000);
      console.log(
        `HOST_SOAK_SAMPLE t=${seconds}s rss=${sample.rssMiB.toFixed(1)}MiB heap=${sample.heapUsedMiB.toFixed(1)}MiB ` +
          `handles=${sample.handles} queue=${sample.queueDepth} completed=${sample.completed} failed=${sample.failed} ` +
          `retries=${sample.retries} children=${sample.orphanProcesses} (${heartbeat.updatedAt})`
      );
    }
  });

  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2), "utf8");
  }

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("");
    console.log(renderSoakReport(report));
    console.log("");
    console.log(`wall clock: ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(`heartbeat:  ${report.heartbeatPath}`);
    if (options.out) console.log(`report:     ${path.relative(repoRoot, options.out)}`);
    console.log(summarizeForLog(report));
  }

  return EXIT[report.overall] ?? 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("HOST_SOAK_ERROR " + (error && error.stack ? error.stack : String(error)));
    process.exit(2);
  });
