import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  emptySentinelSnapshot,
  type AcceptanceSlice,
  type InterfaceEntry,
  type SentinelSnapshot,
  type TestSlice
} from "../../src/shared/regression-sentinel";

/**
 * Host-M P6 — snapshot capture.
 *
 * This is the read side of the sentinel: it measures what the current checkout
 * looks like and stores it as data. It writes only the snapshot file it is asked
 * to write, and it never touches production code — the sentinel's job is to
 * report, and a tool that "fixes" what it measures is not reporting.
 *
 * Every capture is fault-isolated per dimension. A dimension that cannot be
 * measured here is left absent, which the comparison then reports as UNAVAILABLE
 * — a missing measurement is not evidence that nothing changed.
 */

export interface CaptureOptions {
  repoRoot: string;
  /** Where to look for the acceptance record P1 wrote. */
  acceptanceFile?: string;
  /** Where to look for a benchmark result. */
  benchmarkFile?: string;
  /** Where to look for telemetry (provider success rates). */
  telemetryFile?: string;
  /** Source roots to scan for exported symbols and declared types. */
  sourceRoots?: readonly string[];
  /** The test measurement the caller actually observed. */
  tests?: TestSlice;
  now?: () => string;
}

/** Interface capture scans only these, so the signature list stays meaningful. */
const DEFAULT_SOURCE_ROOTS = ["src/shared", "electron"];
const SOURCE_SKIP = new Set(["node_modules", ".git", "dist", "dist-electron", "coverage"]);

