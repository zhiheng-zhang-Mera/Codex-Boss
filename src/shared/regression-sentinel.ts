/**
 * Host-M P6 — Regression Sentinel (pure comparison).
 *
 *   baseline → candidate, report only, never modify production code.
 *
 * The sentinel exists to make a merge question answerable: did this change make
 * anything measurably worse? It answers by comparing recorded snapshots of the
 * things that actually regress — the acceptance digest, the test counts, the
 * public interface surface, the exported schema surface, the benchmark numbers,
 * provider success rates, dependency versions, file-format expectations and build
 * sizes — and it classifies every difference instead of printing a diff for a
 * human to interpret.
 *
 * Three rules keep it honest:
 *
 * 1. It is report-only. `compareSnapshots` returns findings; nothing in this
 *    module writes, and no caller is given a way to auto-apply a change.
 * 2. A dimension that exists in only one snapshot is `UNAVAILABLE`, not
 *    "unchanged" — a missing measurement is not evidence of stability.
 * 3. Drift and regression are different verdicts. A changed interface is drift; a
 *    *failing* acceptance check is a regression. Both are reported, and only the
 *    second makes the run fail.
 */

export const SENTINEL_DIMENSIONS = [
  "acceptance",
  "tests",
  "interfaces",
  "schemas",
  "benchmark",
  "provider-success",
  "file-formats",
  "dependencies",
  "build-size"
] as const;
export type SentinelDimension = (typeof SENTINEL_DIMENSIONS)[number];

export type FindingSeverity = "INFO" | "DRIFT" | "REGRESSION" | "IMPROVEMENT" | "UNAVAILABLE";

export interface SentinelFinding {
  dimension: SentinelDimension;
  severity: FindingSeverity;
  key: string;
  detail: string;
  baseline?: string | number;
  candidate?: string | number;
}

/** The acceptance record produced by P1, as the sentinel consumes it. */
export interface AcceptanceSlice {
  overall: string;
  digest: string;
  summary: { pass: number; fail: number; blockedExternal: number; degraded: number; skipped: number; total: number };
  checks: Array<{ id: string; program: string; status: string }>;
}

export interface TestSlice {
  files: number;
  tests: number;
  failed: number;
  /** Per-suite test counts, when the runner reports them. */
  suites?: Record<string, number>;
}

/**
 * One exported symbol and its shape. The shape is a normalized signature string,
 * so a reordered parameter list or a widened union shows up as drift.
 */
export interface InterfaceEntry {
  symbol: string;
  kind: "function" | "class" | "const" | "type" | "interface" | "enum";
  signature: string;
}

export interface SentinelSnapshot {
  schemaVersion: 1;
  kind: "HOST_SENTINEL_SNAPSHOT";
  revision: string;
  branch: string;
  capturedAt: string;
  acceptance?: AcceptanceSlice;
  tests?: TestSlice;
  /** Every exported symbol with its normalized signature. */
  interfaces?: Record<string, InterfaceEntry>;
  /** Normalized schema surface: type/interface names by owning module. */
  schemas?: Record<string, string[]>;
  /** Named benchmark metrics. Higher is not always better, so direction matters. */
  benchmarks?: Record<string, { value: number; unit: string; higherIsBetter: boolean }>;
  /** Provider success rates in [0, 1]. */
  providerSuccess?: Record<string, number>;
  /** File extensions the build/run is expected to produce, with counts. */
  fileFormats?: Record<string, number>;
  /** Resolved dependency versions. */
  dependencies?: Record<string, string>;
  /** Build artifact sizes in bytes. */
  buildSize?: Record<string, number>;
  /** Dimensions the capture could not measure here, with the reason. */
  unavailable?: Array<{ dimension: SentinelDimension; reason: string }>;
}

export function emptySentinelSnapshot(input: { revision: string; branch: string; capturedAt: string }): SentinelSnapshot {
  return {
    schemaVersion: 1,
    kind: "HOST_SENTINEL_SNAPSHOT",
    revision: input.revision,
    branch: input.branch,
    capturedAt: input.capturedAt
  };
}

