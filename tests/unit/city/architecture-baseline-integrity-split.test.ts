import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 1B baseline gate — INTEGRITY is not TREE IDENTITY.
 *
 * THE DEFECT THESE TESTS PIN
 *   `architecture:enforce:baseline -- --check` asked one question and used the answer for two purposes. In check
 *   mode it re-derived a baseline FROM THE CANDIDATE TREE and required the result to equal the frozen file
 *   byte-for-byte, so "is the frozen baseline valid?" was answered as "does the candidate tree still equal it?".
 *   The hosted `architecture` job runs that step BEFORE shadow and enforce and none of those steps carries an
 *   `if:` guard, so any pull request that legitimately changed the architecture — a new declared edge, or the S2
 *   negative control's undeclared one — failed at the baseline step and shadow/enforce never ran. A gate that can
 *   only certify a tree that has not changed the architecture is not an enforcement gate.
 *
 * THE SPLIT
 *   artifact_integrity              is the FROZEN FILE consistent with the hash it records?   GATES
 *   series_authorized               does an Owner-authorised entry name that hash?             GATES
 *   candidate_tree_matches_frozen   how far has the TREE moved from the frozen baseline?       REPORTED
 *
 *   The third is the input to prospective enforcement (`architecture-enforcement.cjs`), which classifies each edge
 *   as grandfathered / declared / undeclared and exits non-zero on a violation. That classification is already
 *   proven by `architecture-s2-hosted-enforce.test.ts` and is deliberately NOT duplicated here.
 *
 * Tamper detection is preserved, not weakened: the artifact-level hash is the same value the Owner-authorised
 * series names, so an in-place edit is caught by integrity AND by the series.
 */

const PROJECT = process.cwd();
const BASELINE = path.join(PROJECT, "config", "architecture-enforcement-baseline.json");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const baselineModule = require(path.join(PROJECT, "scripts", "architecture-enforcement-baseline.cjs")) as {
  BASELINE_PATH: string;
  buildBaseline: (input: Record<string, unknown>) => { baselineHash: string };
  verifyBaselineArtifactIntegrity: (p?: string) => {
    valid: boolean;
    recorded_baseline_hash: string | null;
    recomputed_baseline_hash: string;
    problems: string[];
  };
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const observatory = require(path.join(PROJECT, "scripts", "architecture-observatory.cjs")) as {
  canonicalJson: (value: unknown) => string;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const series = require(path.join(PROJECT, "scripts", "architecture-baseline-series.cjs")) as {
  loadSeries: (file?: string) => { path: string; value: unknown; problems: string[] };
  validateSeries: (value: unknown) => string[];
  acceptedEntries: (value: unknown) => unknown[];
  authorizeTriple: (value: unknown, triple: unknown) => { authorized: boolean; entry: unknown; problems: string[] };
  tripleOf: (baseline: unknown) => unknown;
};

const sha256 = (text: string): string => crypto.createHash("sha256").update(text).digest("hex");

/** A temp directory holding copies, so no test ever writes the tracked baseline. */
function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "baseline-integrity-"));
}

/** Re-hash a baseline object the way the generator does, so a deliberately-changed copy stays SELF-CONSISTENT. */
function selfConsistent(baseline: Record<string, unknown>): Record<string, unknown> {
  const { baseline_hash: _drop, ...content } = baseline;
  return { ...content, baseline_hash: sha256(observatory.canonicalJson(content)) };
}

const realBaselineText = (): string => fs.readFileSync(BASELINE, "utf8");
const realBaseline = (): Record<string, unknown> => JSON.parse(realBaselineText()) as Record<string, unknown>;

