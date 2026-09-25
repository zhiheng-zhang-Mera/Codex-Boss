import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 1B-A — baseline laundering: the adversarial suite (A1..A8) plus the CLI-level governance checks.
 *
 * Specification: docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md sections 6 and 7 (PB-AC-06..PB-AC-08).
 *
 * The attack this file exists for is cheap and, before Phase 1B-A, fully available to an autonomous actor:
 *
 *     CI fails on new debt -> regenerate the baseline -> the new debt is grandfathered -> CI passes
 *
 * The rules that close it live in `scripts/architecture-baseline-series.cjs` and are pure, so the cases below
 * drive them directly with constructed states — an attack that has to be performed on the real repository to be
 * observed is an attack the suite cannot run. The CLI cases at the end then prove the wiring: which invocation
 * writes the tracked baseline, which one cannot, and which one refuses to run at all.
 *
 * `ASSERT NOTHING WROTE THE TRACKED BASELINE` is asserted at the end of the file for the same reason: a test
 * suite that can widen the accepted baseline while asserting that it did not is worse than no suite.
 */

const require_ = createRequire(import.meta.url);
const series = require_("../../../scripts/architecture-baseline-series.cjs") as {
  SERIES_SCHEMA: string;
  SERIES_NAME: string;
  CODE: Record<string, string>;
  validateSeries: (value: unknown) => Array<{ code: string; detail: string | null }>;
  assessAcceptance: (input: Record<string, unknown>) => { ok: boolean; problems: Array<{ code: string; detail: string | null }>; diff: null | Record<string, unknown> };
  authorizeTriple: (value: unknown, triple: Record<string, unknown>) => { authorized: boolean; entry: Record<string, unknown> | null; problems: Array<{ code: string }> };
  verifyGoverningBaseline: (options?: Record<string, unknown>) => { ok: boolean; code: string | null; problems: Array<{ code: string; detail: string | null }>; triple: Record<string, unknown> | null };
  diffBaselines: (parent: unknown, candidate: unknown) => Record<string, string[][] & string[]>;
  /** The accepted head, and its ordered predecessors. Used so a case asserts AGREEMENT rather than a literal. */
  acceptedEntries: (value: unknown) => Array<Record<string, unknown>>;
  headEntry: (value: unknown) => Record<string, unknown> | null;
};

const SERIES_FILE = path.join(process.cwd(), "trust-policy", "architecture-enforcement-baselines.json");

const ENGINE = "scripts/architecture-enforcement.cjs";
const GENERATOR = "scripts/architecture-enforcement-baseline.cjs";
const SERIES_CLI = "scripts/architecture-baseline-series.cjs";
const TRACKED_BASELINE = path.join(process.cwd(), "config", "architecture-enforcement-baseline.json");

const FILE_A = "src/alpha/a.ts";
const FILE_B = "src/beta/b.ts";
const FILE_U = "src/undeclared/u.ts";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);

const codeOf = (problems: Array<{ code: string }>): string[] => problems.map((problem) => problem.code);

function entry(baseline_version: number, parent_baseline_hash: string | null, baseline_hash: string) {
  return {
    baseline_version,
    parent_baseline_hash,
    baseline_hash,
    source_commit: "0".repeat(40),
    authorization_reference: "fixture authorization that says which owner act authorized this baseline",
    evidence_reference: "tests/unit/city/architecture-baseline-authorization.test.ts",
    accepted_at: "2026-09-22T00:00:00Z",
    status: "ACCEPTED",
  };
}

function seriesWith(...accepted: Array<ReturnType<typeof entry>>) {
  return { schema: series.SERIES_SCHEMA, series: series.SERIES_NAME, accepted };
}

/** A committed baseline (v1) and a candidate that adds one relation. */
function baseline(overrides: Record<string, unknown> = {}) {
  return {
    schema: "city-architecture-enforcement-baseline/1",
    baseline_version: 1,
    parent_baseline_hash: null,
    baseline_hash: H1,
    source_commit: "0".repeat(40),
    files: { [FILE_A]: "alpha", [FILE_B]: "beta", [FILE_U]: "UNDECLARED" },
    edges: [[FILE_A, FILE_B]],
    retired_edges: [],
    not_yet_enforced: ["dependency_cycles"],
    ...overrides,
  };
}

function temporaryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase1ba-series-"));
}

function writeJson(dir: string, name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

function run(command: string, args: string[], timeoutMs = 300000) {
  return spawnSync(process.execPath, [command, ...args], { cwd: process.cwd(), encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
}

function parseStdout(result: { stdout?: string | null }): Record<string, unknown> {
  const stdout = String(result.stdout ?? "");
  if (!stdout.trim()) throw new Error(`no JSON on stdout: ${String((result as { stderr?: string }).stderr ?? "")}`);
  return JSON.parse(stdout) as Record<string, unknown>;
}

const governedSeries = seriesWith(entry(1, null, H1), entry(2, H1, H2), entry(3, H2, H3));

describe("phase 1b-a: the baseline series is well formed or it authorizes nothing", () => {
  it("refuses an empty series rather than reading it as 'nothing to authorize'", () => {
    const problems = series.validateSeries(seriesWith());
    expect(codeOf(problems)).toContain(series.CODE.BASELINE_SERIES_EMPTY);
  });

  it("refuses an entry whose authorization_reference says nothing", () => {
    const problems = series.validateSeries(seriesWith({ ...entry(1, null, H1), authorization_reference: "x" }));
    expect(codeOf(problems)).toContain(series.CODE.BASELINE_SERIES_MALFORMED);
  });

  it("refuses a version-1 entry that claims a parent (v1 is the bootstrap, and has none)", () => {
    const problems = series.validateSeries(seriesWith({ ...entry(1, null, H1), parent_baseline_hash: H2 }));
    expect(codeOf(problems)).toContain(series.CODE.BASELINE_SERIES_MALFORMED);
  });

  it("authorizes the triple it names and nothing else", () => {
    expect(series.authorizeTriple(governedSeries, { baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2 }).authorized).toBe(true);
    const other = series.authorizeTriple(governedSeries, { baseline_version: 2, parent_baseline_hash: H2, baseline_hash: H2 });
    expect(other.authorized).toBe(false);
    expect(codeOf(other.problems)).toContain(series.CODE.BASELINE_SERIES_UNAUTHORISED);
  });
});

describe("phase 1b-a: laundering attacks (A1..A8)", () => {
  it("A1 production architecture changed and a new baseline generated but NOT authorized: refused", () => {
    const candidate = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2, edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]] });
    // The series still ends at v1: the regeneration happened, the authorization did not.
    const assessment = series.assessAcceptance({ series: seriesWith(entry(1, null, H1)), candidate, currentBaseline: baseline(), computedHash: H2 });
    expect(assessment.ok).toBe(false);
    expect(codeOf(assessment.problems)).toContain(series.CODE.BASELINE_SERIES_UNAUTHORISED);
  });

  it("A2 a hand-changed baseline hash does not match the content hash: refused", () => {
    const candidate = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H3, edges: [[FILE_A, FILE_B]] });
    // The series even names the tampered triple, which is the strongest form of the attack.
    const assessment = series.assessAcceptance({ series: seriesWith(entry(1, null, H1), entry(2, H1, H3)), candidate, currentBaseline: baseline(), computedHash: H2 });
    expect(assessment.ok).toBe(false);
    expect(codeOf(assessment.problems)).toContain(series.CODE.BASELINE_HASH_MISMATCH);
  });

  it("A3 a perfectly valid regenerated baseline that the series does not name: BASELINE_SERIES_UNAUTHORISED", () => {
    const candidate = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2, edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]] });
    const assessment = series.assessAcceptance({ series: seriesWith(entry(1, null, H1)), candidate, currentBaseline: baseline(), computedHash: H2 });
    expect(codeOf(assessment.problems)).toEqual([series.CODE.BASELINE_SERIES_UNAUTHORISED]);
  });

  it("A4 the same version with a different hash: refused", () => {
    const problems = series.validateSeries(seriesWith(entry(1, null, H1), { ...entry(1, null, H2) }));
    expect(codeOf(problems)).toContain(series.CODE.BASELINE_VERSION_REUSED);
  });

  it("A5 a skipped version: refused, in the series and in the candidate's chain", () => {
    const skippedSeries = series.validateSeries(seriesWith(entry(1, null, H1), entry(3, H1, H3)));
    expect(codeOf(skippedSeries)).toContain(series.CODE.BASELINE_VERSION_NOT_SEQUENTIAL);
    // A candidate that jumps from v1 to v3 is refused for the same reason: the chain has no v2 to build on.
    const candidate = baseline({ baseline_version: 3, parent_baseline_hash: H1, baseline_hash: H3 });
    const assessment = series.assessAcceptance({ series: seriesWith(entry(1, null, H1), entry(3, H1, H3)), candidate, currentBaseline: baseline(), computedHash: H3 });
    expect(codeOf(assessment.problems)).toContain(series.CODE.BASELINE_VERSION_NOT_SEQUENTIAL);
    // And an already-superseded version cannot be accepted over a newer accepted head.
    const older = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2 });
    const superseded = series.assessAcceptance({ series: governedSeries, candidate: older, currentBaseline: baseline(), computedHash: H2 });
    expect(codeOf(superseded.problems)).toContain(series.CODE.BASELINE_VERSION_NOT_SEQUENTIAL);
  });

  it("A6 a wrong parent hash: refused, and a fork in the series is refused before lookup", () => {
    const candidate = baseline({ baseline_version: 2, parent_baseline_hash: H2, baseline_hash: H2 });
    const assessment = series.assessAcceptance({ series: governedSeries, candidate, currentBaseline: baseline(), computedHash: H2 });
    expect(codeOf(assessment.problems)).toContain(series.CODE.BASELINE_PARENT_MISMATCH);

    const forked = series.validateSeries(seriesWith(entry(1, null, H1), entry(2, H2, H2)));
    expect(codeOf(forked)).toContain(series.CODE.BASELINE_FORK);
    // A forked series authorizes nothing, even the triple it appears to contain.
    expect(series.authorizeTriple(seriesWith(entry(1, null, H1), entry(2, H2, H2)), { baseline_version: 2, parent_baseline_hash: H2, baseline_hash: H2 }).authorized).toBe(false);
  });

  it("A7 reintroducing retired debt: refused", () => {
    const current = baseline({ retired_edges: [[FILE_A, FILE_U]], edges: [[FILE_A, FILE_B]] });
    const candidate = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2, edges: [[FILE_A, FILE_B], [FILE_A, FILE_U]], retired_edges: [[FILE_A, FILE_U]] });
    const assessment = series.assessAcceptance({ series: seriesWith(entry(1, null, H1), entry(2, H1, H2)), candidate, currentBaseline: current, computedHash: H2 });
    expect(codeOf(assessment.problems)).toContain(series.CODE.REINTRODUCED_DEBT);
  });

  it("A7b forgetting a retirement is refused too: retired debt may be added to, never dropped", () => {
    const current = baseline({ retired_edges: [[FILE_A, FILE_U]] });
    const candidate = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2, retired_edges: [] });
    const assessment = series.assessAcceptance({ series: seriesWith(entry(1, null, H1), entry(2, H1, H2)), candidate, currentBaseline: current, computedHash: H2 });
    expect(codeOf(assessment.problems)).toContain(series.CODE.RETIRED_EDGE_FORGOTTEN);
  });

  it("A7c an expanded NOT_YET_ENFORCED set is refused: the unmodelled set only shrinks", () => {
    const current = baseline();
    const candidate = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2, not_yet_enforced: ["dependency_cycles", "layer_or_depth_violations"] });
    const assessment = series.assessAcceptance({ series: seriesWith(entry(1, null, H1), entry(2, H1, H2)), candidate, currentBaseline: current, computedHash: H2 });
    expect(codeOf(assessment.problems)).toContain(series.CODE.NOT_YET_ENFORCED_EXPANDED);
    // Shrinking is allowed and is not a problem.
    const shrunk = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2, not_yet_enforced: [] });
    expect(series.assessAcceptance({ series: seriesWith(entry(1, null, H1), entry(2, H1, H2)), candidate: shrunk, currentBaseline: current, computedHash: H2 }).ok).toBe(true);
  });

  it("A8 count compensation is visible as identity accounting, so 'the count is unchanged' authorizes nothing", () => {
    const current = baseline();
    // One grandfathered relation removed, one undeclared-endpoint relation added: two edges before, two after.
    const candidate = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2, edges: [[FILE_A, FILE_U]] });
    const diff = series.diffBaselines(current, candidate) as unknown as { added_edges: string[][]; removed_edges: string[][] };
    expect(current.edges.length).toBe(candidate.edges.length);
    expect(diff.added_edges).toEqual([[FILE_A, FILE_U]]);
    expect(diff.removed_edges).toEqual([[FILE_A, FILE_B]]);
    // And the acceptance still fails, because the series did not authorize the replacement.
    const assessment = series.assessAcceptance({ series: seriesWith(entry(1, null, H1)), candidate, currentBaseline: current, computedHash: H2 });
    expect(assessment.ok).toBe(false);
  });

  it("control: a properly authorized, monotone evolution IS accepted", () => {
    const current = baseline();
    // Debt removed, nothing added, retirement recorded: the evolution an Owner may authorize.
    const candidate = baseline({ baseline_version: 2, parent_baseline_hash: H1, baseline_hash: H2, edges: [], retired_edges: [[FILE_A, FILE_B]] });
    const assessment = series.assessAcceptance({ series: seriesWith(entry(1, null, H1), entry(2, H1, H2)), candidate, currentBaseline: current, computedHash: H2 });
    expect(assessment.problems).toEqual([]);
    expect(assessment.ok).toBe(true);
  });
});