export interface SentinelReport {
  schemaVersion: 1;
  kind: "HOST_SENTINEL_REPORT";
  generatedAt: string;
  baseline: { revision: string; branch: string; capturedAt: string };
  candidate: { revision: string; branch: string; capturedAt: string };
  findings: SentinelFinding[];
  summary: {
    regressions: number;
    drift: number;
    improvements: number;
    info: number;
    unavailable: number;
    total: number;
  };
  /** FAIL only when something actually regressed. Drift alone does not fail. */
  overall: "PASS" | "DRIFT" | "FAIL";
  verdictReason: string;
  /** Always restated in the report so a reader cannot mistake the sentinel's role. */
  policy: "REPORT_ONLY";
}

/**
 * Compares two sub-maps, or reports nothing at all when the caller simply did not
 * record them.
 *
 * This distinction matters: an *absent whole dimension* is UNAVAILABLE, but an
 * absent optional sub-field (per-suite counts, for instance) is not a missing
 * measurement — reporting it as one produced a spurious "the baseline has no
 * measurement for this dimension" finding on every run that did not break its
 * suite counts down.
 */
function compareOptionalMap(
  dimension: SentinelDimension,
  before: Record<string, string | number> | undefined,
  after: Record<string, string | number> | undefined,
  classify: (key: string, baseline: string | number, candidate: string | number) => FindingSeverity
): SentinelFinding[] {
  if (before === undefined || after === undefined) return [];
  return findingsOf(dimension, before, after, classify);
}

function findingsOf(
  dimension: SentinelDimension,
  before: Record<string, string | number> | undefined,
  after: Record<string, string | number> | undefined,
  classify: (key: string, baseline: string | number, candidate: string | number) => FindingSeverity
): SentinelFinding[] {
  if (before === undefined || after === undefined) {
    return [
      {
        dimension,
        severity: "UNAVAILABLE",
        key: dimension,
        detail: before === undefined ? "the baseline has no measurement for this dimension" : "the candidate has no measurement for this dimension"
      }
    ];
  }
  const findings: SentinelFinding[] = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of keys) {
    const left = before[key];
    const right = after[key];
    if (left === undefined) {
      findings.push({ dimension, severity: "INFO", key, detail: "added in the candidate", candidate: right });
      continue;
    }
    if (right === undefined) {
      findings.push({ dimension, severity: "DRIFT", key, detail: "present in the baseline but missing from the candidate", baseline: left });
      continue;
    }
    if (left === right) continue;
    findings.push({ dimension, severity: classify(key, left, right), key, detail: `${left} → ${right}`, baseline: left, candidate: right });
  }
  return findings;
}

/** Compares acceptance records: a check that got worse is a regression. */
export function compareAcceptance(before: AcceptanceSlice | undefined, after: AcceptanceSlice | undefined): SentinelFinding[] {
  if (!before || !after) {
    return [{ dimension: "acceptance", severity: "UNAVAILABLE", key: "acceptance", detail: before ? "no candidate acceptance record" : "no baseline acceptance record" }];
  }
  const findings: SentinelFinding[] = [];
  const rank: Record<string, number> = { PASS: 4, DEGRADED: 3, SKIPPED_WITH_REASON: 2, BLOCKED_EXTERNAL: 1, FAIL: 0 };
  const beforeChecks = new Map(before.checks.map((check) => [check.id, check]));
  const afterChecks = new Map(after.checks.map((check) => [check.id, check]));

  for (const [id, check] of beforeChecks) {
    const now = afterChecks.get(id);
    if (!now) {
      // A check that disappeared is a loss of coverage, not an improvement.
      findings.push({ dimension: "acceptance", severity: "REGRESSION", key: id, detail: `baseline ${check.status}, candidate did not run it`, baseline: check.status });
      continue;
    }
    if (now.status === check.status) continue;
    const left = rank[check.status] ?? 2;
    const right = rank[now.status] ?? 2;
    findings.push({
      dimension: "acceptance",
      severity: right < left ? "REGRESSION" : right > left ? "IMPROVEMENT" : "DRIFT",
      key: id,
      detail: `${check.status} → ${now.status}`,
      baseline: check.status,
      candidate: now.status
    });
  }
  for (const [id, check] of afterChecks) {
    if (!beforeChecks.has(id)) {
      findings.push({ dimension: "acceptance", severity: "INFO", key: id, detail: `added in the candidate as ${check.status}`, candidate: check.status });
    }
  }
  if (before.digest !== after.digest) {
    findings.push({ dimension: "acceptance", severity: "DRIFT", key: "digest", detail: `${before.digest} → ${after.digest}`, baseline: before.digest, candidate: after.digest });
  }
  if (before.overall !== after.overall) {
    const left = rank[before.overall] ?? 2;
    const right = rank[after.overall] ?? 2;
    findings.push({
      dimension: "acceptance",
      severity: right < left ? "REGRESSION" : right > left ? "IMPROVEMENT" : "DRIFT",
      key: "overall",
      detail: `${before.overall} → ${after.overall}`,
      baseline: before.overall,
      candidate: after.overall
    });
  }
  return findings;
}

