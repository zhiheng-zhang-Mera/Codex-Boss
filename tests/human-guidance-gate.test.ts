import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decideIntervention, validateInterventionRequest, type HumanInterventionRequest } from "../src/shared/intervention";
import { HumanGuidanceGate } from "../electron/commander/human-guidance-gate";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-gate-")); dirs.push(dir); return dir; }

describe("intervention decision (Phase 4 pure)", () => {
  it("auto-recovers only known recoverable reasons", () => {
    expect(decideIntervention({ reason: "provider timeout" })).toBe("AUTO_RECOVER");
    expect(decideIntervention({ reason: "rate limit hit" })).toBe("AUTO_RECOVER");
    expect(decideIntervention({ reason: "test failure in step 3" })).toBe("AUTO_RECOVER");
    expect(decideIntervention({ reason: "model output malformed" })).toBe("REQUIRES_USER"); // unknown → human
  });

  it("pauses for user-decision kinds, paid resources and irreversible actions", () => {
    expect(decideIntervention({ kind: "DIRECTION", reason: "choose next direction" })).toBe("REQUIRES_USER");
    expect(decideIntervention({ kind: "LOGIN", reason: "captcha" })).toBe("REQUIRES_USER");
    expect(decideIntervention({ reason: "run experiment", isPaidResource: true })).toBe("REQUIRES_USER");
    expect(decideIntervention({ reason: "publish preprint", isIrreversible: true })).toBe("REQUIRES_USER");
    expect(decideIntervention({ kind: "BUDGET", reason: "budget limit" })).toBe("REQUIRES_USER");
  });

  it("validates request shape fail-closed", () => {
    const valid: HumanInterventionRequest = { id: "i1", taskId: "t", kind: "DIRECTION", question: "q", blockingStepId: "s", contextSummary: "c", createdAt: "2026-09-06T00:00:00.000Z" };
    expect(() => validateInterventionRequest(valid)).not.toThrow();
    expect(() => validateInterventionRequest({ ...valid, kind: "NOPE" as never })).toThrow();
    expect(() => validateInterventionRequest({ ...valid, question: "" })).toThrow();
  });
});

describe("human guidance gate (Phase 4 electron)", () => {
  it("raises one active intervention per task, resolves with answer and persists across reload", () => {
    const file = path.join(root(), "interventions.json");
    const gate = new HumanGuidanceGate(file);
    const request = gate.raise({ taskId: "t1", kind: "DIRECTION", question: "研究方向?", options: ["A", "B"], blockingStepId: "step1", contextSummary: "checkpoint saved" });
    expect(gate.activeFor("t1")?.id).toBe(request.id);
    expect(() => gate.raise({ taskId: "t1", kind: "DIRECTION", question: "x", blockingStepId: "s", contextSummary: "c" })).toThrow(/already waits/);
    const resolved = gate.resolve("t1", "DIRECTION", "A");
    expect(resolved.answer).toBe("A");
    expect(resolved.resolvedAt).toBeDefined();
    expect(gate.activeFor("t1")).toBeUndefined();
    const reloaded = new HumanGuidanceGate(file);
    expect(reloaded.list("t1")[0].answer).toBe("A"); // durable
  });

  it("fails closed on corrupt store and rejects unknown resolution", () => {
    const file = path.join(root(), "interventions.json");
    const gate = new HumanGuidanceGate(file);
    expect(() => gate.resolve("t9", "LOGIN", "ok")).toThrow(/No active/);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9 }));
    expect(() => new HumanGuidanceGate(file)).toThrow();
  });
});