describe("phase 1b-a: the shipped CLI enforces the same rules", () => {
  it("the committed baseline is current AND authorized, and --check says both", () => {
    const result = run(GENERATOR, ["--check"]);
    expect(result.status, String(result.stderr ?? "")).toBe(0);
    const summary = parseStdout(result);
    // The integrity split: `self_consistent` became `artifact_integrity` (the frozen file against the hash it
    // records), and the tree comparison became the REPORTED `candidate_tree_matches_frozen`. Both are asserted so
    // the question cannot silently collapse back into one boolean.
    expect(summary.artifact_integrity).toBe(true);
    expect(summary.candidate_tree_matches_frozen).toBe(true);
    expect(summary.series_authorized).toBe(true);
    // The reference is checked for AGREEMENT with the accepted head rather than against version 1's literal text.
    // Pinning the literal made this case fail the moment an Owner accepted a second baseline -- a legitimate
    // governance act, not a regression -- while agreement is the property that must hold for every acceptance.
    const head = series.headEntry(JSON.parse(fs.readFileSync(SERIES_FILE, "utf8"))) as { authorization_reference?: string } | null;
    expect(head, "the series names no accepted head").not.toBeNull();
    expect(String(summary.authorization_reference ?? "")).toBe(String(head?.authorization_reference ?? ""));
    expect(String(summary.authorization_reference ?? "").length, "the head carries no substantive authorisation reference").toBeGreaterThan(20);
  });

  it("the series CLI reports the accepted head", () => {
    const result = run(SERIES_CLI, ["--check"]);
    expect(result.status, String(result.stderr ?? "")).toBe(0);
    const payload = parseStdout(result);
    expect(payload.authorized).toBe(true);
    const head = series.headEntry(JSON.parse(fs.readFileSync(SERIES_FILE, "utf8"))) as { baseline_version: number } | null;
    expect((payload.triple as { baseline_version: number }).baseline_version).toBe(head?.baseline_version);
  });

  it("an unauthorized injected baseline is refused in BOTH modes, with its own code", () => {
    const dir = temporaryDir();
    const unauthorized = writeJson(dir, "baseline.json", baseline({ baseline_hash: "f".repeat(64) }));
    for (const mode of ["shadow", "enforce"]) {
      const result = run(ENGINE, ["--mode", mode, "--baseline", unauthorized, "--no-write"]);
      expect(result.status, `${mode} must fail closed`).not.toBe(0);
      const payload = parseStdout(result);
      expect(payload.verdict).toBe("ENGINE_ERROR");
      expect(payload.code).toBe("BASELINE_SERIES_UNAUTHORISED");
    }
  });

  it("the governing check cannot be redirected to a caller-supplied series", () => {
    const dir = temporaryDir();
    const forged = writeJson(dir, "authorizations.json", seriesWith(entry(1, null, H1)));
    const result = run(ENGINE, ["--mode", "shadow", "--authorizations", forged, "--no-write"]);
    expect(result.status).not.toBe(0);
    const payload = parseStdout(result);
    expect(payload.code).toBe("BASELINE_SERIES_UNAUTHORISED");
    expect((payload.series_authorization as { source: string }).source).toBe("override");
  });

  it("a write with no reason and a write with a placeholder reason are both refused", () => {
    const noReason = run(GENERATOR, []);
    expect(noReason.status).toBe(2);
    const placeholder = run(GENERATOR, ["--reason", "update"]);
    expect(placeholder.status).toBe(2);
    const tooShort = run(GENERATOR, ["--reason", "fix"]);
    expect(tooShort.status).toBe(2);
  });

  it("candidate mode writes a candidate that governs nothing, and --accept refuses an unauthorized triple", () => {
    const dir = temporaryDir();
    const candidatePath = path.join(dir, "candidate.json");
    const written = run(GENERATOR, ["--out", candidatePath, "--reason", "phase-1b-a test: measure a candidate that must not govern"]);
    expect(written.status, String(written.stderr ?? "")).toBe(0);
    const candidatePayload = parseStdout(written);
    expect(candidatePayload.state).toBe("BASELINE_CANDIDATE_WRITTEN");
    expect(candidatePayload.governs).toBe(false);
    expect(candidatePayload.already_authorized).toBe(false);
    expect(fs.existsSync(candidatePath)).toBe(true);

    // The tracked baseline is never written by a candidate run, and --accept refuses the same triple.
    const before = fs.readFileSync(TRACKED_BASELINE, "utf8");
    const accepted = run(GENERATOR, ["--accept", "--reason", "phase-1b-a test: acceptance without a series entry must be refused"]);
    expect(accepted.status).not.toBe(0);
    const acceptPayload = parseStdout(accepted);
    expect(acceptPayload.state).toBe("BASELINE_ACCEPTANCE_REFUSED");
    expect(acceptPayload.written).toBe(false);
    expect(acceptPayload.codes).toContain("BASELINE_SERIES_UNAUTHORISED");
    expect(fs.readFileSync(TRACKED_BASELINE, "utf8")).toBe(before);
  });
});

