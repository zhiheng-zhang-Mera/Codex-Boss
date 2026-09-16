import { describe, expect, it } from "vitest";
import { coordinationRecordFromLedger, type LedgerRecordView } from "../../../src/shared/coordination-ledger";
import { COORDINATION_MEASURES } from "../../../src/shared/coordination-economics";

/**
 * Phase 05 Task D — deriving coordination records from the durable task ledger.
 *
 * The property under test throughout is the one the phase keeps insisting on: **a figure is reported
 * only if the ledger genuinely observed it.** Two figures the ledger cannot know — `outputTokens`
 * (it holds an estimate) and `defectsEscaped` (escapes are discovered after the run, outside it) —
 * must come out null and undeclared rather than filled with something plausible.
 */

const AT = "2026-09-16T00:00:00.000Z";

function ledgerRecord(overrides: Partial<LedgerRecordView> = {}): LedgerRecordView {
  return {
    taskId: "task-1",
    verificationState: "PASS",
    modifiedFiles: ["src/a.ts"],
    failureHistory: [],
    activeProvider: "api:deepseek",
    usage: {
      modelCalls: 12,
      estimatedInputTokens: 48_000,
      estimatedOutputTokens: 20_000,
      toolCalls: 7,
      retries: 0,
      workerRuntimeMs: 118_000,
      providerWaitMs: 2_000
    },
    sessions: [{ provider: "api:deepseek", health: "READY" }],
    jobs: {
      "job-1": { attempts: 1, state: "COMPLETED", startedAt: "2026-09-16T00:00:00.000Z", completedAt: "2026-09-16T00:02:00.000Z" }
    },
    ...overrides
  };
}

describe("Phase 05 Task D — the ledger adapter reports only what the ledger observed", () => {
  it("derives the observed figures and leaves the two unobservable ones out", () => {
    const { record, unmeasured } = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(record.runtime).toBe("api:deepseek");
    // Observed, and declared.
    for (const measure of ["modelCalls", "inputTokens", "wallMs", "coordinationMs", "executionMs", "reviewFindings", "reworkAvoided"] as const) {
      expect(record.measured, `${measure} should be declared`).toContain(measure);
    }
    // NOT observed, and honestly absent.
    expect(record.measured).not.toContain("outputTokens");
    expect(record.measured).not.toContain("defectsEscaped");
    expect(unmeasured).toContain("outputTokens");
    expect(unmeasured).toContain("defectsEscaped");
    // `estimatedOutputTokens` exists on the ledger and is deliberately NOT promoted to a measurement.
    const carrier = record.stages.find((stage) => stage.modelCalls !== null);
    expect(carrier?.outputTokens).toBeNull();
    expect(carrier?.defectsEscaped).toBeNull();
  });

  it("measures wall time from the durable job timestamps", () => {
    const { record } = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    const carrier = record.stages.find((stage) => stage.wallMs !== null);
    expect(carrier?.wallMs).toBe(120_000);
    expect(carrier?.executionMs).toBe(118_000);
    expect(carrier?.coordinationMs).toBe(2_000);
  });

  it("reports no wall time when no job carries durable timestamps", () => {
    // Absent rather than zero: a task whose timing was not recorded has no duration, and calling that
    // 0 would make it look instantaneous in a cost comparison.
    const { record, unmeasured } = coordinationRecordFromLedger(
      ledgerRecord({ jobs: { "job-1": { attempts: 1, state: "COMPLETED" } } }),
      { at: AT }
    );
    expect(record.measured).not.toContain("wallMs");
    expect(unmeasured).toContain("wallMs");
  });

  it("counts rework only for a job that failed first and later completed", () => {
    const recovered = coordinationRecordFromLedger(
      ledgerRecord({ jobs: { "job-1": { attempts: 2, state: "COMPLETED", startedAt: AT, completedAt: AT } } }),
      { at: AT }
    );
    expect(recovered.record.measured).toContain("reworkAvoided");
    expect(recovered.record.stages.find((stage) => stage.reworkAvoided !== null)?.reworkAvoided).toBe(1);

    // A job that completed on its first attempt absorbed no rework — a real zero, which is different
    // from unmeasured.
    const firstTry = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(firstTry.record.stages.find((stage) => stage.reworkAvoided !== null)?.reworkAvoided).toBe(0);
    // No jobs at all is unmeasured rather than zero.
    const noJobs = coordinationRecordFromLedger(ledgerRecord({ jobs: {} }), { at: AT });
    expect(noJobs.record.measured).not.toContain("reworkAvoided");
  });

  it("takes diff size only from a caller that measured it", () => {
    const without = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(without.record.measured).not.toContain("diffLines");
    const with_ = coordinationRecordFromLedger(ledgerRecord(), { at: AT, diffLines: 42 });
    expect(with_.record.measured).toContain("diffLines");
    expect(with_.record.stages.find((stage) => stage.diffLines !== null)?.diffLines).toBe(42);
  });

  it("reports a repair stage only when something actually had to be repaired", () => {
    const clean = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(clean.record.pipeline).not.toContain("repair");
    const repaired = coordinationRecordFromLedger(
      ledgerRecord({ failureHistory: [{ kind: "TOOL_TIMEOUT" }] }),
      { at: AT }
    );
    expect(repaired.record.pipeline).toContain("repair");
  });

  it("reports the ledger's own quality signal under its own name, not as escaped defects", () => {
    const failed = coordinationRecordFromLedger(ledgerRecord({ verificationState: "FAILED" }), { at: AT });
    expect(failed.verificationFailed).toBe(true);
    // Still not dressed up as an escape.
    expect(failed.record.measured).not.toContain("defectsEscaped");
  });

  it("names an unknown runtime rather than inventing one, so it cannot look comparable", () => {
    const orphan = coordinationRecordFromLedger(ledgerRecord({ activeProvider: null, sessions: [] }), { at: AT });
    expect(orphan.record.runtime).toBe("unknown");
  });

  it("carries the cohort it was given and none when it was given none", () => {
    const bare = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(bare.record.cohort).toBeUndefined();
    const paired = coordinationRecordFromLedger(ledgerRecord(), {
      at: AT,
      cohort: { runtime: "api:deepseek", benchmarkTaskId: "bench", inputIdentity: "input-1", plannedVariable: "review", arm: "candidate" }
    });
    expect(paired.record.cohort?.arm).toBe("candidate");
  });

  it("never declares a measure its stages leave null, which the guard would refuse", () => {
    // The invariant that keeps the adapter and the guard consistent: whatever the adapter declares,
    // the record must actually carry.
    for (const view of [ledgerRecord(), ledgerRecord({ verificationState: "FAILED", failureHistory: [{ kind: "X" }] })]) {
      const { record } = coordinationRecordFromLedger(view, { at: AT, diffLines: 5 });
      for (const measure of record.measured) {
        expect(COORDINATION_MEASURES).toContain(measure);
        const carried = record.stages.some((stage) => stage[measure] !== null);
        expect(carried, `${measure} was declared but no stage carries it`).toBe(true);
      }
    }
  });

  it("is deterministic: the same ledger record and timestamp give the same record", () => {
    const first = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    const second = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(second).toEqual(first);
  });
});
