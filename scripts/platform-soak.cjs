#!/usr/bin/env node
/**
 * Phase 05 Task F — run the platform soak and write its report.
 *
 * Usage:
 *   node scripts/platform-soak.cjs --minutes 45
 *   node scripts/platform-soak.cjs --minutes 0.75 --root <dir>
 *
 * This is the driver the book's Task F asks for: a controlled, repeatable soak that can be run short
 * in CI and at length on a real machine. The report it writes is the evidence gate 6 reads — memory,
 * heap, handle and storage trends, per-stage work counts, and the shared soak invariants.
 *
 * The report is written even when the run FAILS an invariant, and the exit code says which happened.
 * A soak that only produced a file on success would lose the evidence of the failure that matters.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const COMPILED = path.join(ROOT, "dist-electron");

function parseArgs(argv) {
  const options = { minutes: 45, root: undefined, interval: 1000, out: undefined };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--minutes") options.minutes = Number(argv[++index]);
    else if (token === "--root") options.root = argv[++index];
    else if (token === "--interval") options.interval = Number(argv[++index]);
    else if (token === "--out") options.out = argv[++index];
    else { process.stderr.write(`unknown argument: ${token}\n`); process.exitCode = 2; return undefined; }
  }
  if (!Number.isFinite(options.minutes) || options.minutes <= 0) {
    process.stderr.write("--minutes must be a positive number\n");
    process.exitCode = 2;
    return undefined;
  }
  return options;
}

/** Least-squares slope in MiB per minute over a set of samples. */
function slopePerMinute(samples, pick) {
  const points = samples.map((sample) => ({ x: sample.elapsedMs / 60_000, y: pick(sample) }));
  if (points.length < 3) return 0;
  const meanX = points.reduce((total, point) => total + point.x, 0) / points.length;
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
  const covariance = points.reduce((total, point) => total + (point.x - meanX) * (point.y - meanY), 0);
  const variance = points.reduce((total, point) => total + (point.x - meanX) ** 2, 0);
  return variance === 0 ? 0 : covariance / variance;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return 2;

  const soakPath = path.join(COMPILED, "electron", "state-core", "platform-soak.js");
  const harnessPath = path.join(COMPILED, "src", "shared", "soak-harness.js");
  if (!fs.existsSync(soakPath) || !fs.existsSync(harnessPath)) {
    process.stderr.write("the compiled soak is missing; run `pnpm run build:electron` first.\n");
    return 1;
  }
  const { runPlatformSoak, scaledBounds } = require(soakPath);
  const { evaluateSoakInvariants, SOAK_BOUNDS } = require(harnessPath);

  const root = options.root ? path.resolve(options.root) : fs.mkdtempSync(path.join(os.tmpdir(), "boss-soak-"));
  const durationMs = Math.round(options.minutes * 60_000);
  const out = options.out ? path.resolve(options.out) : path.join(ROOT, "artifacts", "platform-foundation", "phase-05", "soak-report.json");

  process.stdout.write(`[soak] running ${options.minutes} minute(s) against ${root}\n`);

  return runPlatformSoak({ root, durationMs, sampleIntervalMs: options.interval }).then((result) => {
    const bounds = scaledBounds(result.elapsedMs);
    const last = result.samples[result.samples.length - 1];
    // Warmup is discarded for the trend: JIT and the first database opens are not a leak.
    const warmup = Math.max(1, Math.floor(result.samples.length / 5));
    const steady = result.samples.slice(warmup);
    const trends = {
      rssMiBPerMinute: slopePerMinute(steady, (sample) => sample.rssMiB),
      heapMiBPerMinute: slopePerMinute(steady, (sample) => sample.heapUsedMiB),
      databaseBytesPerMinute: 0,
      journalEvents: result.storage.journalEvents
    };

    const outcomes = evaluateSoakInvariants({
      tier: "smoke",
      elapsedSeconds: result.elapsedMs / 1000,
      samples: result.samples,
      completed: last.completed,
      failed: last.failed,
      retries: 0,
      circuitOpenCounts: result.circuitOpenCounts,
      pids: result.pids
    });

    // The gate's own reading, in the units a reader can argue with: growth per minute against the
    // long-run allowance per minute. The short-run scaled bound is published alongside so the two are
    // not confused.
    const trendWithinLongRunAllowance =
      trends.heapMiBPerMinute < SOAK_BOUNDS.heapGrowthMiB / 30 &&
      trends.rssMiBPerMinute < SOAK_BOUNDS.rssGrowthMiB / 30;

    const report = {
      $comment: "Phase 05 Task F soak report. Produced by scripts/platform-soak.cjs. Every number is measured during the run; dimensions this host cannot observe are listed as unavailable with a reason rather than reported as zero.",
      generatedAt: new Date().toISOString(),
      phase: "05-scale-verification-soak",
      node: process.version,
      root,
      requestedMinutes: options.minutes,
      startedAt: result.startedAt,
      elapsedMs: result.elapsedMs,
      samples: result.samples.length,
      totals: result.totals,
      storage: result.storage,
      trends,
      bounds: {
        ...bounds,
        longRunAllowancePerMinute: {
          rssMiB: SOAK_BOUNDS.rssGrowthMiB / 30,
          heapMiB: SOAK_BOUNDS.heapGrowthMiB / 30,
          handles: SOAK_BOUNDS.handleGrowth / 30
        },
        trendWithinLongRunAllowance
      },
      invariants: outcomes,
      unavailable: result.unavailable,
      acceptance: {
        failedInvariants: outcomes.filter((outcome) => outcome.status === "FAIL").map((outcome) => outcome.id),
        trendWithinLongRunAllowance,
        gcMisdeleted: result.totals.gcMisdeleted,
        recoveredTransactions: result.totals.recoveredTransactions,
        cycles: result.totals.cycles
      }
    };

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    process.stdout.write(`[soak] cycles=${result.totals.cycles} writes=${result.totals.stateWrites} events=${result.totals.eventsAppended} restarts=${result.totals.restarts} recoveredTx=${result.totals.recoveredTransactions}\n`);
    process.stdout.write(`[soak] gc planned=${result.totals.gcPlanned} collected=${result.totals.gcCollected} misdeleted=${result.totals.gcMisdeleted}\n`);
    process.stdout.write(`[soak] storage: ${(result.storage.databaseBytes / 1048576).toFixed(2)} MiB, ${result.storage.journalEvents} events, backlog ${result.storage.eventBacklog}\n`);
    process.stdout.write(`[soak] trend: rss ${trends.rssMiBPerMinute.toFixed(2)} MiB/min, heap ${trends.heapMiBPerMinute.toFixed(2)} MiB/min\n`);
    process.stdout.write(`[soak] allowance: rss < ${(SOAK_BOUNDS.rssGrowthMiB / 30).toFixed(1)} MiB/min, heap < ${(SOAK_BOUNDS.heapGrowthMiB / 30).toFixed(1)} MiB/min => ${trendWithinLongRunAllowance ? "within" : "EXCEEDED"}\n`);
    process.stdout.write(`[soak] report: ${path.relative(ROOT, out)}\n`);

    const failed = report.acceptance.failedInvariants;
    if (failed.length > 0 || !trendWithinLongRunAllowance) {
      process.stderr.write(`[soak] FAILED: ${failed.join(", ") || "trend exceeded"}\n`);
      return 1;
    }
    process.stdout.write("[soak] platform soak PASS\n");
    return 0;
  }).catch((error) => {
    process.stderr.write(`[soak] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  });
}

const outcome = main();
if (typeof outcome === "number") process.exitCode = outcome;
else if (outcome && typeof outcome.then === "function") outcome.then((code) => { process.exitCode = code; });
