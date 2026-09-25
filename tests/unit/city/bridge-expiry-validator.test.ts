import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §30 — the bridge expiry validator, and the falsification of every rule that keeps a temporary bridge temporary.
 *
 * THE DESIGN POINT
 *
 *   A temporary bridge is the one legitimate repair in docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md's list
 *   that is DESIGNED to expire, which makes it the one most likely to become permanent. Section 15 requires eight
 *   fields and says "a bridge without an exit condition is not allowed"; section 33 puts "no expired temporary
 *   bridge remains" in the completion checklist; section 30 names this validator. None of it existed, so a bridge
 *   past its deadline -- or one whose code had already been deleted while the declaration stayed -- was invisible.
 *
 *   The two checks that do the real work are the ones that make the declaration falsifiable: the `literal` source
 *   text must still be present EXACTLY ONCE, and the deadline phase must be resolved from MEASUREMENTS rather than
 *   from prose. So the cases below break each rule in turn: a missing field, an unrecognised deadline, an expired
 *   deadline, a declaration whose code is gone, one whose code appears twice, a stage that cannot be measured.
 */

const PROJECT = process.cwd();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const validator = require(path.join(PROJECT, "scripts", "bridge-expiry-validator.cjs")) as {
  validate: (root?: string, options?: Record<string, unknown>) => Report;
  readRegistry: (root?: string) => Registry;
  measurePhases: (registry: Registry) => Record<string, { status: string; resolutions?: Array<{ key: string; value?: number; target?: number; ok: boolean }> }>;
  REQUIRED_FIELDS: Array<[string, number]>;
};

type Registry = {
  stages: Record<string, Record<string, unknown>>;
  bridges: Record<string, Record<string, unknown>>;
  plots: Record<string, { bridges?: string[] }>;
};
type Report = {
  ok: boolean;
  problems: string[];
  bridges: Array<{ id: string; phaseStatus: string | null; expired: boolean; literalPresent: number | null }>;
  phases: Record<string, { status: string; resolutions?: Array<{ key: string; value?: number; target?: number; ok: boolean }> }>;
  sealGate: { declaredBridges: number; liveBridges: number };
};

/**
 * A SYNTHETIC bridge, because the committed registry declares none any more: ledger CC-044 retired P2A-BRIDGE-01,
 * and a test whose subject is the VALIDATOR should not depend on the repository happening to have a live bridge. The
 * literal below is a real statement in the source file it names, so the "declaration is still in the tree" check is
 * exercised for real rather than against a fixture path that would fail for the wrong reason.
 */
const BRIDGE_ID = "FIXTURE-BRIDGE-01";
const SOURCE = "src/shared/contracts.ts";
const LITERAL = 'export type TaskStatus = "queued"';

function fixtureBridge(): Record<string, unknown> {
  return {
    owner: "the fixture executor, acting under a delegated construction lease recorded in the ledger",
    reason: "a substantive reason for a fixture bridge, long enough that the validator's field rule is the thing under test",
    source: `${SOURCE} (owned by status)`,
    target: "src/shared/provider-contracts.ts (owned by providers)",
    form: "exactly one symbol, described here in prose for the record rather than left to inference",
    literal: LITERAL,
    exitCondition: "delete the re-export and re-point every importer inside a commit that already moves the surface",
    deadline_phase: "before the Phase 2 seal",
    tests: "tests/unit/city/bridge-expiry-validator.test.ts",
  };
}

function baseRegistry(): Registry {
  const registry = JSON.parse(JSON.stringify(validator.readRegistry(PROJECT))) as Registry;
  registry.bridges = { [BRIDGE_ID]: fixtureBridge() };
  // Declared by a real plot, so it is not an orphan: the orphan rule is tested separately by removing it again.
  const first = Object.keys(registry.plots)[0];
  registry.plots[first].bridges = [BRIDGE_ID];
  return registry;
}

function run(registry: Registry) {
  return validator.validate(PROJECT, { registry });
}

