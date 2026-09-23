import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Capability City Phase 1A — prospective enforcement regression suite (ENF-01..ENF-18).
 *
 * Specification: docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md, sections 7, 8 and 9.
 *
 * Every case drives the shipped command with an injected baseline, measurement and declarations, so the real
 * evaluator is exercised without touching the repository or the production architecture. The engine is spawned
 * rather than imported because the production entry point is what the acceptance criteria speak about; a test
 * that called a private copy of the evaluator would prove nothing about the command.
 */

const ENGINE = "scripts/architecture-enforcement.cjs";
const GENERATOR = "scripts/architecture-enforcement-baseline.cjs";

/**
 * Phase 1B-A: a baseline governs only when an ACCEPTED series entry names its
 * `(baseline_version, parent_baseline_hash, baseline_hash)` triple. Every case in this file injects a
 * baseline, so every case declares the series that authorizes it — explicitly, through `--authorizations`,
 * which is refused on the governing path. A fixture that could reach the engine without saying so would make
 * this suite a bypass of the governance it is supposed to exercise; the suite in
 * `architecture-baseline-authorization.test.ts` is what proves an undeclared baseline is refused.
 */
const FIXTURE_V1_HASH = "1".repeat(64);
const FIXTURE_V2_HASH = "2".repeat(64);

function authorizationSeries(baseline: Json): Json {
  const version = Number(baseline.baseline_version ?? 1);
  const parent = (baseline.parent_baseline_hash as string | null) ?? null;
  const entry = (baseline_version: number, parent_baseline_hash: string | null, baseline_hash: string) => ({
    baseline_version,
    parent_baseline_hash,
    baseline_hash,
    source_commit: "0".repeat(40),
    authorization_reference: "phase1a enforcement fixture: an injected baseline used to drive the evaluator, not a repository state",
    evidence_reference: "tests/unit/city/architecture-enforcement.test.ts",
    accepted_at: "2026-09-22T00:00:00Z",
    status: "ACCEPTED",
  });
  const accepted = version >= 2
    ? [entry(1, null, String(parent)), entry(version, parent, String(baseline.baseline_hash))]
    : [entry(1, null, String(baseline.baseline_hash))];
  return { schema: "city-architecture-enforcement-baseline-series/1", series: "city-architecture-enforcement-baseline", accepted };
}

const CAP_A = "alpha";
const CAP_B = "beta";
const FILE_A = "src/alpha/a.ts";
const FILE_B = "src/beta/b.ts";
const FILE_U = "src/undeclared/u.ts";

type Json = Record<string, unknown>;

function fixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase1a-enf-"));
}

