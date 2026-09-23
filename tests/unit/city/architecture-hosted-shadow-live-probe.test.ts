import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeLiveProbe, LIVE_PROBE_TIMEOUT_MS, probeLiveRuleset } from "./helpers/live-ruleset-probe";

/**
 * Phase 1B — the bounds on the live-ruleset probe (Mission-4D PR #19 content repair).
 *
 * THE DEFECT THIS FILE PINS
 *   `H7` used to spawn `gh api …` with `timeout: 120000` from inside a Vitest case whose own timeout is 60
 *   seconds. On the GitHub-hosted runner — where `gh` is unauthenticated — the child blocked and the CASE was
 *   killed: measured on PR #19, run `35851017393`, `Error: Test timed out in 60000ms.` A subprocess timeout larger
 *   than the enclosing test's timeout is not a timeout; it is a hang wearing a timeout as a disguise.
 *
 * WHAT IS ASSERTED, AND WHY EACH PART MATTERS
 *   1. the probe's bound is strictly below the enclosing unit-test budget, so the failure cannot recur silently;
 *   2. every unmeasurable outcome lands in `LIVE_NOT_MEASURED` with a named reason — a timeout, a missing binary,
 *      an unauthenticated `gh`, a non-zero exit, malformed JSON, or a response for the WRONG ruleset — rather
 *      than hanging or being reported as a measurement;
 *   3. a genuinely readable response lands in `LIVE_MEASURED` and yields the required contexts, so the
 *      classification is a real fork and not a branch that always takes the same side;
 *   4. the diagnostic line for the unmeasured state says `NOT_MEASURED` out loud, because a green test must never
 *      be readable as "the live platform was checked".
 *
 * NO NETWORK. Every case injects its own runner, so this file cannot become a network dependency in the ordinary
 * unit tier — which is the same reason the probe's classification had to be separable from the spawn in the first
 * place.
 */

const RULESET_ID = 22746755;

type RunnerResult = ReturnType<typeof spawnSync>;
type Runner = typeof spawnSync;

/** A spawn result shaped the way `spawnSync` shapes one. */
function result(overrides: Partial<{ status: number | null; stdout: string; stderr: string; error: Error; signal: string | null }>): RunnerResult {
  return {
    pid: 1,
    output: [null, overrides.stdout ?? "", overrides.stderr ?? ""],
    stdout: overrides.stdout ?? "",
    stderr: overrides.stderr ?? "",
    status: overrides.status ?? 0,
    signal: (overrides.signal ?? null) as RunnerResult["signal"],
    ...(overrides.error ? { error: overrides.error } : {}),
  } as unknown as RunnerResult;
}

function rulesetBody(id: number, contexts: string[]): string {
  return JSON.stringify({ id, rules: [{ type: "required_status_checks", parameters: { required_status_checks: contexts.map((context) => ({ context })) } }] });
}

const okRunner: Runner = (() => result({ status: 0, stdout: rulesetBody(RULESET_ID, ["quality", "unit", "acceptance", "package"]) })) as unknown as Runner;

