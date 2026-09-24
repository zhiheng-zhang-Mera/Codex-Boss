import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Stage D — the S2 exit audit, and the two confusions it exists to prevent.
 *
 * WHY THIS FILE IS MOSTLY ABOUT PARSING
 *
 *   The audit recomputes the S2 exit claim from what the hosted `architecture` job PUBLISHES. The job prints two
 *   summarising lines:
 *
 *     ARCHITECTURE_SHADOW_VERDICT=PASS FINDINGS=1677 DIGEST=<sha256> EPOCH=33 NOT_YET_ENFORCED=5
 *     ARCHITECTURE_S2_ENFORCE_VERDICT=PASS FINDINGS=1677 VIOLATIONS=0 ENGINE_ERRORS=0
 *
 *   Those lines are the whole contract between the gate and a reader, so the parser is where the two failures a
 *   window audit is most likely to commit would live:
 *
 *     1  ABSENT read as ZERO.        A key that was not printed must be `null`, never `0`. `ENGINE_ERRORS=0` is
 *                                    the strongest possible result; an unreadable line is the weakest. A parser
 *                                    that collapses them reports a run whose evidence never arrived as a run with
 *                                    no engine errors -- which would inflate the S2 count with the exact runs that
 *                                    should exclude it.
 *     2  ONE DIGEST read as MANY.    "Same findings hash throughout" is the S2 claim. If the summariser took the
 *                                    first digest, or ignored a variation, the claim would hold by construction.
 *
 *   The real log shape is pinned here verbatim, including the detail that cost a measurement to find: the
 *   workflow prefixes each line with `job<TAB>step<TAB>` and the TIMESTAMP SHARES A FIELD WITH THE CONTENT, so a
 *   parser that assumes four tab-separated fields reads every line as empty.
 */

const PROJECT = process.cwd();
const SCRIPT = "scripts/s2-exit-audit.cjs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const audit = require(path.join(PROJECT, SCRIPT)) as {
  parsePublishedLine: (text: string) => Record<string, string | number | null>;
  publishedLines: (log: string) => { shadow: string | null; enforce: string | null };
  classifyRun: (run: Record<string, unknown>) => { valid: boolean; reason: string | null };
  summarize: (runs: Array<Record<string, unknown>>) => {
    considered: number;
    valid: number;
    excluded: number;
    consecutiveValidFromNewest: number;
    distinctDigests: string[];
    distinctEpochs: Array<string | number | null>;
    sameDigestThroughout: boolean;
    retries: unknown[];
    flakes: unknown[];
    firstValid: unknown;
    lastValid: unknown;
  };
  partitionByStatus: (runs: Array<{ databaseId: number; headSha: string; status: string }>) => {
    pending: Array<{ databaseId: number }>;
    completed: Array<{ databaseId: number }>;
  };
};

/** The exact text the hosted job printed on run 36068773868 (main @ 5740b7c). */
const SHADOW_LINE = "ARCHITECTURE_SHADOW_VERDICT=PASS FINDINGS=1677 DIGEST=db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba EPOCH=33 NOT_YET_ENFORCED=5";
const ENFORCE_LINE = "ARCHITECTURE_S2_ENFORCE_VERDICT=PASS FINDINGS=1677 VIOLATIONS=0 ENGINE_ERRORS=0";
const DIGEST = "db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba";

function validRun(digest = DIGEST, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    architectureJob: { databaseId: 1, conclusion: "success" },
    parityStep: { number: 14, conclusion: "success" },
    shadowLine: SHADOW_LINE,
    enforceLine: ENFORCE_LINE,
    published: { ...audit.parsePublishedLine(`${SHADOW_LINE} ${ENFORCE_LINE}`), digest },
    ...extra,
  };
}

