import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { findingsParityTool, hostedShadowRunner } from "./helpers/phase1b-scripts";

/**
 * Capability City Phase 1B — stage S2: hosted ENFORCE, visible and NOT required.
 *
 * Specification: docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md, stage **S2** of §3, and the ENF-12 identity.
 *
 * WHAT S2 IS, STATED SO THE TESTS BELOW ARE NOT MYSTERIOUS
 *   S1 put the qualified prospective enforcer on hosted CI in **shadow** mode: it measured and reported, and a
 *   policy violation did not block. S2 adds the real **enforce** evaluation beside it. The two modes share ONE
 *   evaluator, and the only thing that differs between them is the EXIT CODE:
 *
 *       shadow   policy violation -> reported, exit 0
 *       enforce  policy violation -> reported, exit non-zero
 *       both     engine/machinery failure -> exit non-zero
 *
 *   That difference is the whole point of S2, and ENF-12 is what makes shadow evidence *about* enforce: the two
 *   modes must produce the **same findings** on the same inputs. If they did not, everything S1 measured would be
 *   evidence about a program that enforcement does not run.
 *
 * WHAT S2 IS NOT
 *   It does not make `architecture` required. Activation is stage **S3** — a ruleset edit and nothing else — and
 *   it is a Root Owner act. The S2 job must stay independent (`needs:` absent), visible on both events, and free
 *   of any conditional or `continue-on-error` that could hide an enforce failure.
 *
 * WHY THESE TESTS DRIVE THE SHIPPED COMMANDS
 *   The subject under test is the enforcement the hosted job actually runs, so the engine is spawned and the
 *   artifacts it writes are read back. A test that called a private copy of the evaluator would prove nothing
 *   about what CI does — the same reasoning the Phase 1A ENF suite records.
 */

const PROJECT = process.cwd();
const ENGINE = "scripts/architecture-enforcement.cjs";
const PARITY = "scripts/architecture-findings-parity.cjs";
const SHADOW_HOSTED = "scripts/architecture-shadow-hosted.cjs";
const WORKFLOW = ".github/workflows/ci.yml";

type Json = Record<string, unknown>;

const FILE_A = "src/alpha/a.ts";
const FILE_B = "src/beta/b.ts";
const FILE_U = "src/undeclared/u.ts";
const V1_HASH = "1".repeat(64);

// ---------------------------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------------------------

function fixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase1b-s2-"));
}

