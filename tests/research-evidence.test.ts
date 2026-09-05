import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describe as statsDescribe, confidenceInterval, mean, median, standardDeviation, bootstrapCi, effectSize, permutationP } from "../src/shared/research-statistics";
import { EvidenceGraph, type PrimaryRunRecord } from "../electron/research/evidence/evidence-graph";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-evidence-")); dirs.push(dir); return dir; }

function run(seed: number): PrimaryRunRecord {
  return { runId: `run-${seed}`, experimentId: "exp1", protocolHash: "abc", gitCommit: "commit1", gitDirty: false, command: ["node", "bench.mjs"], environmentFingerprint: "env", dependencyLockHash: "lock", seed, inputHashes: [], outputHash: "out", stdoutStderrHash: "logs", metrics: { accuracy: 0.9 }, durationMs: 100, hardware: "ci", timestamp: new Date(seed).toISOString() };
}

describe("deterministic research statistics (Phase 10)", () => {
  it("computes mean/median/sd/CI deterministically", () => {
    const values = [1, 2, 3, 4, 5];
    expect(mean(values)).toBe(3);
    expect(median(values)).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(statsDescribe(values).sd).toBeCloseTo(Math.sqrt(2.5), 10);
    const ci = confidenceInterval(values);
    expect(ci.lower).toBeLessThan(3);
    expect(ci.upper).toBeGreaterThan(3);
  });

  it("bootstrap CI is reproducible with a fixed seed", () => {
    const values = Array.from({ length: 40 }, (_, index) => 0.5 + index / 100);
    expect(bootstrapCi(values, { seed: 42 })).toEqual(bootstrapCi(values, { seed: 42 }));
    expect(bootstrapCi(values, { seed: 42 }).lower).toBeLessThan(bootstrapCi(values, { seed: 42 }).upper);
  });

  it("computes effect sizes and permutation p-values deterministically", () => {
    const high = Array.from({ length: 30 }, () => 10 + Math.random());
    const low = Array.from({ length: 30 }, () => 5 + Math.random());
    expect(effectSize(high, low)).toBeGreaterThan(0);
    const p = permutationP(high, low, { seed: 1, permutations: 500 });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
    const same = permutationP([1, 2, 3], [1, 2, 3], { seed: 2, permutations: 300 });
    expect(same).toBeGreaterThan(0.01); // identical sets → high p
  });
});

describe("evidence graph + primary-run provenance (Phase 10)", () => {
  it("persists run provenance records and graph edges", () => {
    const dir = root();
    const graph = new EvidenceGraph(dir);
    graph.addNode("r1", { id: "question:q1", kind: "research-question", label: "Q1" });
    graph.addNode("r1", { id: "hypothesis:h1", kind: "hypothesis", label: "H1" });
    graph.addEdge("r1", "question:q1", "hypothesis:h1");
    graph.addRun("r1", run(1));
    graph.addRun("r1", run(2));
    expect(graph.runs("r1")).toHaveLength(2);
    expect(graph.runs("r1")[0].protocolHash).toBe("abc");
    const file = graph.graph("r1");
    expect(file.nodes.length).toBeGreaterThanOrEqual(4); // q + h + 2 runs
    expect(file.edges.some((edge) => edge.from === "experiment:exp1")).toBe(true);
  });

  it("rejects traversal ids and corrupt graphs", () => {
    const dir = root();
    const graph = new EvidenceGraph(dir);
    expect(() => graph.addRun("../evil", run(1))).toThrow();
    fs.mkdirSync(path.join(dir, "r1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "r1", "evidence-graph.json"), JSON.stringify({ schemaVersion: 9 }));
    expect(() => graph.graph("r1")).toThrow();
  });
});
