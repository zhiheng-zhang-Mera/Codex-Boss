import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchIR } from "../src/shared/research-ir";
import type { ResearchProtocol } from "../src/shared/research-protocol";
import type { ResearchCommandSpec } from "../src/shared/research-command";
import { ResearchService } from "../electron/research/research-service";
import { ResearchRuntime } from "../electron/research/runtime/research-runtime";
import { EvidenceGraph, type PrimaryRunRecord } from "../electron/research/evidence/evidence-graph";
import { analyzeRecordedRuns } from "../electron/research/evidence/run-analysis";
import { DefaultLevelBExecutor } from "../electron/research/default-levelb-executor";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-ranal-")); dirs.push(dir); return dir; }

function runRecord(seed: number, metrics: Record<string, number>): PrimaryRunRecord {
  return { runId: `run-${seed}`, experimentId: "exp-accuracy", protocolHash: "frozen-abc", gitCommit: "c", gitDirty: false, command: ["node", "bench.mjs"], environmentFingerprint: "env", dependencyLockHash: "lock", seed, inputHashes: [], outputHash: "o", stdoutStderrHash: "s", metrics, durationMs: 10, hardware: "ci", timestamp: new Date(seed).toISOString() };
}

function ir(workspace: string): ResearchIR {
  return {
    schemaVersion: 1, id: "an1", goal: "compare decision modes",
    scope: { workspace, allowedDomains: [], reviewers: ["web:chatgpt"], autonomy: "AUTOPILOT", budget: { maxExperiments: 3, maxSteps: 20 } },
    state: "SCOPING", researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}

function protocol(): ResearchProtocol {
  return { schemaVersion: 1, hypothesis: "H: evidence beats majority", primaryMetric: "accuracy", baseline: "0.8", sampleDefinition: "tasks 1..20", evaluationCriterion: ">= baseline", createdAt: new Date(0).toISOString() };
}

function specAt(cwd: string, seed: number): ResearchCommandSpec {
  const code = `const v = ${seed} * 2; console.log('METRICS ' + JSON.stringify({accuracy: v}));`;
  return { executable: process.execPath, args: ["-e", code], cwd, purpose: "EXPERIMENT", timeoutMs: 30000, expectedOutputs: ["METRICS"] };
}

describe("recorded-run analysis (Phase 10→8)", () => {
  it("computes statistics and adopts a claim with evidence + independent replication", () => {
    const dir = root();
    const graph = new EvidenceGraph(dir);
    graph.addRun("an1", runRecord(1, { accuracy: 9 }));
    graph.addRun("an1", runRecord(2, { accuracy: 11 }));
    graph.addRun("an1", { ...runRecord(9, { accuracy: 1 }), protocolHash: "other-protocol" }); // other protocol → excluded by hash filter
    const result = analyzeRecordedRuns(graph, "an1", {
      claimId: "claim:accuracy", metric: "accuracy", protocolHash: "frozen-abc", baseline: 8,
      votes: [{ reviewerId: "r1", claimId: "claim:accuracy", stance: "supports" }], requiredVotes: 1
    });
    expect(result.eligibleRuns).toHaveLength(2);
    expect(result.mean).toBe(10);
    expect(result.independentReplication).toBe(true);
    expect(result.verdict.adopted).toBe(true);
    expect(result.describe.sd).toBeCloseTo(Math.SQRT2, 10);
    // Claim traceability: statistic + claim nodes, run → statistic → claim edges.
    const graphFile = graph.graph("an1");
    expect(graphFile.nodes.some((node) => node.id === "stat:claim:accuracy" && node.kind === "statistic")).toBe(true);
    expect(graphFile.nodes.some((node) => node.id === "claim:accuracy")).toBe(true);
    expect(graphFile.edges.some((edge) => edge.from === "run:run-1" && edge.to === "stat:claim:accuracy")).toBe(true);
    expect(graphFile.edges.some((edge) => edge.from === "stat:claim:accuracy" && edge.to === "claim:accuracy")).toBe(true);
  });

  it("never adopts without independent replication, even with unanimous votes", () => {
    const dir = root();
    const graph = new EvidenceGraph(dir);
    graph.addRun("an1", runRecord(1, { accuracy: 9 }));
    const result = analyzeRecordedRuns(graph, "an1", {
      claimId: "claim:single", metric: "accuracy", protocolHash: "frozen-abc", baseline: 8,
      votes: [{ reviewerId: "r1", claimId: "claim:single", stance: "supports" }]
    });
    expect(result.independentReplication).toBe(false);
    expect(result.verdict.adopted).toBe(false);
    expect(result.verdict.reason).toContain("no independent replication");
  });

  it("rejects analysis with no eligible runs (no fabricated statistics)", () => {
    const dir = root();
    const graph = new EvidenceGraph(dir);
    graph.addRun("an1", runRecord(1, { other: 1 }));
    expect(() => analyzeRecordedRuns(graph, "an1", { claimId: "c", metric: "accuracy", protocolHash: "frozen-abc" })).toThrow(/No recorded runs/);
  });
});

describe("research service analyzeRuns composition", () => {
  it("runs real experiments then analyzes them against the frozen protocol", { timeout: 30000 }, async () => {
    const cwd = root();
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 1;");
    const svc = new ResearchService({ root: path.join(cwd, ".boss"), executor: new DefaultLevelBExecutor(), runtime: new ResearchRuntime() });
    svc.start(ir(cwd));
    const frozen = svc.freeze("an1", protocol());
    await svc.runExperiment("an1", { experimentId: "exp-acc", protocolHash: frozen.hash, spec: specAt(cwd, 4), seed: 4 });
    await svc.runExperiment("an1", { experimentId: "exp-acc", protocolHash: frozen.hash, spec: specAt(cwd, 5), seed: 5 });
    const result = svc.analyzeRuns("an1", {
      claimId: "claim:accuracy", metric: "accuracy", protocolHash: frozen.hash,
      votes: [{ reviewerId: "r1", claimId: "claim:accuracy", stance: "supports" }]
    });
    expect(result.eligibleRuns).toHaveLength(2);
    expect(result.mean).toBe(9);
    expect(result.independentReplication).toBe(true);
    expect(result.verdict.adopted).toBe(true);
  });

  it("rejects analysis before freeze or on mismatched hash", () => {
    const cwd = root();
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 1;");
    const svc = new ResearchService({ root: path.join(cwd, ".boss"), executor: new DefaultLevelBExecutor(), runtime: new ResearchRuntime() });
    svc.start(ir(cwd));
    expect(() => svc.analyzeRuns("an1", { claimId: "c", metric: "accuracy", protocolHash: "h" })).toThrow(/frozen/i);
    const frozen = svc.freeze("an1", protocol());
    expect(() => svc.analyzeRuns("an1", { claimId: "c", metric: "accuracy", protocolHash: "wrong" })).toThrow(/does not match/i);
    expect(frozen.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