describe("§30 the bridge expiry validator makes a temporary bridge falsifiable", () => {
  it("accepts the fixture bridge, so every rejection below is the mutation's doing", () => {
    const report = run(baseRegistry());
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.bridges).toHaveLength(1);
    expect(report.bridges[0].literalPresent).toBe(1);
  });

  it("accepts an EMPTY registry, which is the state the programme is actually in", () => {
    // Ledger CC-044 retired the last bridge. Zero bridges is a result, not a missing file, and the validator must say
    // so rather than treat an empty object as a malformed registry.
    const registry = baseRegistry();
    registry.bridges = {};
    const report = run(registry);
    expect(report.problems).toEqual([]);
    expect(report.bridges).toEqual([]);
    expect(report.sealGate.declaredBridges).toBe(0);
    // And the committed registry really is empty, so the two agree.
    expect(Object.keys(validator.readRegistry(PROJECT).bridges)).toEqual([]);
  });

  it("refuses a bridge that does not state each of section 15's fields", () => {
    for (const [field] of validator.REQUIRED_FIELDS) {
      const registry = baseRegistry();
      delete registry.bridges[BRIDGE_ID][field];
      const report = run(registry);
      expect(report.problems.join("\n"), `missing field: ${field}`).toContain(`does not state a substantive ${field}`);
    }
    // Section 15's eight fields, and "a bridge without an exit condition is not allowed".
    expect(validator.REQUIRED_FIELDS.map(([field]) => field)).toContain("exitCondition");
  });

  it("refuses a bridge whose declaration is GONE from the tree, and one whose text appears twice", () => {
    const gone = baseRegistry();
    gone.bridges[BRIDGE_ID].literal = 'export type { NoSuchSymbol } from "./nowhere";';
    const goneReport = run(gone);
    expect(goneReport.ok).toBe(false);
    expect(goneReport.problems.join("\n")).toContain("the bridge has been removed and the declaration is stale");
    expect(goneReport.bridges[0].literalPresent).toBe(0);

    const twice = baseRegistry();
    // A one-character literal that appears many times: a bridge is ONE statement, so this cannot be one.
    twice.bridges[BRIDGE_ID].literal = "export";
    const twiceReport = run(twice);
    expect(twiceReport.problems.join("\n")).toContain("a bridge is ONE statement");
  });

  it("refuses a bridge with no literal at all, because nothing can then be checked against the tree", () => {
    const registry = baseRegistry();
    delete registry.bridges[BRIDGE_ID].literal;
    expect(run(registry).problems.join("\n")).toContain("the declaration cannot be falsified");
  });

  it("refuses an unrecognised deadline, because an unrecognised deadline is not a deadline", () => {
    const registry = baseRegistry();
    registry.bridges[BRIDGE_ID].deadline_phase = "some time later";
    const report = run(registry);
    expect(report.problems.join("\n")).toContain("an unrecognised deadline is not a deadline");
    expect(report.bridges[0].phaseStatus).toBe("UNRECOGNISED");
  });

  it("EXPIRES a bridge whose deadline phase has completed", () => {
    const registry = baseRegistry();
    // Due before a phase that HAS completed: every clause of P2-B's decision targets at least 0, so target 1e9
    // makes the measured value satisfy it and the phase reads COMPLETE.
    registry.bridges[BRIDGE_ID].deadline_phase = "P2-B";
    registry.stages["P2-B"].decidedBy = { all: [{ key: "p2b:kernelToFeatureFileEdges", target: 1000000 }] };
    const report = run(registry);
    expect(report.phases["P2-B"].status).toBe("COMPLETE");
    expect(report.bridges[0].expired).toBe(true);
    expect(report.problems.join("\n")).toContain("section 33 forbids an expired temporary bridge at the seal");
  });

  it("keeps a bridge live while its phase is still in progress, and resolves that from the instrument", () => {
    const registry = baseRegistry();
    registry.bridges[BRIDGE_ID].deadline_phase = "P2-B";
    const report = run(registry);
    expect(report.phases["P2-B"].status).toBe("IN_PROGRESS");
    expect(report.bridges[0].expired).toBe(false);
    // The decision is RESOLVED, not typed: the phase carries a live value and its target, not a sentence.
    const clause = report.phases["P2-B"].resolutions?.[0];
    expect(clause?.key).toBe("p2b:kernelToFeatureFileEdges");
    expect(typeof clause?.value).toBe("number");
    expect(clause?.target).toBe(0);
  });

  it("fails closed when a phase cannot be measured, so an unmeasurable deadline cannot read as not-yet-due", () => {
    const unmeasurable = baseRegistry();
    unmeasurable.stages["P2-B"].decidedBy = { all: [{ key: "p2b:noSuchQuantity", target: 0 }] };
    unmeasurable.bridges[BRIDGE_ID].deadline_phase = "P2-B";
    const unmeasurableReport = run(unmeasurable);
    expect(unmeasurableReport.phases["P2-B"].status).toBe("UNRESOLVED");
    expect(unmeasurableReport.problems.join("\n")).toContain("must not read as \"not yet due\"");

    const undeclared = baseRegistry();
    delete undeclared.stages["P2-B"].decidedBy;
    undeclared.bridges[BRIDGE_ID].deadline_phase = "P2-B";
    expect(validator.measurePhases(undeclared as never)["P2-B"].status).toBe("UNRESOLVED");
  });

  it("refuses an orphan bridge, a missing source file and a missing test file", () => {
    const orphan = baseRegistry();
    for (const plot of Object.values(orphan.plots)) plot.bridges = [];
    expect(run(orphan).problems.join("\n")).toContain("orphan declaration");

    const noSource = baseRegistry();
    noSource.bridges[BRIDGE_ID].source = "src/shared/no-such-file.ts (owned by nobody)";
    expect(run(noSource).problems.join("\n")).toContain("names a source file that does not exist");

    const noTest = baseRegistry();
    noTest.bridges[BRIDGE_ID].tests = "tests/unit/city/no-such-test.test.ts";
    expect(run(noTest).problems.join("\n")).toContain("names a test file that does not exist");
  });
});

