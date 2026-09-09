import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchLedger } from "../electron/research/research-ledger";
import type { ResearchIR } from "../src/shared/research-ir";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-rlist-")); dirs.push(dir); return dir; }

function ir(id: string, goal: string): ResearchIR {
  return { schemaVersion: 1, id, goal, scope: { workspace: "C:/repo", allowedDomains: [], reviewers: ["web:chatgpt"], autonomy: "AUTOPILOT", budget: { maxExperiments: 2, maxSteps: 20 } }, state: "SCOPING", researchQuestions: [], hypotheses: [], createdAt: new Date(0).toISOString(), updatedAt: new Date().toISOString() };
}

describe("research ledger list (round 6)", () => {
  it("lists multiple runs newest-first and ignores corrupt files", () => {
    const dir = root();
    const ledger = new ResearchLedger(dir);
    ledger.create(ir("r1", "first"));
    const second = ledger.create(ir("r2", "second"));
    ledger.setState("r2", "PROTOCOL_FROZEN", "frozen");
    ledger.create(ir("r3", "third"));
    const runs = ledger.list();
    expect(runs.map((run) => run.id)).toEqual(["r3", "r2", "r1"]);
    expect(runs.find((run) => run.id === "r2")?.state).toBe("PROTOCOL_FROZEN");
    void second;
    // A corrupt file is skipped, not fatal.
    fs.writeFileSync(path.join(dir, "r-broken.json"), "{not-json");
    expect(ledger.list().length).toBe(3);
  });

  it("exposes protocolHash and pendingStage on list rows (round 34 GUI drive support)", () => {
    const dir = root();
    const ledger = new ResearchLedger(dir);
    const record = ledger.create(ir("r1", "frozen+paused"));
    // Set a protocol hash (freeze path writes it) then pause at a reviewer gate.
    ledger.checkpoint("r1", (next) => { next.ir.protocolHash = "abc123"; next.ir.updatedAt = new Date().toISOString(); }, "hash");
    ledger.pauseAt("r1", "LITERATURE_REVIEW", "reviewer gate");
    const run = ledger.list().find((item) => item.id === "r1")!;
    expect(run.protocolHash).toBe("abc123");
    expect(run.pendingStage).toBe("LITERATURE_REVIEW");
    expect(run.state).toBe("WAITING_FOR_PROVIDER");
    expect(record.revision).toBeGreaterThanOrEqual(1);
  });
});