describe("Stage D — the audit reads the hosted job's own published lines", () => {
  it("parses both lines exactly as the job printed them", () => {
    const parsed = audit.parsePublishedLine(`${SHADOW_LINE} ${ENFORCE_LINE}`);
    expect(parsed.shadowVerdict).toBe("PASS");
    expect(parsed.findings).toBe(1677);
    expect(parsed.digest).toBe(DIGEST);
    expect(parsed.epoch).toBe(33);
    expect(parsed.notYetEnforced).toBe(5);
    expect(parsed.enforceVerdict).toBe("PASS");
    expect(parsed.violations).toBe(0);
    expect(parsed.engineErrors).toBe(0);
  });

  it("reports an ABSENT key as null and never as zero", () => {
    // The distinction the whole audit rests on: `ENGINE_ERRORS=0` is the strongest result and a missing line is
    // the weakest, and a parser that maps both to 0 would let a run whose evidence never arrived count as clean.
    const parsed = audit.parsePublishedLine("ARCHITECTURE_SHADOW_VERDICT=PASS FINDINGS=1");
    expect(parsed.engineErrors, "an absent engine-error count was reported as a number").toBeNull();
    expect(parsed.violations, "an absent violation count was reported as a number").toBeNull();
    expect(parsed.digest, "an absent digest was reported as something").toBeNull();
    expect(parsed.enforceVerdict).toBeNull();
    expect(parsed.engineErrors).not.toBe(0);
  });

  it("strips the `job<TAB>step<TAB>` prefix and the ANSI codes, with the timestamp sharing the content field", () => {
    // The shape that matters: three tab-separated fields, not four. A parser assuming a separate timestamp field
    // reads every real line as empty, and then excludes every run for "the evidence line was not published".
    const log = [
      "architecture\tArchitecture shadow evidence is present and complete\t2026-09-24T22:41:32.4126289Z \u001b[36;1m" + SHADOW_LINE + "\u001b[0m",
      "architecture\tHosted enforce and parity evidence is present and complete\t2026-09-24T22:41:35.3560660Z " + ENFORCE_LINE,
    ].join("\n");
    const lines = audit.publishedLines(log);
    expect(lines.shadow).toBe(SHADOW_LINE);
    expect(lines.enforce).toBe(ENFORCE_LINE);
  });

  it("does not mistake the echoed command for the printed result", () => {
    // ci.yml ECHOES the Write-Host source before executing it, and the echoed line contains the same variable
    // names. Only the executed line starts with the literal key, so the anchor has to be the key itself.
    const log = "architecture\tstep\t2026-01-01T00:00:00Z ^[[36;1mWrite-Host \"ARCHITECTURE_SHADOW_VERDICT=$($meta.shadow_verdict) FINDINGS=$($meta.findings_count) DIGEST=$($meta.findings_semantic_hash)\"^[[0m\n"
      + "architecture\tstep\t2026-01-01T00:00:01Z " + SHADOW_LINE;
    const lines = audit.publishedLines(log);
    expect(lines.shadow).toBe(SHADOW_LINE);
    expect(audit.parsePublishedLine(lines.shadow ?? "").digest).toBe(DIGEST);
  });
});

