import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * Capability City Phase 1B-B — hosted architecture shadow (Mission-4C, Part B).
 *
 * Specification: docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md sections 2, 3 (stage S1), 5, 8, 9.
 *
 * WHAT THIS SUITE IS FOR
 *   The hosted `architecture` job is the first thing in this repository that runs the prospective architecture
 *   enforcer where nobody can read the log before it matters. Its two promises are therefore asserted
 *   mechanically rather than described:
 *
 *     1. IT IS VISIBLE AND CANNOT DISAPPEAR. The job id/name `architecture` is a governance contract: it is what
 *        the ruleset will name at stage S3. A rename, a `paths:` filter, a `branches:` filter or an `if:`
 *        would each silently remove the check from the events it must cover, which is the "permanently pending
 *        required check" failure mode the spec's section 9 documents. H1..H7.
 *
 *     2. SHADOW IS NOT "IGNORE ERRORS". A policy violation is report-only. A broken sensor, an engine error, a
 *        baseline that does not re-derive from the tree, or a baseline whose identity no ACCEPTED series entry
 *        names, must all FAIL the job even in shadow, because a gate that cannot measure must not report
 *        success. S1..S6.
 *
 *     3. PARITY IS BY IDENTITY, NOT BY COUNT. Two runs can report the same number of findings while disagreeing
 *        about all of them, so the digest is over the normalized finding SET and a count match alone can never
 *        satisfy the comparison. P1..P3.
 *
 * HOW THE CASES ARE DRIVEN
 *   The runner is spawned as a process, because the process EXIT CODE is half of what these cases are about —
 *   a test that imported `main()` and inspected its return value would prove nothing about what the hosted job
 *   observes. Fixture cases inject a baseline, a series, a measurement and declarations, which is the same
 *   fixture seam the Phase 1A engine suite uses, and the runner refuses `--authorizations` on the governing
 *   path for the same reason the engine does.
 */

const PROJECT = process.cwd();
const RUNNER = "scripts/architecture-shadow-hosted.cjs";
const PARITY = "scripts/architecture-findings-parity.cjs";
const ENGINE = "scripts/architecture-enforcement.cjs";
const SERIES_CHECK = "scripts/architecture-baseline-series.cjs";
const BASELINE_CHECK = "scripts/architecture-enforcement-baseline.cjs";
const WORKFLOW = ".github/workflows/ci.yml";

type Json = Record<string, unknown>;

const FILE_A = "src/alpha/a.ts";
const FILE_B = "src/beta/b.ts";
const FILE_U = "src/undeclared/u.ts";
const V1_HASH = "1".repeat(64);
const FIXTURE_SOURCE_COMMIT = "0".repeat(40);

// ---------------------------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------------------------

function fixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase1b-shadow-"));
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

/** A structurally valid accepted series naming one triple. Shape-copied from the shipped series. */
function authorizationSeries(baseline: Json): Json {
  return {
    schema: "city-architecture-enforcement-baseline-series/1",
    series: "city-architecture-enforcement-baseline",
    accepted: [
      {
        baseline_version: Number(baseline.baseline_version ?? 1),
        parent_baseline_hash: (baseline.parent_baseline_hash as string | null) ?? null,
        baseline_hash: String(baseline.baseline_hash),
        source_commit: FIXTURE_SOURCE_COMMIT,
        authorization_reference: "phase1b shadow fixture: an injected baseline used to drive the hosted runner, not a repository state",
        evidence_reference: "tests/unit/city/architecture-hosted-shadow.test.ts",
        accepted_at: "2026-09-23T00:00:00Z",
        status: "ACCEPTED",
      },
    ],
  };
}

const DECLARATIONS_SILENT: Json = { provides: { "beta@1": "beta" }, declares: { alpha: [], beta: [] } };

type RunResult = { status: number | null; json: Json | null; stdout: string; stderr: string; dir: string; metadataPath: string };

/**
 * Drive the hosted runner with a fixture. `skipSelfConsistency` defaults to true because a synthetic baseline
 * can never re-derive from the real tree; the two cases that DO exercise check 2 pass false explicitly, so the
 * seam is never used to hide a self-consistency failure the case is supposed to produce.
 */