function writeJson(dir: string, name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

function baseBaseline(overrides: Json = {}): Json {
  return {
    schema: "city-architecture-enforcement-baseline/1",
    baseline_version: 1,
    parent_baseline_hash: null,
    baseline_hash: FIXTURE_V1_HASH,
    source_commit: "fixture",
    files: { [FILE_A]: CAP_A, [FILE_B]: CAP_B, [FILE_U]: "UNDECLARED" },
    edges: [[FILE_A, FILE_B]],
    retired_edges: [],
    unresolved: [],
    not_yet_enforced: ["dependency_cycles"],
    ...overrides,
  };
}

function baseMeasurement(overrides: Json = {}): Json {
  return {
    files: { [FILE_A]: CAP_A, [FILE_B]: CAP_B, [FILE_U]: "UNDECLARED" },
    edges: [[FILE_A, FILE_B]],
    unresolved: [],
    parse_issues: [],
    read_failures: [],
    silent_skips: 0,
    ownership_conflicts: [],
    ...overrides,
  };
}

const DECLARATIONS_AUTHORIZING = { provides: { "beta@1": CAP_B }, declares: { [CAP_A]: ["beta@1"], [CAP_B]: [] } };
const DECLARATIONS_SILENT = { provides: { "beta@1": CAP_B }, declares: { [CAP_A]: [], [CAP_B]: [] } };

function runEngine(args: string[], timeoutMs = 120000): { status: number | null; json: Json } {
  const result = spawnSync(process.execPath, [ENGINE, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout ?? "");
  if (!stdout.trim()) throw new Error(`engine produced no JSON (status ${String(result.status)}): ${String(result.stderr ?? "")}`);
  return { status: result.status, json: JSON.parse(stdout) as Json };
}

/** Run one fixture through both modes and return the written findings plus the exit codes. */
function evaluate(baseline: Json, measurement: Json, declarations: Json = DECLARATIONS_SILENT) {
  const dir = fixtureDir();
  const baselinePath = writeJson(dir, "baseline.json", baseline);
  const measurementPath = writeJson(dir, "measurement.json", measurement);
  const declarationsPath = writeJson(dir, "declarations.json", declarations);
  const authorizationsPath = writeJson(dir, "authorizations.json", authorizationSeries(baseline));
  const shadowOut = path.join(dir, "shadow-out");
  const enforceOut = path.join(dir, "enforce-out");
  const common = ["--baseline", baselinePath, "--measurement", measurementPath, "--declarations", declarationsPath, "--authorizations", authorizationsPath];
  const shadow = runEngine(["--mode", "shadow", "--out", shadowOut, ...common]);
  const enforce = runEngine(["--mode", "enforce", "--out", enforceOut, ...common]);
  // The command prints a compact summary and writes the full findings to the mode's artifact, so the artifact is
  // what a case asserts on — which also exercises the documented output path.
  const shadowJson = JSON.parse(fs.readFileSync(path.join(shadowOut, "architecture-enforcement-shadow.json"), "utf8")) as Json;
  const enforceJson = JSON.parse(fs.readFileSync(path.join(enforceOut, "architecture-enforcement-live.json"), "utf8")) as Json;
  return { shadow: { status: shadow.status, json: shadowJson }, enforce: { status: enforce.status, json: enforceJson }, dir };
}

function codes(json: Json): string[] {
  const findings = (json.findings ?? []) as Array<{ code: string; subject: string }>;
  return findings.map((finding) => finding.code);
}

function summaryOf(json: Json): Json {
  return (json.summary ?? {}) as Json;
}

describe("phase 1a enforcement: grandfathering and debt (ENF-01, ENF-02, ENF-17, ENF-18)", () => {
  it("ENF-01 an edge that existed before enforcement passes as grandfathered", () => {
    const { shadow, enforce } = evaluate(baseBaseline(), baseMeasurement());
    expect(shadow.json.verdict).toBe("PASS");
    expect(enforce.status).toBe(0);
    expect(codes(shadow.json)).toContain("PASS_AS_GRANDFATHERED");
    expect(summaryOf(shadow.json).violations).toBe(0);
  });

  it("ENF-02 removing inherited debt passes and is reported as debt reduced", () => {
    const measurement = baseMeasurement({ edges: [] });
    const { shadow, enforce } = evaluate(baseBaseline(), measurement);
    expect(shadow.json.verdict).toBe("PASS");
    expect(enforce.status).toBe(0);
    expect(codes(shadow.json)).toContain("DEBT_REDUCED");
    expect(summaryOf(shadow.json).debt_reduced).toBe(1);
  });

  it("ENF-17 a count-compensation attack is refused: the same edge count is not the same graph", () => {
    // One grandfathered edge removed, one new undeclared-endpoint edge added. The COUNT is unchanged.
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_U]] });
    const { shadow, enforce } = evaluate(baseBaseline(), measurement);
    expect(shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(enforce.status).not.toBe(0);
    expect(codes(shadow.json)).toContain("NEW_EDGE_UNDECLARED_ENDPOINT");
    expect(summaryOf(shadow.json).debt_reduced).toBe(1);
  });

  it("ENF-18 debt retired by an accepted later baseline and then reintroduced is treated as new", () => {
    // Baseline v2 is an accepted later state that retired the edge. Its version/parent are stated explicitly so
    // the fixture is a well-formed series link rather than a v2 with no ancestry.
    const baselineV2 = baseBaseline({ baseline_version: 2, parent_baseline_hash: FIXTURE_V1_HASH, baseline_hash: FIXTURE_V2_HASH, edges: [], retired_edges: [[FILE_A, FILE_U]] });
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_U]] });
    const { shadow } = evaluate(baselineV2, measurement);
    expect(shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(codes(shadow.json)).toContain("REINTRODUCED_DEBT");
    expect(codes(shadow.json)).not.toContain("PASS_AS_GRANDFATHERED");
  });
});