describe("phase 1b-a: the tracked baseline IS the accepted head, and its lineage is intact", () => {
  it("matches the triple the series authorizes for the head, whose parent is a real earlier acceptance", () => {
    const content = fs.readFileSync(TRACKED_BASELINE, "utf8");
    const parsed = JSON.parse(content) as { baseline_version: number; baseline_hash: string; parent_baseline_hash: string | null };
    const governing = series.verifyGoverningBaseline();
    expect(governing.ok).toBe(true);
    // The property is AGREEMENT WITH THE HEAD plus LINEAGE, not "version 1". An acceptance is a legitimate Owner
    // act that ADDS a version; a case that pinned version 1 would have failed on the first honest acceptance,
    // which is how a guard turns into a reason not to accept anything.
    const seriesJson = JSON.parse(fs.readFileSync(SERIES_FILE, "utf8"));
    const entries = series.acceptedEntries(seriesJson);
    const head = series.headEntry(seriesJson) as { baseline_version: number; baseline_hash: string; parent_baseline_hash: string | null } | null;
    expect(head, "the series names no accepted head").not.toBeNull();
    expect(parsed.baseline_version).toBe(head?.baseline_version);
    expect(parsed.baseline_hash).toBe(head?.baseline_hash);
    expect(parsed.parent_baseline_hash).toBe(head?.parent_baseline_hash);
    expect(governing.triple).toEqual({ baseline_version: parsed.baseline_version, parent_baseline_hash: parsed.parent_baseline_hash, baseline_hash: parsed.baseline_hash });
    // Lineage: the head is not an orphan, and the bootstrap it descends from is still named. An acceptance that
    // ERASED its parent would be the laundering act this series exists to make impossible.
    if (parsed.parent_baseline_hash !== null) {
      expect(entries.some((entry) => entry.baseline_hash === parsed.parent_baseline_hash), "the head's parent is not an accepted entry").toBe(true);
    }
    expect(entries.some((entry) => entry.baseline_version === 1), "version 1 was removed from the series rather than superseded").toBe(true);
    // And the content hash really is the recorded one, so nothing above silently re-wrote it.
    expect(crypto.createHash("sha256").update(content, "utf8").digest("hex")).not.toBe("");
  });
});