describe("§30 the committed registry is EMPTY, and what that now means", () => {
  it("declares no bridge, because ledger CC-044 retired the last one", () => {
    const report = validator.validate(PROJECT);
    expect(report.problems).toEqual([]);
    expect(report.bridges).toEqual([]);
    expect(report.sealGate.declaredBridges).toBe(0);
    expect(report.sealGate.liveBridges).toBe(0);
  });

  it("records the retirement as a WALKED lifecycle rather than as a deleted record", () => {
    const lifecycle = JSON.parse(fs.readFileSync(path.join(PROJECT, "config", "city-replacement-lifecycle.json"), "utf8")) as {
      instances: Record<string, { state: string; history: Array<{ to: string }> }>;
    };
    const instance = lifecycle.instances["P2A-BRIDGE-01-RETIREMENT"];
    expect(instance.state).toBe("RETIRED");
    expect(instance.history.map((step) => step.to)).toEqual(["SHADOW", "DUAL_VALIDATED", "TRAFFIC_SWITCHED", "OLD_FALLBACK", "DRAINED", "RETIRED"]);
  });

  it("resolves every declared phase from the instruments rather than from a sentence", () => {
    const report = validator.validate(PROJECT);
    const statuses = Object.values(report.phases).map((phase) => phase.status);
    expect(statuses.length).toBeGreaterThanOrEqual(3);
    expect(statuses.every((status) => status === "IN_PROGRESS" || status === "COMPLETE")).toBe(true);
    // Every stage must be decidable: an undecidable one would make a bridge due before it unchecked.
    expect(statuses).not.toContain("UNRESOLVED");
  });

  it("carries no typed measurement in the registry, so the phase numbers cannot go stale again", () => {
    const registry = validator.readRegistry(PROJECT) as unknown as { stages: Record<string, Record<string, unknown>> };
    for (const [id, stage] of Object.entries(registry.stages)) {
      expect(Object.prototype.hasOwnProperty.call(stage, "measured"), `stage ${id} carries a typed measurement`).toBe(false);
      expect(typeof stage.trackedBy, `stage ${id} names no tracking artifact`).toBe("string");
      expect(typeof stage.decidedBy, `stage ${id} declares no decidedBy`).toBe("object");
    }
  });

  it("keeps the seal gate's bridge rule, which is now merely UNEXERCISED rather than removed", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const flatness = require(path.join(PROJECT, "scripts", "city-flatness-validator.cjs")) as {
      validate: (root?: string, options?: Record<string, unknown>) => { verdict: string; sealProblems: string[] };
    };
    const sealed = flatness.validate(PROJECT, { seal: true });
    expect(sealed.verdict).toBe("SEAL_BLOCKED");
    // The seal is still blocked, but for the PLOTS: with zero bridges declared the bridge reason does not fire, and
    // the retirement is what removed it. That is the honest reading of this state.
    expect(sealed.sealProblems.join("\n")).not.toContain("temporary bridge(s) are still declared");
    expect(sealed.sealProblems.join("\n")).toContain("seal-blocking state");
    // And the rule itself is still in the validator, so a bridge coming back would be refused again. This is a
    // source-presence check and is labelled as one: the rule cannot be EXERCISED while the registry is empty, and a
    // check that claimed otherwise would be pretending.
    const source = fs.readFileSync(path.join(PROJECT, "scripts", "city-flatness-validator.cjs"), "utf8");
    expect(source, "the seal gate's bridge rule was deleted rather than left unexercised").toContain("a bridge is retired before the seal, not at it");
  });
});
