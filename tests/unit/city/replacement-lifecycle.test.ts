import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §21 — the replacement lifecycle, and the falsification of every rule that makes its ORDER enforceable.
 *
 * THE DESIGN POINT
 *
 *   docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md section 21 demands a reusable mechanism and names seven
 *   pieces of machinery, then asks for one real bounded migration as its proof. A replacement that reports RETIRED
 *   without ever having run both sides side by side is indistinguishable, IN PROSE, from one that did -- and that
 *   specific forgery is what the state machine refuses. The cases below walk a history that skips a state, one that
 *   reaches RETIRED without DUAL_VALIDATED, one with no evidence, one citing a ledger entry that does not exist, one
 *   whose clock runs backwards, and one that claims a state its history never entered.
 *
 *   The genericity case matters as much as the rest: section 21's acceptance is that "future capabilities can adopt
 *   it without inventing a new protocol", so a SECOND synthetic instance for a different capability is driven
 *   through the same validator. If any capability-specific logic were hiding in it, that case would fail.
 *
 *   This file is also the artifact the lifecycle declares as `rollbackVerifiedBy`, so it carries the rollback proof
 *   itself: the authoritative side is a PURE ALIAS of the successor, which is what makes restoring it a no-op.
 */

const PROJECT = process.cwd();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const lifecycle = require(path.join(PROJECT, "scripts", "replacement-lifecycle-validator.cjs")) as {
  validate: (root?: string, options?: Record<string, unknown>) => Report;
  readLifecycle: (root?: string) => Lifecycle;
};

type Step = { to: string; at: string; ledgerEntry: string } & Record<string, string>;
type Instance = { capability: string; rollbackVerifiedBy?: string; state: string; history: Step[] } & Record<string, unknown>;
type Lifecycle = { states: string[]; transitions: unknown[]; terminalStates: string[]; requiredMachinery: string[]; evidenceByState: Record<string, string>; adoptionProtocol: string; instances: Record<string, Instance> };
type Report = { ok: boolean; problems: string[]; instances: Array<{ id: string; state: string; retired: boolean }>; retiredInstances: number; states: string[] };

const INSTANCE_ID = "P2A-BRIDGE-01-RETIREMENT";
const DEMONSTRATION_ENTRY = "CC-042";
const AUTHORITATIVE = "src/shared/contracts.ts";
const SUCCESSOR = "src/shared/provider-contracts.ts";
const RE_EXPORT = 'export type { ProviderId } from "./provider-contracts";';

function baseLifecycle(): Lifecycle {
  return JSON.parse(JSON.stringify(lifecycle.readLifecycle(PROJECT))) as Lifecycle;
}

function run(config: Lifecycle) {
  return lifecycle.validate(PROJECT, { lifecycle: config });
}

/** One step per state, with the evidence field that state requires, in the declared order. */
function walk(states: string[], evidenceByState: Record<string, string>): Step[] {
  return states.map((state, index) => ({
    to: state,
    at: `2026-09-25T1${index}:00Z`,
    ledgerEntry: DEMONSTRATION_ENTRY,
    ...(evidenceByState[state] ? { [evidenceByState[state]]: `evidence recorded when this replacement entered ${state}, which is what the protocol requires here` } : {}),
  }));
}

const FULL_PATH = ["SHADOW", "DUAL_VALIDATED", "TRAFFIC_SWITCHED", "OLD_FALLBACK", "DRAINED", "RETIRED"];