function writeJson(dir: string, name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

function baseBaseline(overrides: Json = {}): Json {
  return {
    schema: "city-architecture-enforcement-baseline/1",
    baseline_version: 1,
    parent_baseline_hash: null,
    baseline_hash: V1_HASH,
    source_commit: "fixture",
    files: { [FILE_A]: "alpha", [FILE_B]: "beta", [FILE_U]: "UNDECLARED" },
    edges: [[FILE_A, FILE_B]],
    retired_edges: [],
    unresolved: [],
    not_yet_enforced: ["dependency_cycles"],
    ...overrides,
  };
}

function baseMeasurement(overrides: Json = {}): Json {
  return {
    files: { [FILE_A]: "alpha", [FILE_B]: "beta", [FILE_U]: "UNDECLARED" },
    edges: [[FILE_A, FILE_B]],
    unresolved: [],
    parse_issues: [],
    read_failures: [],
    silent_skips: 0,
    ownership_conflicts: [],
    ...overrides,
  };
}

function authorizationSeries(baseline: Json): Json {
  return {
    schema: "city-architecture-enforcement-baseline-series/1",
    series: "city-architecture-enforcement-baseline",
    accepted: [
      {
        baseline_version: Number(baseline.baseline_version ?? 1),
        parent_baseline_hash: (baseline.parent_baseline_hash as string | null) ?? null,
        baseline_hash: String(baseline.baseline_hash),
        source_commit: "0".repeat(40),
        authorization_reference: "phase1b S2 fixture: an injected baseline used to drive both enforcement modes, not a repository state",
        evidence_reference: "tests/unit/city/architecture-s2-hosted-enforce.test.ts",
        accepted_at: "2026-09-23T00:00:00Z",
        status: "ACCEPTED",
      },
    ],
  };
}

const DECLARATIONS_SILENT: Json = { provides: { "beta@1": "beta" }, declares: { alpha: [], beta: [] } };

interface ModeRun {
  status: number | null;
  artifact: Json;
  artifactPath: string;
}

/**
 * Run the engine in one mode over an injected fixture and read back the artifact it wrote.
 *
 * Both modes are driven through the shipped CLI with the same seam, which is what makes the comparison between
 * them meaningful: any difference in the findings is a difference in the MODE, not in how the test invoked it.
 */
function runMode(mode: "shadow" | "enforce", options: { baseline?: Json; measurement?: Json; series?: Json; declarations?: Json } = {}): ModeRun {
  const dir = fixtureDir();
  const baseline = options.baseline ?? baseBaseline();
  const baselinePath = writeJson(dir, "baseline.json", baseline);
  const seriesPath = writeJson(dir, "series.json", options.series ?? authorizationSeries(baseline));
  const declarationsPath = writeJson(dir, "declarations.json", options.declarations ?? DECLARATIONS_SILENT);
  const measurementPath = writeJson(dir, "measurement.json", options.measurement ?? baseMeasurement());
  const outDir = path.join(dir, "out");
  const result = spawnSync(process.execPath, [ENGINE, "--mode", mode, "--baseline", baselinePath, "--authorizations", seriesPath, "--measurement", measurementPath, "--declarations", declarationsPath, "--out", outDir], { cwd: PROJECT, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  const name = mode === "shadow" ? "architecture-enforcement-shadow.json" : "architecture-enforcement-live.json";
  const artifactPath = path.join(outDir, name);
  return { status: result.status, artifact: JSON.parse(fs.readFileSync(artifactPath, "utf8")) as Json, artifactPath };
}

function findingsOf(artifact: Json): Array<{ code: string; severity: string; subject: string; detail?: string }> {
  return (artifact.findings ?? []) as Array<{ code: string; severity: string; subject: string; detail?: string }>;
}

/** Every non-comment line of the workflow: what it EXECUTES, not what it explains. */
function executableLines(workflow: string): string {
  return workflow.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join("\n");
}

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> };
type Job = { "runs-on"?: string; needs?: unknown; if?: unknown; paths?: unknown; branches?: unknown; steps?: Step[] };
type CiWorkflow = { on?: Record<string, unknown>; jobs?: Record<string, Job> };

function ciWorkflow(): { raw: string; parsed: CiWorkflow } {
  const raw = fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8");
  return { raw, parsed: parseYaml(raw) as CiWorkflow };
}

function architectureJob(): { raw: string; parsed: CiWorkflow; job: Job } {
  const { raw, parsed } = ciWorkflow();
  const job = parsed.jobs?.architecture;
  if (!job) throw new Error("the `architecture` job is absent from ci.yml; S2 cannot exist without it");
  return { raw, parsed, job };
}

function jobRunText(job: Job): string {
  return (job.steps ?? []).map((step) => step.run ?? "").join("\n");
}

// =============================================================================================
// 1, 2, 3, 12 — the S2 job stays NOT required, independent and additive
// =============================================================================================

describe("Phase 1B S2: the hosted enforce job is visible, independent and NOT required", () => {
  it("1/12 the job exists and is not in the ruleset's required contexts", () => {
    const { parsed, job } = architectureJob();
    expect(Object.keys(parsed.jobs ?? {})).toContain("architecture");
    expect(job["runs-on"]).toBe("windows-latest");

    // The ruleset is the only thing that can make a check required, and this phase must not touch it. The
    // repository's own statement of the ruleset contract is checked here; the live ruleset is asserted in the
    // S1 suite (which has the credential-aware branch) and measured out of band by the mission.
    const codeowners = fs.readFileSync(path.join(PROJECT, ".github", "CODEOWNERS"), "utf8");
    const requiredLine = codeowners.split(/\r?\n/).find((line) => /Required status checks\s*=/.test(line));
    expect(requiredLine, "CODEOWNERS no longer states the required status-check contract").toBeTruthy();
    expect(requiredLine).toMatch(/quality,\s*unit,\s*acceptance,\s*package/);
    expect(requiredLine, "S2 must not add the architecture check to the required list").not.toMatch(/architecture/);
    // And no workflow file may claim a required context of its own.
    expect(executableLines(fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8"))).not.toMatch(/required_status_checks/);
  });

  it("2 the job remains independent: no needs, no if, no paths filter, no branches filter", () => {
    const { job } = architectureJob();
    // A `needs:` would let the check vanish whenever an earlier job failed; a filter or a conditional would make
    // it absent rather than red. S2 adds work to this job, so these properties must survive the addition.
    expect(job.needs, "a `needs:` would let the S2 check disappear").toBeUndefined();
    expect(job.if, "an `if:` would let the S2 check disappear").toBeUndefined();
    expect(job.paths).toBeUndefined();
    expect(job.branches).toBeUndefined();
  });

  it("2b no ordinary job gates on the architecture job, and `architecture` is not added to any needs", () => {
    const { parsed } = ciWorkflow();
    for (const [name, job] of Object.entries(parsed.jobs ?? {})) {
      if (name === "architecture") continue;
      expect(JSON.stringify(job.needs ?? null), `${name} now depends on the architecture job`).not.toContain("architecture");
    }
  });

  it("3 S2 is ADDITIVE: shadow is still there, and enforce did not replace it", () => {
    const { job } = architectureJob();
    const runs = jobRunText(job);
    // The S1 evidence trail must survive. S2 without shadow would destroy the very evidence the S2 comparison is
    // made against, and would silently change what every historical `architecture-shadow` artifact means.
    expect(runs, "the S1 shadow evaluation is gone").toMatch(/architecture:enforce:shadow/);
    expect(runs, "the S1 hosted shadow runner is gone").toMatch(/scripts\/architecture-shadow-hosted\.cjs/);
    expect(runs, "the S1 baseline-series check is gone").toMatch(/architecture:enforce:baseline:series/);
    expect(runs, "the S1 baseline self-consistency check is gone").toMatch(/architecture:enforce:baseline -- --check/);
    // ...and the S2 enforce evaluation is present BESIDE it.
    expect(runs, "the S2 enforce evaluation is missing").toMatch(/architecture:enforce -- --out/);
  });

  it("4 enforce is a SEPARATE step from shadow, so its verdict and exit code are its own", () => {
    const { job } = architectureJob();
    const steps = job.steps ?? [];
    const shadowStep = steps.findIndex((s) => /architecture:enforce:shadow/.test(String(s.run ?? "")));
    const enforceStep = steps.findIndex((s) => /architecture:enforce -- --out/.test(String(s.run ?? "")));
    expect(shadowStep, "no shadow step").toBeGreaterThanOrEqual(0);
    expect(enforceStep, "no enforce step").toBeGreaterThanOrEqual(0);
    // Distinct steps is the point: a single shell block running both would report one exit code and hide which
    // mode failed. Enforce must come after shadow so the artifact it is compared against already exists.
    expect(enforceStep).not.toBe(shadowStep);
    expect(enforceStep, "enforce must run after shadow, so its comparison input exists").toBeGreaterThan(shadowStep);
    expect(steps[enforceStep].if, "the enforce step is conditional").toBeUndefined();
  });

  it("5 shadow and enforce write to DIFFERENT output directories", () => {
    const { job } = architectureJob();
    const runs = jobRunText(job);
    // Both modes name their artifact after the MODE, so the directory is the only thing keeping them apart: a
    // shared `--out` would make one silently overwrite the other and the parity comparison would compare a file
    // with itself, which always "passes".
    const outDirs = [...runs.matchAll(/--out\s+(\S+)/g)].map((m) => m[1]);
    expect(outDirs.length, "expected at least the shadow and enforce output directories").toBeGreaterThanOrEqual(2);
    expect(new Set(outDirs).size, `the modes share an output directory: ${JSON.stringify(outDirs)}`).toBe(outDirs.length);
    expect(outDirs.some((d) => /engine-shadow/.test(d))).toBe(true);
    expect(outDirs.some((d) => /engine-enforce/.test(d))).toBe(true);
    // The parity step must consume exactly those two directories.
    const parityStep = (job.steps ?? []).find((s) => /architecture-findings-parity/.test(String(s.run ?? "")));
    expect(parityStep, "no parity step").toBeTruthy();
    expect(String(parityStep?.run)).toMatch(/--shadow\s+artifacts\/city\/phase1\/engine-shadow/);
    expect(String(parityStep?.run)).toMatch(/--enforce\s+artifacts\/city\/phase1\/engine-enforce/);
  });

  it("10 nothing can hide an enforce failure: no continue-on-error and no always() near enforcement", () => {
    const { parsed, job } = architectureJob();
    expect(JSON.stringify(job), "the architecture job uses continue-on-error").not.toMatch(/continue-on-error/);
    for (const [name, j] of Object.entries(parsed.jobs ?? {})) {
      expect(JSON.stringify(j), `${name} sets a workflow-level continue-on-error`).not.toMatch(/continue-on-error/);
    }
    // The only permitted `if: always()` is the artifact upload, whose conclusion cannot change the job.
    for (const step of job.steps ?? []) {
      const isAlways = /always\(\)/.test(String(step.if ?? ""));
      if (!isAlways) continue;
      expect(step.uses, "a non-artifact step runs as `if: always()`, which can hide a failure").toMatch(/upload-artifact/);
    }
    // The enforcement steps themselves must be unconditional.
    for (const step of job.steps ?? []) {
      if (!/architecture:enforce|architecture-findings-parity/.test(String(step.run ?? ""))) continue;
      expect(step.if, `the enforcement step '${step.name ?? step.run?.slice(0, 30)}' is conditional`).toBeUndefined();
    }
  });

  it("11 the legacy ratchet remains in the REQUIRED quality job, unchanged", () => {
    const { parsed } = ciWorkflow();
    const quality = parsed.jobs?.quality;
    expect(quality, "the quality job is gone").toBeTruthy();
    expect(jobRunText(quality ?? {}), "the legacy ratchet no longer runs in the required quality job").toMatch(/architecture:ratchet/);
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["architecture:ratchet"], "the legacy ratchet command changed").toBe("node scripts/architecture.cjs ratchet");
    // S2 is additive observation plus policy; it may not retire the gate it is replacing trust in.
    expect(jobRunText(architectureJob().job)).not.toMatch(/architecture:ratchet/);
  });
});

// =============================================================================================
// 6, 7 — parity compares identity and multiplicity, and fails closed
// =============================================================================================

describe("Phase 1B S2: shadow/enforce parity (ENF-12) compares identity, and fails closed", () => {
  it("8 the modes differ ONLY in exit behaviour: same findings, shadow exits 0, enforce exits non-zero", () => {
    // A new edge to a file whose owner is UNDECLARED: a genuine policy violation, not a machinery failure.
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]] });
    const shadow = runMode("shadow", { measurement });
    const enforce = runMode("enforce", { measurement });

    expect(shadow.status, "shadow must NOT block on a policy violation").toBe(0);
    expect(enforce.status, "enforce MUST block on the same policy violation").toBe(1);

    // The findings are identical, in order and in content. This is ENF-12 stated directly.
    expect(JSON.stringify(findingsOf(enforce.artifact))).toBe(JSON.stringify(findingsOf(shadow.artifact)));
    expect(shadow.artifact.verdict).toBe("POLICY_VIOLATION");
    expect(enforce.artifact.verdict).toBe("POLICY_VIOLATION");
    expect(findingsOf(shadow.artifact).map((f) => f.code)).toContain("NEW_EDGE_UNDECLARED_ENDPOINT");
    // ...and the modes are LABELLED differently, so a reader can tell which produced a file.
    expect(shadow.artifact.mode).toBe("shadow");
    expect(enforce.artifact.mode).toBe("enforce");
  });

  it("6 parity is by identity and multiplicity, not by count", () => {
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]] });
    const shadow = runMode("shadow", { measurement });
    const enforce = runMode("enforce", { measurement });

    // The shipped comparator, not a private reimplementation: one identity definition, one multiset comparison.
    const comparison = hostedShadowRunner.compareFindings(
      findingsOf(shadow.artifact).map(hostedShadowRunner.normalizeFinding),
      findingsOf(enforce.artifact).map(hostedShadowRunner.normalizeFinding)
    );
    expect(comparison.parity).toBe(true);
    expect(comparison.comparison_kind).toMatch(/multiset/);
    expect(comparison.local_findings_hash).toBe(comparison.hosted_findings_hash);
    expect(comparison.multiplicity_differences).toEqual([]);

    // A COUNT-ONLY check would call this a pass, and it must not: keep the count, change one finding's identity.
    const normalized = findingsOf(enforce.artifact).map(hostedShadowRunner.normalizeFinding);
    const mutated = normalized.map((entry, index) => (index === 0 ? { ...entry, subject: `${entry.subject}#mutated` } : entry));
    const trapped = hostedShadowRunner.compareFindings(normalized, mutated);
    expect(trapped.local_count, "the mutation changed the count, so it is not a count-only trap").toBe(trapped.hosted_count);
    expect(trapped.local_findings_hash).not.toBe(trapped.hosted_findings_hash);
    expect(trapped.parity, "a count-preserving identity change was reported as parity").toBe(false);

    // Multiplicity is part of the identity too: one occurrence is not the same observation as three.
    const once = [normalized[0]];
    const thrice = [normalized[0], normalized[0], normalized[0]];
    expect(hostedShadowRunner.compareFindings(once, thrice).parity).toBe(false);
  });

  it("7 a missing or unreadable parity input is NOT_MEASURED and fails; it is never a pass", () => {
    const dir = fixtureDir();
    // Neither path exists.
    const missing = spawnSync(process.execPath, [PARITY, "--mode", "shadow-enforce", "--shadow", path.join(dir, "nope-1.json"), "--enforce", path.join(dir, "nope-2.json")], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (missing.error) throw missing.error;
    expect(missing.status, "a comparison that could not be made must not exit 0").toBe(2);
    const report = JSON.parse(String(missing.stdout ?? "")) as Json;
    expect(report.state).toBe("PARITY_NOT_MEASURED");
    expect(report.parity).toBe(false);
    expect(report.mode).toBe("shadow-enforce");

    // An input that is valid JSON but not an enforcement artifact is also not comparable.
    const notAnArtifact = writeJson(dir, "not-an-artifact.json", { schema: "x" });
    const bogus = spawnSync(process.execPath, [PARITY, "--mode", "shadow-enforce", "--shadow", notAnArtifact, "--enforce", notAnArtifact], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (bogus.error) throw bogus.error;
    expect(bogus.status).toBe(2);
    expect((JSON.parse(String(bogus.stdout ?? "")) as Json).state).toBe("PARITY_NOT_MEASURED");

    // The shipped entry point agrees, driven directly.
    expect(findingsParityTool.shadowEnforceMain({ shadow: path.join(dir, "nope-1.json"), enforce: path.join(dir, "nope-2.json") })).toBe(2);
  });

  it("6b the shipped comparator reports SHADOW_HASH/ENFORCE_HASH and agrees on a passing fixture", () => {
    const dir = fixtureDir();
    const baseline = baseBaseline();
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]] });
    // Produce the two artifacts through the shipped CLI, then drive the shipped comparator over the directories.
    const outShadow = path.join(dir, "engine-shadow");
    const outEnforce = path.join(dir, "engine-enforce");
    const baselinePath = writeJson(dir, "baseline.json", baseline);
    const seriesPath = writeJson(dir, "series.json", authorizationSeries(baseline));
    const measurementPath = writeJson(dir, "measurement.json", measurement);
    const declarationsPath = writeJson(dir, "declarations.json", DECLARATIONS_SILENT);
    for (const [mode, out] of [["shadow", outShadow], ["enforce", outEnforce]] as Array<[string, string]>) {
      const r = spawnSync(process.execPath, [ENGINE, "--mode", mode, "--baseline", baselinePath, "--authorizations", seriesPath, "--measurement", measurementPath, "--declarations", declarationsPath, "--out", out], { cwd: PROJECT, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      if (r.error) throw r.error;
      // shadow exits 0 on a policy violation; enforce exits 1. Both wrote their artifact -- that is the point.
      expect([0, 1]).toContain(r.status);
    }
    const parity = spawnSync(process.execPath, [PARITY, "--mode", "shadow-enforce", "--shadow", outShadow, "--enforce", outEnforce], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (parity.error) throw parity.error;
    const payload = JSON.parse(String(parity.stdout ?? "")) as Json;
    expect(payload.state).toBe("SHADOW_ENFORCE_PARITY");
    expect(payload.parity).toBe(true);
    // The directory argument must resolve each mode to the artifact that mode actually writes.
    expect(String(payload.SHADOW_FINDINGS_HASH)).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.SHADOW_FINDINGS_HASH).toBe(payload.ENFORCE_FINDINGS_HASH);
    expect(payload.HASHES_EQUAL).toBe(true);
    expect(payload.COUNTS_EQUAL).toBe(true);
    expect(payload.multiplicity_differences).toEqual([]);
    expect(parity.status).toBe(0);
  });
});