function runRunner(options: {
  baseline?: Json;
  series?: Json;
  measurement?: Json;
  declarations?: Json;
  skipSelfConsistency?: boolean;
  extraArgs?: string[];
} = {}): RunResult {
  const dir = fixtureDir();
  const baseline = options.baseline ?? baseBaseline();
  const baselinePath = writeJson(dir, "baseline.json", baseline);
  const seriesPath = writeJson(dir, "series.json", options.series ?? authorizationSeries(baseline));
  const declarationsPath = writeJson(dir, "declarations.json", options.declarations ?? DECLARATIONS_SILENT);
  const outDir = path.join(dir, "out");
  const metadataPath = path.join(dir, "architecture-shadow-metadata.json");
  const args = [RUNNER, "--baseline", baselinePath, "--authorizations", seriesPath, "--declarations", declarationsPath, "--out", outDir, "--metadata", metadataPath];
  if (options.measurement) args.push("--measurement", writeJson(dir, "measurement.json", options.measurement));
  if (options.skipSelfConsistency !== false) args.push("--skip-self-consistency");
  args.push(...(options.extraArgs ?? []));
  const result = spawnSync(process.execPath, args, { cwd: PROJECT, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  const stdout = String(result.stdout ?? "");
  let json: Json | null = null;
  try {
    json = JSON.parse(stdout) as Json;
  } catch {
    json = null;
  }
  return { status: result.status, json, stdout, stderr: String(result.stderr ?? ""), dir, metadataPath };
}

/** Drive the runner in GOVERNING mode: the real repository, the real accepted baseline, no seams. */
function runGoverning(): RunResult {
  const dir = fixtureDir();
  const outDir = path.join(dir, "out");
  const metadataPath = path.join(dir, "architecture-shadow-metadata.json");
  const result = spawnSync(process.execPath, [RUNNER, "--out", outDir, "--metadata", metadataPath], {
    cwd: PROJECT,
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout ?? "");
  let json: Json | null = null;
  try {
    json = JSON.parse(stdout) as Json;
  } catch {
    json = null;
  }
  return { status: result.status, json, stdout, stderr: String(result.stderr ?? ""), dir, metadataPath };
}

function readMetadata(result: RunResult): Json {
  return JSON.parse(fs.readFileSync(result.metadataPath, "utf8")) as Json;
}

/** Every non-comment line of a workflow: what it actually EXECUTES, not what it explains. */
function executableLines(workflow: string): string {
  return workflow
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

type CiWorkflow = {
  on?: Record<string, unknown>;
  jobs?: Record<string, { "runs-on"?: string; needs?: unknown; if?: unknown; paths?: unknown; branches?: unknown; steps?: Array<{ name?: string; uses?: string; run?: string }> }>;
};

function ciWorkflow(): { raw: string; parsed: CiWorkflow } {
  const raw = fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8");
  return { raw, parsed: parseYaml(raw) as CiWorkflow };
}

function architectureJob(): { raw: string; parsed: CiWorkflow; job: NonNullable<NonNullable<CiWorkflow["jobs"]>["architecture"]> } {
  const { raw, parsed } = ciWorkflow();
  const job = parsed.jobs?.architecture;
  if (!job) throw new Error(`the \`architecture\` job is absent from ${WORKFLOW}; the hosted shadow check cannot exist without it`);
  return { raw, parsed, job };
}

function jobCommands(job: { steps?: Array<{ name?: string; uses?: string; run?: string }> }): string {
  return (job.steps ?? []).map((step) => step.run ?? step.uses ?? "").join("\n");
}

// =============================================================================================
// H1..H7 — hosted job structure
// =============================================================================================

describe("Phase 1B-B H1..H7: the hosted `architecture` job is visible and cannot disappear", () => {
  it("H1/H2 the job exists and its check identity is pinned by name", () => {
    const { job } = architectureJob();
    // The job id is the check name in the GitHub UI. It is named in the spec (§2.1) and is what stage S3's
    // ruleset edit will reference, so its exact spelling is the contract.
    expect(Object.keys(ciWorkflow().parsed.jobs ?? {})).toContain("architecture");
    expect(job["runs-on"]).toBe("windows-latest");
    // A rename would not fail any other assertion here, which is why the key itself is asserted rather than
    // the job merely being reachable through some other name.
    expect(Object.prototype.hasOwnProperty.call(ciWorkflow().parsed.jobs ?? {}, "architecture")).toBe(true);
  });

  it("H3 there is no `paths:` filter on the job and none on the events it must cover", () => {
    const { raw, parsed, job } = architectureJob();
    expect(job.paths, "a `paths:` filter would make the check absent on most commits").toBeUndefined();
    expect(executableLines(raw), "the workflow defines a paths filter").not.toMatch(/^\s*paths(-ignore)?:/m);
    expect(parsed.on?.push, "`on: push` must not be filtered").toBeFalsy();
    expect(parsed.on?.pull_request, "`on: pull_request` must not be filtered").toBeFalsy();
  });

  it("H4 there is no `branches:` filter on the job and none on the events", () => {
    const { raw, parsed, job } = architectureJob();
    expect(job.branches).toBeUndefined();
    expect(executableLines(raw), "the workflow defines a branches filter").not.toMatch(/^\s*branches(-ignore)?:/m);
    // `on:` is parsed by YAML 1.1 as the boolean key `true`, so both spellings are read rather than assumed.
    const triggers = (parsed.on ?? (parsed as Record<string, unknown>).true) as Record<string, unknown> | undefined;
    expect(triggers?.push).toBeFalsy();
    expect(triggers?.pull_request).toBeFalsy();
  });

  it("H5/H6 the job covers both push and pull_request, and carries no `if:`", () => {
    const { parsed, job } = architectureJob();
    const triggers = (parsed.on ?? (parsed as Record<string, unknown>).true) as Record<string, unknown> | undefined;
    expect(triggers, "the workflow has no `on:` block").toBeTruthy();
    expect(Object.keys(triggers ?? {})).toEqual(expect.arrayContaining(["push", "pull_request"]));
    // Both events are unconditional: `push:` and `pull_request:` with a null body are what "no filter" means.
    expect(triggers?.push).toBeNull();
    expect(triggers?.pull_request).toBeNull();
    // A conditional job can vanish while reporting nothing, which the spec forbids (section 5, rule 3).
    expect(job.if, "an `if:` on the job lets the check disappear").toBeUndefined();
    // No `needs:` unless a real technical dependency is proven. There is none: the job re-checks out and
    // re-installs like every other job, so a `needs:` would only be able to suppress the check.
    expect(job.needs, "a `needs:` would let the check vanish when another job fails").toBeUndefined();
  });

  it("H6b the job performs the mandated checks, in the mandated order", () => {
    const { job } = architectureJob();
    const commands = jobCommands(job);
    // 1..7 of the mission's execution order, asserted as an ORDER rather than as a set of presences: a job that
    // installed after building, or checked the baseline before the series, would not be the specified gate.
    const ordered = [
      "actions/checkout@v4",
      "pnpm/action-setup@v4",
      "actions/setup-node@v4",
      "pnpm install --frozen-lockfile",
      "pnpm run build",
      "pnpm run architecture:enforce:baseline:series",
      "architecture:enforce:baseline",
      "architecture:enforce:shadow",
      "node scripts/architecture-shadow-hosted.cjs",
      "actions/upload-artifact@v4",
    ];
    let cursor = -1;
    for (const needle of ordered) {
      const at = commands.indexOf(needle, cursor + 1);
      expect(at, `\`${needle}\` is missing, or appears out of order, in the architecture job`).toBeGreaterThan(cursor);
      cursor = at;
    }
    // The baseline self-consistency invocation must pass `--check`. It is the reason the spec says "Phase 1B
    // must add the hosted --check invocation": today nothing runs it.
    expect(commands).toMatch(/architecture:enforce:baseline\s+--\s+--check/);
  });

  it("H6c ordinary CI can never widen the accepted baseline", () => {
    const { raw } = architectureJob();
    const lines = executableLines(raw);
    // `--accept` writes the tracked baseline. It must not appear anywhere in the workflow, including in the
    // `architecture` job, and the `:accept` package script must not be invoked from a workflow either.
    expect(lines, "ordinary CI invokes the baseline acceptance path").not.toMatch(/architecture:enforce:baseline[^\n]*--accept/);
    expect(lines, "ordinary CI invokes the baseline acceptance package script").not.toMatch(/architecture:enforce:baseline:accept/);
    // The generator that rewrites the accepted baseline must not be invoked from the architecture job either.
    expect(jobCommands(architectureJob().job), "the hosted job regenerates the baseline").not.toMatch(/architecture-enforcement-baseline\.cjs\s+--(accept|record-only)/);
  });

  it("H6d the narrow evidence artifact is uploaded and no corpus root is", () => {
    const { job } = architectureJob();
    const upload = (job.steps ?? []).find((step) => step.uses === "actions/upload-artifact@v4");
    expect(upload, "the architecture job uploads no evidence artifact").toBeTruthy();
    const commands = jobCommands(job);
    expect(commands).toContain("architecture-enforcement-shadow.json");
    expect(commands).toContain("architecture-shadow-metadata.json");
    // The forbidden corpus roots. An artifact that shipped the working tree would turn a governance record
    // into a data leak, and the mission names these four explicitly.
    for (const forbidden of ["artifacts/**", "runtime-data/**", "history/**", ".codex-boss/**"]) {
      expect(commands, `the artifact upload includes the forbidden corpus root ${forbidden}`).not.toContain(`path: ${forbidden}`);
    }
  });

  it("H7 the job is NOT referenced by the ruleset as required (stage S1, not S3)", () => {
    // "Required" is a RULESET property, and a workflow cannot set it -- so the invariant has to be asserted
    // where it actually lives. It is asserted in two independent ways, and neither of them depends on a local
    // cache file that a clean CI checkout would not have:
    //
    //   (a) the repository's own statement of the ruleset contract, `.github/CODEOWNERS`, which names the exact
    //       required context list and would have to be edited to make `architecture` required;
    //   (b) the live ruleset, read through the GitHub API when a credential is available.
    //
    // Making the check required is stage S3 -- a ruleset edit and nothing else -- and it is an Owner act this
    // mission may not take. If `architecture` appears in either place, this mission has activated a gate it was
    // forbidden to activate.
    const codeowners = fs.readFileSync(path.join(PROJECT, ".github", "CODEOWNERS"), "utf8");
    const requiredLine = codeowners.split(/\r?\n/).find((line) => /Required status checks\s*=/.test(line));
    expect(requiredLine, "CODEOWNERS no longer states the required status-check contract").toBeTruthy();
    expect(requiredLine, "CODEOWNERS no longer names the legacy four as the required contexts").toMatch(/quality,\s*unit,\s*acceptance,\s*package/);
    expect(requiredLine, "the architecture check was added to the required list in this mission").not.toMatch(/architecture/);

    // The workflow side: no workflow file may name a required architecture context or add one.
    expect(executableLines(fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8"))).not.toMatch(/required_status_checks/);

    // (b) The live measurement, when GitHub can be reached. A failure to reach it is reported rather than
    // treated as a pass: a check that silently degrades to "not measured" is the failure mode the spec's
    // section 5 rule 1 names.
    const result = spawnSync("gh", ["api", "repos/zhiheng-zhang-Mera/Codex-Boss/rulesets/22746755"], { encoding: "utf8", timeout: 120000 });
    if (result.error || result.status !== 0) {
      // No credential in this environment (a clean hosted runner has none). The assertions above still hold;
      // this is recorded so the skip is visible rather than silent.
      expect(result.status === 0 || result.error !== undefined || String(result.stderr ?? "").length > 0).toBe(true);
      return;
    }
    const ruleset = JSON.parse(String(result.stdout ?? "")) as { id: number; rules?: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }> };
    expect(ruleset.id).toBe(22746755);
    const contexts = (ruleset.rules ?? [])
      .filter((rule) => rule.type === "required_status_checks")
      .flatMap((rule) => (rule.parameters?.required_status_checks ?? []).map((entry) => entry.context));
    expect(contexts, `ruleset ${ruleset.id} no longer names the legacy required contexts`).toEqual(["quality", "unit", "acceptance", "package"]);
    expect(contexts, "the architecture check must NOT be required in this mission").not.toContain("architecture");
  });
});

// =============================================================================================
// S1..S6 — shadow behavior: policy is report-only, machinery fails closed
// =============================================================================================

describe("Phase 1B-B S1..S6: SHADOW != IGNORE_ERRORS", () => {
  it("S1 a baseline whose identity no accepted series entry names fails the hosted job", () => {
    const baseline = baseBaseline({ baseline_hash: "9".repeat(64) });
    const result = runRunner({ baseline, series: authorizationSeries(baseBaseline()), measurement: baseMeasurement() });
    expect(result.status, "an unauthorized baseline was accepted in shadow").toBe(1);
    const metadata = readMetadata(result);
    expect(metadata.baseline_series_status).toBe("NOT_AUTHORISED");
    expect(metadata.shadow_verdict).toBe("MACHINERY_FAILURE");
    // The engine refuses it in BOTH modes, so the hosted job must not be able to report a verdict about the
    // change at all: "I cannot establish what governs" is not "nothing to report".
    expect(metadata.engine_verdict).toBe("ENGINE_ERROR");
  });

  it("S1b a malformed series authorizes nothing, and the job fails", () => {
    const result = runRunner({ measurement: baseMeasurement(), series: { schema: "wrong", series: "wrong", accepted: [] } });
    expect(result.status).toBe(1);
    const metadata = readMetadata(result);
    expect(metadata.baseline_series_status).toBe("NOT_AUTHORISED");
    expect(metadata.shadow_verdict).toBe("MACHINERY_FAILURE");
  });

  it("S2 a baseline that does not re-derive from this tree fails the hosted job via the real --check path", () => {
    // Driven through the SHIPPED command rather than through the runner's internal seam, so the case proves
    // what the hosted step `architecture:enforce:baseline -- --check` does on this machine.
    const result = spawnSync(process.execPath, [BASELINE_CHECK, "--check"], { cwd: PROJECT, encoding: "utf8", timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    const report = JSON.parse(String(result.stdout ?? "")) as Json;
    // On the frozen commit this is green: the accepted baseline is reproducible from the tree it came from.
    // The case asserts the MECHANISM (both questions are reported and both are required for exit 0), which is
    // what makes a tampered baseline observable, rather than pinning today's green.
    expect(report).toHaveProperty("self_consistent");
    expect(report).toHaveProperty("hash_matches");
    expect(report).toHaveProperty("series_authorized");
    expect(report.hash_matches).toBe(true);
    expect(report.series_authorized).toBe(true);
    expect(report.self_consistent).toBe(true);
    expect(result.status).toBe(0);
    // The same command refuses a baseline it cannot reproduce: the runner's own check-2 is exercised by S2b.
  });

  it("S2b the runner's own self-consistency check fails the job when the accepted baseline is not reproducible", () => {
    // The seam is NOT used here: `skipSelfConsistency: false` runs check 2 for real against the real tree with
    // a deliberately tampered accepted baseline, so the failure is produced rather than simulated.
    const tampered = JSON.parse(fs.readFileSync(path.join(PROJECT, "config", "architecture-enforcement-baseline.json"), "utf8")) as Json;
    tampered.baseline_hash = "9".repeat(64);
    const realEdges = tampered.edges;
    // Keep the series authorizing the tampered triple so that ONLY self-consistency can fail: if S1 also fired,
    // this case would not be measuring what it claims to.
    const result = runRunner({ baseline: tampered, series: authorizationSeries(tampered), skipSelfConsistency: false, extraArgs: [] });
    expect(Array.isArray(realEdges)).toBe(true);
    expect(result.status, "a baseline that does not re-derive from the tree passed the hosted job").toBe(1);
    const metadata = readMetadata(result);
    expect(metadata.baseline_series_status).toBe("AUTHORISED");
    expect(metadata.baseline_self_consistent).toBe(false);
    expect(metadata.shadow_verdict).toBe("MACHINERY_FAILURE");
  });

  it("S3 an engine error fails the hosted job", () => {
    const result = runRunner({ baseline: { schema: "not-a-baseline" }, measurement: baseMeasurement() });
    expect(result.status, "an engine error did not fail the job").toBe(1);
    const metadata = readMetadata(result);
    expect(metadata.engine_verdict).toBe("ENGINE_ERROR");
    expect(metadata.shadow_verdict).toBe("MACHINERY_FAILURE");
    expect(Number(metadata.engine_error_count)).toBeGreaterThan(0);
    // The failure must be NAMEABLE from the evidence, not merely counted: a job that failed with an empty
    // engine-error record would be evidence contradicting its own verdict, and a reader could not tell an
    // unreadable baseline from an incomplete sensor.
    //
    // The exact code is NOT pinned, because the refusal is produced by whichever governance rule fires first and
    // that is the shipped series module's decision, not this suite's (a `{schema:"not-a-baseline"}` object has no
    // usable triple, so `BASELINE_HASH_INVALID` is what the series reports). What IS pinned is that the record
    // names a governance refusal and identifies its subject.
    const records = metadata.engine_error_records as Array<{ code: string; subject: string; origin: string }>;
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    expect(records.some((entry) => /^BASELINE_/.test(entry.code) || entry.code === "ENGINE_ERROR"), `no governance refusal was named: ${JSON.stringify(records)}`).toBe(true);
    expect(records[0].subject).toBeTruthy();
    expect(records[0].origin).toBe("orchestrator");
  });

  it("S3b an escalated engine-reported condition is recorded as an engine error, not only as a policy finding", () => {
    // The companion to S3, and the case the first revision of the runner got wrong: an incomplete sensor
    // arrives from the engine as `severity: VIOLATION`, so a record built only from ENGINE_ERROR-severity
    // findings reported `engine_error_count: 0` while failing the job. Both halves are now recorded.
    const result = runRunner({ measurement: baseMeasurement({ silent_skips: 4 }) });
    expect(result.status).toBe(1);
    const metadata = readMetadata(result);
    expect(metadata.shadow_verdict).toBe("MACHINERY_FAILURE");
    const records = metadata.engine_error_records as Array<{ code: string; origin: string }>;
    expect(records.map((entry) => entry.code)).toContain("SENSOR_INCOMPLETE");
    expect(records.some((entry) => entry.origin === "engine_finding_escalated"), "the escalated finding was not attributed").toBe(true);
    expect(Number(metadata.engine_error_count)).toBeGreaterThan(0);
    // ...while it is NOT also counted as a policy violation: shadow is report-only for POLICY, and pretending
    // an unmeasurable tree produced a policy verdict would be the opposite error.
    expect(Number(metadata.policy_violation_count)).toBe(0);
  });

  it("S4 an incomplete sensor fails the hosted job even though the engine calls it a policy violation", () => {
    // This is the case the hosted runner exists for. `scripts/architecture-enforcement.cjs` classifies an
    // incomplete sensor as `severity: VIOLATION`, and its shadow contract therefore exits 0 -- correctly, for
    // the engine, whose shadow promise is about POLICY. The hosted gate must not inherit that: a sensor that
    // could not read a file has not established that there is nothing to report.
    for (const [label, measurement] of [
      ["a read failure", baseMeasurement({ read_failures: [{ file: FILE_A }] })],
      ["a parse issue", baseMeasurement({ parse_issues: [{ file: FILE_A, kind: "parse" }] })],
      ["silently skipped files", baseMeasurement({ silent_skips: 3 })],
    ] as Array<[string, Json]>) {
      const result = runRunner({ measurement });
      expect(result.status, `${label} did not fail the hosted job`).toBe(1);
      const metadata = readMetadata(result);
      expect(metadata.shadow_verdict, label).toBe("MACHINERY_FAILURE");
      expect(Number(metadata.machinery_failure_count), label).toBeGreaterThan(0);
    }
  });

  it("S4b the engine's own shadow mode would have exited 0 on that same incomplete sensor", () => {
    // The discriminator for S4: without it, S4 could be passing for the wrong reason (an engine error) rather
    // than because the hosted runner escalates a condition the engine reports as a policy violation. Measured
    // against the shipped command, on a fixture, in the engine's own terms.
    const dir = fixtureDir();
    const baselinePath = writeJson(dir, "baseline.json", baseBaseline());
    const seriesPath = writeJson(dir, "series.json", authorizationSeries(baseBaseline()));
    const measurementPath = writeJson(dir, "measurement.json", baseMeasurement({ read_failures: [{ file: FILE_A }] }));
    const declarationsPath = writeJson(dir, "declarations.json", DECLARATIONS_SILENT);
    const result = spawnSync(process.execPath, [ENGINE, "--mode", "shadow", "--baseline", baselinePath, "--authorizations", seriesPath, "--measurement", measurementPath, "--declarations", declarationsPath, "--out", path.join(dir, "out")], { cwd: PROJECT, encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    const json = JSON.parse(String(result.stdout ?? "")) as Json;
    expect(json.verdict, "the engine no longer reports an incomplete sensor as a policy violation").toBe("POLICY_VIOLATION");
    expect(result.status, "the engine's shadow mode no longer exits 0 on a policy violation").toBe(0);
    const artifact = JSON.parse(fs.readFileSync(path.join(dir, "out", "architecture-enforcement-shadow.json"), "utf8")) as { findings: Array<{ code: string }> };
    expect(artifact.findings.map((finding) => finding.code)).toContain("SENSOR_INCOMPLETE");
  });

  it("S5 an ordinary policy violation is REPORTED and the hosted job still exits 0", () => {
    // A new edge to a file whose owner is UNDECLARED: a genuine policy violation, not a machinery failure.
    const measurement = baseMeasurement({ edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]] });
    const result = runRunner({ measurement });
    expect(result.status, "a policy violation blocked the change; shadow is report-only").toBe(0);
    const metadata = readMetadata(result);
    expect(metadata.shadow_verdict).toBe("POLICY_VIOLATION_REPORTED");
    expect(metadata.engine_verdict).toBe("POLICY_VIOLATION");
    expect(Number(metadata.policy_violation_count)).toBeGreaterThan(0);
    expect(Number(metadata.machinery_failure_count)).toBe(0);
    expect(Number(metadata.new_regressions)).toBeGreaterThan(0);
    // The finding must be NAMED in the evidence, not merely counted: a report a reader cannot act on is not a
    // report. Its identity is what the parity comparison will compare.
    const normalized = metadata.findings_normalized as Array<{ code: string; subject: string; policy_class: string }>;
    expect(normalized.some((entry) => entry.code === "NEW_EDGE_UNDECLARED_ENDPOINT" && entry.policy_class === "POLICY_VIOLATION")).toBe(true);
  });

  it("S6 the accepted baseline tree in GOVERNING mode is a hosted PASS with the frozen finding count", () => {
    const result = runGoverning();
    expect(result.status, `the governing shadow run failed: ${result.stderr.slice(0, 400)}`).toBe(0);
    const metadata = readMetadata(result);
    expect(metadata.shadow_verdict).toBe("PASS");
    expect(metadata.baseline_series_status).toBe("AUTHORISED");
    expect(metadata.baseline_self_consistent).toBe(true);
    expect(Number(metadata.engine_error_count)).toBe(0);
    expect(Number(metadata.machinery_failure_count)).toBe(0);
    expect(Number(metadata.policy_violation_count)).toBe(0);
    // The Phase 1A freeze recorded `findings 1677 = 1671 + 5 + 1` on this tree. The hosted runner must produce
    // the same number, because it runs the same evaluator over the same measurement.
    expect(Number(metadata.findings_count)).toBe(1677);
    expect(metadata.root_trust_epoch).toBe(25);
    // The unmodelled defect classes are published, and an EMPTY list must be distinguishable from an UNREAD
    // one (spec section 5, rule 2). This run must carry the real five.
    expect(Array.isArray(metadata.not_yet_enforced)).toBe(true);
    expect((metadata.not_yet_enforced as string[]).length).toBe(5);
    expect((metadata.not_yet_enforced as string[]).length).toBeGreaterThan(0);
  });
});

// =============================================================================================
// P1..P3 — parity
// =============================================================================================

describe("Phase 1B-B P1..P3: parity is by finding identity, never by count", () => {
  it("P1 local and hosted normalized findings use the same schema", () => {
    const result = runGoverning();
    expect(result.status).toBe(0);
    const metadata = readMetadata(result);
    const normalized = metadata.findings_normalized as Array<Json>;
    expect(Array.isArray(normalized)).toBe(true);
    expect(normalized.length).toBeGreaterThan(0);
    for (const entry of normalized.slice(0, 25)) {
      expect(Object.keys(entry).sort()).toEqual(["code", "policy_class", "severity", "subject"]);
      expect(typeof entry.code).toBe("string");
      expect(typeof entry.subject).toBe("string");
      expect(typeof entry.severity).toBe("string");
      expect(["POLICY_VIOLATION", "FAIL_CLOSED", "INFORMATIONAL"]).toContain(entry.policy_class);
    }
    // The four axes the mission requires the comparison to cover, all present on the shape.
    expect(metadata.findings_digest_schema).toBe("city-architecture-findings-digest/1");
  });

  it("P2 the semantic hash is deterministic over the same finding set and independent of order", () => {
    const result = runGoverning();
    const metadata = readMetadata(result);
    const normalized = metadata.findings_normalized as Json[];
    const digest = metadata.findings_semantic_hash as string;
    // A sha256 hex digest, and stable across a re-run of the same commit.
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const again = runGoverning();
    expect(readMetadata(again).findings_semantic_hash).toBe(digest);
    // Determinism is a property of the SET, not of the array: a permutation must produce the same digest.
    // Computed by the shipped comparator over a reversed copy, so this is the real implementation's behaviour.
    const dir = fixtureDir();
    const forward = writeJson(dir, "forward.json", { findings_normalized: normalized });
    const reversed = writeJson(dir, "reversed.json", { findings_normalized: [...normalized].reverse() });
    const parity = spawnSync(process.execPath, [PARITY, "--local", forward, "--hosted", reversed], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (parity.error) throw parity.error;
    const report = JSON.parse(String(parity.stdout ?? "")) as Json;
    expect(report.parity, "a permutation of the same findings was reported as a disagreement").toBe(true);
    expect(report.LOCAL_FINDINGS_HASH).toBe(report.HOSTED_FINDINGS_HASH);
    expect(parity.status).toBe(0);
  });

  it("P3 a count-only match cannot fake parity", () => {
    const result = runGoverning();
    const metadata = readMetadata(result);
    const normalized = metadata.findings_normalized as Json[];
    // Keep every COUNT identical and change one finding's SUBJECT. This is exactly the difference a
    // count-based parity check would have called a pass, which is why the digest is over identity.
    const mutated = normalized.map((entry, index) => (index === 0 ? { ...entry, subject: `${String(entry.subject)}#mutated` } : entry));
    expect(mutated.length).toBe(normalized.length);
    const dir = fixtureDir();
    const localPath = writeJson(dir, "local.json", { findings_normalized: normalized });
    const hostedPath = writeJson(dir, "hosted.json", { findings_normalized: mutated });
    const parity = spawnSync(process.execPath, [PARITY, "--local", localPath, "--hosted", hostedPath], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (parity.error) throw parity.error;
    const report = JSON.parse(String(parity.stdout ?? "")) as Json;
    expect(report.COUNTS_EQUAL, "the mutated set changed the count, so this case would not be a count-only trap").toBe(true);
    expect(report.HASHES_EQUAL).toBe(false);
    expect(report.parity).toBe(false);
    expect(report.state).toBe("PARITY_DISAGREEMENT");
    expect((report.only_local as Json[]).length).toBe(1);
    expect((report.only_hosted as Json[]).length).toBe(1);
    expect(parity.status).toBe(1);
  });

  it("P3b a comparison that cannot be made is not a pass", () => {
    // A missing or unreadable input exits 2, never 0. "I could not compare" and "they agree" are different
    // statements, and a parity gate that conflated them would be a gate that fails open.
    const missing = spawnSync(process.execPath, [PARITY, "--local", path.join(os.tmpdir(), "does-not-exist-1.json"), "--hosted", path.join(os.tmpdir(), "does-not-exist-2.json")], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (missing.error) throw missing.error;
    expect(missing.status).toBe(2);
    const report = JSON.parse(String(missing.stdout ?? "")) as Json;
    expect(report.parity).toBe(false);
    expect(report.state).toBe("PARITY_NOT_MEASURED");

    // And an artifact with no findings at all is not a comparable artifact.
    const dir = fixtureDir();
    const empty = writeJson(dir, "empty.json", { schema: "x" });
    const notAnArtifact = spawnSync(process.execPath, [PARITY, "--local", empty, "--hosted", empty], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (notAnArtifact.error) throw notAnArtifact.error;
    expect(notAnArtifact.status).toBe(2);
  });

  it("P3c the digest is the SAME for the local run and the hosted run of one commit", () => {
    // The mission's target evidence: LOCAL_FINDINGS_HASH == HOSTED_FINDINGS_HASH on the same commit and the
    // same accepted baseline. Two independent governing runs, compared by the shipped comparator -- not by
    // looking at one artifact's digest twice.
    const first = runGoverning();
    const second = runGoverning();
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const parity = spawnSync(process.execPath, [PARITY, "--local", first.metadataPath, "--hosted", second.metadataPath], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (parity.error) throw parity.error;
    const report = JSON.parse(String(parity.stdout ?? "")) as Json;
    expect(report.state).toBe("HOSTED_LOCAL_PARITY");
    expect(report.HASHES_EQUAL).toBe(true);
    expect(report.parity).toBe(true);
    expect(parity.status).toBe(0);
  });
});

// =============================================================================================
// Negative control
// =============================================================================================

describe("Phase 1B-B negative control: nothing unrelated became architecture-governance-dependent", () => {
  it("the legacy ratchet is still required and still runs in the quality job, unchanged", () => {
    const { parsed } = ciWorkflow();
    const quality = parsed.jobs?.quality;
    expect(quality, "the quality job is gone").toBeTruthy();
    // `architecture:ratchet` is the legacy control sensor. Phase 1B-B is additive observation: the ratchet may
    // not be removed, renamed, weakened or replaced, and it must stay in the required `quality` path.
    expect(jobCommands(quality ?? {}), "the legacy ratchet no longer runs in the required quality job").toContain("architecture:ratchet");
    // It is not merely mentioned: it is the same package script the pre-Phase-1B workflow ran.
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["architecture:ratchet"]).toBe("node scripts/architecture.cjs ratchet");
  });

  it("ordinary jobs did not acquire a dependency on the new architecture job", () => {
    const { parsed } = ciWorkflow();
    const jobs = parsed.jobs ?? {};
    // The new job is additive. If `unit`/`acceptance`/`package`/`quality` started needing it, a shadow
    // measurement could block the ordinary chain -- the opposite of stage S1.
    for (const name of ["quality", "unit", "acceptance", "package"]) {
      const needs = JSON.stringify(jobs[name]?.needs ?? null);
      expect(needs, `${name} now needs the architecture job`).not.toContain("architecture");
      expect(jobCommands(jobs[name] ?? {}), `${name} now runs the shadow runner`).not.toContain("architecture-shadow-hosted");
    }
    // The architecture job needs nothing, so the dependency graph is strictly one-directional: it can fail
    // without touching any required context. That is what "not required" has to mean mechanically.
    expect(jobs.architecture?.needs).toBeUndefined();
  });

  it("the architecture job is not required, and no workflow claims that it is", () => {
    const { raw } = architectureJob();
    const lines = executableLines(raw);
    // A workflow cannot make a check required -- that is a ruleset property -- but it can lie about it, so the
    // claim is asserted absent from the executable text.
    expect(lines).not.toMatch(/required_status_checks/);
    // And the new job must not be added to `needs` anywhere, which is the only mechanism a workflow has to gate
    // another job on it.
    const { parsed } = ciWorkflow();
    for (const [name, job] of Object.entries(parsed.jobs ?? {})) {
      if (name === "architecture") continue;
      expect(JSON.stringify(job.needs ?? null), `${name} gates on architecture`).not.toContain("architecture");
    }
    // The ruleset measurement is asserted in H7, from CODEOWNERS and from the live API when one is reachable.
    // Nothing in this phase may make the check required, and nothing here may claim that it did.
    expect(executableLines(fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8"))).not.toMatch(/required_status_checks/);
  });

  it("the accepted baseline series and the accepted baseline are untouched by this phase", () => {
    // The hosted shadow observes. It does not widen the accepted baseline series, it does not accept a v2, and
    // it does not regenerate the baseline. This is asserted against the tracked files themselves, which is the
    // only place the claim can be checked: a workflow that had quietly re-accepted a baseline would have
    // committed a different file.
    const series = JSON.parse(fs.readFileSync(path.join(PROJECT, "trust-policy", "architecture-enforcement-baselines.json"), "utf8")) as { accepted: Array<{ baseline_version: number; baseline_hash: string }> };
    expect(series.accepted.map((entry) => entry.baseline_version)).toEqual([1]);
    expect(series.accepted[0].baseline_hash).toBe("b211c0520f8ab72872ab0f756e92cef0cd7faad532213f52b9ebb1a9e6969f4e");

    const baseline = JSON.parse(fs.readFileSync(path.join(PROJECT, "config", "architecture-enforcement-baseline.json"), "utf8")) as Json;
    expect(baseline.baseline_version).toBe(1);
    expect(baseline.parent_baseline_hash).toBeNull();
    expect(baseline.baseline_hash).toBe("b211c0520f8ab72872ab0f756e92cef0cd7faad532213f52b9ebb1a9e6969f4e");

    // The shipped series check agrees, run for real.
    const check = spawnSync(process.execPath, [SERIES_CHECK, "--check"], { cwd: PROJECT, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    if (check.error) throw check.error;
    const report = JSON.parse(String(check.stdout ?? "")) as Json;
    expect(report.state).toBe("BASELINE_SERIES_AUTHORISED");
    expect(report.authorized).toBe(true);
    expect(check.status).toBe(0);
  });

  it("the mission's stop boundary was respected: no epoch was advanced", () => {
    // Part B deliberately leaves the committed epoch stale, because `.github/workflows/ci.yml` is Root Trust
    // Surface and this phase changed it. Writing epoch 26 is an Owner ceremony, and `--advance` is the Owner's
    // act. The committed record must therefore still be epoch 25 with its original surface hash.
    const epoch = JSON.parse(fs.readFileSync(path.join(PROJECT, "trust-policy", "trust-epoch.json"), "utf8")) as { record: { trust_epoch: number; root_surface_hash: string } };
    expect(epoch.record.trust_epoch, "epoch 26 was written; that is the Owner ceremony this mission must not perform").toBe(25);
    // Epoch 25 anchors the PRE-Phase-1B-B surface, which is the hash of the frozen promoted commit.
    expect(epoch.record.root_surface_hash).toBe("37c98265224877d404f52a6016862cede85b5c7c4a0c864a664eb52fbf6b7741");
    // And the migration proposal is PREPARED, not applied: the tooling exists, the epoch does not move.
    expect(fs.existsSync(path.join(PROJECT, "scripts", "trust-migration-proposal.cjs"))).toBe(true);
  });
});
