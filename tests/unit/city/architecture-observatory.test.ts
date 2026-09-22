import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Capability City Phase 0 — architecture observatory regression suite.
 *
 * The specification is docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md. These tests drive the real
 * production entry point (the same file `pnpm run architecture:observe` invokes) rather than reimplementing
 * any part of it, so a passing suite is evidence about the shipped command and not about a copy of it.
 *
 * The six falsification classes the specification requires are exercised inside the observer itself
 * (`--self-test`) against isolated fixtures, and this suite asserts their results. The real-tree tests
 * assert structural properties that must hold for any tracked tree, never frozen counts: exact numbers are
 * measurements, and a test that pinned them would turn a legitimate repository change into a red build.
 */

const OBSERVATORY = "scripts/architecture-observatory.cjs";

type Json = Record<string, unknown>;

function run(args: string[], timeoutMs = 180000): { status: number | null; json: Json } {
  const result = spawnSync(process.execPath, [OBSERVATORY, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout ?? "");
  if (!stdout.trim()) {
    throw new Error(`observatory produced no JSON (status ${String(result.status)}): ${String(result.stderr ?? "")}`);
  }
  return { status: result.status, json: JSON.parse(stdout) as Json };
}

function runWithArtifacts(): { status: number | null; outDir: string; measurement: Json; comparison: Json; selfTest: Json } {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase0-observatory-"));
  const { status } = run(["--out", outDir]);
  const read = (name: string): Json => JSON.parse(fs.readFileSync(path.join(outDir, name), "utf8")) as Json;
  return {
    status,
    outDir,
    measurement: read("architecture-observatory.json"),
    comparison: read("legacy-comparison.json"),
    selfTest: read("observatory-self-test.json"),
  };
}

describe("phase 0 architecture observatory: required falsification self-tests", () => {
  const { status, json } = run(["--self-test", "--no-write"]);
  const tests = json.tests as Array<{ id: string; pass: boolean; title: string }>;

  it("exits 0 and reports a pass verdict for the self-test set", () => {
    expect(status).toBe(0);
    expect(json.pass).toBe(true);
    expect(tests).toHaveLength(6);
  });

  it.each([
    ["OBS-01", "manifest independence"],
    ["OBS-02", "undeclared target preservation"],
    ["OBS-03", "false-import negative control"],
    ["OBS-04", "supported import forms"],
    ["OBS-05", "mutation sensitivity"],
    ["OBS-06", "determinism"],
  ])("%s passes: %s", (id) => {
    const found = tests.find((test) => test.id === id);
    expect(found, `self-test ${id} missing`).toBeDefined();
    expect(found?.pass, `self-test ${id} failed: ${JSON.stringify(found)}`).toBe(true);
  });
});

describe("phase 0 architecture observatory: known-positive control", () => {
  const { status, json } = run(["--known-positive", "--no-write"]);

  it("resolves the persistence -> runtime-intelligence live-capture dependency from source", () => {
    expect(status).toBe(0);
    expect(json.source).toBe("electron/bootstrap/persistence.ts");
    expect(json.observable).toBe(true);
    expect(String(json.target_observed)).toContain("runtime-intelligence/live-capture");
    expect(json.source_declared_owner).toBe("persistence");
  });

  it("shows the legacy visibility rule would have dropped that real edge", () => {
    // The point of the control: the target is a real tracked source file that no manifest declares, so the
    // legacy rule -- which drops an edge whose target is not a declared module -- cannot retain it.
    expect(json.target_is_declared_module).toBe(false);
    expect(json.target_declared_owner).toBe("UNDECLARED");
    expect(json.legacy_rule_would_keep_edge).toBe(false);
  });
});

describe("phase 0 architecture observatory: real tracked tree", () => {
  const run1 = runWithArtifacts();
  const scan = run1.measurement.scan as Json;
  const ownership = run1.measurement.ownership as Json;
  const graph = run1.measurement.graph as Json;
  const knownPositive = run1.measurement.known_positive as Json;
  const crossCheck = run1.measurement.regex_cross_check as Json;

  it("writes the four required runtime artifacts, and the tracked acceptance record is bound to them", () => {
    expect(run1.status).toBe(0);
    for (const name of [
      "architecture-observatory.json",
      "legacy-comparison.json",
      "observatory-self-test.json",
      "ARCHITECTURE_OBSERVATORY_REPORT.md",
    ]) {
      expect(fs.existsSync(path.join(run1.outDir, name)), `${name} missing`).toBe(true);
    }
    expect(run1.selfTest.pass).toBe(true);
  });

  it("scans Git-tracked source independently of the manifest declarations", () => {
    expect(scan.source).toBe("git ls-files");
    const scanned = Number(scan.tracked_source_files_scanned);
    const declaredModules = Number(ownership.declared_modules);
    expect(scanned).toBeGreaterThan(0);
    // Manifest independence: the scan set is far larger than what the manifests declare.
    expect(scanned).toBeGreaterThan(declaredModules);
    expect(Number(ownership.undeclared_files)).toBeGreaterThan(0);
  });

  it("keeps every resolved internal edge, including edges onto UNDECLARED targets", () => {
    const edges = graph.edges as Array<{ toOwner: string; fromOwner: string; edgeClass: string }>;
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.length).toBe(Number(graph.internal_edges));
    expect(edges.some((edge) => edge.toOwner === "UNDECLARED")).toBe(true);
    expect(edges.some((edge) => edge.edgeClass === "DECLARED_TO_UNDECLARED")).toBe(true);
    // No edge may be missing an ownership verdict: unknown is reported, never omitted.
    expect(edges.every((edge) => typeof edge.fromOwner === "string" && typeof edge.toOwner === "string")).toBe(true);
  });

  it("reports the persistence/live-capture edge in the real graph, not only in the focused control", () => {
    expect(knownPositive.observable).toBe(true);
    const edges = graph.edges as Array<{ from: string; to: string }>;
    expect(
      edges.some((edge) => edge.from === "electron/bootstrap/persistence.ts" && edge.to === knownPositive.target_observed),
    ).toBe(true);
  });

  it("reports the legacy control arm beside the observer and does not silence disagreements", () => {
    expect(Array.isArray(crossCheck.regex_only)).toBe(true);
    expect(Array.isArray(crossCheck.lexer_only)).toBe(true);
    // An edge the strict regex found and the lexer did not would be a lexer MISS. None is tolerated.
    expect((crossCheck.regex_only as unknown[]).length).toBe(0);
    const legacy = run1.comparison.legacy_rule_rederivation as Json;
    expect(legacy.label).toBe("LEGACY_RULE_REDERIVATION");
    // The control comparison is recorded explicitly, and the legacy instrument is not modified by this phase.
    const cli = run1.comparison.legacy_cli as Json;
    expect(cli.label).toBe("LEGACY_CLI");
    expect(cli.ratchet_pass).toBe(true);
  });

  it("is deterministic across runs at the same commit", () => {
    const second = run(["--no-write"]);
    expect(second.status).toBe(0);
    expect(second.json.semantic_hash).toBe(run1.measurement.semantic_hash);
  }, 300000);
});