/** Fewer passing tests, or any new failure, is a regression. */
export function compareTests(before: TestSlice | undefined, after: TestSlice | undefined): SentinelFinding[] {
  if (!before || !after) {
    return [{ dimension: "tests", severity: "UNAVAILABLE", key: "tests", detail: before ? "no candidate test measurement" : "no baseline test measurement" }];
  }
  const findings: SentinelFinding[] = [];
  if (after.failed > before.failed) {
    findings.push({ dimension: "tests", severity: "REGRESSION", key: "failed", detail: `${before.failed} → ${after.failed}`, baseline: before.failed, candidate: after.failed });
  } else if (after.failed < before.failed) {
    findings.push({ dimension: "tests", severity: "IMPROVEMENT", key: "failed", detail: `${before.failed} → ${after.failed}`, baseline: before.failed, candidate: after.failed });
  }
  if (after.tests < before.tests) {
    findings.push({ dimension: "tests", severity: "REGRESSION", key: "tests", detail: `${before.tests} → ${after.tests} (tests were removed)`, baseline: before.tests, candidate: after.tests });
  } else if (after.tests > before.tests) {
    findings.push({ dimension: "tests", severity: "INFO", key: "tests", detail: `${before.tests} → ${after.tests}`, baseline: before.tests, candidate: after.tests });
  }
  if (after.files < before.files) {
    findings.push({ dimension: "tests", severity: "DRIFT", key: "files", detail: `${before.files} → ${after.files}`, baseline: before.files, candidate: after.files });
  }
  findings.push(...compareOptionalMap("tests", before.suites, after.suites, (_key, left, right) => (Number(right) < Number(left) ? "REGRESSION" : "INFO")));
  return findings;
}

/**
 * Interface drift: every baseline symbol must still exist with the same shape.
 * An added symbol is informational; a changed or removed one is drift, because
 * something downstream may depend on the old shape.
 */
export function compareInterfaces(before: Record<string, InterfaceEntry> | undefined, after: Record<string, InterfaceEntry> | undefined): SentinelFinding[] {
  if (!before || !after) {
    return [{ dimension: "interfaces", severity: "UNAVAILABLE", key: "interfaces", detail: before ? "no candidate interface capture" : "no baseline interface capture" }];
  }
  const findings: SentinelFinding[] = [];
  for (const [symbol, entry] of Object.entries(before)) {
    const now = after[symbol];
    if (!now) {
      findings.push({ dimension: "interfaces", severity: "DRIFT", key: symbol, detail: `exported ${entry.kind} was removed`, baseline: entry.signature });
      continue;
    }
    if (now.signature !== entry.signature) {
      findings.push({ dimension: "interfaces", severity: "DRIFT", key: symbol, detail: `signature changed`, baseline: entry.signature, candidate: now.signature });
    }
    if (now.kind !== entry.kind) {
      findings.push({ dimension: "interfaces", severity: "DRIFT", key: symbol, detail: `kind changed ${entry.kind} → ${now.kind}`, baseline: entry.kind, candidate: now.kind });
    }
  }
  for (const [symbol, entry] of Object.entries(after)) {
    if (!before[symbol]) findings.push({ dimension: "interfaces", severity: "INFO", key: symbol, detail: `added as ${entry.kind}`, candidate: entry.signature });
  }
  return findings;
}

