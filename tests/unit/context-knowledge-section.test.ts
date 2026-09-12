/**
 * checkpoint-1 §5.5 — the knowledge section in the REAL prompt path.
 *
 * `ContextManager.assemble` is what `MainCommander` hands a provider, so this is
 * where reused project knowledge actually reaches a prompt. Two properties
 * matter: the section is bounded, and with no provider the assembled context is
 * byte-for-byte what it was before the seam existed (no silent prompt change for
 * every existing task).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ContextManager, type TaskContext } from "../../electron/commander/context-manager";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-context-knowledge-"));

afterAll(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
});

function context(taskId: string): TaskContext {
  return {
    taskId,
    objective: "implement the latency guard",
    constraints: ["do not modify the UI"],
    currentProtocol: "direct",
    currentRound: "1",
    resolvedClaims: [],
    openDisputes: [],
    artifactRefs: ["artifact:1"],
    summaries: [{ id: "s1", text: "summary one", createdAt: "2026-01-01T00:00:00.000Z" }],
    executionHistory: []
  };
}

describe("§5.5 knowledge reaches the provider prompt without changing legacy output", () => {
  it("produces exactly the pre-seam context when no knowledge provider is attached", () => {
    const manager = new ContextManager(path.join(ROOT, "none.json"));
    manager.save(context("task-none"));
    const expected = [
      "ROLE: executor\nfollow the instructions",
      "OBJECTIVE:\nimplement the latency guard",
      "CONSTRAINTS:\ndo not modify the UI",
      "PROTOCOL: direct / 1",
      "ARTIFACT_REFS:\nartifact:1",
      "OPEN_DISPUTES:\n",
      "SUMMARIES:\nsummary one"
    ].join("\n\n");
    expect(manager.assemble("task-none", "executor", "follow the instructions")).toBe(expected);
  });

  it("stays byte-identical when the knowledge provider has nothing to reuse", () => {
    const manager = new ContextManager(path.join(ROOT, "empty.json"));
    manager.save(context("task-empty"));
    const withoutSeam = manager.assemble("task-empty", "executor", "follow the instructions");
    manager.setKnowledgeSectionProvider(() => undefined);
    expect(manager.assemble("task-empty", "executor", "follow the instructions")).toBe(withoutSeam);
    manager.setKnowledgeSectionProvider(() => "");
    expect(manager.assemble("task-empty", "executor", "follow the instructions")).toBe(withoutSeam);
  });

  it("inserts a bounded PROJECT_KNOWLEDGE section after the task's own instructions", () => {
    const manager = new ContextManager(path.join(ROOT, "with.json"));
    manager.save(context("task-with"));
    let reportedBudget = 0;
    manager.setKnowledgeSectionProvider((_taskId, _role, maxChars) => {
      reportedBudget = maxChars;
      return "REUSED_PROJECT_KNOWLEDGE (1 object(s)):\n- [ARCHITECTURE] repository layout";
    });
    const assembled = manager.assemble("task-with", "executor", "follow the instructions", { maxChars: 600 });
    expect(reportedBudget).toBeGreaterThan(0);
    expect(reportedBudget).toBeLessThanOrEqual(200);
    expect(assembled).toContain("PROJECT_KNOWLEDGE:");
    expect(assembled).toContain("REUSED_PROJECT_KNOWLEDGE");
    expect(assembled.indexOf("CONSTRAINTS:")).toBeLessThan(assembled.indexOf("PROJECT_KNOWLEDGE:"));
    expect(assembled.indexOf("PROJECT_KNOWLEDGE:")).toBeLessThan(assembled.indexOf("PROTOCOL:"));
    expect(assembled.length).toBeLessThanOrEqual(600);
  });

  it("never lets knowledge crowd out the objective in a tight budget", () => {
    const manager = new ContextManager(path.join(ROOT, "tight.json"));
    manager.save(context("task-tight"));
    manager.setKnowledgeSectionProvider(() => `KE-${"x".repeat(5000)}`);
    const assembled = manager.assemble("task-tight", "executor", "follow the instructions", { maxChars: 200 });
    expect(assembled.startsWith("ROLE: executor")).toBe(true);
    expect(assembled).toContain("OBJECTIVE:");
    expect(assembled).toContain("CONSTRAINTS:");
    expect(assembled.length).toBeLessThanOrEqual(200);
  });
});
