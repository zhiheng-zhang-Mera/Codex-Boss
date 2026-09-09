import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchLedger } from "../electron/research/research-ledger";
import { ResearchSupervisor } from "../electron/research/research-supervisor";
import { DefaultLevelBExecutor } from "../electron/research/default-levelb-executor";
import type { ResearchIR } from "../src/shared/research-ir";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-levelb-")); dirs.push(dir); return dir; }

function ir(workspace: string, state: ResearchIR["state"] = "PROJECT_INSPECTION"): ResearchIR {
  return {
    schemaVersion: 1, id: "lb1", goal: "compare decision modes",
    scope: { workspace, allowedDomains: [], reviewers: ["web:chatgpt"], autonomy: "AUTOPILOT", budget: { maxExperiments: 2, maxSteps: 20 } },
    state, researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}

describe("Level-B default executor (Phase 8)", () => {
  it("runs real repo inspection for PROJECT_INSPECTION and records evidence", async () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(dir, "src", "a.test.ts"), "import { it } from 'vitest'; it('x', () => {});");

    const ledger = new ResearchLedger(path.join(dir, ".boss"));
    ledger.create(ir(dir));
    const supervisor = new ResearchSupervisor({ ledger, executor: new DefaultLevelBExecutor() });
    const result = await supervisor.step("lb1"); // PROJECT_INSPECTION → LITERATURE_REVIEW
    const record = ledger.load("lb1")!;
    expect(result.state).toBe("LITERATURE_REVIEW");
    expect(record.decisions[0].stepId).toBe("PROJECT_INSPECTION");
    expect(record.decisions[0].evidenceRefs?.some((ref) => ref.startsWith("repo:"))).toBe(true);
    expect(record.decisions[0].reason).toContain("2 files");
  });

  it("marks reviewer-gated stages honestly: pause instead of fabricating evidence", async () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;");
    const ledger = new ResearchLedger(path.join(dir, ".boss"));
    ledger.create(ir(dir, "LITERATURE_REVIEW"));
    const executor = new DefaultLevelBExecutor();
    const outcome = await executor.run({ ir: ir(dir, "LITERATURE_REVIEW"), stage: "LITERATURE_REVIEW", workspace: dir });
    expect(outcome.summary).toContain("requires web-AI reviewer");
    expect(outcome.pause).toBe(true);
    expect(outcome.evidenceRefs).toBeUndefined();
  });
});
