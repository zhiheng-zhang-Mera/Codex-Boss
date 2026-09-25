import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P2-H — the Core growth ban, and the falsification of every rule that makes it a budget rather than a number.
 *
 * THE DESIGN POINT
 *
 *   Section 22's final acceptance is `Core size <= Phase 2 starting Core size`, and it forbids two escapes: treating
 *   shared infrastructure as automatic Core, and letting an exception silently redefine the baseline. Those are the
 *   two ways a Core budget fails quietly, so the cases below BREAK EACH RULE and assert the rejection: a kernel
 *   leaving Core by losing its `kind`, a fifth capability becoming Core without an exception, growth with no
 *   exception, growth beyond the recorded allowance, a fall in any of the three floors, and an exception missing
 *   any one of its required parts -- including each of section 22's four questions.
 *
 *   The budget, the ledger and the measurement are all injected, so the rules can be exercised without editing the
 *   real tree. One integration case runs the real measurement against the real budget.
 */

const PROJECT = process.cwd();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const budget = require(path.join(PROJECT, "scripts/core-budget-validator.cjs")) as {
  measure: (root?: string) => Measurement;
  decide: (measurement: Measurement, budget: unknown, ledger: string) => Decision;
  readBudget: (root?: string) => Record<string, unknown>;
  readLedger: (root?: string) => string;
  CLASSIFICATION: string;
  EXCEPTION_QUESTIONS: Array<[string, string]>;
};

type Measurement = {
  schema: string;
  classification: string;
  coreCapabilities: string[];
  coreOwnedFiles: number;
  filesPerCapability: Record<string, number>;
  compositionRootFiles: number;
  capabilityCount: number;
  capabilityOwnedFiles: number;
  scannedSourceFiles: number;
  manifestCount: number;
  kinds: Record<string, string | null>;
};

type Decision = { ok: boolean; problems: string[]; improvements: string[]; measured: Record<string, number | string[]> };

const START = { core: 115, composition: 2, owned: 596, scanned: 614, manifests: 27 };

function baseMeasurement(overrides: Partial<Measurement> = {}): Measurement {
  return {
    schema: "city-core-budget-measurement/1",
    classification: budget.CLASSIFICATION,
    coreCapabilities: ["persistence", "providers", "runtime", "state-core"],
    coreOwnedFiles: START.core,
    filesPerCapability: { persistence: 13, providers: 51, runtime: 36, "state-core": 15 },
    compositionRootFiles: START.composition,
    capabilityCount: 27,
    capabilityOwnedFiles: START.owned,
    scannedSourceFiles: START.scanned,
    manifestCount: START.manifests,
    kinds: {},
    ...overrides,
  };
}

function baseBudget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "city-core-budget/1",
    classification: budget.CLASSIFICATION,
    recordedAt: "2026-09-25T04:15Z",
    starting: {
      coreCapabilities: ["persistence", "providers", "runtime", "state-core"],
      coreOwnedFiles: START.core,
      compositionRootFiles: START.composition,
      capabilityOwnedFiles: START.owned,
      scannedSourceFiles: START.scanned,
      manifestCount: START.manifests,
      capabilityCount: 27,
      recordedByLedgerEntry: "CC-035",
    },
    target: { growth: 0 },
    exceptions: [],
    ...overrides,
  };
}

const LEDGER = [
  "ENTRY_ID                    CC-035",
  "the starting Core surface: persistence, providers, runtime, state-core",
  "ENTRY_ID                    CC-900",
  "core-budget-exception EX-01 was authorised by the Owner for node",
].join("\n");

function goodException(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "EX-01",
    capability: "node",
    allowedFiles: 5,
    debtId: "CITY-DEBT-005",
    exitCondition: "the module is extracted to its own road and removed from Core",
    ownerAuthorization: "Owner authorization recorded for exception EX-01 in the construction ledger",
    whyExistingRoadCannotCarryIt: "no existing road holds a durable handle on the process tree",
    whyItIsNotABuilding: "it performs no business function and owns no user-visible outcome",
    whatInvariantOnlyCoreCanHold: "exactly one supervisor may hold a child process handle",
    whatBreaksIfOutsideCore: "two supervisors would race to reap the same child process",
    ledgerEntry: "CC-900",
    ...overrides,
  };
}

