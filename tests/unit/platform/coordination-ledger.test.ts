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
  it("derives the observed TASK figures and leaves the unobservable ones out", () => {
    const { record, unmeasured, tokenProvenance } = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(record.runtime).toBe("api:deepseek");
    // Observed at the task grain, and declared.
    for (const measure of ["modelCalls", "wallMs", "coordinationMs", "executionMs", "reviewFindings", "reworkAvoided"] as const) {
      expect(record.measured, `${measure} should be declared`).toContain(measure);
    }
    // NOT observed, and honestly absent. `inputTokens` is the one the provenance audit changed.
    for (const measure of ["inputTokens", "outputTokens", "defectsEscaped"] as const) {
      expect(record.measured, `${measure} must NOT be declared`).not.toContain(measure);
      expect(unmeasured).toContain(measure);
      expect(record.totals[measure], `${measure} must be null`).toBeNull();
    }
    // The heuristic estimate is kept as a DIAGNOSTIC, with the reason attached, and is not a
    // measurement: `estimatedInputTokens` is ceil(characters / 4), and ApiCompletion carries no usage
    // block, so no provider-counted tokens ever reach the ledger.
    expect(record.diagnostics?.estimatedInputTokens).toBe(48_000);
    expect(record.diagnostics?.note).toContain("ceil");
    expect(tokenProvenance).toContain("unmeasured");
  });

  it("carries NO stage attribution, because the ledger has no per-stage cost", () => {
    // An empty stages array is the honest answer. The first version put the task totals on one
    // arbitrary carrier stage, which invented an attribution and made every other stage look like an
    // unmeasured gap — so a realistic multi-stage record could never be judged.
    const { record } = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(record.stages).toEqual([]);
    expect(record.stageMeasured).toEqual([]);
    // The pipeline is still reported: knowing which stages RAN is different from knowing what each cost.
    expect(record.pipeline).toContain("implement");
    expect(record.pipeline).toContain("finalize");
  });

  it("measures wall time from the durable job timestamps", () => {
    const { record } = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(record.totals.wallMs).toBe(120_000);
    expect(record.totals.executionMs).toBe(118_000);
    expect(record.totals.coordinationMs).toBe(2_000);
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
    expect(recovered.record.totals.reworkAvoided).toBe(1);

    // A job that completed on its first attempt absorbed no rework — a real zero, which is different
    // from unmeasured.
    const firstTry = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(firstTry.record.totals.reworkAvoided).toBe(0);
    // No jobs at all is unmeasured rather than zero.
    const noJobs = coordinationRecordFromLedger(ledgerRecord({ jobs: {} }), { at: AT });
    expect(noJobs.record.measured).not.toContain("reworkAvoided");
  });

  it("takes diff size only from a caller that measured it", () => {
    const without = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(without.record.measured).not.toContain("diffLines");
    const with_ = coordinationRecordFromLedger(ledgerRecord(), { at: AT, diffLines: 42 });
    expect(with_.record.measured).toContain("diffLines");
    expect(with_.record.totals.diffLines).toBe(42);
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
        // Declared at the TASK grain, so the task total must carry it. This is the invariant that
        // keeps the adapter and the guard consistent: a declared-but-null total is refused, so the
        // adapter must never declare one.
        expect(record.totals[measure], `${measure} was declared but the task total is null`).not.toBeNull();
      }
    }
  });

  it("is deterministic: the same ledger record and timestamp give the same record", () => {
    const first = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    const second = coordinationRecordFromLedger(ledgerRecord(), { at: AT });
    expect(second).toEqual(first);
  });
});