/** Schema drift: a declared type/interface name that changed or vanished. */
export function compareSchemas(before: Record<string, string[]> | undefined, after: Record<string, string[]> | undefined): SentinelFinding[] {
  if (!before || !after) {
    return [{ dimension: "schemas", severity: "UNAVAILABLE", key: "schemas", detail: before ? "no candidate schema capture" : "no baseline schema capture" }];
  }
  const findings: SentinelFinding[] = [];
  const modules = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const module of modules) {
    const left = new Set(before[module] ?? []);
    const right = new Set(after[module] ?? []);
    for (const name of left) {
      if (!right.has(name)) findings.push({ dimension: "schemas", severity: "DRIFT", key: `${module}#${name}`, detail: "declared type was removed", baseline: name });
    }
    for (const name of right) {
      if (!left.has(name)) findings.push({ dimension: "schemas", severity: "INFO", key: `${module}#${name}`, detail: "declared type was added", candidate: name });
    }
  }
  return findings;
}

/** Benchmark drift, respecting each metric's own direction. */
export function compareBenchmarks(
  before: Record<string, { value: number; unit: string; higherIsBetter: boolean }> | undefined,
  after: Record<string, { value: number; unit: string; higherIsBetter: boolean }> | undefined
): SentinelFinding[] {
  if (!before || !after) {
    return [{ dimension: "benchmark", severity: "UNAVAILABLE", key: "benchmark", detail: before ? "no candidate benchmark" : "no baseline benchmark" }];
  }
  const findings: SentinelFinding[] = [];
  for (const [metric, entry] of Object.entries(before)) {
    const now = after[metric];
    if (!now) {
      findings.push({ dimension: "benchmark", severity: "DRIFT", key: metric, detail: "metric is no longer measured", baseline: entry.value });
      continue;
    }
    if (now.value === entry.value) continue;
    const better = entry.higherIsBetter ? now.value > entry.value : now.value < entry.value;
    findings.push({
      dimension: "benchmark",
      severity: better ? "IMPROVEMENT" : "REGRESSION",
      key: metric,
      detail: `${entry.value}${entry.unit} → ${now.value}${now.unit} (${entry.higherIsBetter ? "higher" : "lower"} is better)`,
      baseline: entry.value,
      candidate: now.value
    });
  }
  for (const metric of Object.keys(after)) {
    if (!before[metric]) findings.push({ dimension: "benchmark", severity: "INFO", key: metric, detail: "metric is new", candidate: after[metric].value });
  }
  return findings;
}

/** Provider success rates: a drop beyond the tolerance is a regression. */
export function compareProviderSuccess(
  before: Record<string, number> | undefined,
  after: Record<string, number> | undefined,
  tolerance = 0.02
): SentinelFinding[] {
  if (!before || !after) {
    return [{ dimension: "provider-success", severity: "UNAVAILABLE", key: "provider-success", detail: before ? "no candidate provider sample" : "no baseline provider sample" }];
  }
  const findings: SentinelFinding[] = [];
  for (const [provider, rate] of Object.entries(before)) {
    const now = after[provider];
    if (now === undefined) {
      findings.push({ dimension: "provider-success", severity: "DRIFT", key: provider, detail: "provider is no longer measured", baseline: rate });
      continue;
    }
    const delta = now - rate;
    if (Math.abs(delta) <= tolerance) continue;
    findings.push({
      dimension: "provider-success",
      severity: delta < 0 ? "REGRESSION" : "IMPROVEMENT",
      key: provider,
      detail: `${(rate * 100).toFixed(1)}% → ${(now * 100).toFixed(1)}%`,
      baseline: rate,
      candidate: now
    });
  }
  return findings;
}