describe("P2-H the Core budget refuses the two ways it would fail quietly", () => {
  it("accepts the fixture baseline, so every rejection below is caused by the mutation under test", () => {
    const decision = budget.decide(baseMeasurement(), baseBudget(), LEDGER);
    expect(decision.problems).toEqual([]);
    expect(decision.ok).toBe(true);
    expect(decision.measured.unexcusedGrowth).toBe(0);
  });

  it("refuses a pinned Core capability that lost its kind", () => {
    const decision = budget.decide(baseMeasurement({ coreCapabilities: ["providers", "runtime", "state-core"] }), baseBudget(), LEDGER);
    expect(decision.ok).toBe(false);
    expect(decision.problems.join("\n")).toContain("persistence was Core at the city-phase start and is not Core now");
  });

  it("refuses a fifth Core capability that no exception names", () => {
    const decision = budget.decide(baseMeasurement({ coreCapabilities: ["node", "persistence", "providers", "runtime", "state-core"] }), baseBudget(), LEDGER);
    expect(decision.problems.join("\n")).toContain("node is Core now and was not at the start, and no exception names it");
  });

  it("refuses Core growth with no exception at all", () => {
    const decision = budget.decide(baseMeasurement({ coreOwnedFiles: START.core + 5 }), baseBudget(), LEDGER);
    expect(decision.problems.join("\n")).toContain("Core grew by 5 owned file(s)");
  });

  it("refuses growth beyond the recorded allowance, and the composition root cannot absorb it either", () => {
    const beyond = budget.decide(baseMeasurement({ coreOwnedFiles: START.core + 9 }), baseBudget({ exceptions: [goodException()] }), LEDGER);
    expect(beyond.problems.join("\n")).toContain("the recorded exceptions allow only 5");

    const viaCompositionRoot = budget.decide(baseMeasurement({ compositionRootFiles: START.composition + 3 }), baseBudget(), LEDGER);
    expect(viaCompositionRoot.problems.join("\n")).toContain("3 composition-root file(s)");
  });

  it("accepts growth that an Owner-approved exception covers, and still reports it", () => {
    const decision = budget.decide(baseMeasurement({ coreOwnedFiles: START.core + 5 }), baseBudget({ exceptions: [goodException()] }), LEDGER);
    expect(decision.problems).toEqual([]);
    expect(decision.measured.growth).toBe(5);
    expect(decision.measured.allowances).toBe(5);
    expect(decision.measured.unexcusedGrowth).toBe(0);
  });

  it("refuses a fall in each of the three floors, because a smaller measurement is not a smaller Core", () => {
    const owned = budget.decide(baseMeasurement({ capabilityOwnedFiles: START.owned - 1 }), baseBudget(), LEDGER);
    expect(owned.problems.join("\n")).toContain("capability-owned files fell");

    const scanned = budget.decide(baseMeasurement({ scannedSourceFiles: START.scanned - 1 }), baseBudget(), LEDGER);
    expect(scanned.problems.join("\n")).toContain("scanned source files fell");

    const manifests = budget.decide(baseMeasurement({ manifestCount: START.manifests - 1 }), baseBudget(), LEDGER);
    expect(manifests.problems.join("\n")).toContain("declared manifest count fell");
  });

  it("reports an improvement when Core is below its starting surface, without lowering the ceiling", () => {
    const decision = budget.decide(baseMeasurement({ coreOwnedFiles: START.core - 10 }), baseBudget(), LEDGER);
    expect(decision.ok).toBe(true);
    expect(decision.improvements.join("\n")).toContain("at or below its starting surface");
    // And the fall buys nothing: the same budget still refuses a return to the starting size.
    const rebound = budget.decide(baseMeasurement({ coreOwnedFiles: START.core + 1 }), baseBudget(), LEDGER);
    expect(rebound.problems.join("\n")).toContain("Core grew by 1 owned file(s)");
  });

  it("refuses an exception that leaves any required part unstated", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["identity", { capability: null }, "does not name the identity"],
      ["allowance", { allowedFiles: 0 }, "states no positive file allowance"],
      ["debt id", { debtId: null }, "carries no debt id"],
      ["exit condition", { exitCondition: "later" }, "states no exit condition"],
      ["owner authorization", { ownerAuthorization: null }, "names no Owner authorization"],
    ];
    for (const [label, mutation, expected] of cases) {
      const decision = budget.decide(baseMeasurement({ coreOwnedFiles: START.core + 1 }), baseBudget({ exceptions: [goodException(mutation)] }), LEDGER);
      expect(decision.problems.join("\n"), `mutation: ${label}`).toContain(expected);
    }
  });

  it("refuses an exception that does not answer each of section 22's four questions", () => {
    expect(budget.EXCEPTION_QUESTIONS).toHaveLength(4);
    for (const [field, question] of budget.EXCEPTION_QUESTIONS) {
      const decision = budget.decide(baseMeasurement({ coreOwnedFiles: START.core + 1 }), baseBudget({ exceptions: [goodException({ [field]: "no" })] }), LEDGER);
      expect(decision.problems.join("\n"), `question: ${field}`).toContain(question);
    }
  });

  it("refuses an exception whose ledger record is missing, or does not mention the exception", () => {
    const missingEntry = budget.decide(baseMeasurement(), baseBudget({ exceptions: [goodException({ ledgerEntry: "CC-901" })] }), LEDGER);
    expect(missingEntry.problems.join("\n")).toContain("which the ledger does not contain");

    const silentEntry = budget.decide(baseMeasurement(), baseBudget({ exceptions: [goodException({ id: "EX-77", ledgerEntry: "CC-035" })] }), LEDGER);
    expect(silentEntry.problems.join("\n")).toContain("does not mention EX-77");
  });

  it("refuses a duplicated exception id and an unstated or contradictory classification", () => {
    const duplicated = budget.decide(baseMeasurement(), baseBudget({ exceptions: [goodException(), goodException()] }), LEDGER);
    expect(duplicated.problems.join("\n")).toContain("EX-01 is declared twice");

    const unstated = budget.decide(baseMeasurement(), baseBudget({ classification: undefined }), LEDGER);
    expect(unstated.problems.join("\n")).toContain("states no classification");

    const different = budget.decide(baseMeasurement(), baseBudget({ classification: "Core = whatever is large" }), LEDGER);
    expect(different.problems.join("\n")).toContain("records a different classification");
  });

  it("refuses a starting baseline that names no ledger entry, or one the ledger does not contain", () => {
    const gone = baseBudget();
    (gone.starting as Record<string, unknown>).recordedByLedgerEntry = undefined;
    expect(budget.decide(baseMeasurement(), gone, LEDGER).problems.join("\n")).toContain("names no ledger entry");

    const absent = baseBudget();
    (absent.starting as Record<string, unknown>).recordedByLedgerEntry = "CC-777";
    expect(budget.decide(baseMeasurement(), absent, LEDGER).problems.join("\n")).toContain("CC-777, which the ledger does not contain");
  });

  it("refuses a starting block with no pinned Core names and no recorded floors", () => {
    const unpinned = baseBudget({ starting: { recordedByLedgerEntry: "CC-035" } });
    const decision = budget.decide(baseMeasurement(), unpinned, LEDGER);
    expect(decision.problems.join("\n")).toContain("pins nothing");
    expect(decision.problems.join("\n")).toContain("capability-owned files has no recorded floor");
  });
});