describe("phase 1a enforcement: new source and new edges (ENF-03, ENF-04, ENF-05, ENF-06)", () => {
  it("ENF-03 new tracked production source with owner UNDECLARED fails", () => {
    const measurement = baseMeasurement({ files: { [FILE_A]: CAP_A, [FILE_B]: CAP_B, [FILE_U]: "UNDECLARED", "src/new/new.ts": "UNDECLARED" } });
    const { shadow, enforce } = evaluate(baseBaseline(), measurement);
    expect(shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(enforce.status).not.toBe(0);
    expect(codes(shadow.json)).toContain("NEW_UNDECLARED_SOURCE");
  });

  it("ENF-04 a new edge onto an undeclared target fails (and the target file is grandfathered, so only the edge fires)", () => {
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]] });
    const { shadow } = evaluate(baseBaseline(), measurement);
    expect(shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(codes(shadow.json)).toContain("NEW_EDGE_UNDECLARED_ENDPOINT");
    expect(summaryOf(shadow.json).new_undeclared_source).toBe(0);
  });

  it("ENF-05 a new edge from an undeclared source fails", () => {
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_B], [FILE_U, FILE_A]] });
    const { shadow } = evaluate(baseBaseline(), measurement);
    expect(shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(codes(shadow.json)).toContain("NEW_EDGE_UNDECLARED_ENDPOINT");
  });

  it("ENF-06 a new same-capability declared edge passes", () => {
    const baseline = baseBaseline({ files: { [FILE_A]: CAP_A, "src/alpha/a2.ts": CAP_A }, edges: [] });
    const measurement = baseMeasurement({ files: { [FILE_A]: CAP_A, "src/alpha/a2.ts": CAP_A }, edges: [[FILE_A, "src/alpha/a2.ts"]] });
    const { shadow, enforce } = evaluate(baseline, measurement);
    expect(shadow.json.verdict).toBe("PASS");
    expect(enforce.status).toBe(0);
    expect(codes(shadow.json)).toContain("NEW_EDGE_DECLARED_ENDPOINT");
  });
});

describe("phase 1a enforcement: cross-capability authorization (ENF-07, ENF-08)", () => {
  const baseline = baseBaseline({ edges: [] });

  it("ENF-07 a declared cross-capability relation passes", () => {
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_B]] });
    const { shadow, enforce } = evaluate(baseline, measurement, DECLARATIONS_AUTHORIZING);
    expect(shadow.json.verdict).toBe("PASS");
    expect(enforce.status).toBe(0);
    expect(codes(shadow.json)).toContain("NEW_EDGE_DECLARED_ENDPOINT");
    expect(codes(shadow.json)).not.toContain("NEW_UNDECLARED_CROSS_CAPABILITY_EDGE");
  });

  it("ENF-08 an undeclared cross-capability relation fails", () => {
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_B]] });
    const { shadow, enforce } = evaluate(baseline, measurement, DECLARATIONS_SILENT);
    expect(shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(enforce.status).not.toBe(0);
    expect(codes(shadow.json)).toContain("NEW_UNDECLARED_CROSS_CAPABILITY_EDGE");
  });
});