/** Unexpected file-format changes: a format that vanished is drift. */
export function compareFileFormats(before: Record<string, number> | undefined, after: Record<string, number> | undefined): SentinelFinding[] {
  if (!before || !after) {
    return [{ dimension: "file-formats", severity: "UNAVAILABLE", key: "file-formats", detail: before ? "no candidate format inventory" : "no baseline format inventory" }];
  }
  const findings: SentinelFinding[] = [];
  for (const [extension, count] of Object.entries(before)) {
    const now = after[extension];
    if (now === undefined) {
      findings.push({ dimension: "file-formats", severity: "DRIFT", key: extension, detail: `${count} file(s) no longer produced`, baseline: count });
      continue;
    }
    if (now !== count) {
      // Losing most of a format is drift; a small count change is informational.
      const severity: FindingSeverity = now < count * 0.5 ? "DRIFT" : "INFO";
      findings.push({ dimension: "file-formats", severity, key: extension, detail: `${count} → ${now}`, baseline: count, candidate: now });
    }
  }
  for (const extension of Object.keys(after)) {
    if (before[extension] === undefined) findings.push({ dimension: "file-formats", severity: "DRIFT", key: extension, detail: "a new file format appeared", candidate: after[extension] });
  }
  return findings;
}

/** Dependency changes. A major-version jump is drift; anything else is info. */
export function compareDependencies(before: Record<string, string> | undefined, after: Record<string, string> | undefined): SentinelFinding[] {
  if (!before || !after) {
    return [{ dimension: "dependencies", severity: "UNAVAILABLE", key: "dependencies", detail: before ? "no candidate dependency capture" : "no baseline dependency capture" }];
  }
  const findings: SentinelFinding[] = [];
  for (const [name, version] of Object.entries(before)) {
    const now = after[name];
    if (now === undefined) {
      findings.push({ dimension: "dependencies", severity: "DRIFT", key: name, detail: "dependency was removed", baseline: version });
      continue;
    }
    if (now === version) continue;
    const majorChanged = version.split(".")[0] !== now.split(".")[0];
    findings.push({
      dimension: "dependencies",
      severity: majorChanged ? "DRIFT" : "INFO",
      key: name,
      detail: majorChanged ? `major version changed ${version} → ${now}` : `${version} → ${now}`,
      baseline: version,
      candidate: now
    });
  }
  for (const [name, version] of Object.entries(after)) {
    if (before[name] === undefined) findings.push({ dimension: "dependencies", severity: "INFO", key: name, detail: "dependency was added", candidate: version });
  }
  return findings;
}

/** Binary/build size anomalies, judged against a relative tolerance. */
export function compareBuildSize(before: Record<string, number> | undefined, after: Record<string, number> | undefined, tolerance = 0.1): SentinelFinding[] {
  if (!before || !after) {
    return [{ dimension: "build-size", severity: "UNAVAILABLE", key: "build-size", detail: before ? "no candidate build measurement" : "no baseline build measurement" }];
  }
  const findings: SentinelFinding[] = [];
  for (const [artifact, bytes] of Object.entries(before)) {
    const now = after[artifact];
    if (now === undefined) {
      findings.push({ dimension: "build-size", severity: "DRIFT", key: artifact, detail: "artifact is no longer produced", baseline: bytes });
      continue;
    }
    if (bytes === 0) continue;
    const delta = (now - bytes) / bytes;
    if (Math.abs(delta) <= tolerance) continue;
    findings.push({
      dimension: "build-size",
      severity: delta > 0 ? "DRIFT" : "IMPROVEMENT",
      key: artifact,
      detail: `${(bytes / 1024).toFixed(1)} KiB → ${(now / 1024).toFixed(1)} KiB (${(delta * 100).toFixed(1)}%)`,
      baseline: bytes,
      candidate: now
    });
  }
  for (const artifact of Object.keys(after)) {
    if (before[artifact] === undefined) findings.push({ dimension: "build-size", severity: "INFO", key: artifact, detail: "new artifact", candidate: after[artifact] });
  }
  return findings;
}

export function summarizeFindings(findings: readonly SentinelFinding[]): SentinelReport["summary"] {
  const summary = { regressions: 0, drift: 0, improvements: 0, info: 0, unavailable: 0, total: findings.length };
  for (const finding of findings) {
    if (finding.severity === "REGRESSION") summary.regressions += 1;
    else if (finding.severity === "DRIFT") summary.drift += 1;
    else if (finding.severity === "IMPROVEMENT") summary.improvements += 1;
    else if (finding.severity === "INFO") summary.info += 1;
    else summary.unavailable += 1;
  }
  return summary;
}

