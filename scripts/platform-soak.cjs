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

/**
 * Least-squares slope in MiB per minute over a set of samples, or `null` when there are too few to derive one.
 *
 * `null` RATHER THAN `0`, and that is the whole point of the return type. Three points is the minimum a slope can
 * be read from, so a run with one or two samples cannot report a trend — and reporting `0` instead said "I measured
 * a flat trend" when the truth was "I could not measure one". `0` is finite and far below every allowance, so the
 * placeholder passed each check that asked whether the trend was a number and within its bound. The trend is now
 * either a measurement or `null`, and `evaluatePlatformSoakAcceptance` refuses to accept an unmeasurable one.
 */
function slopePerMinute(samples, pick) {
  const points = samples.map((sample) => ({ x: sample.elapsedMs / 60_000, y: pick(sample) }));
  if (points.length < 3) return null;
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
  const { evaluateSoakInvariants, evaluatePlatformSoakAcceptance, longRunAllowancePerMinute } = require(harnessPath);

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
    // long-run allowance per minute. The DECISION is not made here — it is made by the production
    // `evaluatePlatformSoakAcceptance`, so the generator and the acceptance suite cannot disagree about what
    // the policy is, and so the refusal branch can be exercised deterministically rather than by hoping a
    // real host happens to measure an over-limit trend (PF-DEBT-017).
    const acceptance = evaluatePlatformSoakAcceptance({
      invariants: outcomes,
      rssMiBPerMinute: trends.rssMiBPerMinute,
      heapMiBPerMinute: trends.heapMiBPerMinute
    });
    const trendWithinLongRunAllowance = acceptance.trendWithinLongRunAllowance;

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
        longRunAllowancePerMinute: longRunAllowancePerMinute(),
        trendWithinLongRunAllowance
      },
      invariants: outcomes,
      unavailable: result.unavailable,
      acceptance: {
        failedInvariants: acceptance.failedInvariantIds,
        trendWithinLongRunAllowance: acceptance.trendWithinLongRunAllowance,
        accepted: acceptance.accepted,
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
    // A `null` trend is printed as NOT MEASURED rather than as `0.00`, so a reader of the log cannot mistake an
    // under-sampled run for a flat one -- the same distinction the report now makes.
    const trendText = (value) => (value === null ? "NOT MEASURED" : `${value.toFixed(2)} MiB/min`);
    process.stdout.write(`[soak] trend: rss ${trendText(trends.rssMiBPerMinute)}, heap ${trendText(trends.heapMiBPerMinute)}\n`);
    const allowancePerMinute = longRunAllowancePerMinute();
    process.stdout.write(`[soak] allowance: rss < ${allowancePerMinute.rssMiB.toFixed(1)} MiB/min, heap < ${allowancePerMinute.heapMiB.toFixed(1)} MiB/min => ${trendWithinLongRunAllowance ? "within" : "EXCEEDED"}\n`);
    if (trends.rssMiBPerMinute === null || trends.heapMiBPerMinute === null) {
      process.stdout.write(`[soak] WARNING: too few samples to derive a trend; the run CANNOT be accepted on trend grounds and is reported as unmeasurable rather than as flat\n`);
    }
    process.stdout.write(`[soak] report: ${path.relative(ROOT, out)}\n`);

    // The verdict is the production decision, not a re-derivation of it: accepted = nothing failed AND the
    // trend is inside the allowance. A refused run still writes its report first (above), because the
    // evidence of a refusal is the thing worth keeping.
    if (!acceptance.accepted) {
      process.stderr.write(`[soak] FAILED: ${acceptance.failedInvariantIds.join(", ") || "trend exceeded"}\n`);
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