describe("phase 1a enforcement: conflicts, sensor integrity and classification (ENF-09, ENF-10, ENF-11)", () => {
  it("ENF-09 an ownership conflict fails", () => {
    const measurement = baseMeasurement({ ownership_conflicts: [{ module: FILE_A, capabilities: [CAP_A, CAP_B] }] });
    const { shadow, enforce } = evaluate(baseBaseline(), measurement);
    expect(shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(enforce.status).not.toBe(0);
    expect(codes(shadow.json)).toContain("OWNERSHIP_CONFLICT");
  });

  it.each([
    ["a read failure", { read_failures: [{ file: FILE_A, kind: "unreadable" }] }],
    ["a parse issue", { parse_issues: [{ file: FILE_A, kind: "unterminated-string" }] }],
    ["a silent skip", { silent_skips: 1 }],
  ])("ENF-10 %s fails closed in both modes", (_label, override) => {
    const measurement = baseMeasurement(override as Json);
    const { shadow, enforce } = evaluate(baseBaseline(), measurement);
    expect(shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(enforce.status).not.toBe(0);
    expect(codes(shadow.json)).toContain("SENSOR_INCOMPLETE");
  });

  it("ENF-11 a non-source asset is classified and does not fail, while a missing source target does", () => {
    const asset = baseMeasurement({ unresolved: [{ from: "src/renderer/main.tsx", specifier: "./styles.css", phase0_reason: "non-source-extension", classification: "NON_SOURCE_ASSET" }] });
    const pass = evaluate(baseBaseline(), asset);
    expect(pass.shadow.json.verdict).toBe("PASS");
    expect(codes(pass.shadow.json)).toContain("NON_SOURCE_ASSET");

    const missing = baseMeasurement({ unresolved: [{ from: FILE_A, specifier: "./gone", phase0_reason: "no-tracked-candidate", classification: "SOURCE_TARGET_MISSING" }] });
    const fail = evaluate(baseBaseline(), missing);
    expect(fail.shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(codes(fail.shadow.json)).toContain("UNRESOLVED_SOURCE_TARGET_MISSING");

    const unknown = baseMeasurement({ unresolved: [{ from: FILE_A, specifier: "./x", phase0_reason: "something-new", classification: "OTHER_UNKNOWN" }] });
    expect(evaluate(baseBaseline(), unknown).shadow.json.verdict).toBe("POLICY_VIOLATION");
  });
});

describe("phase 1a enforcement: shadow and enforce share one evaluator (ENF-12, ENF-13, ENF-14, ENF-15)", () => {
  it("ENF-12 shadow and enforce produce identical findings on the same violation", () => {
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]] });
    const { shadow, enforce } = evaluate(baseBaseline(), measurement);
    expect(JSON.stringify(enforce.json.findings)).toBe(JSON.stringify(shadow.json.findings));
    expect(enforce.json.verdict).toBe(shadow.json.verdict);
  });

  it("ENF-13 shadow exits zero on a policy violation", () => {
    const { shadow } = evaluate(baseBaseline(), baseMeasurement({ edges: [[FILE_A, FILE_U]] }));
    expect(shadow.json.verdict).toBe("POLICY_VIOLATION");
    expect(shadow.status).toBe(0);
  });

  it("ENF-14 enforce exits non-zero on the same violation", () => {
    const { enforce } = evaluate(baseBaseline(), baseMeasurement({ edges: [[FILE_A, FILE_U]] }));
    expect(enforce.json.verdict).toBe("POLICY_VIOLATION");
    expect(enforce.status).not.toBe(0);
  });

  it("ENF-15 findings are deterministically ordered", () => {
    const measurement = baseMeasurement({
      files: { [FILE_A]: CAP_A, [FILE_B]: CAP_B, [FILE_U]: "UNDECLARED", "src/new/z.ts": "UNDECLARED", "src/new/a.ts": "UNDECLARED" },
      edges: [[FILE_A, FILE_U], [FILE_U, FILE_A], [FILE_A, FILE_B]],
    });
    const first = evaluate(baseBaseline(), measurement);
    const second = evaluate(baseBaseline(), measurement);
    expect(JSON.stringify(first.shadow.json.findings)).toBe(JSON.stringify(second.shadow.json.findings));
    const findings = (first.shadow.json.findings ?? []) as Array<{ severity: string; code: string; subject: string }>;
    const rank: Record<string, number> = { ENGINE_ERROR: 0, VIOLATION: 1, INFO: 2 };
    for (let i = 1; i < findings.length; i += 1) {
      const previous = findings[i - 1];
      const current = findings[i];
      const ordered =
        rank[previous.severity] < rank[current.severity] ||
        (rank[previous.severity] === rank[current.severity] &&
          (previous.code < current.code || (previous.code === current.code && previous.subject <= current.subject)));
      expect(ordered, `finding ${i} out of order: ${JSON.stringify([previous, current])}`).toBe(true);
    }
  });
});

describe("phase 1a enforcement: baseline reproducibility and engine failure (ENF-16, engine error)", () => {
  it("ENF-16 baseline regeneration is byte-identical at the same commit", () => {
    const dir = fixtureDir();
    const first = path.join(dir, "a.json");
    const second = path.join(dir, "b.json");
    for (const out of [first, second]) {
      const result = spawnSync(process.execPath, [GENERATOR, "--out", out, "--reason", "enf-16 reproducibility"], {
        cwd: process.cwd(), encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024,
      });
      expect(result.status, String(result.stderr ?? "")).toBe(0);
    }
    expect(fs.readFileSync(first, "utf8")).toBe(fs.readFileSync(second, "utf8"));
    // And the committed baseline must be current for this tree.
    const check = spawnSync(process.execPath, [GENERATOR, "--check"], { cwd: process.cwd(), encoding: "utf8", timeout: 300000, maxBuffer: 1 << 28 });
    expect(check.status, String(check.stdout ?? "")).toBe(0);
  }, 600000);

  it("an unreadable baseline is an ENGINE_ERROR and fails closed in both modes", () => {
    const dir = fixtureDir();
    const missing = path.join(dir, "does-not-exist.json");
    const measurementPath = writeJson(dir, "measurement.json", baseMeasurement());
    const declarationsPath = writeJson(dir, "declarations.json", DECLARATIONS_SILENT);
    for (const mode of ["shadow", "enforce"]) {
      const result = runEngine(["--mode", mode, "--baseline", missing, "--measurement", measurementPath, "--declarations", declarationsPath, "--no-write"]);
      expect(result.status).not.toBe(0);
      expect(result.json.verdict).toBe("ENGINE_ERROR");
      expect(codes(result.json)).toContain("ENGINE_ERROR");
    }
  });
});
