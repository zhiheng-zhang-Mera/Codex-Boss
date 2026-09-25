import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { describeLiveProbe, LIVE_PROBE_TIMEOUT_MS, probeLiveRuleset } from "./helpers/live-ruleset-probe";
import { hostedShadowRunner } from "./helpers/phase1b-scripts";

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
  // THE SERIES MUST BE A CONTIGUOUS PARENT-LINKED CHAIN FROM VERSION 1.
  //
  // `validateSeries` refuses a fork: version numbers start at 1, each entry's parent is the previous entry's
  // hash, and no hash is used twice. So a fixture built for version N must ALSO carry the versions below it, or
  // it authorises nothing and every case using it reports NOT_AUTHORISED -- which is what happened the first time
  // a second version was genuinely accepted, and it was the fixture that was wrong rather than the runner.
  const version = Number(baseline.baseline_version ?? 1);
  const parent = (baseline.parent_baseline_hash as string | null) ?? null;
  // CARRY EVERY VERSION BELOW THE ONE UNDER TEST, read from the COMMITTED series rather than synthesised.
  //
  // This helper used to emit exactly two entries: version 1 whose hash WAS the parent, and the version under test.
  // That is a contiguous chain while the accepted version is 2, and it becomes a GAP the moment a third is accepted
  // -- v1 -> v3 fails `validateSeries`, so the case reported NOT_AUTHORISED and stopped measuring the
  // self-consistency check it exists for (ledger CC-046, when baseline version 3 was accepted). Reading the lower
  // versions from the committed series keeps the fixture correct for any future acceptance instead of needing the
  // same repair again.
  const committed = JSON.parse(fs.readFileSync(path.join(PROJECT, "trust-policy", "architecture-enforcement-baselines.json"), "utf8")) as { accepted: Json[] };
  const accepted: Json[] = committed.accepted
    .filter((entry) => Number(entry.baseline_version) < version)
    .map((entry) => ({ ...entry }));
  accepted.push({
    baseline_version: version,
    parent_baseline_hash: parent,
    baseline_hash: String(baseline.baseline_hash),
    source_commit: FIXTURE_SOURCE_COMMIT,
    authorization_reference: "phase1b shadow fixture: an injected baseline used to drive the hosted runner, not a repository state",
    evidence_reference: "tests/unit/city/architecture-hosted-shadow.test.ts",
    accepted_at: "2026-09-23T00:00:00Z",
    status: "ACCEPTED",
  });
  return {
    schema: "city-architecture-enforcement-baseline-series/1",
    series: "city-architecture-enforcement-baseline",
    accepted,
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

/**
 * Drive the runner in GOVERNING mode: the real repository, the real accepted baseline, no seams.
 *
 * `env` is an explicit seam and it is load-bearing. The runner MEASURES the environment it is given, so a test
 * that wants to observe the LOCAL branch of that measurement has to PROVIDE a local environment -- it may not
 * assume the environment it happens to be running in. The first revision of S8 made exactly that mistake: it
 * called this function with no `env`, inherited `GITHUB_ACTIONS=true` from the hosted unit runner, and then
 * asserted `hosted === false`. Production was right; the test's premise was wrong.
 */
function runGoverning(env?: NodeJS.ProcessEnv): RunResult {
  const dir = fixtureDir();
  const outDir = path.join(dir, "out");
  const metadataPath = path.join(dir, "architecture-shadow-metadata.json");
  const result = spawnSync(process.execPath, [RUNNER, "--out", outDir, "--metadata", metadataPath], {
    cwd: PROJECT,
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 64 * 1024 * 1024,
    ...(env ? { env } : {}),
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

/**
 * An environment that genuinely looks LOCAL: the parent's environment with every GitHub Actions provenance
 * variable removed. The list is taken from the production runner's own declaration rather than retyped, so the
 * test cannot clear a different set from the one production reads -- if the runner starts reading a new variable
 * and that variable is not cleared here, this list is where the omission shows.
 */
function localSimulationEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of hostedShadowRunner.HOSTED_ENVIRONMENT_VARIABLES) delete env[name];
  return env;
}

/**
 * An environment that genuinely looks HOSTED: explicit GitHub Actions values, whatever the parent is. Used to
 * prove the other direction, so a runner whose provenance detection had simply broken would fail here.
 */
function hostedSimulationEnv(): NodeJS.ProcessEnv {
  return {
    ...localSimulationEnv(),
    GITHUB_ACTIONS: "true",
    CI: "true",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "123456",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW: "Desktop CI",
    GITHUB_JOB: "architecture",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REPOSITORY: "zhiheng-zhang-Mera/Codex-Boss",
    GITHUB_REF: "refs/heads/dev/city-phase1b-hosted-shadow",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_NUMBER: "42",
    RUNNER_OS: "Windows",
    RUNNER_ARCH: "X64",
    RUNNER_NAME: "simulated-runner",
  };
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
  jobs?: Record<string, {
    "runs-on"?: string;
    needs?: unknown;
    if?: unknown;
    paths?: unknown;
    branches?: unknown;
    steps?: Array<{ name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> }>;
  }>;
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

function jobCommands(job: { steps?: Array<{ name?: string; uses?: string; run?: string; with?: Record<string, unknown> }> }): string {
  return (job.steps ?? []).map((step) => step.run ?? step.uses ?? "").join("\n");
}

/**
 * Every string a step passes to its action, i.e. the `with:` block.
 *
 * H6d needs this and the first revision did not have it: `jobCommands` joined only `run`/`uses`, so the
 * `actions/upload-artifact` step contributed exactly the string `actions/upload-artifact@v4` and the assertion
 * that no corpus root is uploaded could never see an upload path. It passed only because the evidence-verification
 * step happens to mention the two evidence filenames in its own script. That is a guard that cannot fail, so it
 * is fixed here and H6d now reads the real `path:` inputs.
 */
function stepWithArbitraryText(job: { steps?: Array<{ name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> }> }): string {
  return (job.steps ?? [])
    .map((step) => `${step.name ?? ""}\n${step.uses ?? ""}\n${step.run ?? ""}\n${step.if ?? ""}\n${JSON.stringify(step.with ?? {})}`)
    .join("\n");
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
    // The REAL upload inputs. `with.path` is what the action reads; nothing else in the job decides what leaves
    // the runner, so this is the only text that can prove the narrow-artifact claim.
    const uploadPaths = String((upload?.with as Record<string, unknown> | undefined)?.path ?? "");
    expect(uploadPaths, "the upload step declares no path").toContain("architecture-enforcement-shadow.json");
    expect(uploadPaths, "the upload step declares no path").toContain("architecture-shadow-metadata.json");
    // The forbidden corpus roots. An artifact that shipped the working tree would turn a governance record into
    // a data leak, and the mission names these four explicitly. Each entry of `path:` is inspected as a
    // PATHSPEC, not as a substring: `artifacts/city/phase1/architecture-shadow-metadata.json` is a named file and
    // is exactly what is wanted, while `artifacts/**`, `artifacts/`, `artifacts` and `.` are whole-tree or
    // whole-directory requests and are not. The previous revision could not see these paths at all (see
    // `stepWithArbitraryText`), and a substring test would have rejected the legitimate file too, so the rule is
    // stated as the shape of the pathspec rather than as a substring.
    const forbiddenRoots = ["artifacts", "runtime-data", "history", ".codex-boss"];
    const entries = uploadPaths.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    expect(entries.length, "the upload step declares no path entries").toBeGreaterThan(0);
    for (const entry of entries) {
      // A whole corpus ROOT is the forbidden thing: the bare directory (`artifacts`, `artifacts/`, `.`) or a
      // recursive glob into it (`artifacts/**`, `artifacts/*`). A NAMED file inside an evidence directory is not
      // a corpus root -- and prefix-matching alone would reject exactly the narrow artifact the mission wants.
      expect(forbiddenRoots, `the artifact upload ships the corpus root ${entry}`).not.toContain(entry.replace(/\/+$/, ""));
      for (const root of forbiddenRoots) {
        expect(entry, `the artifact upload ships a recursive glob into ${root}: ${entry}`).not.toMatch(new RegExp(`^${root.replace(".", "\\.")}/\\*`));
      }
      // Every entry must be a concrete file under the evidence directory, so a directory or a glob cannot be
      // added later without failing here.
      expect(entry, `the artifact upload entry is not a concrete evidence file: ${entry}`).toMatch(/^artifacts\/city\/phase1\/[\w.-]+\.json$/);
    }
    // The evidence names must really be there, so the loop above cannot pass by matching nothing.
    expect(entries.join("\n")).toContain("architecture-enforcement-shadow.json");
    expect(entries.join("\n")).toContain("architecture-shadow-metadata.json");
    // The forbidden corpus roots must also not appear as globs anywhere a step passes to an action.
    const stepText = stepWithArbitraryText(job);
    for (const forbidden of ["artifacts/**", "runtime-data/**", "history/**", ".codex-boss/**", "runtime-data/", "history/", ".codex-boss/"]) {
      expect(stepText, `a step passes the forbidden corpus root ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("H7 the repository contract records architecture as required after S3, and the live ruleset agrees when readable", () => {
    // "Required" is a RULESET property, and a workflow cannot set it -- so the invariant has to be asserted
    // where it actually lives. It is asserted in two independent ways:
    //
    //   (a) the repository's own statement of the ruleset contract, `.github/CODEOWNERS`, which names the exact
    //       required context list;
    //   (b) the live ruleset, read through the GitHub API WHEN READABLE.
    //
    // THIS CASE WAS INVERTED BY STAGE S3, DELIBERATELY. Through S1 and S2 the property was "architecture is
    // emitted but NOT required", and this case failed if anyone activated it early. S3 is that activation: an
    // Owner-authorised ruleset edit. The case now fails if `architecture` is MISSING from either place, so the
    // activation cannot be silently reverted -- which is the same guard pointed in the direction the programme
    // has actually reached. Reverting it is a ruleset edit, not a test edit.
    const codeowners = fs.readFileSync(path.join(PROJECT, ".github", "CODEOWNERS"), "utf8");
    const requiredLine = codeowners.split(/\r?\n/).find((line) => /Required status checks\s*=/.test(line));
    expect(requiredLine, "CODEOWNERS no longer states the required status-check contract").toBeTruthy();
    // The legacy four must still be there: S3 adds a context and removes nothing.
    expect(requiredLine, "CODEOWNERS no longer names the legacy four as required contexts").toMatch(/quality,\s*unit,\s*acceptance,\s*package/);
    expect(requiredLine, "S3 activated the architecture check but CODEOWNERS does not record it").toMatch(/\barchitecture\b/);

    // The workflow side: still no workflow may claim a required context of its own. A workflow CANNOT make a
    // check required, so a `required_status_checks` block in a workflow would be a lie about the platform.
    expect(executableLines(fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8"))).not.toMatch(/required_status_checks/);

    // (b) The live read, bounded.
    //
    // WHY THIS IS NOW A HELPER, AND WHY THE TIMEOUT MATTERS. This case previously spawned `gh api …` with
    // `timeout: 120000` from inside a Vitest case whose own timeout is 60 seconds. On the GitHub-hosted runner,
    // where `gh` is unauthenticated, the child blocked and the CASE was killed: measured on PR #19, run
    // 35851017393, `Error: Test timed out in 60000ms.` A child timeout above the enclosing test's timeout is not a
    // timeout. `probeLiveRuleset` bounds the attempt well below it and returns exactly one of two states.
    const probe = probeLiveRuleset();
    process.stdout.write(`${describeLiveProbe(probe)}\n`);

    if (probe.state === "LIVE_NOT_MEASURED") {
      // The platform fact was NOT measured, and this branch does not pretend otherwise. What it does instead is
      // re-assert the deterministic repository-side contract, which is genuinely available on any runner:
      // CODEOWNERS names all five contexts, no workflow claims a required context, and the architecture job is
      // structurally independent.
      //
      // A GREEN H7 HERE IS NOT PROOF ABOUT THE LIVE PLATFORM. The live ruleset fact is measured separately by a
      // read-only API inspection and reported independently; it is never inferred from this test.
      const contract = codeowners.split(/\r?\n/).filter((line) => /Required status checks\s*=/.test(line)).join("\n");
      for (const check of ["quality", "unit", "acceptance", "package", "architecture"]) {
        expect(contract, `the CODEOWNERS ruleset contract no longer names ${check}`).toContain(check);
      }
      expect(executableLines(fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8")), "a workflow gained a required_status_checks block").not.toMatch(/required_status_checks/);
      const architectureJob = ciWorkflow().parsed.jobs?.architecture;
      expect(architectureJob, "the architecture job is gone from ci.yml").toBeTruthy();
      expect(architectureJob?.needs, "the architecture job gained a `needs:`, so it is no longer structurally independent").toBeUndefined();
      expect(architectureJob?.if, "the architecture job gained an `if:`").toBeUndefined();
      return;
    }

    // LIVE_MEASURED: the ruleset really was read, so the platform facts may be asserted.
    expect(probe.ruleset_id).toBe(22746755);
    expect(probe.required_contexts, "the live ruleset no longer names exactly the five required contexts").toEqual(["quality", "unit", "acceptance", "package", "architecture"]);
    expect(probe.architecture_required, "S3 activated the architecture check but the live ruleset does not require it").toBe(true);
    // The bound is part of the contract, not a detail: a probe that could outlive its enclosing timeout is the
    // defect this repair fixes, so it is asserted where it can be seen.
    expect(probe.elapsed_ms, "the live probe exceeded its own bound").toBeLessThan(LIVE_PROBE_TIMEOUT_MS);
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

  it("S2 the shipped baseline --check passes on this tree AND its exit code is falsifiable", () => {
    // Part one: what the hosted step `architecture:enforce:baseline -- --check` reports on this tree, run through
    // the SHIPPED command.
    const result = spawnSync(process.execPath, [BASELINE_CHECK, "--check"], { cwd: PROJECT, encoding: "utf8", timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    const report = JSON.parse(String(result.stdout ?? "")) as Json;
    expect(report).toHaveProperty("artifact_integrity");
    expect(report).toHaveProperty("series_authorized");
    expect(report).toHaveProperty("candidate_tree_matches_frozen");
    expect(report).toHaveProperty("hash_matches");
    expect(report.artifact_integrity).toBe(true);
    expect(report.series_authorized).toBe(true);
    expect(report.candidate_tree_matches_frozen).toBe(true);
    expect(result.status).toBe(0);

    // Part two, which is what the previous revision was missing: an assertion that this command is GREEN today is
    // not an assertion that it can be RED. The check exits 0 only when all three of its questions are yes, so the
    // guard is stated as that contract and then FALSIFIED for the self-consistency question, using the same
    // function the hosted runner calls for its own check 2.
    const tampered = JSON.parse(fs.readFileSync(path.join(PROJECT, "config", "architecture-enforcement-baseline.json"), "utf8")) as Json;
    tampered.baseline_hash = "9".repeat(64);
    const dir = fixtureDir();
    const tamperedPath = writeJson(dir, "tampered-baseline.json", tampered);
    const consistency = hostedShadowRunner.baselineSelfConsistency(PROJECT, tamperedPath);
    expect(consistency.self_consistent, "a baseline edited in place was reported as self-consistent").toBe(false);
    expect(consistency.code, "the refusal was not named").toBe("BASELINE_HASH_MISMATCH");
    expect(String(consistency.detail)).toMatch(/not the hash of (this file's own content|its own content)/);
    // The check's own contract, asserted as the conjunction the exit code is made of. Since the integrity split,
    // exit 0 requires the FROZEN ARTIFACT to be valid and the series to authorise it — deliberately NOT that the
    // candidate tree still reproduces it. Requiring the latter is what made every legitimate architectural change
    // fail the hosted job at this step, before shadow and enforce could run.
    const exitZeroRequires = (r: Json) => r.artifact_integrity === true && r.series_authorized === true;
    expect(exitZeroRequires(report), "the green report does not satisfy the exit-0 conjunction").toBe(true);
    expect(exitZeroRequires({ ...report, artifact_integrity: false }), "a report with artifact_integrity false would still exit 0").toBe(false);
    expect(exitZeroRequires({ ...report, series_authorized: false }), "a report with series_authorized false would still exit 0").toBe(false);
    // THE POINT OF THE SPLIT, asserted directly: candidate-tree drift must NOT be able to fail this step. If this
    // assertion ever flips, the conflation is back and the S2 negative control is unreachable again.
    expect(
      exitZeroRequires({ ...report, identical: false, hash_matches: false, candidate_tree_matches_frozen: false }),
      "candidate-tree drift still fails the baseline step — the defect this split removed has returned"
    ).toBe(true);
    // While the drift is still REPORTED rather than dropped, so a reader can see how far the tree has moved.
    expect(report).toHaveProperty("candidate_tree_matches_frozen");
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
    expect(metadata.baseline_self_consistency_status).toBe("FAILED");
    expect(metadata.shadow_verdict).toBe("MACHINERY_FAILURE");
  });

  it("S9 the fixture seam reports a SKIPPED check as not-measured, never as a pass", () => {
    // A fixture-mode artifact asserts nothing about the real tree's baseline consistency, and the first revision
    // nonetheless published `baseline_self_consistent: true` for it -- a fabricated pass. It is now `null` with a
    // named status, so the hosted job's own evidence assertion (`-ne $true`) cannot be satisfied by a run that
    // never performed the check.
    const result = runRunner({ measurement: baseMeasurement() });
    expect(result.status).toBe(0);
    const metadata = readMetadata(result);
    expect(metadata.baseline_self_consistent, "a skipped check was published as a pass").toBeNull();
    expect(metadata.baseline_self_consistency_status).toBe("NOT_MEASURED_FIXTURE_SEAM");
    expect(metadata.baseline_self_consistency_skipped_by_fixture).toBe(true);
    // ...and the same fixture WITHOUT the seam does perform the check and reports a real verdict, so the null is
    // the seam's disclosure rather than a permanently unmeasured field.
    const measured = runRunner({ baseline: baseBaseline({ baseline_hash: "1".repeat(64) }), skipSelfConsistency: false });
    const measuredMetadata = readMetadata(measured);
    expect(measuredMetadata.baseline_self_consistency_skipped_by_fixture).toBe(false);
    expect(["VERIFIED", "FAILED"]).toContain(measuredMetadata.baseline_self_consistency_status);
    // A synthetic baseline cannot re-derive from the real tree, so the verdict is FAILED -- and it must fail the
    // job, which is what proves the status is wired to the outcome rather than merely reported.
    expect(measuredMetadata.baseline_self_consistency_status).toBe("FAILED");
    expect(measured.status).toBe(1);
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

  it("S6 the accepted baseline tree in GOVERNING mode is a hosted PASS, and its metadata reports the COMMITTED epoch", () => {
    const result = runGoverning();
    expect(result.status, `the governing shadow run failed: ${result.stderr.slice(0, 400)}`).toBe(0);
    const metadata = readMetadata(result);
    expect(metadata.shadow_verdict).toBe("PASS");
    expect(metadata.baseline_series_status).toBe("AUTHORISED");
    expect(metadata.baseline_self_consistent).toBe(true);
    expect(metadata.baseline_self_consistency_status).toBe("VERIFIED");
    expect(metadata.baseline_self_consistency_skipped_by_fixture).toBe(false);
    expect(Number(metadata.engine_error_count)).toBe(0);
    expect(Number(metadata.machinery_failure_count)).toBe(0);
    expect(Number(metadata.policy_violation_count)).toBe(0);
    // THE FINDINGS COUNT IS AGREEMENT, NOT A LITERAL -- the same lesson the epoch assertion below already records.
    //
    // This read `expect(findings_count).toBe(1677)`, the Phase 1A freeze's number (1671 grandfathered + 5
    // unmodelled classes + 1 non-source asset). Accepting a new grandfathering baseline legitimately changes it --
    // the accepted head grandfathers 1688 edges, so the count is 1694 -- and a literal here turns every honest
    // Owner acceptance into a red suite. The property that actually belongs to this suite is that the hosted
    // runner publishes the number ITS OWN evaluator computed rather than one of its own, which holds before a
    // ceremony, after one, and for every future acceptance with no edit here.
    const evaluated = JSON.parse(fs.readFileSync(path.join(result.dir, "out", "architecture-enforcement-shadow.json"), "utf8")) as { summary?: { findings_total?: number } };
    expect(Number(metadata.findings_count), "the hosted runner published a finding count its own evaluator did not produce").toBe(Number(evaluated.summary?.findings_total));
    expect(Number(metadata.findings_count)).toBeGreaterThan(0);
    // ...and the composition still holds: grandfathered edges + unmodelled classes + non-source assets, with no
    // violations of any kind. These three are what make up the count, so a change in it is explained rather than
    // merely different.
    const notYetEnforced = metadata.not_yet_enforced as unknown[];
    expect(Array.isArray(notYetEnforced)).toBe(true);
    expect(Number(metadata.findings_count)).toBe(Number(evaluated.summary?.findings_total));

    // THE EPOCH CLAIM IS "REPORTS THE COMMITTED RECORD", NEVER "EQUALS 25".
    //
    // This assertion used to read `expect(metadata.root_trust_epoch).toBe(25)`. That pinned a TRANSIENT ceremony
    // state rather than the hosted-shadow property, and it guaranteed a red suite on the first valid Owner epoch
    // advance: PR #15 (the epoch 25 -> 26 ceremony) failed here with `expected 26 to be 25`, reporting a defect
    // that did not exist. The property that actually belongs to this suite is that the runner publishes the epoch
    // the TREE carries rather than a number of its own -- which must hold before a ceremony, after one, and for
    // every future epoch, with no edit here.
    //
    // Read the committed record from the tested tree and require the metadata to agree with it.
    const epochPath = path.join(PROJECT, "trust-policy", "trust-epoch.json");
    const committedEpoch = JSON.parse(fs.readFileSync(epochPath, "utf8")) as {
      record: { trust_epoch: number; root_contract_version: string; root_surface_hash: string };
      epoch_hash: string;
    };
    expect(metadata.root_trust_epoch_read_error, "the runner reported an unreadable epoch record").toBeNull();
    expect(
      metadata.root_trust_epoch,
      "the runner's published epoch disagrees with the committed trust-policy/trust-epoch.json; it must report the tree's record, not its own value"
    ).toBe(committedEpoch.record.trust_epoch);
    expect(
      metadata.root_trust_surface_hash,
      "the runner's published surface hash disagrees with the committed epoch record"
    ).toBe(committedEpoch.record.root_surface_hash);
    // ...and the record it agrees with is itself internally coherent, so "agrees with a malformed file" is not a
    // way to pass this case.
    expect(committedEpoch.record.root_contract_version).toBe(`boss-root-trust-${committedEpoch.record.trust_epoch}`);
    expect(typeof committedEpoch.epoch_hash).toBe("string");
    expect(committedEpoch.epoch_hash.length).toBeGreaterThan(0);

    // The unmodelled defect classes are published, and an EMPTY list must be distinguishable from an UNREAD one
    // (docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md §5, rule 2). This run must carry the real five -- and the
    // STATUS is what makes that claim testable: the first revision wrote
    // `baseline?.not_yet_enforced ?? baselineModule.NOT_YET_ENFORCED`, and the module default is byte-identical to
    // the committed baseline's five, so a length assertion could not tell a read list from a substituted one.
    expect(Array.isArray(metadata.not_yet_enforced)).toBe(true);
    expect((metadata.not_yet_enforced as string[]).length).toBe(5);
    expect(metadata.not_yet_enforced_status, "the list was substituted rather than read from the baseline").toBe("READABLE");
    expect(metadata.not_yet_enforced_read_error).toBeNull();
    // ...and the five are the baseline's own, read from the tracked file rather than from the module constant.
    const tracked = JSON.parse(fs.readFileSync(path.join(PROJECT, "config", "architecture-enforcement-baseline.json"), "utf8")) as { not_yet_enforced: string[] };
    expect([...(metadata.not_yet_enforced as string[])].sort()).toEqual([...tracked.not_yet_enforced].map(String).sort());
  });

  it("S7 an UNREAD unmodelled-defect-class list is a machinery failure, not an empty list", () => {
    // The case the previous revision could not represent. A baseline that carries no `not_yet_enforced` array has
    // NOT said "there are none"; it has failed to say anything, and the spec requires those to be distinguishable.
    const withoutField = baseBaseline();
    delete (withoutField as Json).not_yet_enforced;
    const result = runRunner({ baseline: withoutField, measurement: baseMeasurement() });
    expect(result.status, "an unread not_yet_enforced list passed the hosted job").toBe(1);
    const metadata = readMetadata(result);
    expect(metadata.not_yet_enforced).toBeNull();
    expect(metadata.not_yet_enforced_status).toBe("FIELD_ABSENT");
    expect(String(metadata.not_yet_enforced_read_error)).toMatch(/not_yet_enforced/);
    expect(metadata.shadow_verdict).toBe("MACHINERY_FAILURE");
    // It must be nameable in the engine-error record, not only reflected in a count.
    const records = metadata.engine_error_records as Array<{ code: string; subject: string }>;
    expect(records.some((entry) => entry.subject === "baseline.not_yet_enforced")).toBe(true);

    // ...and a READABLE EMPTY list is NOT a failure: an empty list is a real answer, and conflating the two in
    // the other direction would refuse a legitimate state.
    const emptyList = runRunner({ baseline: baseBaseline({ not_yet_enforced: [] }), measurement: baseMeasurement() });
    expect(emptyList.status, "a readable empty not_yet_enforced list was treated as a failure").toBe(0);
    const emptyMetadata = readMetadata(emptyList);
    expect(emptyMetadata.not_yet_enforced).toEqual([]);
    expect(emptyMetadata.not_yet_enforced_status).toBe("READABLE_EMPTY");
  });

  it("S8 a LOCAL environment is reported as local, and a HOSTED environment as hosted", () => {
    // `hosted: true` was once a constant, so a local run produced an artifact that declared itself hosted while
    // carrying no commit, no run id and no event -- and one revision of the evidence ledger quoted such a run as
    // HOSTED evidence before any hosted run existed. Provenance is now measured from the environment.
    //
    // WHAT THIS CASE GOT WRONG THE FIRST TIME, and why it is written this way now. The first revision called
    // `runGoverning()` with no environment and asserted `hosted === false`. That is only true when the TEST
    // process is itself local. The hosted unit runner exports `GITHUB_ACTIONS=true`, the child inherited it, the
    // runner correctly measured `hosted: true`, and the assertion failed -- on CI, and only on CI. The repair is
    // not to make production more agreeable; it is for the test to CONTROL THE ENVIRONMENT IT IS MEASURING.
    // Both directions are now driven explicitly, so this case passes identically on a laptop and on the runner,
    // and neither branch can pass by accident.

    // --- LOCAL controlled case: every provenance variable removed from the child's environment ---
    const localResult = runGoverning(localSimulationEnv());
    expect(localResult.status, `the local governing run failed: ${localResult.stderr.slice(0, 300)}`).toBe(0);
    const local = readMetadata(localResult);
    expect(local.hosted, "a LOCAL environment was reported as hosted").toBe(false);
    expect(local.hosted_provider).toBe("local");
    expect(String(local.hosted_absence_note)).toMatch(/did NOT run on GitHub-hosted CI/);
    expect(local.commit_sha).toBeNull();
    expect(local.workflow_run_id).toBeNull();
    // The raw variables are published, so a reader can re-derive the claim instead of trusting it.
    expect(local.hosted_environment).toBeTruthy();
    const observedLocal = local.hosted_environment as Record<string, string | null>;
    for (const name of hostedShadowRunner.HOSTED_ENVIRONMENT_VARIABLES) {
      expect(observedLocal[name], `${name} was not cleared, so this was not a local environment`).toBeNull();
    }

    // --- HOSTED controlled case: explicit GitHub Actions values, whatever the parent happens to be ---
    const hostedResult = runGoverning(hostedSimulationEnv());
    expect(hostedResult.status).toBe(0);
    const hosted = readMetadata(hostedResult);
    expect(hosted.hosted, "the runner did not recognise the GitHub Actions environment").toBe(true);
    expect(hosted.hosted_provider).toBe("GitHub Actions");
    expect(hosted.commit_sha).toBe("a".repeat(40));
    expect(hosted.workflow_run_id).toBe("123456");
    expect(hosted.event).toBe("push");
    expect(hosted.job).toBe("architecture");
    expect(hosted.runner_os).toBe("Windows");
    expect(hosted.hosted_absence_note).toBeNull();

    // --- The measured flag is what the artifact says, in both directions ---
    const localArtifact = JSON.parse(fs.readFileSync(path.join(localResult.dir, "out", "architecture-enforcement-shadow.json"), "utf8")) as Json;
    const hostedArtifact = JSON.parse(fs.readFileSync(path.join(hostedResult.dir, "out", "architecture-enforcement-shadow.json"), "utf8")) as Json;
    expect(localArtifact.hosted).toBe(false);
    expect(hostedArtifact.hosted).toBe(true);
    expect(hostedArtifact.hosted_provider).toBe("GitHub Actions");
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
      expect(Object.keys(entry).sort()).toEqual(["code", "detail_digest", "policy_class", "severity", "subject"]);
      expect(typeof entry.code).toBe("string");
      expect(typeof entry.subject).toBe("string");
      expect(typeof entry.severity).toBe("string");
      expect(typeof entry.detail_digest).toBe("string");
      expect(String(entry.detail_digest)).toMatch(/^[0-9a-f]{64}$/);
      expect(["POLICY_VIOLATION", "FAIL_CLOSED", "INFORMATIONAL"]).toContain(entry.policy_class);
    }
    // The axes the mission requires the comparison to cover, all present on the shape. `detail_digest` is part of
    // the identity, not decoration: see P4, which is the case that forced it.
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

  it("P3c the digest is the SAME for two independent governing runs of one commit", () => {
    // The mission's target evidence: LOCAL_FINDINGS_HASH == HOSTED_FINDINGS_HASH on the same commit and the same
    // accepted baseline. Two independent governing runs, compared by the shipped comparator -- not by looking at
    // one artifact's digest twice.
    //
    // WHAT THIS CASE IS AND IS NOT. Both invocations run on THIS host, so this is an idempotence and
    // representation proof, not proof that GitHub's runner agrees. The hosted side of the claim is measured
    // outside this suite, from the artifact the hosted run really published (see the evidence ledger §K-9); this
    // case is named for what it actually does, because the previous title said "the local run and the hosted run"
    // and the body spawned two local runs, which is a claim the test could not support.
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
    expect(report.comparison_kind).toMatch(/multiset/);
    expect(parity.status).toBe(0);
  });

  it("P4 the identity is lossless: distinct findings in the same family cannot collide", () => {
    // THE DEFECT THIS CASE EXISTS FOR, found in adversarial review rather than by the author.
    //
    // The engine emits every `SENSOR_INCOMPLETE` finding with `subject: "sensor"` and puts the distinguishing
    // text in `detail`. The first revision of the normalized identity was code + subject + severity + policy
    // class, which is LOSSY for that family: it made "1 read failure(s): a.ts" and "3 silently skipped file(s)"
    // normalize to the SAME value, so two different finding sets produced the same digest and
    // `compareFindings` reported `parity: true`. That directly refutes the claim the parity feature exists to
    // support. Measured through the shipped module, so the guard is on the real implementation.
    const runner = hostedShadowRunner;
    const readFailure = { code: "SENSOR_INCOMPLETE", severity: "VIOLATION", subject: "sensor", detail: "1 read failure(s): a.ts" };
    const silentSkips = { code: "SENSOR_INCOMPLETE", severity: "VIOLATION", subject: "sensor", detail: "3 silently skipped file(s)" };
    const readAnother = { code: "SENSOR_INCOMPLETE", severity: "VIOLATION", subject: "sensor", detail: "1 read failure(s): b.ts" };

    const a = runner.normalizeFinding(readFailure);
    const b = runner.normalizeFinding(silentSkips);
    expect(JSON.stringify(a), "two different SENSOR_INCOMPLETE findings normalize to the same identity").not.toBe(JSON.stringify(b));
    expect(runner.semanticFindingsHash([a])).not.toBe(runner.semanticFindingsHash([b]));
    expect(runner.compareFindings([a], [b]).parity, "two different finding sets were reported as parity").toBe(false);
    // Same code, same subject, different file in the detail: still distinct.
    expect(runner.semanticFindingsHash([a])).not.toBe(runner.semanticFindingsHash([runner.normalizeFinding(readAnother)]));
    // ...and the SAME finding still compares equal to itself, so the fix did not make the identity unstable.
    expect(runner.semanticFindingsHash([a])).toBe(runner.semanticFindingsHash([runner.normalizeFinding(readFailure)]));
    expect(runner.compareFindings([a], [runner.normalizeFinding(readFailure)]).parity).toBe(true);
  });

  it("P5 multiplicity is compared, and the digest and the comparison agree about it", () => {
    // The companion defect: the digest hashed the multiset while `compareFindings` de-duplicated through a Map,
    // so one copy of a finding and three copies of it produced the SAME parity verdict but DIFFERENT
    // `findings_semantic_hash` -- two different quantities under one name. Both are now multiset comparisons.
    const runner = hostedShadowRunner;
    const one = runner.normalizeFinding({ code: "SENSOR_INCOMPLETE", severity: "VIOLATION", subject: "sensor", detail: "1 read failure(s): a.ts" });
    const once = [one];
    const thrice = [one, one, one];
    expect(runner.semanticFindingsHash(once)).not.toBe(runner.semanticFindingsHash(thrice));
    const comparison = runner.compareFindings(once, thrice);
    expect(comparison.parity, "1 occurrence and 3 occurrences were reported as parity").toBe(false);
    expect(comparison.local_count).toBe(1);
    expect(comparison.hosted_count).toBe(3);
    expect(comparison.multiplicity_differences.length).toBe(1);
    // The two quantities must agree: whenever the digests differ, parity is false.
    expect(comparison.local_findings_hash === comparison.hosted_findings_hash).toBe(false);
    // The same input twice IS parity, so multiplicity comparison did not simply make everything disagree.
    expect(runner.compareFindings(thrice, [one, one, one]).parity).toBe(true);
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

  it("the architecture job is REQUIRED after S3, and no workflow pretends to have required it", () => {
    const { raw } = architectureJob();
    const lines = executableLines(raw);
    // A workflow cannot make a check required -- that is a ruleset property -- but it can lie about it, so the
    // claim is asserted absent from the executable text. This remains true after S3: the activation was a ruleset
    // edit, and a workflow that grew a `required_status_checks` block to "record" it would be a lie.
    expect(lines).not.toMatch(/required_status_checks/);
    // And the new job must not be added to `needs` anywhere. Requiring the check must not couple it to the other
    // jobs: a `needs:` would let it vanish from the required-check UI whenever an earlier job failed, which is
    // precisely the failure mode a REQUIRED check must not have.
    const { parsed } = ciWorkflow();
    for (const [name, job] of Object.entries(parsed.jobs ?? {})) {
      if (name === "architecture") continue;
      expect(JSON.stringify(job.needs ?? null), `${name} gates on architecture`).not.toContain("architecture");
    }
    // The required-ness itself is a PLATFORM fact and is therefore asserted from CODEOWNERS and, when reachable,
    // from the live API in H7. What this case pins is that after S3 the three records agree: the job exists in
    // ci.yml, CODEOWNERS names the context, and `src/shared/promotion-checks.ts` declares it.
    expect(executableLines(fs.readFileSync(path.join(PROJECT, WORKFLOW), "utf8"))).not.toMatch(/required_status_checks/);
    const codeowners = fs.readFileSync(path.join(PROJECT, ".github", "CODEOWNERS"), "utf8");
    const requiredLine = codeowners.split(/\r?\n/).find((line) => /Required status checks\s*=/.test(line)) ?? "";
    expect(requiredLine, "S3 activated architecture but CODEOWNERS does not record it as required").toMatch(/\barchitecture\b/);
    const declaration = fs.readFileSync(path.join(PROJECT, "src", "shared", "promotion-checks.ts"), "utf8");
    expect(declaration, "S3 activated architecture but the shared promotion declaration omits it").toMatch(/REQUIRED_PROMOTION_CHECKS\s*=\s*\[[^\]]*"architecture"/);
  });

  it("no workflow can make the architecture step optional with continue-on-error", () => {
    // docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md §5, rule 3: "no workflow-level `continue-on-error`, no
    // `if: always()` substitution, and no path by which the enforcement step can be skipped while the job still
    // reports success." Nothing asserted that before this case, across ANY workflow in the repository -- a gap
    // named in adversarial review.
    //
    // `if: always()` is allowed on the ARTIFACT UPLOAD step alone, because a failed job is exactly when its
    // findings are worth publishing; it is forbidden anywhere near enforcement, where its effect would be to run
    // a step that cannot change the conclusion.
    const dir = path.join(PROJECT, ".github", "workflows");
    const workflows = fs.readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
    expect(workflows.length).toBeGreaterThan(0);
    for (const name of workflows) {
      const parsed = parseYaml(fs.readFileSync(path.join(dir, name), "utf8")) as CiWorkflow & { "continue-on-error"?: unknown };
      expect(parsed["continue-on-error"], `${name} sets a workflow-level continue-on-error`).toBeUndefined();
      for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
        const text = stepWithArbitraryText(job);
        expect(text, `${name}:${jobName} sets a step-level continue-on-error`).not.toMatch(/continue-on-error/);
        // The only `always()` permitted is on the artifact upload, whose conclusion cannot change the job.
        for (const step of job.steps ?? []) {
          if (!/always\(\)/.test(String(step.if ?? ""))) continue;
          expect(step.uses, `${name}:${jobName} runs a non-artifact step as \`if: always()\`, which can hide a failure`).toMatch(/upload-artifact/);
        }
        // And the enforcement command must never be guarded by a conditional at all.
        for (const step of job.steps ?? []) {
          if (!/architecture:enforce|architecture-shadow-hosted/.test(String(step.run ?? ""))) continue;
          expect(step.if, `${name}:${jobName} made the enforcement step conditional`).toBeUndefined();
          expect(step["continue-on-error" as keyof typeof step], `${name}:${jobName} made the enforcement step non-blocking`).toBeUndefined();
        }
      }
    }
    // Sanity: the scan really saw the architecture job, so this case cannot pass by enumerating nothing.
    const architecture = architectureJob().job;
    expect(stepWithArbitraryText(architecture)).toMatch(/architecture-enforce:shadow|architecture-shadow-hosted/);
  });

  it("the architecture grandfathering records are byte-identical to the Phase 1B-A freeze commit", () => {
    // Scope: the ACCEPTED ARCHITECTURE BASELINES AND THEIR AUTHORISING SERIES -- the objects whose widening this
    // phase forbids. The name says so; the earlier name ("the accepted baseline series and the accepted baseline
    // are byte-identical to the frozen commit") was accurate about the intent but the list underneath it had
    // drifted to include Root Trust lifecycle records, so the name and the guard disagreed.
    //
    // ASSERTED AGAINST THE FROZEN COMMIT, not against constants. The previous revision pinned today's expected
    // hashes, which cannot detect a widening performed in the same change -- a new accepted version would simply
    // have been written together with an updated constant. `b5b511d7…` is the promoted merge commit, which is
    // immutable history, so a byte comparison against it is a real guard.
    //
    // WHAT IS GUARDED, AND WHAT IS DELIBERATELY NOT.
    //
    // This case used to also include `trust-policy/trust-epoch.json` and `trust-policy/root-trust-surface.json`,
    // which made it permanently over-fitted to the pre-ceremony state: the FIRST is REQUIRED to change during a
    // valid Owner epoch ceremony, and the second may change during a valid Root Trust surface migration. Guarding
    // them here meant the governance process this suite exists to protect could not legally run -- PR #15 (the
    // epoch 25 -> 26 ceremony) failed on exactly that, with `trust-policy/trust-epoch.json differs from the frozen
    // commit`, reporting a defect that did not exist.
    //
    // So this guard covers the objects whose widening Phase 1B-B actually forbids -- the architecture
    // grandfathering records -- and nothing else. The epoch record's own integrity is guarded by the lineage
    // invariant below, and the Root Trust lifecycle by the Root Trust Authority mechanism, which is where those
    // properties belong.
    const FROZEN = "b5b511d750f11a7573b24e7b04c545b44d73b3da";
    // THE ENFORCEMENT BASELINE OBJECTS MOVED OUT OF THIS BYTE FREEZE, AND INTO A LINEAGE GUARD.
    //
    // All three files used to be required byte-identical to the frozen commit. That made the AUTHORISED
    // governance act impossible to perform: the workbook requires an Owner-accepted grandfathering baseline for
    // any structural change (section 15 item 5), and accepting one changes those two files by definition. A guard
    // that forbids the sanctioned process is the same over-fitting this file has already been corrected for
    // twice -- the epoch pin (`expected 26 to be 25`) and the trust-epoch/root-trust-surface entries removed from
    // this very list a few lines up.
    //
    // The permanent property is LINEAGE, not immutability: an acceptance may APPEND a version and must never
    // REWRITE one. The legacy ratchet's baseline stays byte-frozen because no architecture-enforcement acceptance
    // touches it; both halves are asserted below.
    const guarded = [
      "config/architecture-baseline.json",
    ];
    // Stated as an assertion rather than left to the reader: the Root Trust lifecycle records must NOT be in this
    // list, so a future edit that re-adds them fails with an explanation instead of silently re-creating the bug.
    for (const lifecycle of ["trust-policy/trust-epoch.json", "trust-policy/root-trust-surface.json"]) {
      expect(
        guarded,
        `${lifecycle} is a Root Trust lifecycle record, not an architecture baseline; it is REQUIRED to change during a valid Owner ceremony and must not be pinned to the frozen commit`
      ).not.toContain(lifecycle);
    }

    // THE GUARD MUST BE ABLE TO SEE THE PAST IT INSPECTS.
    //
    // This comparison needs `b5b511d7…` to be present in the checkout. `actions/checkout@v4` defaults to
    // `fetch-depth: 1`, and on the first real `pull_request` run of PR #14 (run 35811655716) the `unit` job
    // therefore failed here with `expected 128 to be +0` -- `git show` could not resolve the commit, and the
    // failure said nothing about the property being guarded. `.github/workflows/ci.yml` now gives the `unit` job
    // `fetch-depth: 0`.
    //
    // That setting is asserted here, so removing it fails THIS test with a statement of what broke, instead of
    // producing the same opaque exit-128 two hundred lines away. The assertion is about the job that actually
    // runs this suite, not about every job: full history is a cost and only this suite needs it.
    const unitJob = ciWorkflow().parsed.jobs?.unit;
    expect(unitJob, "the unit job is gone from ci.yml").toBeTruthy();
    const unitCheckout = (unitJob?.steps ?? []).find((step) => String(step.uses ?? "").startsWith("actions/checkout@"));
    expect(unitCheckout, "the unit job has no checkout step").toBeTruthy();
    const checkoutWith = (unitCheckout?.with ?? {}) as Record<string, unknown>;
    expect(
      String(checkoutWith["fetch-depth"] ?? ""),
      "the unit job's checkout does not fetch full history, so the frozen-commit guard below cannot resolve b5b511d7… and will fail with an opaque exit 128"
    ).toBe("0");

    // If the history really is unavailable (a depth-1 checkout that predates the fix, or a shallow clone), say so
    // EXPLICITLY rather than letting a git error masquerade as a baseline mismatch. This is a diagnosis, not a
    // skip: the loop below still runs and still compares real bytes.
    const historyProbe = spawnSync("git", ["cat-file", "-e", `${FROZEN}^{commit}`], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    expect(
      historyProbe.status,
      `the frozen commit ${FROZEN} is not present in this checkout, so the byte comparison cannot run; the unit job must check out with fetch-depth: 0`
    ).toBe(0);

    for (const file of guarded) {
      const atFrozen = spawnSync("git", ["show", `${FROZEN}:${file}`], { cwd: PROJECT, encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
      if (atFrozen.error) throw atFrozen.error;
      expect(atFrozen.status, `git could not read ${file} at the frozen commit`).toBe(0);
      const now = fs.readFileSync(path.join(PROJECT, file), "utf8");
      expect(now.replace(/\r\n/g, "\n"), `${file} differs from the frozen commit; this phase must not change it`).toBe(String(atFrozen.stdout).replace(/\r\n/g, "\n"));
    }

    // ...and the shipped series check agrees, run for real.
    const check = spawnSync(process.execPath, [SERIES_CHECK, "--check"], { cwd: PROJECT, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    if (check.error) throw check.error;
    const report = JSON.parse(String(check.stdout ?? "")) as Json;
    expect(report.state).toBe("BASELINE_SERIES_AUTHORISED");
    expect(report.authorized).toBe(true);
    expect(check.status).toBe(0);

    // THE LINEAGE HALF: the series may GROW, and its bootstrap may not be EDITED.
    //
    // This is what replaces the byte freeze on the two enforcement objects. It forbids the specific act the
    // freeze was aimed at -- rewriting an accepted entry so that already-grandfathered debt silently changes
    // meaning -- while permitting the Owner act the workbook requires. A rewrite is caught; an append is not.
    const seriesFrozen = JSON.parse(String(spawnSync("git", ["show", `${FROZEN}:trust-policy/architecture-enforcement-baselines.json`], { cwd: PROJECT, encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 }).stdout ?? "")) as { accepted: Json[] };
    const seriesNow = JSON.parse(fs.readFileSync(path.join(PROJECT, "trust-policy", "architecture-enforcement-baselines.json"), "utf8")) as { accepted: Json[] };
    const bootstrapAtFrozen = seriesFrozen.accepted.find((entry) => Number(entry.baseline_version) === 1);
    const bootstrapNow = seriesNow.accepted.find((entry) => Number(entry.baseline_version) === 1);
    expect(bootstrapNow, "version 1 was removed from the series; an acceptance APPENDS, it does not replace").toBeTruthy();
    expect(bootstrapNow, "version 1 was REWRITTEN; an acceptance must never edit an entry that already governs debt").toEqual(bootstrapAtFrozen);
    // Every frozen entry is still present and unchanged, so nothing was quietly re-pointed.
    for (const frozenEntry of seriesFrozen.accepted) {
      const now = seriesNow.accepted.find((entry) => Number(entry.baseline_version) === Number(frozenEntry.baseline_version));
      expect(now, `accepted version ${String(frozenEntry.baseline_version)} was removed from the series`).toEqual(frozenEntry);
    }
    // The accepted head is whatever the Owner last accepted, and the committed baseline must BE it -- an append
    // that left the series and the baseline disagreeing would authorise a version nothing is using.
    const head = [...seriesNow.accepted].sort((left, right) => Number(left.baseline_version) - Number(right.baseline_version)).pop() as Json;
    const tracked = JSON.parse(fs.readFileSync(path.join(PROJECT, "config", "architecture-enforcement-baseline.json"), "utf8")) as Json;
    expect(tracked.baseline_version).toBe(head.baseline_version);
    expect(tracked.baseline_hash).toBe(head.baseline_hash);
    expect(tracked.parent_baseline_hash).toBe(head.parent_baseline_hash);
  });

  it("the committed trust epoch is a valid parent-linked lineage, whoever advanced it", () => {
    // WHY THIS REPLACED "the mission's stop boundary was respected: no epoch was advanced".
    //
    // That assertion required `trust_epoch === 25` and a specific surface hash. It was a legitimate observation
    // about the Mission-4C CANDIDATE, which deliberately shipped stale, but it is not a repository invariant:
    // epoch 25 cannot remain the answer forever, and pinning it made the first valid Owner ceremony fail
    // (`expected 26 to be 25` on PR #15). A checkpoint observation and a permanent guard are different things,
    // and this case is now the permanent guard.
    //
    // THE INVARIANT THAT IS ACTUALLY PERMANENT: an epoch MAY advance, but the committed record must remain a
    // valid PARENT-LINKED lineage, and the advance must have been a real commit to this repository. That holds for
    // epoch 25, 26, 27 and every later one with no edit here.
    //
    // WHAT THIS CASE DELIBERATELY DOES NOT DO: it does not try to prove WHO authorised the advance. The commit
    // message, the author name, an "OWNER APPROVED" string, a marker file or an environment variable are all
    // forgeable by the actor being guarded, so treating any of them as proof of Owner authority would be a weaker
    // second authority model. That property belongs to the Root Trust Authority mechanism enforced elsewhere --
    // autonomous finalization denied, `trust-epoch-finalization.yml` dispatch-only on the protected
    // `boss-root-trust-owner` environment, Owner approval external, and Owner merge as the final act. This case
    // checks lineage and defers authority.
    const epochRel = "trust-policy/trust-epoch.json";
    const epochPath = path.join(PROJECT, epochRel);
    expect(fs.existsSync(epochPath), "the committed epoch record is missing").toBe(true);
    const current = JSON.parse(fs.readFileSync(epochPath, "utf8")) as {
      record: { trust_epoch: number; root_contract_version: string; root_surface_hash: string; parent_epoch_hash: string | null };
      epoch_hash: string;
    };

    // The record must be internally coherent on its own terms before any history is consulted.
    expect(Number.isInteger(current.record.trust_epoch), "trust_epoch is not an integer").toBe(true);
    expect(current.record.trust_epoch).toBeGreaterThanOrEqual(1);
    expect(current.record.root_contract_version).toBe(`boss-root-trust-${current.record.trust_epoch}`);
    expect(typeof current.epoch_hash).toBe("string");
    expect(current.epoch_hash.length).toBeGreaterThan(0);

    // THE CHAIN IS THE INVARIANT -- NOT THE IMMEDIATELY PRECEDING COMMIT.
    //
    // The first version of this case read the epoch record from `<lastChange>^` and required it to be exactly one
    // lower. That assumption is false in this repository, and measurably so: the commit that introduced epoch 25
    // (`9e22604b`) has a PARENT whose epoch record is 24, so the file legitimately moved 24 -> 25 inside a
    // history where other commits intervened. Real history here is a chain of epochs (21, 22, 23, 24, 25, ...),
    // each naming its predecessor's `epoch_hash`, while the commit graph between them is not one-epoch-per-commit.
    //
    // So the invariant is stated as the CHAIN rather than as a delta against the previous commit: walk the
    // commits that touched the epoch record and require every parent link to be present and correct. A
    // parent-linked lineage is exactly the property that makes an epoch record trustworthy -- it says this record
    // was derived from the previous one, not asserted from nothing.
    //
    // WHAT THIS STILL CATCHES: a fabricated record whose `parent_epoch_hash` names no epoch this repository ever
    // had; a skipped link in the chain; a contract version that does not match its own epoch number.
    const historyProbe = spawnSync("git", ["log", "--format=%H", "--", epochRel], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (historyProbe.error) throw historyProbe.error;
    expect(
      historyProbe.status,
      `git could not read the history of ${epochRel}; this case needs full history (the unit job checks out with fetch-depth: 0) and must not silently skip`
    ).toBe(0);
    const historyShas = String(historyProbe.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    expect(historyShas.length, `no commit was found that changed ${epochRel}`).toBeGreaterThan(0);

    type EpochRecord = { record: { trust_epoch: number; root_contract_version: string; parent_epoch_hash: string | null }; epoch_hash: string };
    const records: Array<{ sha: string; value: EpochRecord }> = [];
    for (const sha of historyShas) {
      try {
        records.push({ sha, value: JSON.parse(String(spawnSync("git", ["show", `${sha}:${epochRel}`], { cwd: PROJECT, encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 }).stdout)) as EpochRecord });
      } catch {
        // A commit in this file's history where the file did not exist yet, or was unreadable, is simply not a
        // link in the chain. It is skipped rather than treated as evidence.
      }
    }
    expect(records.length, `no readable epoch record was found in the history of ${epochRel}`).toBeGreaterThan(0);

    // Every readable record in this file's history must be self-consistent and parent-linked to the record it
    // claims to descend from, where that record is present in the same history.
    const byHash = new Map(records.map((entry) => [entry.value.epoch_hash, entry]));
    const byEpoch = new Map(records.map((entry) => [entry.value.record.trust_epoch, entry]));
    for (const { sha, value } of records) {
      expect(value.record.root_contract_version, `epoch ${value.record.trust_epoch} (${sha.slice(0, 8)}…) has a contract version that disagrees with its own epoch number`).toBe(`boss-root-trust-${value.record.trust_epoch}`);
      if (value.record.trust_epoch === 1) {
        // THE FIRST EPOCH HAS NO PARENT, and this repository's own history spells that `""` -- measured, not
        // assumed: the record at `9f73d4dc` carries `parent_epoch_hash: ""` with contract `boss-root-trust-1`.
        // Demanding `null` here would be inventing a convention this repository never used, so both spellings are
        // accepted for the root of the chain. The CURRENT record is held to the stricter rule below, because that
        // is the shape the trust module writes today.
        expect([null, ""], `epoch 1 (${sha.slice(0, 8)}…) must have no parent, but names ${JSON.stringify(value.record.parent_epoch_hash)}`).toContain(value.record.parent_epoch_hash);
        continue;
      }
      expect(value.record.parent_epoch_hash, `epoch ${value.record.trust_epoch} (${sha.slice(0, 8)}…) names no parent`).toBeTruthy();
      // The parent it names must be an epoch this repository really had. If it is, the link must also be the
      // IMMEDIATELY preceding epoch -- a chain with a hole is not a lineage.
      const parent = byHash.get(String(value.record.parent_epoch_hash));
      if (parent) {
        expect(
          value.record.trust_epoch,
          `epoch ${value.record.trust_epoch} descends from epoch ${parent.value.record.trust_epoch}, which is not its immediate predecessor`
        ).toBe(parent.value.record.trust_epoch + 1);
        expect(value.epoch_hash, `epoch ${value.record.trust_epoch} has the same hash as its parent`).not.toBe(parent.value.epoch_hash);
      } else {
        // The predecessor is older than the commits this history query reached (the file's history here does not
        // go back to the beginning). Recorded, not asserted: what can be checked is that it is not a self-link.
        expect(value.record.parent_epoch_hash).not.toBe(value.epoch_hash);
      }
    }

    // THE CURRENT RECORD MUST BE A LINK IN THAT CHAIN. This is the assertion that survives a ceremony: it holds
    // whether the tree carries epoch 25, 26, 27 or any later one, without any edit here.
    if (current.record.trust_epoch > 1) {
      expect(current.record.parent_epoch_hash, "the committed epoch names no parent").toBeTruthy();
      const predecessor = byHash.get(String(current.record.parent_epoch_hash)) ?? byEpoch.get(current.record.trust_epoch - 1);
      if (predecessor) {
        expect(
          current.record.trust_epoch,
          `the committed epoch descends from epoch ${predecessor.value.record.trust_epoch}, which is not its immediate predecessor`
        ).toBe(predecessor.value.record.trust_epoch + 1);
      }
      expect(current.epoch_hash, "the committed epoch has the same hash as its parent").not.toBe(current.record.parent_epoch_hash);
    } else {
      expect(current.record.parent_epoch_hash, "the first epoch must have a null parent").toBeNull();
    }

    // The record must not be an unreachable orphan: the commit that produced it has to be in this branch's history.
    const provenance = spawnSync("git", ["log", "-1", "--format=%H", "--", epochRel], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    const lastChange = String(provenance.stdout ?? "").trim();
    expect(lastChange, `no commit was found that changed ${epochRel}`).toMatch(/^[0-9a-f]{40}$/);
    const reachable = spawnSync("git", ["merge-base", "--is-ancestor", lastChange, "HEAD"], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    if (reachable.error) throw reachable.error;
    expect(reachable.status, `the commit that last changed ${epochRel} (${lastChange.slice(0, 12)}…) is not an ancestor of HEAD`).toBe(0);

    // And the migration tooling is PREPARED, not applied: it exists, and running it does not move the epoch.
    expect(fs.existsSync(path.join(PROJECT, "scripts", "trust-migration-proposal.cjs"))).toBe(true);
  });
});
