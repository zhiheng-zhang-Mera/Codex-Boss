import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionSupervisor } from "../../../electron/commander/execution-supervisor";
import { TaskLedger, type TaskLedgerRecord } from "../../../electron/commander/task-ledger";
import {
  anthropicUsage,
  geminiUsage,
  openAiCompatibleUsage
} from "../../../electron/provider-api";
import type { RuntimeAdapter, RuntimeResult } from "../../../electron/runtimes/runtime";
import { coordinationRecordFromLedger } from "../../../src/shared/coordination-ledger";
import { evaluateStageGuard } from "../../../src/shared/coordination-economics";

/**
 * Phase 05 Task D — real provider token usage, from the response to the ledger to the decision.
 *
 * ## What these tests are and are NOT
 *
 * The provider RESPONSES here are deterministic fixtures: each vendor's documented usage shape, fed to
 * the normaliser. That is legitimate for testing a parser — the parser's job is to read a schema, and
 * the schema is the vendor's contract, not something invented here.
 *
 * What is NOT simulated is the path. Every test below drives the REAL `ExecutionSupervisor` over a REAL
 * durable `TaskLedger`, and reads the result through the REAL `coordinationRecordFromLedger`. So the
 * figures are persisted, reloaded and measured exactly as a production run would, and the record's
 * `measured` declaration is derived by the same code Gate 8 uses.
 *
 * These are infrastructure tests. They are never a Gate 8 measurement: the economics artifact requires
 * `provenance.kind: "real-provider"` for that, and nothing here writes one.
 */

const dirs: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-usage-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A runtime that answers with a fixed result, standing in for a provider completion. */
function answeringRuntime(id: string, result: Partial<RuntimeResult>): RuntimeAdapter {
  return {
    id,
    kind: "api",
    capabilities: { consumesModel: true, roles: ["planning"], supportsCancellation: false, supportsStreaming: false },
    healthCheck: async () => ({ runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: new Date().toISOString() }),
    execute: async (request): Promise<RuntimeResult> => ({
      runtimeId: id, jobId: request.jobId, status: "SUCCESS", content: "the answer", ...result
    })
  };
}

async function runTask(root: string, runtime: RuntimeAdapter, taskId = "task-1"): Promise<TaskLedgerRecord> {
  const ledger = new TaskLedger(path.join(root, "ledger.json"));
  const supervisor = new ExecutionSupervisor(ledger);
  const result = await supervisor.execute({ taskId, jobId: "job-1", role: "planning", prompt: "do it", replaySafe: true, timeoutMs: 30_000 }, [runtime]);
  expect(result.status).toBe("SUCCESS");
  const saved = ledger.load(taskId);
  expect(saved, "the ledger lost the task").toBeTruthy();
  return saved as TaskLedgerRecord;
}

