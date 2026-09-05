import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchIR } from "../src/shared/research-ir";
import type { ResearchProtocol } from "../src/shared/research-protocol";
import { ResearchService } from "../electron/research/research-service";
import { DefaultLevelBExecutor } from "../electron/research/default-levelb-executor";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-rservice-")); dirs.push(dir); return dir; }

function ir(workspace: string): ResearchIR {
  return {
    schemaVersion: 1, id: "svc1", goal: "compare decision modes",
    scope: { workspace, allowedDomains: [], reviewers: ["web:chatgpt", "web:gemini"], autonomy: "AUTOPILOT", budget: { maxExperiments: 2, maxSteps: 30 } },
    state: "SCOPING", researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}

function protocol(): ResearchProtocol {
  return { schemaVersion: 1, hypothesis: "H: evidence-based beats majority", primaryMetric: "accuracy", baseline: "0.8", sampleDefinition: "tasks 1..50", evaluationCriterion: ">= baseline", createdAt: new Date(0).toISOString() };
}

describe("research service facade (Phase 5-11 glue)", () => {
  it("runs an offline autopilot journey: start → inspect → honest pause at reviewer gates", async () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(dir, "src", "a.test.ts"), "import {it} from 'vitest'; it('a',()=>{});");
    const service = new ResearchService({ root: path.join(dir, ".boss"), executor: new DefaultLevelBExecutor() });
    service.start(ir(dir));
    expect(service.status("svc1")?.ir.state).toBe("SCOPING");
    // First step executes SCOPING and advances to PROJECT_INSPECTION.
    const first = await service.step("svc1");
    expect(first.state).toBe("PROJECT_INSPECTION");
    // Second step executes real repo inspection via the default executor.
    const second = await service.step("svc1");
    expect(second.state).toBe("LITERATURE_REVIEW");
    const record = service.status("svc1")!;
    expect(record.decisions.some((d) => d.stepId === "PROJECT_INSPECTION" && d.evidenceRefs?.[0]?.startsWith("repo:"))).toBe(true);
    // Reviewer-gated stages pause (evidence > vote): the run parks at
    // WAITING_FOR_PROVIDER with the pending stage recorded — it never advances
    // past a gate no executor actually passed.
    const gated = await service.step("svc1");
    expect(gated.state).toBe("WAITING_FOR_PROVIDER");
    const paused = service.status("svc1")!;
    expect(paused.ir.pendingStage).toBe("LITERATURE_REVIEW");
    const gatedDecision = paused.decisions.find((d) => d.stepId === "LITERATURE_REVIEW")!;
    expect(gatedDecision.reason).toContain("requires web-AI reviewer");
    // resume() returns to the exact pending stage, never a restart from SCOPING.
    expect(service.supervisor.resume("svc1")).toBe(true);
    expect(service.status("svc1")!.ir.state).toBe("LITERATURE_REVIEW");
    expect(service.status("svc1")!.ir.pendingStage).toBeUndefined();
  });

  it("freezes a protocol (moves to PROTOCOL_FROZEN, records hash) and can fail a run", () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    const service = new ResearchService({ root: path.join(dir, ".boss"), executor: new DefaultLevelBExecutor() });
    service.start(ir(dir));
    const frozen = service.freeze("svc1", protocol());
    expect(frozen.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(service.status("svc1")!.ir.state).toBe("PROTOCOL_FROZEN");
    expect(service.status("svc1")!.ir.protocolHash).toBe(frozen.hash);
    expect(service.protocols.load("svc1")?.protocolHash).toBe(frozen.hash);
    service.fail("svc1", "protocol amendment rejected");
    expect(service.status("svc1")!.ir.state).toBe("FAILED");
  });

  it("records a frozen-field amendment bound to the frozen hash only after freeze", () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    const service = new ResearchService({ root: path.join(dir, ".boss"), executor: new DefaultLevelBExecutor() });
    service.start(ir(dir));
    // Amendment before freeze fails closed (Phase 7: no silent scientific change).
    expect(() => service.amend("svc1", { changes: [{ field: "baseline", before: "0.8", after: "0.7", reason: "measurement fix" }] })).toThrow(/frozen/i);
    const frozen = service.freeze("svc1", protocol());
    const amendment = service.amend("svc1", { changes: [{ field: "baseline", before: "0.8", after: "0.7", reason: "measurement fix" }] });
    expect(amendment.protocolHash).toBe(frozen.hash);
    expect(service.amendments("svc1")).toHaveLength(1);
    // The frozen hash experiments bind to never changes via amendment.
    expect(service.protocols.load("svc1")?.protocolHash).toBe(frozen.hash);
    expect(() => service.amend("ghost", { changes: [{ field: "baseline", before: "0.8", after: "0.7", reason: "x" }] })).toThrow(/Unknown/i);
  });

  it("writes evidence graph runs and exposes the protocol hash helper", () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    const service = new ResearchService({ root: path.join(dir, ".boss"), executor: new DefaultLevelBExecutor() });
    service.start(ir(dir));
    const hash = service.hashProtocol(protocol());
    const frozen = service.freeze("svc1", protocol());
    expect(hash).toBe(frozen.hash);
    service.recordRun("svc1", { runId: "run-1", experimentId: "exp-1", protocolHash: hash, gitCommit: "c", gitDirty: false, command: ["node", "x.mjs"], environmentFingerprint: "e", dependencyLockHash: "l", seed: 1, inputHashes: [], outputHash: "o", stdoutStderrHash: "s", metrics: { accuracy: 0.9 }, durationMs: 10, hardware: "ci", timestamp: new Date(0).toISOString() });
    expect(service.evidence.runs("svc1")).toHaveLength(1);
  });
});
