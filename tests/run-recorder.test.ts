import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchIR } from "../src/shared/research-ir";
import type { ResearchProtocol } from "../src/shared/research-protocol";
import type { ResearchCommandSpec } from "../src/shared/research-command";
import { ResearchService } from "../electron/research/research-service";
import { ResearchRuntime } from "../electron/research/runtime/research-runtime";
import { PrimaryRunRecorder, probeGit } from "../electron/research/runtime/run-recorder";
import { EvidenceGraph } from "../electron/research/evidence/evidence-graph";
import { DefaultLevelBExecutor } from "../electron/research/default-levelb-executor";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-rrun-")); dirs.push(dir); return dir; }

function ir(workspace: string): ResearchIR {
  return {
    schemaVersion: 1, id: "run1", goal: "compare decision modes",
    scope: { workspace, allowedDomains: [], reviewers: ["web:chatgpt"], autonomy: "AUTOPILOT", budget: { maxExperiments: 3, maxSteps: 20 } },
    state: "SCOPING", researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}

function protocol(): ResearchProtocol {
  return { schemaVersion: 1, hypothesis: "H: evidence beats majority", primaryMetric: "accuracy", baseline: "0.8", sampleDefinition: "tasks 1..20", evaluationCriterion: ">= baseline", createdAt: new Date(0).toISOString() };
}

function specAt(cwd: string, seed: number): ResearchCommandSpec {
  // Real node experiment: prints a METRICS line (deterministic from seed) and
  // writes the same metric to a metrics.json artifact in cwd.
  const code = `const v = ${seed} * 2; console.log('METRICS ' + JSON.stringify({accuracy: v})); require('fs').writeFileSync('metrics.json', JSON.stringify({accuracy: v}));`;
  return { executable: process.execPath, args: ["-e", code], cwd, purpose: "EXPERIMENT", timeoutMs: 30000, expectedOutputs: ["METRICS"] };
}

describe("primary-run recorder (Phase 6→10 glue)", () => {
  it("runs a real experiment and records protocol-bound provenance", { timeout: 30000 }, async () => {
    const cwd = root();
    const evidenceDir = path.join(cwd, ".evidence");
    const recorder = new PrimaryRunRecorder(new EvidenceGraph(evidenceDir), new ResearchRuntime());
    const spec = specAt(cwd, 7);
    const recorded = await recorder.run("r1", { experimentId: "exp1", protocolHash: "frozen-hash", spec, seed: 7 });
    expect(recorded.passed).toBe(true);
    const record = recorded.record;
    expect(record.protocolHash).toBe("frozen-hash");
    expect(record.experimentId).toBe("exp1");
    expect(record.metrics.accuracy).toBe(14);
    expect(record.command[0]).toBe(process.execPath);
    expect(record.stdoutStderrHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    // Deterministic outputs hash identically across identical runs.
    const second = await recorder.run("r1", { experimentId: "exp1", protocolHash: "frozen-hash", spec: specAt(cwd, 7), seed: 7 });
    expect(second.record.stdoutStderrHash).toBe(record.stdoutStderrHash);
    expect(second.record.environmentFingerprint).toBe(record.environmentFingerprint);
    // A different seed yields a different output hash + metrics.
    const other = await recorder.run("r1", { experimentId: "exp1", protocolHash: "frozen-hash", spec: specAt(cwd, 9), seed: 9 });
    expect(other.record.metrics.accuracy).toBe(18);
    expect(other.record.stdoutStderrHash).not.toBe(record.stdoutStderrHash);
    expect(new EvidenceGraph(evidenceDir).runs("r1")).toHaveLength(3);
  });

  it("hashes declared inputs and detects a dependency lockfile", { timeout: 30000 }, async () => {
    const cwd = root();
    fs.writeFileSync(path.join(cwd, "data.csv"), "a,b\n1,2\n");
    fs.writeFileSync(path.join(cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
    const evidenceDir = path.join(cwd, ".evidence");
    const recorder = new PrimaryRunRecorder(new EvidenceGraph(evidenceDir), new ResearchRuntime());
    const spec = specAt(cwd, 1);
    const { record } = await recorder.run("r1", { experimentId: "exp2", protocolHash: "h", spec, seed: 1, inputFiles: [path.join(cwd, "data.csv")] });
    expect(record.inputHashes).toHaveLength(1);
    expect(record.inputHashes[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(record.dependencyLockHash).not.toBe("none");
    // A declared input that disappears must fail closed (never a silent record).
    await expect(recorder.run("r1", { experimentId: "exp3", protocolHash: "h", spec: specAt(cwd, 2), seed: 2, inputFiles: [path.join(cwd, "gone.csv")] })).rejects.toThrow(/missing/i);
    expect(new EvidenceGraph(evidenceDir).runs("r1")).toHaveLength(1);
  });

  it("probes git without throwing in a non-repo directory", async () => {
    const cwd = root();
    const git = await probeGit(cwd);
    expect(["unknown"]).toContain(git.commit);
    expect(typeof git.dirty).toBe("boolean");
  });

  it("records whether a real run passed and persists a failed run as passed:false", async () => {
    const cwd = root();
    const evidenceDir = path.join(cwd, ".evidence");
    const recorder = new PrimaryRunRecorder(new EvidenceGraph(evidenceDir), new ResearchRuntime());
    const ok = await recorder.run("r1", { experimentId: "exp-ok", protocolHash: "h", spec: specAt(cwd, 3), seed: 3 });
    expect(ok.record.passed).toBe(true);
    // Exit code 1 but still prints METRICS → recorded, passed:false (never evidence).
    const failing = await recorder.run("r1", {
      experimentId: "exp-fail", protocolHash: "h",
      spec: { ...specAt(cwd, 4), args: ["-e", "console.log('METRICS ' + JSON.stringify({accuracy: 999})); process.exit(1)"] }, seed: 4
    });
    expect(failing.passed).toBe(false);
    expect(failing.record.passed).toBe(false);
    const stored = new EvidenceGraph(evidenceDir).runs("r1");
    expect(stored).toHaveLength(2);
    expect(stored.find((run) => run.runId === failing.record.runId)?.passed).toBe(false);
  });
});

describe("research service runExperiment (Phase 5–10 composition)", () => {
  function service(cwd: string): ResearchService {
    return new ResearchService({ root: path.join(cwd, ".boss"), executor: new DefaultLevelBExecutor(), runtime: new ResearchRuntime() });
  }

  it("freeze → real experiment run binds to the frozen protocol hash", async () => {
    const cwd = root();
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 1;");
    const svc = service(cwd);
    svc.start(ir(cwd));
    const frozen = svc.freeze("run1", protocol());
    expect(svc.status("run1")!.ir.state).toBe("PROTOCOL_FROZEN");
    const recorded = await svc.runExperiment("run1", { experimentId: "exp-service", protocolHash: frozen.hash, spec: specAt(cwd, 3), seed: 3 });
    expect(recorded.passed).toBe(true);
    expect(recorded.record.protocolHash).toBe(frozen.hash);
    expect(svc.evidence.runs("run1")).toHaveLength(1);
  });

  it("rejects experiments before freeze or with a mismatched hash", async () => {
    const cwd = root();
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 1;");
    const svc = service(cwd);
    svc.start(ir(cwd));
    // Not frozen yet → fail closed (Phase 7: no run before protocol freeze).
    await expect(svc.runExperiment("run1", { experimentId: "e1", protocolHash: "h", spec: specAt(cwd, 1), seed: 1 })).rejects.toThrow(/frozen/i);
    const frozen = svc.freeze("run1", protocol());
    // Mismatched protocol hash → rejected (silent-mutation guard).
    await expect(svc.runExperiment("run1", { experimentId: "e1", protocolHash: "wrong", spec: specAt(cwd, 1), seed: 1 })).rejects.toThrow(/does not match/i);
    expect(svc.evidence.runs("run1")).toHaveLength(0);
    expect(frozen.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