describe("baseline gate integrity split — integrity is independent of tree identity", () => {
  it("1. AN UNTOUCHED TREE: the frozen baseline is valid, and the tree reproduces it", () => {
    const integrity = baselineModule.verifyBaselineArtifactIntegrity(BASELINE);
    expect(integrity.problems, `the shipped baseline failed its own integrity check: ${integrity.problems.join("; ")}`).toEqual([]);
    expect(integrity.valid, "the shipped accepted baseline is not self-consistent").toBe(true);
    expect(integrity.recorded_baseline_hash).toBe(integrity.recomputed_baseline_hash);

    // And the CLI agrees, reporting the three questions separately rather than as one boolean.
    const run = spawnSync(process.execPath, ["scripts/architecture-enforcement-baseline.cjs", "--check"], { cwd: PROJECT, encoding: "utf8", timeout: 600000 });
    expect(run.status, `--check failed on the untouched tree: ${run.stderr}`).toBe(0);
    const summary = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(summary.artifact_integrity).toBe(true);
    expect(summary.series_authorized).toBe(true);
    expect(summary.candidate_tree_matches_frozen).toBe(true);
    // The reported fields must still exist: removing them would hide the drift measurement instead of splitting it.
    expect(summary).toHaveProperty("identical");
    expect(summary).toHaveProperty("hash_matches");
  });

  it("2. A LEGITIMATE ARCHITECTURAL CHANGE is NOT a baseline failure (the defect this repair exists for)", () => {
    // A self-consistent baseline whose edge set differs from the tree stands in for any legitimate change: a new
    // declared edge, or a debt reduction. The OLD check called this a failure and blocked shadow/enforce; the
    // split must call it VALID and leave the decision to prospective enforcement.
    const dir = tempDir();
    const original = realBaseline();
    expect(Array.isArray(original.edges)).toBe(true);
    expect((original.edges as unknown[]).length).toBeGreaterThan(1);

    // Debt reduction: one fewer edge, still self-consistent (re-hashed), so the file is not tampered — just different.
    const reduced = selfConsistent({ ...original, edges: (original.edges as unknown[]).slice(1) });
    const reducedPath = path.join(dir, "reduced.json");
    fs.writeFileSync(reducedPath, `${JSON.stringify(reduced, null, 2)}\n`, "utf8");

    const integrity = baselineModule.verifyBaselineArtifactIntegrity(reducedPath);
    expect(integrity.problems, `a self-consistent but changed baseline was rejected: ${integrity.problems.join("; ")}`).toEqual([]);
    expect(integrity.valid, "a legitimate architectural change still reads as a baseline failure").toBe(true);
    // Its hash is genuinely different from the shipped one — i.e. this really is a different baseline, not a no-op.
    expect(integrity.recorded_baseline_hash).not.toBe(realBaseline().baseline_hash);

    // The opposite direction too: one MORE edge is equally valid as an artifact.
    const grown = selfConsistent({ ...original, edges: [...(original.edges as unknown[]), { from: "a.ts", specifier: "./b", to: "b.ts" }] });
    const grownPath = path.join(dir, "grown.json");
    fs.writeFileSync(grownPath, `${JSON.stringify(grown, null, 2)}\n`, "utf8");
    expect(baselineModule.verifyBaselineArtifactIntegrity(grownPath).valid, "an additional edge made the artifact invalid").toBe(true);
  });

  it("3. AN UNDECLARED NEW EDGE does not fail the BASELINE gate — enforcement is what blocks it", () => {
    // The property the hosted job depends on: the baseline step must pass a tree that changed, so that shadow and
    // enforce are reached at all. Integrity is about the FILE; the tree comparison is an input, not a verdict.
    const dir = tempDir();
    const original = realBaseline();
    const withExtraEdge = selfConsistent({ ...original, counts: { ...(original.counts as Record<string, unknown>), internal_edges: ((original.counts as Record<string, number>).internal_edges ?? 0) + 1 } });
    const p = path.join(dir, "with-extra.json");
    fs.writeFileSync(p, `${JSON.stringify(withExtraEdge, null, 2)}\n`, "utf8");

    const integrity = baselineModule.verifyBaselineArtifactIntegrity(p);
    expect(integrity.valid, "the baseline gate would still block before enforcement runs").toBe(true);
    expect(integrity.problems).toEqual([]);

    // The gate no longer decides this case; the engine does, and its classification is proven by the S2 suite.
    // Assert the split is real by checking the summary's own semantics text, so a future edit cannot silently
    // re-merge the two questions into one boolean.
    const run = spawnSync(process.execPath, ["scripts/architecture-enforcement-baseline.cjs", "--check"], { cwd: PROJECT, encoding: "utf8", timeout: 600000 });
    const summary = JSON.parse(run.stdout) as { semantics?: Record<string, string> };
    expect(summary.semantics?.artifact_integrity, "the integrity semantics are no longer stated").toMatch(/no tree was read/i);
    expect(summary.semantics?.candidate_tree_matches_frozen, "the drift semantics are no longer stated as non-gating").toMatch(/NOT a failure/i);
  });

  it("4. DECLARATION REPAIR: --check is READ-ONLY and never rewrites the frozen baseline", () => {
    // The counterfactual's precondition: adding a declaration must not depend on the baseline having been
    // regenerated. `--check` must therefore leave the tracked file byte-identical.
    const before = sha256(realBaselineText());
    const run = spawnSync(process.execPath, ["scripts/architecture-enforcement-baseline.cjs", "--check"], { cwd: PROJECT, encoding: "utf8", timeout: 600000 });
    expect(run.status).toBe(0);
    const after = sha256(realBaselineText());
    expect(after, "--check modified the tracked baseline, so the counterfactual would not be baseline-unchanged").toBe(before);
  });

  it("5. A TAMPERED BASELINE FAILS CLOSED — the check that replaces the tree comparison as tamper detector", () => {
    // This is the case that must not regress. The old gate detected tampering as a side effect of comparing the
    // tree; with the split, integrity IS the detector, so it has to catch every edit shape on its own.
    const dir = tempDir();
    const original = realBaseline();

    const cases: Array<{ label: string; text: string }> = [
      { label: "an edge removed without re-hashing", text: `${JSON.stringify({ ...original, edges: (original.edges as unknown[]).slice(1) }, null, 2)}\n` },
      { label: "an edge added without re-hashing", text: `${JSON.stringify({ ...original, edges: [...(original.edges as unknown[]), { from: "x.ts", specifier: "./y", to: "y.ts" }] }, null, 2)}\n` },
      { label: "a forged baseline_hash", text: `${JSON.stringify({ ...original, baseline_hash: "0".repeat(64) }, null, 2)}\n` },
      { label: "a tampered count", text: `${JSON.stringify({ ...original, counts: { ...(original.counts as Record<string, unknown>), internal_edges: 1 } }, null, 2)}\n` },
      { label: "a tampered ownership map", text: `${JSON.stringify({ ...original, ownership: { ...(original.ownership as Record<string, unknown>), tampered: true } }, null, 2)}\n` },
      { label: "malformed JSON", text: "{ not json" },
    ];

    for (const [index, { label, text }] of cases.entries()) {
      const p = path.join(dir, `tampered-${index}.json`);
      fs.writeFileSync(p, text, "utf8");
      const integrity = baselineModule.verifyBaselineArtifactIntegrity(p);
      expect(integrity.valid, `the integrity check accepted ${label}`).toBe(false);
      expect(integrity.problems.length, `${label} was refused without a reason`).toBeGreaterThan(0);
    }

    // And the untouched control still passes, so the detector is not simply always-false.
    const good = path.join(dir, "good.json");
    fs.writeFileSync(good, realBaselineText(), "utf8");
    expect(baselineModule.verifyBaselineArtifactIntegrity(good).valid, "the detector rejects an untouched copy").toBe(true);
  });

  it("6. AN UNAUTHORISED SERIES FAILS CLOSED", () => {
    const dir = tempDir();
    const original = realBaseline();
    // loadSeries returns a { path, value, problems } WRAPPER; the authorisation helpers take `.value`.
    const loadedReal = series.loadSeries() as { value: unknown; problems: string[] };
    expect(loadedReal.problems, `the shipped series did not load: ${loadedReal.problems.join("; ")}`).toEqual([]);
    const realSeries = loadedReal.value;

    // The shipped series authorises this baseline; that is the positive control.
    const realTriple = series.tripleOf(original);
    const authorized = series.authorizeTriple(realSeries, realTriple);
    expect(authorized.authorized, `the shipped baseline is not authorised by the shipped series: ${JSON.stringify(authorized.problems ?? [])}`).toBe(true);

    // A triple the series does not name must be refused, with its own code.
    const unknownTriple = { baseline_version: 99, parent_baseline_hash: null, baseline_hash: "a".repeat(64) };
    const refused = series.authorizeTriple(realSeries, unknownTriple);
    expect(refused.authorized, "an unauthorised triple was accepted").toBe(false);
    // `problems` are structured records, not strings, so stringify rather than join.
    expect(JSON.stringify(refused.problems), "the refusal did not name a series code").toMatch(/BASELINE_SERIES|UNAUTHORISED/i);

    // A MISSING series must not read as "nothing is authorised, carry on".
    const absent = path.join(dir, "no-such-series.json");
    const loadedAbsent = series.loadSeries(absent);
    expect(loadedAbsent.problems.length, "a missing series produced no problem").toBeGreaterThan(0);
    expect(JSON.stringify(loadedAbsent.problems)).toMatch(/BASELINE_SERIES_MISSING|MISSING/i);

    // A MALFORMED series fails closed rather than being treated as empty.
    const malformedPath = path.join(dir, "malformed-series.json");
    fs.writeFileSync(malformedPath, "{ not json", "utf8");
    const loadedMalformed = series.loadSeries(malformedPath);
    expect(loadedMalformed.problems.length, "a malformed series produced no problem").toBeGreaterThan(0);
    expect(JSON.stringify(loadedMalformed.problems)).toMatch(/BASELINE_SERIES_MALFORMED|MALFORMED/i);
  });
});
