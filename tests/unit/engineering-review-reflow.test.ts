import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EngineeringLoopStore } from "../../electron/engineering/engineering-loop-store";
import { EngineeringLoopDriver, type EngineeringLoopOperations } from "../../electron/engineering/engineering-loop-driver";
import { parseReviewerFindings, severityFromReviewLine, isReviewerReflowFinding, type EngineeringGoalContract, type ReviewerFinding } from "../../src/shared/engineering-loop";

const GOAL: EngineeringGoalContract = {
  schemaVersion: 1, id: "goal-test", objective: "make the repository production-grade",
  workspace: "C:\\repo", protectedProductBehavior: [], allowedChangeScope: ["reliability", "correctness"],
  forbiddenChangeScope: [], verificationPolicy: "standard", agentCount: 3,
  convergencePolicy: { cleanRoundsRequired: 1 }, createdAt: new Date(0).toISOString()
};

function storeAt(): EngineeringLoopStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-loop-"));
  return new EngineeringLoopStore(path.join(root, "engineering-loop.json"));
}

function finding(severity: "CRITICAL" | "HIGH" | "MEDIUM", description: string, area = "review") {
  return { id: `${area}:${severity}:${description.slice(0, 8)}`, area, description, severity, evidence: "seed" };
}

function reviewer(severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OPTIONAL", summary: string): ReviewerFinding {
  return { severity, summary };
}

function noopOps(overrides: Partial<EngineeringLoopOperations> = {}): EngineeringLoopOperations {
  return {
    audit: async () => [],
    build: async () => ({ passed: true }),
    test: async () => ({ passed: true }),
    implement: async () => ({ changedFiles: [] }),
    review: async () => ({ findings: [] }),
    ...overrides
  };
}

describe("reviewer finding parsing (Overcomplete §6.2/6.3)", () => {
  it("parses a strict JSON envelope and classifies line text deterministically", () => {
    const parsed = parseReviewerFindings('{"findings":[{"severity":"HIGH","summary":"race on shared state"},{"severity":"LOW","summary":"style nit"}]}');
    expect(parsed.findings).toEqual([{ severity: "HIGH", summary: "race on shared state" }, { severity: "LOW", summary: "style nit" }]);
    expect(severityFromReviewLine("CRITICAL: user data loss on crash")).toBe("CRITICAL");
    expect(severityFromReviewLine("must fix this incorrect path")).toBe("HIGH");
    expect(severityFromReviewLine("unknown phrasing")).toBe("MEDIUM");
    expect(isReviewerReflowFinding({ severity: "HIGH", summary: "x" })).toBe(true);
    expect(isReviewerReflowFinding({ severity: "LOW", summary: "x" })).toBe(false);
    expect(isReviewerReflowFinding({ severity: "MEDIUM", summary: "shared state corruption" })).toBe(true);
    expect(isReviewerReflowFinding({ severity: "MEDIUM", summary: "comment wording" })).toBe(false);
  });

  it("falls back to line classification for a plain-text reviewer answer", () => {
    const parsed = parseReviewerFindings("Looks fine overall.\nHIGH: the change ignores a security boundary");
    expect(parsed.findings.some((item) => item.severity === "HIGH" && item.summary.includes("security boundary"))).toBe(true);
  });
});

describe("EngineeringLoopDriver reviewer reflow (Overcomplete §6.3)", () => {
  it("re-flows a HIGH reviewer finding into a second implement round and converges on the fix", async () => {
    const store = storeAt();
    store.freezeGoal(GOAL);
    let implementCalls = 0;
    const reviewLog: Array<{ files: string[]; evidence: { buildPassed: boolean; testsPassed: boolean } }> = [];
    const auditCalls: string[] = [];
    const driver = new EngineeringLoopDriver({
      store,
      maxIterations: 6,
      operations: noopOps({
        audit: async () => {
          auditCalls.push("audit");
          // The compile-level issue disappears after the first implement.
          return auditCalls.length === 1 ? [finding("HIGH", "missing error handling on startup")] : [];
        },
        implement: async (_goal, target) => { implementCalls++; void target; return { changedFiles: ["src/x.ts"] }; },
        review: async (_goal, _finding, files, evidence) => {
          reviewLog.push({ files, evidence });
          // Independent reviewer: clean only after the second-round repair.
          return implementCalls === 1
            ? { findings: [reviewer("HIGH", "race condition on the shared registry")] }
            : { findings: [] };
        }
      })
    });
    const summary = await driver.run();
    expect(summary.state).toBe("ENGINEERING_CONVERGED");
    expect(implementCalls).toBe(2);
    expect(reviewLog.length).toBe(2);
    // Reviewer saw acceptance evidence (review runs after build/test).
    expect(reviewLog[0].evidence).toEqual({ buildPassed: true, testsPassed: true });
    const iterationRecords = store.iterations();
    // The reviewer reflow is durable evidence on iteration 1 and re-entered triage.
    expect(iterationRecords[0].findings.some((item) => item.id.startsWith("review:"))).toBe(true);
    expect(iterationRecords[0].reviewFindings.some((item) => item.startsWith("HIGH"))).toBe(true);
    expect(iterationRecords[iterationRecords.length - 1].status).toBe("CONVERGED");
  });

  it("stops instead of spinning when the same reviewer rejection repeats (§8.7)", async () => {
    const store = storeAt();
    store.freezeGoal(GOAL);
    const driver = new EngineeringLoopDriver({
      store,
      maxIterations: 10,
      operations: noopOps({
        audit: async () => [finding("HIGH", "missing error handling on startup")],
        implement: async () => ({ changedFiles: ["src/x.ts"] }),
        review: async () => ({ findings: [reviewer("HIGH", "still broken state handling")] })
      })
    });
    const summary = await driver.run();
    expect(summary.state).toBe("STAGNANT");
    expect(store.iterations().length).toBeLessThanOrEqual(4);
  });

  it("aborts (never closes) when the coder reports failure", async () => {
    const store = storeAt();
    store.freezeGoal(GOAL);
    const driver = new EngineeringLoopDriver({
      store,
      maxIterations: 5,
      operations: noopOps({
        audit: async () => [finding("HIGH", "typecheck failure")],
        implement: async () => ({ changedFiles: [], error: "live coder failed: no backend" })
      })
    });
    const summary = await driver.run();
    expect(summary.state).toBe("ABORTED");
    expect(summary.changedFiles).toEqual([]);
  });
});
