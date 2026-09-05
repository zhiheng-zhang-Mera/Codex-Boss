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
});