/**
 * The verdict. A regression fails the sentinel; drift alone does not, because
 * changing an interface is a decision, not a defect — but it must be visible.
 */
export function buildSentinelReport(input: {
  baseline: SentinelSnapshot;
  candidate: SentinelSnapshot;
  findings: SentinelFinding[];
  generatedAt: string;
}): SentinelReport {
  const summary = summarizeFindings(input.findings);
  const overall: SentinelReport["overall"] = summary.regressions > 0 ? "FAIL" : summary.drift > 0 ? "DRIFT" : "PASS";
  const parts = [`${summary.regressions} regression(s)`, `${summary.drift} drift`, `${summary.improvements} improvement(s)`, `${summary.info} informational`];
  if (summary.unavailable) parts.push(`${summary.unavailable} unavailable dimension(s)`);
  return {
    schemaVersion: 1,
    kind: "HOST_SENTINEL_REPORT",
    generatedAt: input.generatedAt,
    baseline: { revision: input.baseline.revision, branch: input.baseline.branch, capturedAt: input.baseline.capturedAt },
    candidate: { revision: input.candidate.revision, branch: input.candidate.branch, capturedAt: input.candidate.capturedAt },
    findings: input.findings,
    summary,
    overall,
    verdictReason: `${overall}: ${parts.join(", ")}`,
    policy: "REPORT_ONLY"
  };
}

/** Runs every dimension comparison. Report-only: nothing here mutates anything. */
export function compareSnapshots(baseline: SentinelSnapshot, candidate: SentinelSnapshot, options: { successTolerance?: number; sizeTolerance?: number } = {}): SentinelFinding[] {
  return [
    ...compareAcceptance(baseline.acceptance, candidate.acceptance),
    ...compareTests(baseline.tests, candidate.tests),
    ...compareInterfaces(baseline.interfaces, candidate.interfaces),
    ...compareSchemas(baseline.schemas, candidate.schemas),
    ...compareBenchmarks(baseline.benchmarks, candidate.benchmarks),
    ...compareProviderSuccess(baseline.providerSuccess, candidate.providerSuccess, options.successTolerance),
    ...compareFileFormats(baseline.fileFormats, candidate.fileFormats),
    ...compareDependencies(baseline.dependencies, candidate.dependencies),
    ...compareBuildSize(baseline.buildSize, candidate.buildSize, options.sizeTolerance)
  ].sort((left, right) => left.dimension.localeCompare(right.dimension) || left.key.localeCompare(right.key));
}

/** Every dimension must be present in both snapshots or it is reported UNAVAILABLE. */
export function missingDimensions(snapshot: SentinelSnapshot): SentinelDimension[] {
  const present: Record<SentinelDimension, boolean> = {
    acceptance: snapshot.acceptance !== undefined,
    tests: snapshot.tests !== undefined,
    interfaces: snapshot.interfaces !== undefined,
    schemas: snapshot.schemas !== undefined,
    benchmark: snapshot.benchmarks !== undefined,
    "provider-success": snapshot.providerSuccess !== undefined,
    "file-formats": snapshot.fileFormats !== undefined,
    dependencies: snapshot.dependencies !== undefined,
    "build-size": snapshot.buildSize !== undefined
  };
  return SENTINEL_DIMENSIONS.filter((dimension) => !present[dimension]);
}

export function renderSentinelReport(report: SentinelReport): string {
  const lines = [
    `Host-M regression sentinel — ${report.overall} (${report.policy})`,
    `baseline ${report.baseline.branch}@${report.baseline.revision} → candidate ${report.candidate.branch}@${report.candidate.revision}`,
    `verdict: ${report.verdictReason}`,
    ""
  ];
  for (const finding of report.findings) {
    if (finding.severity === "INFO") continue;
    lines.push(`${finding.severity.padEnd(12)} ${finding.dimension.padEnd(17)} ${finding.key}  ${finding.detail}`);
  }
  const info = report.findings.filter((finding) => finding.severity === "INFO").length;
  if (info) lines.push(`(${info} informational finding(s) omitted)`);
  return lines.join("\n");
}