describe("Phase 05 Task D — each provider's usage schema normalises to one internal shape", () => {
  it("reads the OpenAI-compatible schema", () => {
    expect(openAiCompatibleUsage({ usage: { prompt_tokens: 1_234, completion_tokens: 567, total_tokens: 1_801 } }))
      .toEqual({ inputTokens: 1_234, outputTokens: 567, totalTokens: 1_801 });
    // Some providers on this protocol use the `input_tokens` spelling instead.
    expect(openAiCompatibleUsage({ usage: { input_tokens: 10, output_tokens: 20 } })).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it("reads the Anthropic schema", () => {
    expect(anthropicUsage({ usage: { input_tokens: 2_000, output_tokens: 300 } })).toEqual({ inputTokens: 2_000, outputTokens: 300 });
  });

  it("reads the Gemini schema", () => {
    expect(geminiUsage({ usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120, totalTokenCount: 1_020 } }))
      .toEqual({ inputTokens: 900, outputTokens: 120, totalTokens: 1_020 });
  });

  it("returns nothing at all when the provider reported no usage", () => {
    // Each vendor's shape minus its usage block. Absent, not zeroed.
    for (const body of [{ choices: [] }, { content: [] }, { candidates: [] }, {}, null]) {
      expect(openAiCompatibleUsage(body)).toBeUndefined();
      expect(anthropicUsage(body)).toBeUndefined();
      expect(geminiUsage(body)).toBeUndefined();
    }
  });

  it("declares only the parts the provider actually reported", () => {
    // A partial usage block must not be padded: input only is input only.
    expect(openAiCompatibleUsage({ usage: { prompt_tokens: 42 } })).toEqual({ inputTokens: 42 });
    expect(geminiUsage({ usageMetadata: { candidatesTokenCount: 7 } })).toEqual({ outputTokens: 7 });
    // An empty usage object is "no usage", not "usage of everything zero".
    expect(openAiCompatibleUsage({ usage: {} })).toBeUndefined();
  });

  it("rejects values that are not real counts", () => {
    // A `null`, a string and a negative are not counts. Reading them as 0 would invent a measurement.
    expect(openAiCompatibleUsage({ usage: { prompt_tokens: null } })).toBeUndefined();
    expect(openAiCompatibleUsage({ usage: { prompt_tokens: "1500" } })).toBeUndefined();
    expect(openAiCompatibleUsage({ usage: { prompt_tokens: -5 } })).toBeUndefined();
    // A genuine zero IS a measurement of nothing.
    expect(openAiCompatibleUsage({ usage: { prompt_tokens: 0 } })).toEqual({ inputTokens: 0 });
  });
});

describe("Phase 05 Task D — provider usage reaches the durable ledger", () => {
  it("CASE 1: full usage is persisted and the record declares both measures", async () => {
    const root = tempRoot();
    const saved = await runTask(root, answeringRuntime("api:probe", { usage: { inputTokens: 4_321, outputTokens: 765, totalTokens: 5_086 } }));

    // Persisted on the durable record, alongside — not instead of — the platform's estimate.
    expect(saved.usage.providerInputTokens).toBe(4_321);
    expect(saved.usage.providerOutputTokens).toBe(765);
    expect(saved.usage.providerTotalTokens).toBe(5_086);
    expect(saved.usage.estimatedOutputTokens).toBeGreaterThan(0);

    const { record, tokenProvenance } = coordinationRecordFromLedger(saved, { at: "2026-09-16T00:00:00.000Z" });
    expect(record.totals.inputTokens).toBe(4_321);
    expect(record.totals.outputTokens).toBe(765);
    expect(record.measured).toContain("inputTokens");
    expect(record.measured).toContain("outputTokens");
    expect(tokenProvenance).toContain("provider");
  });

  it("CASE 2: a provider with no usage block leaves both unmeasured and the guard refuses", async () => {
    const root = tempRoot();
    const saved = await runTask(root, answeringRuntime("api:silent", {}), "task-silent");

    expect(saved.usage.providerInputTokens).toBeUndefined();
    expect(saved.usage.providerOutputTokens).toBeUndefined();
    // The platform's own estimate still exists — and is still not a measurement.
    expect(saved.usage.estimatedInputTokens).toBeGreaterThan(0);

    const { record, tokenProvenance } = coordinationRecordFromLedger(saved, { at: "2026-09-16T00:00:00.000Z" });
    expect(record.totals.inputTokens).toBeNull();
    expect(record.totals.outputTokens).toBeNull();
    expect(record.measured).not.toContain("inputTokens");
    expect(record.measured).not.toContain("outputTokens");
    expect(record.diagnostics?.estimatedInputTokens).toBe(saved.usage.estimatedInputTokens);
    expect(tokenProvenance).toContain("unmeasured");

    // Gate 8 cannot proceed on a task whose cost side is missing: `inputTokens` is a COST measure and
    // is still required. `record` is already the derived record here.
    const peer = coordinationRecordFromLedger(
      await runTask(tempRoot(), answeringRuntime("api:probe", { usage: { inputTokens: 10, outputTokens: 5 } }), "task-peer"),
      { at: "2026-09-16T00:00:00.000Z" }
    );
    const result = evaluateStageGuard({ stage: "review", withStage: [peer.record], withoutStage: [record] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("inputTokens");
  });

  it("CASE 3: input-only usage declares inputTokens and leaves outputTokens unmeasured", async () => {
    const root = tempRoot();
    const saved = await runTask(root, answeringRuntime("api:partial", { usage: { inputTokens: 2_222 } }), "task-partial");
    expect(saved.usage.providerInputTokens).toBe(2_222);
    expect(saved.usage.providerOutputTokens).toBeUndefined();

    const { record } = coordinationRecordFromLedger(saved, { at: "2026-09-16T00:00:00.000Z" });
    expect(record.totals.inputTokens).toBe(2_222);
    expect(record.totals.outputTokens).toBeNull();
    expect(record.measured).toContain("inputTokens");
    expect(record.measured).not.toContain("outputTokens");
  });

  it("CASE 4: the heuristic is kept as a diagnostic and never becomes a measurement", async () => {
    const root = tempRoot();
    const saved = await runTask(root, answeringRuntime("api:silent", {}), "task-heuristic");
    const { record } = coordinationRecordFromLedger(saved, { at: "2026-09-16T00:00:00.000Z" });
    // Present, labelled, and demonstrably NOT the source of the measurement.
    expect(record.diagnostics?.estimatedInputTokens).toBeGreaterThan(0);
    expect(record.diagnostics?.note).toContain("heuristic");
    expect(record.totals.inputTokens).toBeNull();

    // And when a provider DOES report usage, the measurement is the provider's figure — not the
    // estimate, which differs.
    const measured = coordinationRecordFromLedger(
      await runTask(tempRoot(), answeringRuntime("api:probe", { usage: { inputTokens: 999_999 } }), "task-real"),
      { at: "2026-09-16T00:00:00.000Z" }
    );
    expect(measured.record.totals.inputTokens).toBe(999_999);
    expect(measured.record.totals.inputTokens).not.toBe(measured.record.diagnostics?.estimatedInputTokens);
  });

  it("CASE 5: usage survives a reload of the durable ledger", async () => {
    const root = tempRoot();
    await runTask(root, answeringRuntime("api:probe", { usage: { inputTokens: 1_111, outputTokens: 222, totalTokens: 1_333 } }));
    // A NEW TaskLedger over the same file: the restart, as far as durable state is concerned.
    const reloaded = new TaskLedger(path.join(root, "ledger.json"));
    const record = reloaded.load("task-1");
    expect(record?.usage.providerInputTokens).toBe(1_111);
    expect(record?.usage.providerOutputTokens).toBe(222);
    expect(record?.usage.providerTotalTokens).toBe(1_333);

    const derived = coordinationRecordFromLedger(record as TaskLedgerRecord, { at: "2026-09-16T00:00:00.000Z" });
    expect(derived.record.totals.inputTokens).toBe(1_111);
    expect(derived.record.measured).toContain("inputTokens");
  });

  it("CASE 6: two arms with complete token measurement produce a real verdict, not INSUFFICIENT_EVIDENCE", async () => {
    // The point of the whole exercise: with usage plumbed, the guard reaches a cost verdict.
    const cohort = { runtime: "api:probe", benchmarkTaskId: "bench", inputIdentity: "input-1", plannedVariable: "review" };
    const baselineSaved = await runTask(tempRoot(), answeringRuntime("api:probe", { usage: { inputTokens: 1_000, outputTokens: 200 } }), "arm-base");
    const candidateSaved = await runTask(tempRoot(), answeringRuntime("api:probe", { usage: { inputTokens: 4_000, outputTokens: 500 } }), "arm-cand");

    // Job timestamps, which a real dispatch records and this test's stub does not: without them
    // `wallMs` ? a required COST measure ? would be unmeasured and the guard would refuse for a reason
    // that has nothing to do with the token plumbing under test.
    const stamped = (record: TaskLedgerRecord): TaskLedgerRecord => {
      for (const job of Object.values(record.jobs)) {
        job.startedAt = "2026-09-16T00:00:00.000Z";
        job.completedAt = "2026-09-16T00:00:02.000Z";
      }
      return record;
    };
    const baseline = coordinationRecordFromLedger(stamped(baselineSaved), { at: "2026-09-16T00:00:00.000Z", cohort: { ...cohort, arm: "baseline" } });
    const candidate = coordinationRecordFromLedger(stamped(candidateSaved), { at: "2026-09-16T00:00:00.000Z", cohort: { ...cohort, arm: "candidate" } });

    // Same pipeline shape, so only the candidate stage differs... which it does not here, so make the
    // candidate the fuller pipeline by declaring it: the guard compares declared pipelines.
    const candidateRecord: typeof candidate.record = { ...candidate.record, pipeline: [...baseline.record.pipeline, "review"] };
    for (const record of [baseline.record, candidateRecord]) {
      expect(record.measured).toContain("inputTokens");
      expect(record.measured).toContain("wallMs");
    }
    const verdict = evaluateStageGuard({ stage: "review", withStage: [candidateRecord], withoutStage: [baseline.record] });
    // The candidate costs 3,000 more input tokens per task and rework was never observed on either arm,
    // so the honest answer is a measured COST_ONLY — which is Gate 8 SUCCEEDING, not failing.
    expect(verdict.verdict, verdict.reasons.join("; ")).toBe("COST_ONLY");
    expect(verdict.comparison?.addedInputTokens).toBe(3_000);
    expect(verdict.reasons.join(" ")).toContain("bought nothing measurable");
  });

  it("accumulates usage across several calls rather than keeping only the last", async () => {
    const root = tempRoot();
    const ledger = new TaskLedger(path.join(root, "ledger.json"));
    const supervisor = new ExecutionSupervisor(ledger);
    let call = 0;
    const runtime: RuntimeAdapter = {
      id: "api:counter", kind: "api",
      capabilities: { consumesModel: true, roles: ["planning"], supportsCancellation: false, supportsStreaming: false },
      healthCheck: async () => ({ runtimeId: "api:counter", availability: "AVAILABLE", message: "ok", checkedAt: new Date().toISOString() }),
      execute: async (request) => {
        call++;
        return { runtimeId: "api:counter", jobId: request.jobId, status: "SUCCESS", content: "ok", usage: { inputTokens: 100 * call, outputTokens: 10 * call } };
      }
    };
    for (const jobId of ["j1", "j2", "j3"]) {
      const result = await supervisor.execute({ taskId: "multi", jobId, role: "planning", prompt: "go", replaySafe: true, timeoutMs: 30_000 }, [runtime]);
      expect(result.status).toBe("SUCCESS");
    }
    const saved = ledger.load("multi") as TaskLedgerRecord;
    // 100 + 200 + 300, not 300: the ledger accumulates, so a three-call task reports its true total.
    expect(saved.usage.providerInputTokens).toBe(600);
    expect(saved.usage.providerOutputTokens).toBe(60);
  });
});