function walkFiles(root: string, options: { extensions: readonly string[]; maxFiles?: number } = { extensions: [".ts"] }): string[] {
  const files: string[] = [];
  const maxFiles = options.maxFiles ?? 20_000;
  const visit = (directory: string): void => {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (SOURCE_SKIP.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (entry.isFile() && options.extensions.includes(path.extname(entry.name))) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

/**
 * Normalizes a declaration into a comparable signature: whitespace collapsed and
 * generics kept, so formatting churn does not read as interface drift but a
 * changed parameter list or a widened union does.
 */
export function normalizeSignature(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const EXPORT_PATTERNS: Array<{ kind: InterfaceEntry["kind"]; pattern: RegExp }> = [
  { kind: "function", pattern: /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+?))?\s*\{/m },
  { kind: "class", pattern: /^export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)\s*(<[^>]*>)?\s*(?:extends\s+[^{]+)?(?:implements\s+[^{]+)?\{/m },
  { kind: "const", pattern: /^export\s+const\s+([A-Za-z0-9_$]+)\s*(?::\s*([^=]+?))?\s*=/m },
  { kind: "enum", pattern: /^export\s+enum\s+([A-Za-z0-9_$]+)/m }
];

/**
 * Extracts the exported surface of one source file. Declarations are read from
 * the source text rather than from a compiled artifact, so the capture describes
 * the candidate as written, including anything the compiler would erase.
 */
export function captureFileSurface(source: string): { entries: InterfaceEntry[]; types: string[] } {
  const entries: InterfaceEntry[] = [];
  const types: string[] = [];
  const lines = source.split("\n");

  // Type and interface declarations are captured as schema surface.
  for (const match of source.matchAll(/^export\s+(?:type|interface)\s+([A-Za-z0-9_$]+)/gm)) {
    types.push(match[1]);
  }

  for (const line of lines) {
    for (const { kind, pattern } of EXPORT_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const name = match[1];
      // The signature is the whole declaration line for consts, and the
      // parameter list plus return type for the others.
      const signature =
        kind === "function"
          ? normalizeSignature(`(${match[3] ?? ""})${match[4] ? `: ${match[4].trim()}` : ""}`)
          : kind === "const"
            ? normalizeSignature(match[2] ?? "")
            : normalizeSignature(match[2] ?? "");
      entries.push({ symbol: `${kind}:${name}`, kind, signature });
      break;
    }
  }
  return { entries, types };
}

export function captureInterfaces(options: CaptureOptions): { interfaces: Record<string, InterfaceEntry>; schemas: Record<string, string[]> } {
  const repoRoot = options.repoRoot;
  const interfaces: Record<string, InterfaceEntry> = {};
  const schemas: Record<string, string[]> = {};
  for (const root of options.sourceRoots ?? DEFAULT_SOURCE_ROOTS) {
    const absolute = path.join(repoRoot, root);
    if (!fs.existsSync(absolute)) continue;
    for (const file of walkFiles(absolute, { extensions: [".ts"] })) {
      const relative = path.relative(repoRoot, file).replace(/\\/g, "/");
      if (relative.endsWith(".test.ts")) continue;
      let source: string;
      try {
        source = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const { entries, types } = captureFileSurface(source);
      for (const entry of entries) interfaces[`${relative}#${entry.symbol}`] = entry;
      if (types.length) schemas[relative] = types.sort();
    }
  }
  return { interfaces, schemas };
}

/** Reads the P1 acceptance record so the sentinel compares the same evidence P1 wrote. */
export function captureAcceptance(file: string): AcceptanceSlice | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as {
      overall?: string;
      digest?: string;
      summary?: AcceptanceSlice["summary"];
      checks?: Array<{ id: string; program: string; status: string }>;
    };
    if (typeof parsed.overall !== "string" || typeof parsed.digest !== "string" || !parsed.summary || !Array.isArray(parsed.checks)) return undefined;
    return { overall: parsed.overall, digest: parsed.digest, summary: parsed.summary, checks: parsed.checks };
  } catch {
    return undefined;
  }
}

/** Reads the benchmark artifact from the first candidate path that exists. */
export function captureBenchmarks(file: string | readonly string[]): SentinelSnapshot["benchmarks"] {
  const candidates = typeof file === "string" ? [file] : file;
  for (const candidate of candidates) {
    const metrics = readBenchmark(candidate);
    if (metrics) return metrics;
  }
  return undefined;
}

function readBenchmark(file: string): SentinelSnapshot["benchmarks"] {
  try {
    if (!fs.existsSync(file)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
    const metrics: NonNullable<SentinelSnapshot["benchmarks"]> = {};
    const consider = (name: string, value: unknown, unit: string, higherIsBetter: boolean): void => {
      if (typeof value === "number" && Number.isFinite(value)) metrics[name] = { value, unit, higherIsBetter };
    };
    consider("persisted", parsed.persisted, "records", true);
    consider("recovered", parsed.recovered, "records", true);
    consider("prompts", (parsed.routing as Record<string, unknown> | undefined)?.prompts, "prompts", true);
    consider("lightweightRouted", (parsed.routing as Record<string, unknown> | undefined)?.lightweight, "prompts", true);
    return Object.keys(metrics).length ? metrics : undefined;
  } catch {
    return undefined;
  }
}

/** Provider success rates, derived from telemetry rows rather than asserted. */
export function captureProviderSuccess(file: string): SentinelSnapshot["providerSuccess"] {
  try {
    if (!fs.existsSync(file)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as { records?: Array<{ runtimeId?: string; outcome?: string }> };
    if (!Array.isArray(parsed.records)) return undefined;
    const totals = new Map<string, { runs: number; success: number }>();
    for (const record of parsed.records) {
      if (typeof record.runtimeId !== "string") continue;
      const entry = totals.get(record.runtimeId) ?? { runs: 0, success: 0 };
      entry.runs += 1;
      if (record.outcome === "SUCCESS") entry.success += 1;
      totals.set(record.runtimeId, entry);
    }
    if (!totals.size) return undefined;
    const rates: Record<string, number> = {};
    for (const [runtimeId, entry] of totals) rates[runtimeId] = Number((entry.success / entry.runs).toFixed(4));
    return rates;
  } catch {
    return undefined;
  }
}

/** File formats and build sizes, from a bounded walk of the build output. */
export function captureBuildOutput(repoRoot: string): { fileFormats: Record<string, number>; buildSize: Record<string, number> } {
  const fileFormats: Record<string, number> = {};
  const buildSize: Record<string, number> = {};
  for (const directory of ["dist", "dist-electron"]) {
    const absolute = path.join(repoRoot, directory);
    if (!fs.existsSync(absolute)) continue;
    const files = walkFiles(absolute, { extensions: [".js", ".css", ".html", ".mjs", ".cjs", ".json", ".map", ".ts"], maxFiles: 20_000 });
    let total = 0;
    for (const file of files) {
      const extension = path.extname(file).toLowerCase() || "(none)";
      fileFormats[extension] = (fileFormats[extension] ?? 0) + 1;
      try {
        total += fs.statSync(file).size;
      } catch {
        // an unreadable file contributes nothing rather than failing the capture
      }
    }
    if (files.length) buildSize[directory] = total;
  }
  return { fileFormats, buildSize };
}

export function captureDependencies(repoRoot: string): SentinelSnapshot["dependencies"] {
  try {
    const file = path.join(repoRoot, "package.json");
    if (!fs.existsSync(file)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies: Record<string, string> = {};
    for (const [name, version] of Object.entries(parsed.dependencies ?? {})) dependencies[name] = version;
    for (const [name, version] of Object.entries(parsed.devDependencies ?? {})) dependencies[name] = version;
    return Object.keys(dependencies).length ? dependencies : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Test counts, from an explicit measurement rather than a guess. The caller
 * supplies the numbers it observed (the CLI parses them from a real run) so the
 * sentinel never asserts a count it did not see.
 */
export function captureTests(input: { files: number; tests: number; failed: number; suites?: Record<string, number> }): TestSlice {
  return { files: input.files, tests: input.tests, failed: input.failed, suites: input.suites };
}

export function currentGit(repoRoot: string): { revision: string; branch: string } {
  const read = (args: string[]): string => {
    try {
      return execFileSync("git", args, { cwd: repoRoot, windowsHide: true, encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  };
  return { revision: read(["rev-parse", "HEAD"]), branch: read(["rev-parse", "--abbrev-ref", "HEAD"]) };
}

/**
 * Captures a full snapshot. Each dimension is isolated: a failure leaves that
 * dimension absent (later reported UNAVAILABLE) and never aborts the capture.
 */
export function captureSnapshot(options: CaptureOptions & { unavailable?: SentinelSnapshot["unavailable"] }): SentinelSnapshot {
  const now = options.now ?? (() => new Date().toISOString());
  const git = currentGit(options.repoRoot);
  const snapshot = emptySentinelSnapshot({ revision: git.revision, branch: git.branch, capturedAt: now() });
  const unavailable: NonNullable<SentinelSnapshot["unavailable"]> = [...(options.unavailable ?? [])];

  const attempt = <T>(dimension: NonNullable<SentinelSnapshot["unavailable"]>[number]["dimension"], read: () => T | undefined): T | undefined => {
    try {
      const value = read();
      if (value === undefined) unavailable.push({ dimension, reason: "no measurement is available on this checkout" });
      return value;
    } catch (error) {
      unavailable.push({ dimension, reason: String(error) });
      return undefined;
    }
  };

  snapshot.acceptance = attempt("acceptance", () => captureAcceptance(options.acceptanceFile ?? path.join(options.repoRoot, "artifacts", "host-acceptance", "latest-record.json")));
  snapshot.tests = options.tests;
  if (!snapshot.tests) unavailable.push({ dimension: "tests", reason: "no test measurement was supplied" });

  const surface = attempt("interfaces", () => captureInterfaces(options));
  snapshot.interfaces = surface?.interfaces;
  snapshot.schemas = surface?.schemas;

  snapshot.benchmarks = attempt("benchmark", () =>
    captureBenchmarks(
      options.benchmarkFile
        ? [options.benchmarkFile]
        : [
            path.join(options.repoRoot, "artifacts", "benchmark.json"),
            path.join(options.repoRoot, "artifacts", "latest-benchmark.json")
          ]
    )
  );
  snapshot.providerSuccess = attempt("provider-success", () =>
    captureProviderSuccess(options.telemetryFile ?? path.join(options.repoRoot, "runtime-data", ".boss", "telemetry.json"))
  );

  const build = attempt("build-size", () => captureBuildOutput(options.repoRoot));
  if (build) {
    snapshot.fileFormats = Object.keys(build.fileFormats).length ? build.fileFormats : undefined;
    snapshot.buildSize = Object.keys(build.buildSize).length ? build.buildSize : undefined;
  }
  snapshot.dependencies = attempt("dependencies", () => captureDependencies(options.repoRoot));

  if (unavailable.length) snapshot.unavailable = unavailable;
  return snapshot;
}

export function readSnapshot(file: string): SentinelSnapshot {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as SentinelSnapshot;
  if (parsed.kind !== "HOST_SENTINEL_SNAPSHOT" || parsed.schemaVersion !== 1) throw new Error(`Not a sentinel snapshot: ${file}`);
  return parsed;
}

export function writeSnapshot(file: string, snapshot: SentinelSnapshot): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
}

/** Never throws: a missing snapshot file is a normal "nothing to compare" answer. */
export function tryReadSnapshot(file: string): SentinelSnapshot | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    return readSnapshot(file);
  } catch {
    return undefined;
  }
}