describe("Phase 1B: the live-ruleset probe is bounded and cannot hang its enclosing test", () => {
  it("1 the probe bound is strictly below the enclosing unit-test budget", () => {
    // The enclosing budget is Vitest's default 60s for this tier. If the probe's bound ever rises to meet it, the
    // original defect is back: the child outlives the case and the failure reads as an opaque timeout.
    const UNIT_TEST_TIMEOUT_MS = 60_000;
    expect(LIVE_PROBE_TIMEOUT_MS).toBeLessThan(UNIT_TEST_TIMEOUT_MS);
    expect(LIVE_PROBE_TIMEOUT_MS, "the probe bound is far too close to the enclosing budget to be useful").toBeLessThanOrEqual(10_000);
    // ...and it is passed to the child, so the bound is enforced by the platform rather than only asserted here.
    let seen: number | undefined;
    const capturing = ((_cmd: string, _args: readonly string[], options?: { timeout?: number }) => {
      seen = options?.timeout;
      return result({ status: 0, stdout: rulesetBody(RULESET_ID, ["quality", "unit", "acceptance", "package"]) });
    }) as unknown as Runner;
    probeLiveRuleset({ runner: capturing });
    expect(seen, "the probe did not pass its bound to the child process").toBe(LIVE_PROBE_TIMEOUT_MS);
  });

  it("2 a timed-out probe is LIVE_NOT_MEASURED with a reason, not a hang and not a measurement", () => {
    const timingOut = ((_cmd: string, _args: readonly string[], options?: { timeout?: number }) =>
      result({ status: null, error: Object.assign(new Error(`spawnSync gh ETIMEDOUT`), { code: "ETIMEDOUT" }) })) as unknown as Runner;
    const probe = probeLiveRuleset({ runner: timingOut });
    expect(probe.state).toBe("LIVE_NOT_MEASURED");
    expect(String(probe.reason)).toMatch(/timed out|ETIMEDOUT/i);
    // An unmeasured probe must not present platform facts.
    expect(probe.required_contexts).toEqual([]);
    expect(probe.architecture_required).toBe(false);
    expect(probe.ruleset_id).toBeNull();
  });

  it("2b an unauthenticated, missing, killed, non-zero, malformed or wrong-ruleset probe is NOT_MEASURED", () => {
    const cases: Array<{ label: string; runner: Runner; expect: RegExp }> = [
      { label: "gh not authenticated", runner: (() => result({ status: 4, stderr: "gh: To get started with GitHub CLI, please run: gh auth login" })) as unknown as Runner, expect: /not authenticated|exited 4/i },
      { label: "gh missing", runner: (() => { throw Object.assign(new Error("spawnSync gh ENOENT"), { code: "ENOENT" }); }) as unknown as Runner, expect: /ENOENT|spawn failed/i },
      { label: "killed by signal", runner: (() => result({ status: null, signal: "SIGKILL" })) as unknown as Runner, expect: /killed by SIGKILL/i },
      { label: "non-zero exit", runner: (() => result({ status: 1, stderr: "HTTP 404: Not Found" })) as unknown as Runner, expect: /exited 1/i },
      { label: "malformed JSON", runner: (() => result({ status: 0, stdout: "<html>proxy</html>" })) as unknown as Runner, expect: /unparseable/i },
      { label: "wrong ruleset id", runner: (() => result({ status: 0, stdout: rulesetBody(999999, ["quality"]) })) as unknown as Runner, expect: /not 22746755/ },
    ];
    for (const testCase of cases) {
      const probe = probeLiveRuleset({ runner: testCase.runner });
      expect(probe.state, testCase.label).toBe("LIVE_NOT_MEASURED");
      expect(String(probe.reason), testCase.label).toMatch(testCase.expect);
      // The key property: none of these may be reported as a pass with platform facts.
      expect(probe.required_contexts, testCase.label).toEqual([]);
      expect(probe.architecture_required, testCase.label).toBe(false);
    }
    // A response for a DIFFERENT ruleset is refused, and the id it actually returned is preserved as diagnostic
    // evidence rather than discarded -- "we asked for 22746755 and got 999999" is the useful sentence.
    const wrongRuleset = probeLiveRuleset({ runner: (() => result({ status: 0, stdout: rulesetBody(999999, ["quality"]) })) as unknown as Runner });
    expect(wrongRuleset.state).toBe("LIVE_NOT_MEASURED");
    expect(wrongRuleset.ruleset_id, "the probe discarded the id it actually received").toBe(999999);
    expect(wrongRuleset.required_contexts, "a wrong-ruleset response leaked platform facts").toEqual([]);
  });

  it("3 a readable ruleset really is measured, so the classification is a fork and not a constant", () => {
    const probe = probeLiveRuleset({ runner: okRunner });
    expect(probe.state).toBe("LIVE_MEASURED");
    expect(probe.reason).toBeNull();
    expect(probe.ruleset_id).toBe(RULESET_ID);
    expect(probe.required_contexts).toEqual(["quality", "unit", "acceptance", "package"]);
    expect(probe.architecture_required).toBe(false);

    // ...and it reports architecture_required = true when the live ruleset does require it, so the flag is a
    // measurement rather than a hardcoded false.
    const requiring = (() => result({ status: 0, stdout: rulesetBody(RULESET_ID, ["quality", "unit", "acceptance", "package", "architecture"]) })) as unknown as Runner;
    const withArchitecture = probeLiveRuleset({ runner: requiring });
    expect(withArchitecture.state).toBe("LIVE_MEASURED");
    expect(withArchitecture.architecture_required, "the probe cannot detect a required architecture check").toBe(true);
  });

  it("4 the diagnostic distinguishes the states, so a green test is never readable as a live measurement", () => {
    const measured = describeLiveProbe(probeLiveRuleset({ runner: okRunner }));
    expect(measured).toContain("H7_LIVE_RULESET = LIVE_MEASURED");
    expect(measured).toContain("architecture_required=false");

    const unmeasured = describeLiveProbe(probeLiveRuleset({ runner: (() => result({ status: 4, stderr: "not logged in" })) as unknown as Runner }));
    expect(unmeasured).toContain("H7_LIVE_RULESET = NOT_MEASURED");
    expect(unmeasured).toContain("reason =");
    // The word that matters: an unmeasured probe never claims to have measured.
    expect(unmeasured).not.toContain("LIVE_MEASURED ruleset_id");
  });

  it("5 the H7 case itself consumes the helper, so the bound cannot be bypassed by a later edit", () => {
    // Structural, and deliberately blunt: if someone reintroduces a raw `gh api` spawn in the hosted-shadow suite,
    // this fails with a pointer rather than waiting for a hosted runner to time out again.
    const suite = fs.readFileSync(path.join(process.cwd(), "tests/unit/city/architecture-hosted-shadow.test.ts"), "utf8");
    expect(suite, "H7 no longer uses the bounded probe helper").toContain("probeLiveRuleset(");
    const rawGhSpawns = [...suite.matchAll(/spawnSync\(\s*"gh"/g)];
    expect(rawGhSpawns.length, "the suite spawns `gh` directly again; use the bounded probe helper instead").toBe(0);

    // The suite DOES declare long timeouts, and that is correct: `runGoverning` and `runRunner` measure the whole
    // repository and legitimately need minutes. What must never happen is a timeout declared on the GOVERNANCE
    // PROBE, so the rule is scoped to the probe rather than applied to every spawn -- a blanket rule would forbid
    // the very timeouts the measurement needs, and would be "fixed" by shortening them, which is worse.
    const probeCalls = [...suite.matchAll(/probeLiveRuleset\(([^)]*)\)/g)].map((m) => m[1]);
    expect(probeCalls.length, "the suite does not call the probe").toBeGreaterThan(0);
    for (const args of probeCalls) {
      // No caller may raise the bound: the helper owns it, and it is asserted in case 1.
      expect(args, `H7 passes an override to the probe: ${args}`).not.toMatch(/timeout/i);
    }
    // And the helper's own declared bound stays below the enclosing budget (the same invariant as case 1, read
    // from the source so an edit that raises the constant is caught even if the test import were bypassed).
    const helper = fs.readFileSync(path.join(process.cwd(), "tests/unit/city/helpers/live-ruleset-probe.ts"), "utf8");
    const declared = helper.match(/LIVE_PROBE_TIMEOUT_MS\s*=\s*([0-9_]+)/);
    expect(declared, "the probe's timeout constant is gone").toBeTruthy();
    expect(Number(String(declared?.[1]).replace(/_/g, ""))).toBeLessThan(60_000);
  });

  it("6 the 'probe disabled' path is explicit and is not a measurement", () => {
    const probe = probeLiveRuleset({ disabled: true });
    expect(probe.state).toBe("LIVE_NOT_MEASURED");
    expect(probe.skipped).toBe(true);
    expect(String(probe.reason)).toMatch(/disabled/i);
    expect(probe.ruleset_id).toBeNull();
  });
});
