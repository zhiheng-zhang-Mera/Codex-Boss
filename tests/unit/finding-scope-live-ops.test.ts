import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { candidateFilesForFinding } from "../../electron/engineering/finding-scope";
import { createLiveEngineeringOperations } from "../../electron/engineering/live-engineering-operations";
import type { EngineeringGoalContract } from "../../src/shared/engineering-loop";

// Read-only tests against the real workspace root (never mutate).
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const GOAL: EngineeringGoalContract = {
  schemaVersion: 1, id: "goal-scope", objective: "make the repository production-grade",
  workspace: ROOT, protectedProductBehavior: [], allowedChangeScope: [], forbiddenChangeScope: [],
  verificationPolicy: "standard", agentCount: 3, convergencePolicy: { cleanRoundsRequired: 1 }, createdAt: new Date(0).toISOString()
};

describe("automatic scope inference (Overcomplete §6.1.2)", () => {
  it("maps a tsc-style evidence path onto the real file plus related tests", () => {
    const finding = { id: "c1", area: "build", severity: "HIGH" as const, description: "typecheck failure", evidence: "src/shared/engineering-loop.ts:45:7 - error TS2322: Type 'string' is not assignable to type 'number'." };
    const files = candidateFilesForFinding(ROOT, finding);
    expect(files).toContain("src/shared/engineering-loop.ts");
    // A dependency-aware scan must not leak outside the repo.
    for (const file of files) expect(file.startsWith("..")).toBe(false);
  });

  it("accepts Windows absolute paths from a native transcript", () => {
    const absolute = path.join(ROOT, "electron", "engineering", "engineering-loop-driver.ts").split(path.sep).join("\\");
    const finding = { id: "c2", area: "build", severity: "HIGH" as const, description: "tsc failure", evidence: `${absolute}(42,9): error TS2554` };
    expect(candidateFilesForFinding(ROOT, finding)).toContain("electron/engineering/engineering-loop-driver.ts");
  });

  it("returns empty (fail closed) when no real file is tied to the finding", () => {
    const finding = { id: "c3", area: "review", severity: "HIGH" as const, description: "please harden the system", evidence: "no path mentioned anywhere" };
    expect(candidateFilesForFinding(ROOT, finding)).toEqual([]);
  });

  it("seeds scope from files the reviewer actually changed (reviewer reflow)", () => {
    const finding = { id: "c4", area: "review(c1)", severity: "HIGH" as const, description: "state lifecycle issue", evidence: "Reviewer reflow on c1 after 1 changed file(s):\nsrc/shared/engineering-loop.ts" };
    const files = candidateFilesForFinding(ROOT, finding);
    expect(files).toContain("src/shared/engineering-loop.ts");
  });
});

describe("live engineering operations boundaries (Overcomplete §6.1.1)", () => {
  it("aborts with an honest error when scope inference finds no file (no repo edit)", async () => {
    const worker = { ask: async (role: "coder" | "reviewer") => { throw new Error(`worker should not be called for ${role}`); } };
    const live = createLiveEngineeringOperations({ workspace: ROOT, goal: GOAL, worker });
    const outcome = await live.implement(GOAL, { id: "no-scope", area: "review", severity: "HIGH", description: "harden everything", evidence: "nothing actionable" });
    expect(outcome.changedFiles).toEqual([]);
    expect(outcome.error).toContain("scope inference found no candidate file");
  });

  it("parses the independent reviewer response through the worker seam", async () => {
    let reviewPrompt = "";
    const worker = {
      ask: async (_role: "coder" | "reviewer", prompt: string) => {
        reviewPrompt = prompt;
        return '{"findings":[{"severity":"HIGH","summary":"error path leaves the file lock held"}]}';
      }
    };
    const live = createLiveEngineeringOperations({ workspace: ROOT, goal: GOAL, worker });
    const outcome = await live.review(GOAL, { id: "f1", area: "tests", severity: "HIGH", description: "missing error handling", evidence: "seed" }, ["src/shared/engineering-loop.ts"], { buildPassed: true, testsPassed: true });
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0].severity).toBe("HIGH");
    // The reviewer prompt carries the original finding and the acceptance evidence.
    expect(reviewPrompt).toContain("f1");
    expect(reviewPrompt).toContain('"tests":"PASS"');
    expect(reviewPrompt).toContain("src/shared/engineering-loop.ts");
  });
});
