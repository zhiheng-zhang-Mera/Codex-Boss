import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ContextManager } from "../electron/commander/context-manager";

describe("ContextManager", () => {
  it("restores canonical context without a provider session and applies budgets", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boss-context-"));
    const file = path.join(directory, "contexts.json");
    try {
      const manager = new ContextManager(file);
      manager.save({ taskId: "task", objective: "objective", constraints: ["local only"], currentProtocol: "council", currentRound: "2", resolvedClaims: [], openDisputes: [], artifactRefs: ["a", "b"], summaries: [{ id: "s", text: "summary", createdAt: new Date().toISOString() }], executionHistory: [] });
      const restored = new ContextManager(file);
      expect(restored.get("task")?.objective).toBe("objective");
      expect(restored.assemble("task", "reviewer", "review", { maxChars: 80, maxArtifacts: 1 }).length).toBeLessThanOrEqual(80);
      restored.retainTaskIds([]);
      expect(new ContextManager(file).get("task")).toBeUndefined();
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it("falls back to copy-replace when an atomic rename crosses filesystems", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boss-context-"));
    const file = path.join(directory, "contexts.json");
    try {
      vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
        throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
      });
      const manager = new ContextManager(file);
      manager.save({ taskId: "task", objective: "objective", constraints: [], currentProtocol: "direct", currentRound: "1", resolvedClaims: [], openDisputes: [], artifactRefs: [], summaries: [], executionHistory: [] });
      expect(new ContextManager(file).get("task")?.objective).toBe("objective");
      expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("falls back to a direct write when copy-replace also fails", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boss-context-"));
    const file = path.join(directory, "contexts.json");
    try {
      vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
        throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
      });
      vi.spyOn(fs, "copyFileSync").mockImplementationOnce(() => {
        throw Object.assign(new Error("unknown copy error"), { code: "UNKNOWN" });
      });
      const manager = new ContextManager(file);
      manager.save({ taskId: "task", objective: "objective", constraints: [], currentProtocol: "direct", currentRound: "1", resolvedClaims: [], openDisputes: [], artifactRefs: [], summaries: [], executionHistory: [] });
      expect(new ContextManager(file).get("task")?.objective).toBe("objective");
      expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