describe("Stage D — a run is valid only when the whole gate agrees, and every refusal names the machinery", () => {
  it("accepts a run whose architecture job, parity step and both published lines agree", () => {
    expect(audit.classifyRun(validRun())).toEqual({ valid: true, reason: null });
  });

  const refusals: Array<[string, Record<string, unknown>, RegExp]> = [
    ["no architecture job", { architectureJob: null }, /no `architecture` job/],
    ["a skipped job", { ...validRun(), architectureJob: { conclusion: "skipped" } }, /was skipped/],
    ["a failed job", { ...validRun(), architectureJob: { conclusion: "failure" } }, /concluded failure/],
    ["no parity step", { ...validRun(), parityStep: null }, /no step named/],
    ["a failed parity step", { ...validRun(), parityStep: { conclusion: "failure" } }, /parity step concluded failure/],
    ["no shadow line", { ...validRun(), shadowLine: null }, /shadow evidence line was not published/],
    ["no enforce line", { ...validRun(), enforceLine: null }, /enforce evidence line was not published/],
    ["a non-PASS shadow verdict", { ...validRun(), published: { ...audit.parsePublishedLine(`${SHADOW_LINE} ${ENFORCE_LINE}`), shadowVerdict: "POLICY_VIOLATION" } }, /shadow verdict was POLICY_VIOLATION/],
    ["a non-PASS enforce verdict", { ...validRun(), published: { ...audit.parsePublishedLine(`${SHADOW_LINE} ${ENFORCE_LINE}`), enforceVerdict: "POLICY_VIOLATION" } }, /enforce verdict was POLICY_VIOLATION/],
    ["a policy violation", { ...validRun(), published: { ...audit.parsePublishedLine(`${SHADOW_LINE} ${ENFORCE_LINE}`), violations: 1 } }, /1 policy violation/],
    ["an engine error", { ...validRun(), published: { ...audit.parsePublishedLine(`${SHADOW_LINE} ${ENFORCE_LINE}`), engineErrors: 2 } }, /2 engine error/],
    ["a line with no digest", { ...validRun(), published: { ...audit.parsePublishedLine(`${SHADOW_LINE} ${ENFORCE_LINE}`), digest: null } }, /no findings count or digest/],
    ["a line with no findings count", { ...validRun(), published: { ...audit.parsePublishedLine(`${SHADOW_LINE} ${ENFORCE_LINE}`), findings: null } }, /no findings count or digest/],
  ];

  for (const [name, run, expected] of refusals) {
    it(`refuses ${name}`, () => {
      const verdict = audit.classifyRun(run);
      expect(verdict.valid, `${name} was counted as a valid run`).toBe(false);
      expect(verdict.reason, `${name} was refused without naming why`).toMatch(expected);
    });
  }
});

