import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvaluationStore, runDeterministicGolden } from "../electron/evaluation/evaluation-store";
import type { GoldenTask, EvaluationRecord } from "../src/shared/evaluation";
import { summarizeBaseline, EXIT_TARGETS } from "../src/shared/evaluation";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-eval-")); dirs.push(dir); return dir; }

const golden = (id: string, complexity: GoldenTask["complexity"] = "simple", prompt = "list files"): GoldenTask => ({ id, name: id, complexity, prompt, expectedContains: "golden-marker.txt" });

describe("evaluation baseline store", () => {
  it("stores the latest record per golden and aggregates a baseline", () => {
    const file = path.join(root(), "eval.json");
    const store = new EvaluationStore(file);
    const base: Omit<EvaluationRecord, "goldenId"> = { complexity: "simple", status: "PASS", modelCalls: 0, estimatedTokens: 0, workerCalls: 0, retries: 0, latencyMs: 1, humanIntervention: false, sideEffects: false, completedAt: new Date(0).toISOString() };
    store.record({ ...base, goldenId: "a", status: "FAIL" });
    store.record({ ...base, goldenId: "a", status: "PASS" });
    store.record({ ...base, goldenId: "b" });
    expect(store.records()).toHaveLength(2);
    const baseline = store.baseline().find((item) => item.complexity === "simple")!;
    expect(baseline.run).toBe(2);
    expect(baseline.pass).toBe(2);
    expect(baseline.rate).toBe(1);
    expect(baseline.meetsExitTarget).toBe(true);
    expect(EXIT_TARGETS.simple).toBe(0.95);
    expect(new EvaluationStore(file).records().length).toBe(2); // persisted
  });

  it("fails closed on a corrupt store file", () => {
    const file = path.join(root(), "eval.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99 }));
    expect(() => new EvaluationStore(file).load()).toThrow(/Invalid/);
  });

  it("reports summary semantics for mixed and empty suites", () => {
    expect(summarizeBaseline([])).toEqual([
      { complexity: "simple", pass: 0, run: 0, rate: null, meetsExitTarget: false },
      { complexity: "medium", pass: 0, run: 0, rate: null, meetsExitTarget: false },
      { complexity: "complex", pass: 0, run: 0, rate: null, meetsExitTarget: false }
    ]);
    const summary = summarizeBaseline([
      { complexity: "simple", status: "PASS" }, { complexity: "simple", status: "FAIL" },
      { complexity: "medium", status: "PASS" }, { complexity: "medium", status: "NOT_RUN" }
    ]);
    expect(summary.find((item) => item.complexity === "simple")!.rate).toBe(0.5);
    expect(summary.find((item) => item.complexity === "medium")!.rate).toBe(1);
    expect(summary.find((item) => item.complexity === "medium")!.run).toBe(1); // NOT_RUN excluded
  });
});

describe("deterministic golden runner", () => {
  it("runs a simple native golden against a fixture and records PASS", async () => {
    const dir = root();
    const fixture = path.join(dir, "fixture");
    fs.mkdirSync(fixture, { recursive: true });
    fs.writeFileSync(path.join(fixture, "golden-marker.txt"), "expected content");
    const store = new EvaluationStore(path.join(dir, "eval.json"));
    const record = await runDeterministicGolden(store, { ...golden("read"), prompt: "read file golden-marker.txt", expectedContains: "expected content" }, fixture);
    expect(record.status).toBe("PASS");
    expect(record.modelCalls).toBe(0);
    store.record(record);
    expect(store.baseline().find((item) => item.complexity === "simple")!.rate).toBe(1);
  });

  it("marks non-deterministic (AI) golden tasks as NOT_RUN instead of pretending", async () => {
    const store = new EvaluationStore(path.join(root(), "eval.json"));
    const record = await runDeterministicGolden(store, { ...golden("ai"), prompt: "explain this code" });
    expect(record.status).toBe("NOT_RUN");
  });
});