describe("P2-H the committed budget and the real Core surface", () => {
  it("measures four Core capabilities owning 115 files, with the composition root counted separately", () => {
    const measurement = budget.measure(PROJECT);
    expect(measurement.coreCapabilities).toEqual(["persistence", "providers", "runtime", "state-core"]);
    expect(measurement.coreOwnedFiles).toBe(START.core);
    expect(measurement.filesPerCapability.persistence).toBe(13);
    expect(measurement.filesPerCapability.providers).toBe(51);
    expect(measurement.filesPerCapability.runtime).toBe(36);
    expect(measurement.filesPerCapability["state-core"]).toBe(15);
    expect(measurement.compositionRootFiles).toBe(START.composition);
  });

  it("passes against the committed budget, with the starting surface matching what is measured", () => {
    const measurement = budget.measure(PROJECT);
    const decision = budget.decide(measurement, budget.readBudget(PROJECT), budget.readLedger(PROJECT));
    expect(decision.problems).toEqual([]);
    expect(decision.ok).toBe(true);
    expect(decision.measured.growth).toBe(0);
    expect(decision.measured.unexcusedGrowth).toBe(0);
    expect(decision.measured.exceptions).toBe(0);
  });

  it("anchors the starting surface to a ledger entry that exists", () => {
    const recorded = budget.readBudget(PROJECT) as { starting: { recordedByLedgerEntry: string } };
    const ledger = budget.readLedger(PROJECT);
    expect(ledger).toContain(`ENTRY_ID                    ${recorded.starting.recordedByLedgerEntry}`);
  });

  it("says out loud that the ban is proved and the exception path is not", () => {
    const recorded = budget.readBudget(PROJECT) as { exceptions: unknown[]; exception_protocol?: { why?: string } };
    expect(recorded.exceptions).toEqual([]);
    expect(String(recorded.exception_protocol?.why ?? "")).toContain("must not silently redefine the baseline");
  });
});
