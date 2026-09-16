#!/usr/bin/env node
/**
 * Explicit architecture-baseline update (platform foundation, Phase 01 Task D).
 *
 * This is the ONLY writer of `config/architecture-baseline.json`. Nothing in the
 * test tier may rewrite it — an architecture baseline that a test can widen is not a
 * ratchet, it is a rubber stamp. So the bump is a deliberate, separately invoked
 * command that requires a stated reason and prints exactly what it changed.
 *
 * Usage:
 *   node scripts/architecture-baseline.cjs --reason "added the foo capability"
 *   node scripts/architecture-baseline.cjs --show
 *   node scripts/architecture-baseline.cjs --reason "..." --check   (verify, write nothing)
 *
 * Absolute ratchets (cycles, duplicate owners, kernel->feature imports, unregistered
 * boot modules, literal IPC registrations) are deliberately NOT recorded here. If one
 * of those is violated, the fix is the architecture, not the baseline.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_FILE = path.join(ROOT, "config", "architecture-baseline.json");

/** The metrics a baseline records, in report order. Mirrors `RATCHET_DECLARATIONS`. */
const METRIC_KEYS = [
  "bootModuleCount",
  "capabilityCount",
  "dependencyEdgeCount",
  "requiredEdgeCount",
  "featureCapabilityCount",
  "durableNamespaceCount"
];

/** Re-derive the metrics by running the diagnostic, so there is one measurement path. */
function measure() {
  const probe = require("node:child_process").execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts", "architecture.cjs"), "ratchet"],
    { cwd: ROOT, encoding: "utf8" }
  );
  return JSON.parse(probe).metrics;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return undefined;
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
}

function main() {
  const args = process.argv.slice(2);
  const show = args.includes("--show");
  const check = args.includes("--check");
  const reasonIndex = args.indexOf("--reason");
  const reason = reasonIndex >= 0 ? args[reasonIndex + 1] : undefined;

  const metrics = measure();
  const current = readBaseline();

  if (show) {
    console.log(JSON.stringify({ baselineFile: path.relative(ROOT, BASELINE_FILE).split(path.sep).join("/"), recorded: current ?? null, measured: metrics }, null, 2));
    return 0;
  }

  if (!reason || reason.trim() === "") {
    console.error("architecture-baseline: --reason \"<why the metrics changed>\" is required. A bump with no stated reason is not auditable.");
    return 2;
  }

  const drift = current
    ? METRIC_KEYS.filter((key) => current.metrics?.[key] !== metrics[key]).map((key) => `${key}: ${current.metrics?.[key]} -> ${metrics[key]}`)
    : METRIC_KEYS.map((key) => `${key}: (none) -> ${metrics[key]}`);

  if (drift.length === 0) {
    console.log(JSON.stringify({ changed: false, reason: "metrics already match the recorded baseline; nothing to bump", metrics }, null, 2));
    return 0;
  }

  // A DECREASE is always allowed and never needs review: the ratchet exists to stop
  // growth, so recording an improvement is safe. An INCREASE is the thing the reason
  // is for, and it is called out explicitly so a reviewer cannot miss it.
  const increases = current
    ? METRIC_KEYS.filter((key) => (current.metrics?.[key] ?? 0) < metrics[key]).map((key) => `${key}: ${current.metrics?.[key]} -> ${metrics[key]}`)
    : drift;

  if (check) {
    console.log(JSON.stringify({ changed: false, wouldWrite: true, drift, increases, metrics }, null, 2));
    return 0;
  }

  const next = {
    $comment: "Ratchet baseline (platform foundation Phase 01). Absolute ratchets are never recorded here — only the monotone metrics a growing capability set legitimately raises. Updated only by `node scripts/architecture-baseline.cjs --reason \"...\"`, never by a test.",
    version: (current?.version ?? 0) + 1,
    reason: reason.trim(),
    updatedAt: new Date().toISOString(),
    metrics
  };
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    changed: true,
    wrote: path.relative(ROOT, BASELINE_FILE).split(path.sep).join("/"),
    reason: next.reason,
    version: next.version,
    drift,
    increases,
    metrics
  }, null, 2));
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(String(error && error.message ? error.message : error));
  process.exitCode = 1;
}
