import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nextResearchState, validateResearchIR, RESEARCH_MAIN_STATES, type ResearchIR } from "../src/shared/research-ir";
import { ResearchLedger } from "../electron/research/research-ledger";
import { ResearchSupervisor, protocolHash } from "../electron/research/research-supervisor";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-research-")); dirs.push(dir); return dir; }

function ir(overrides: Partial<ResearchIR> = {}): ResearchIR {
  return {
    schemaVersion: 1, id: "r1", goal: "Study multi-agent decision quality",
    scope: { workspace: "C:/repo", allowedDomains: [], reviewers: ["web:chatgpt", "web:gemini"], autonomy: "AUTOPILOT", budget: { maxExperiments: 3, maxSteps: 50 } },
    state: "SCOPING", researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), ...overrides
  };
}

describe("research IR + state machine (Phase 5)", () => {
  it("walks the full main state chain deterministically", () => {
    let state = RESEARCH_MAIN_STATES[0];
    const order: string[] = [];
    while (nextResearchState(state, true)) { order.push(state); state = nextResearchState(state, true)!; }
    order.push(state);
    expect(order).toEqual(RESEARCH_MAIN_STATES);
    expect(nextResearchState("READY", true)).toBeNull();
    expect(nextResearchState("FAILED", true)).toBeNull();
    // Control states cannot autopilot-advance without an explicit resume.
    expect(nextResearchState("WAITING_FOR_USER")).toBeNull();
    expect(nextResearchState("WAITING_FOR_USER", true)).toBe("SCOPING");
  });

  it("validates IR fail-closed", () => {
    expect(() => validateResearchIR(ir())).not.toThrow();
    expect(() => validateResearchIR(ir({ goal: "" }))).toThrow();
    expect(() => validateResearchIR(ir({ scope: { ...ir().scope, reviewers: [] } }))).toThrow();
    expect(() => validateResearchIR(ir({ scope: { ...ir().scope, autonomy: "RUNAWAY" as never } }))).toThrow();
    expect(() => validateResearchIR(ir({ state: "NOPE" as never }))).toThrow();
  });
});

describe("research ledger + supervisor (Phase 5)", () => {
  it("persists IR checkpoints, decisions and autopilot advances", async () => {
    const dir = root();
    const ledger = new ResearchLedger(dir);
    const run = ir();
    ledger.create(run);
    const supervisor = new ResearchSupervisor({ ledger, executor: { async run(input) { return { summary: `ran ${input.stage}` }; } } });
    await supervisor.step("r1"); // SCOPING → PROJECT_INSPECTION
    const record = ledger.load("r1")!;
    expect(record.ir.state).toBe("PROJECT_INSPECTION");
    expect(record.decisions).toHaveLength(1);
    expect(record.decisions[0].stepId).toBe("SCOPING");
    expect(record.revision).toBeGreaterThan(1);
  });

  it("supports control waits, resume and durable reload", () => {
    const dir = root();
    const ledger = new ResearchLedger(dir);
    ledger.create(ir());
    const supervisor = new ResearchSupervisor({ ledger, executor: { async run() { return { summary: "x" }; } } });
    supervisor.wait("r1", "WAITING_FOR_USER", "choose direction");
    expect(ledger.load("r1")!.ir.state).toBe("WAITING_FOR_USER");
    ledger.setState("r1", "SCOPING", "user answered");
    expect(new ResearchLedger(dir).load("r1")!.ir.state).toBe("SCOPING"); // durable
    supervisor.fail("r1", "bad protocol");
    expect(ledger.load("r1")!.ir.state).toBe("FAILED");
  });

  it("produces a stable protocol hash", () => {
    expect(protocolHash({ hypothesis: "h", metric: "m" })).toBe(protocolHash({ metric: "m", hypothesis: "h" }));
    expect(protocolHash("a")).not.toBe(protocolHash("b"));
  });
});