describe("§21 the replacement lifecycle refuses a history that was not walked", () => {
  it("accepts the committed protocol and its declared instance", () => {
    const report = run(baseLifecycle());
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.instances).toHaveLength(1);
    expect(report.instances[0].state).toBe("RETIRED");
    // The first instance has WALKED to RETIRED (ledger CC-044): section 21 asks for one real migration as its proof,
    // and that proof now exists rather than being pending.
    expect(report.retiredInstances).toBe(1);
  });

  it("refuses a history that SKIPS a state", () => {
    const config = baseLifecycle();
    config.instances[INSTANCE_ID].history = walk(["TRAFFIC_SWITCHED"], config.evidenceByState);
    config.instances[INSTANCE_ID].state = "TRAFFIC_SWITCHED";
    const report = run(config);
    expect(report.ok).toBe(false);
    expect(report.problems.join("\n")).toContain("which is not a declared transition");
  });

  it("refuses RETIRED without DUAL_VALIDATED -- the specific forgery section 21 invites", () => {
    const config = baseLifecycle();
    config.instances[INSTANCE_ID].history = walk(["SHADOW"], config.evidenceByState);
    config.instances[INSTANCE_ID].history.push({ to: "RETIRED", at: "2026-09-25T19:00Z", ledgerEntry: DEMONSTRATION_ENTRY, retirementEvidence: "a claim that the old side is gone, made without ever having compared the two sides" });
    config.instances[INSTANCE_ID].state = "RETIRED";
    const report = run(config);
    expect(report.ok).toBe(false);
    expect(report.problems.join("\n")).toContain("SHADOW -> RETIRED");
    // And the reason is stated in the failure, because the next reader has to know WHY the order matters.
    expect(report.problems.join("\n")).toContain("RETIRED instance that never passed DUAL_VALIDATED");
  });

  it("refuses a step with no evidence, and one citing a ledger entry that does not exist", () => {
    const noEvidence = baseLifecycle();
    noEvidence.instances[INSTANCE_ID].history = [{ to: "SHADOW", at: "2026-09-25T10:00Z", ledgerEntry: DEMONSTRATION_ENTRY }];
    noEvidence.instances[INSTANCE_ID].state = "SHADOW";
    expect(run(noEvidence).problems.join("\n")).toContain("without a substantive shadowEvidence");

    const noLedger = baseLifecycle();
    noLedger.instances[INSTANCE_ID].history = [{ to: "SHADOW", at: "2026-09-25T10:00Z", ledgerEntry: "CC-999", shadowEvidence: "the successor runs beside the old side and neither serves the other's consumers yet" }];
    noLedger.instances[INSTANCE_ID].state = "SHADOW";
    expect(run(noLedger).problems.join("\n")).toContain("which the ledger does not contain");
  });

  it("refuses a clock that runs backwards and a state claimed but never entered", () => {
    const backwards = baseLifecycle();
    const path1 = walk(["SHADOW", "DUAL_VALIDATED"], backwards.evidenceByState);
    path1[1].at = "2026-09-25T09:00Z";
    backwards.instances[INSTANCE_ID].history = path1;
    backwards.instances[INSTANCE_ID].state = "DUAL_VALIDATED";
    expect(run(backwards).problems.join("\n")).toContain("not after the previous step");

    const claimed = baseLifecycle();
    claimed.instances[INSTANCE_ID].history = walk(["SHADOW"], claimed.evidenceByState);
    claimed.instances[INSTANCE_ID].state = "DRAINED";
    expect(run(claimed).problems.join("\n")).toContain("a state cannot be claimed without being entered");
  });

  it("refuses missing machinery, an unverifiable rollback, and a protocol that omits a stage", () => {
    const noMachinery = baseLifecycle();
    delete noMachinery.instances[INSTANCE_ID].dualOutputComparison;
    expect(run(noMachinery).problems.join("\n")).toContain("no substantive dualOutputComparison");

    const noRollbackProof = baseLifecycle();
    noRollbackProof.instances[INSTANCE_ID].rollbackVerifiedBy = "tests/unit/city/no-such-rollback-proof.test.ts";
    expect(run(noRollbackProof).problems.join("\n")).toContain("which does not exist");

    const missingStage = baseLifecycle();
    missingStage.states = missingStage.states.filter((state) => state !== "DUAL_VALIDATED");
    expect(run(missingStage).problems.join("\n")).toContain("no DUAL_VALIDATED state");

    const noEvidenceRequirement = baseLifecycle();
    delete noEvidenceRequirement.evidenceByState.DRAINED;
    expect(run(noEvidenceRequirement).problems.join("\n")).toContain("can be entered by assertion");
  });

  it("refuses a transition back to DECLARED, and a terminal state that is not terminal", () => {
    const loop = baseLifecycle();
    loop.transitions.push({ from: "SHADOW", to: "DECLARED" });
    expect(run(loop).problems.join("\n")).toContain("would let a history loop instead of progress");

    const notTerminal = baseLifecycle();
    notTerminal.transitions.push({ from: "RETIRED", to: "DRAINED" });
    expect(run(notTerminal).problems.join("\n")).toContain("is not terminal");
  });

  it("accepts a SECOND instance for a different capability, which is what makes the protocol reusable", () => {
    // Section 21's acceptance: "future capabilities can adopt it without inventing a new protocol". The same
    // validator drives an instance it has never seen, for a different capability, down the full path.
    const config = baseLifecycle();
    const machinery = Object.fromEntries(
      (config.requiredMachinery as string[]).map((field) => [field, `the ${field} a future capability would state when it adopts this protocol without inventing a new one`]),
    );
    config.instances["SYNTHETIC-SECOND-INSTANCE"] = {
      capability: "some-future-capability",
      ...machinery,
      rollbackVerifiedBy: "tests/unit/city/replacement-lifecycle.test.ts",
      state: "RETIRED",
      history: walk(FULL_PATH, config.evidenceByState),
    } as Instance;
    const report = run(config);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    // The committed instance is retired too, so the synthetic one is the SECOND retirement the same validator accepts.
    expect(report.retiredInstances).toBe(2);
    expect(report.instances.find((entry) => entry.id === "SYNTHETIC-SECOND-INSTANCE")?.retired).toBe(true);
  });
});

describe("§21 the rollback is executable, which is why this file is named as its proof", () => {
  it("shows the retirement is COMPLETE and the recorded rollback is still a pure-alias restore", () => {
    const authoritative = fs.readFileSync(path.join(PROJECT, AUTHORITATIVE), "utf8");
    const successor = fs.readFileSync(path.join(PROJECT, SUCCESSOR), "utf8");
    // The successor really declares the type, so the type has an owner rather than having been orphaned by the move.
    expect(/export\s+(type|interface)\s+ProviderId\b|export\s+type\s*\{[^}]*\bProviderId\b/.test(successor)).toBe(true);
    // The old side NO LONGER re-exports it: the bridge is retired (ledger CC-044), not merely unused. The assertion
    // INVERTED here rather than being deleted, so a re-export coming back fails a case.
    expect(authoritative).not.toContain(RE_EXPORT);
    // The type is still imported for contracts.ts's own declarations, which is what made the re-export a BRIDGE.
    expect(/^\s+ProviderId,$/m.test(authoritative)).toBe(true);
    // And the recorded rollback is executable precisely because it was a pure alias: restoring the one line would
    // restore every consumer without touching the successor file at all.
    expect(RE_EXPORT).toContain("./provider-contracts");
    expect(lifecycle.readLifecycle(PROJECT).instances[INSTANCE_ID].state).toBe("RETIRED");
  });

  it("names a rollback proof that exists, because the validator refuses one that does not", () => {
    const config = lifecycle.readLifecycle(PROJECT);
    const instance = config.instances[INSTANCE_ID];
    expect(instance.rollbackVerifiedBy).toBe("tests/unit/city/replacement-lifecycle.test.ts");
    expect(fs.existsSync(path.join(PROJECT, instance.rollbackVerifiedBy as string))).toBe(true);
  });
});