describe("Stage D — the window is a claim about a sequence, and the summariser is what could fake it", () => {
  const run = (databaseId: number, digest: string, valid = true, extra: Record<string, unknown> = {}) => ({
    ...validRun(digest),
    databaseId,
    headSha: `sha-${databaseId}`,
    conclusion: "success",
    attempt: 1,
    valid,
    reason: valid ? null : "excluded by the fixture",
    published: { ...audit.parsePublishedLine(`${SHADOW_LINE} ${ENFORCE_LINE}`), digest },
    ...extra,
  });

  it("counts the streak from the NEWEST run and stops at the first exclusion", () => {
    // Newest first, as the audit considers them. Two valid, then an exclusion, then more valid: the streak is 2,
    // not 4. A summariser that counted all valid runs would answer a different question than "consecutive".
    const summary = audit.summarize([run(5, DIGEST), run(4, DIGEST), run(3, DIGEST, false), run(2, DIGEST), run(1, DIGEST)]);
    expect(summary.consecutiveValidFromNewest).toBe(2);
    expect(summary.valid).toBe(4);
    expect(summary.excluded).toBe(1);
    expect(summary.considered).toBe(5);
  });

  it("reports digest VARIATION rather than taking the first one", () => {
    // "Same findings hash throughout" is the S2 claim. If the summariser reported only the first digest, the
    // claim would hold by construction -- which is the failure this case exists to make impossible.
    const summary = audit.summarize([run(3, DIGEST), run(2, "a".repeat(64)), run(1, DIGEST)]);
    expect(summary.distinctDigests.length, "two different finding digests were reported as one").toBe(2);
    expect(summary.sameDigestThroughout).toBe(false);
  });

  it("reports a single digest as constant, and distinguishes an empty window from a constant one", () => {
    const constant = audit.summarize([run(2, DIGEST), run(1, DIGEST)]);
    expect(constant.distinctDigests).toEqual([DIGEST]);
    expect(constant.sameDigestThroughout).toBe(true);
    const empty = audit.summarize([]);
    expect(empty.considered).toBe(0);
    // An empty window is not a constant one: `distinctDigests.length === 1` is what the audit asserts on, so an
    // empty window must fail it rather than vacuously pass.
    expect(empty.distinctDigests.length).toBe(0);
    expect(empty.consecutiveValidFromNewest).toBe(0);
  });

  it("counts retries and flakes separately, so a re-run is visible rather than silently merged", () => {
    const summary = audit.summarize([
      run(2, DIGEST),
      run(1, DIGEST, false, { attempt: 2, conclusion: "success" }),
      run(0, DIGEST, false, { attempt: 2, conclusion: "failure" }),
    ]);
    expect(summary.retries.length).toBe(2);
    expect(summary.flakes.length, "a run that failed then went green on re-run is the definition of a flake").toBe(1);
  });

  it("scans a background of valid runs without losing the digest set", () => {
    // The real window is dozens of runs. This is the arithmetic the audit actually performs, on a window the size
    // of the one the workbook asks about.
    const runs = Array.from({ length: 30 }, (_, index) => run(30 - index, DIGEST));
    const summary = audit.summarize(runs);
    expect(summary.consecutiveValidFromNewest).toBe(30);
    expect(summary.sameDigestThroughout).toBe(true);
    expect(summary.distinctDigests).toEqual([DIGEST]);
  });

  it("judges an UNFINISHED run neither way, instead of counting it as an exclusion", () => {
    // The failure this prevents, measured on the real history: the newest push run was still in progress, and
    // counting it as an exclusion made `consecutiveValidFromNewest` report 0 while 32 completed runs behind it
    // were all valid -- understating the window because a run had not finished. A pending run belongs to neither
    // the numerator nor the denominator.
    const runs = [
      { databaseId: 3, headSha: "s3", status: "in_progress" },
      { databaseId: 2, headSha: "s2", status: "completed" },
      { databaseId: 1, headSha: "s1", status: "completed" },
    ];
    const { pending, completed } = audit.partitionByStatus(runs);
    expect(pending.map((entry: { databaseId: number }) => entry.databaseId)).toEqual([3]);
    expect(completed.map((entry: { databaseId: number }) => entry.databaseId)).toEqual([2, 1]);
    // And the window computed over the COMPLETED runs is the full streak, not zero.
    const summary = audit.summarize([run(2, DIGEST), run(1, DIGEST)]);
    expect(summary.consecutiveValidFromNewest).toBe(2);
  });
});

describe("Stage D — the audit is a plain Node program and reaches no executor", () => {
  it("is loadable by a plain Node process and exports the pure surface", () => {
    const probe = spawnSync(process.execPath, ["-e", `const m=require(${JSON.stringify(path.join(PROJECT, SCRIPT))}); if(!m.parsePublishedLine||!m.publishedLines||!m.classifyRun||!m.summarize||!m.partitionByStatus) process.exit(1);`], { encoding: "utf8", timeout: 60000 });
    expect(probe.status, `the audit could not be loaded by plain node: ${probe.stderr}`).toBe(0);
  });

  it("dispatches, cancels, deletes and writes nothing: it is a read-only audit", () => {
    // The only `gh` verbs it may use are reads. A window audit that could dispatch a run would be able to change
    // the history it is certifying.
    const source = require("node:fs").readFileSync(path.join(PROJECT, SCRIPT), "utf8") as string;
    const ghCalls = [...source.matchAll(/gh(?:Json)?\(\s*\[([^\]]*)\]/g)].map((match) => match[1]);
    expect(ghCalls.length, "the audit makes no gh call at all").toBeGreaterThan(0);
    for (const call of ghCalls) {
      expect(call, `a non-read gh verb appears in the audit: ${call}`).not.toMatch(/"(rerun|delete|cancel|dispatch|merge|close|edit|create)"/);
    }
    for (const forbidden of ["writeFileSync", "appendFileSync", "rmSync", "unlinkSync"]) {
      expect(source.includes(forbidden), `the read-only audit calls ${forbidden}`).toBe(false);
    }
  });
});