// =============================================================================================
// 9 — machinery failure fails BOTH modes
// =============================================================================================

describe("Phase 1B S2: machinery failure is fail-closed in BOTH modes", () => {
  it("9 an unauthorised baseline series fails shadow AND enforce", () => {
    const baseline = baseBaseline({ baseline_hash: "9".repeat(64) });
    // A series that authorizes a DIFFERENT triple: the baseline does not govern, in either mode.
    const series = authorizationSeries(baseBaseline());
    for (const mode of ["shadow", "enforce"] as const) {
      const run = runMode(mode, { baseline, series });
      expect(run.status, `${mode} accepted an unauthorised baseline`).toBe(1);
      expect(run.artifact.verdict, `${mode} reported a policy verdict it could not establish`).toBe("ENGINE_ERROR");
    }
  });

  it("9b an incomplete sensor fails shadow AND enforce, even though the engine calls it a policy violation", () => {
    // The engine classifies SENSOR_INCOMPLETE as `severity: VIOLATION`, so shadow exits 0 on it by its own
    // contract -- and that is exactly why the HOSTED runner escalates it. Here the two modes are compared
    // directly: both report the identical finding set, and the hosted escalation is what turns it into a failure.
    const measurement = baseMeasurement({ silent_skips: 3 });
    const shadow = runMode("shadow", { measurement });
    const enforce = runMode("enforce", { measurement });
    expect(JSON.stringify(findingsOf(shadow.artifact))).toBe(JSON.stringify(findingsOf(enforce.artifact)));
    expect(findingsOf(shadow.artifact).map((f) => f.code)).toContain("SENSOR_INCOMPLETE");
    // The engine's own shadow contract reports without blocking; enforce blocks.
    expect(shadow.status).toBe(0);
    expect(enforce.status).toBe(1);
    // ...and the HOSTED runner is what makes an incomplete sensor fail closed in shadow too.
    const runnerDir = fixtureDir();
    const baselinePath = writeJson(runnerDir, "baseline.json", baseBaseline());
    const seriesPath = writeJson(runnerDir, "series.json", authorizationSeries(baseBaseline()));
    const measurementPath = writeJson(runnerDir, "measurement.json", measurement);
    const declarationsPath = writeJson(runnerDir, "declarations.json", DECLARATIONS_SILENT);
    const hosted = spawnSync(process.execPath, [SHADOW_HOSTED, "--baseline", baselinePath, "--authorizations", seriesPath, "--measurement", measurementPath, "--declarations", declarationsPath, "--skip-self-consistency", "--out", path.join(runnerDir, "out"), "--metadata", path.join(runnerDir, "meta.json")], { cwd: PROJECT, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    if (hosted.error) throw hosted.error;
    expect(hosted.status, "the hosted runner let an incomplete sensor pass").toBe(1);
  });

  it("9c an engine error fails BOTH modes", () => {
    const baseline = { schema: "not-a-baseline" };
    for (const mode of ["shadow", "enforce"] as const) {
      const run = runMode(mode, { baseline, series: authorizationSeries(baseBaseline()) });
      expect(run.status, `${mode} passed an engine error`).toBe(1);
      expect(run.artifact.verdict).toBe("ENGINE_ERROR");
    }
  });
});
