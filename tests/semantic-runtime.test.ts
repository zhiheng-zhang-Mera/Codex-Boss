import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SemanticRuntime } from "../electron/computer/semantic-runtime";
import { ResourceController, ScopedMemory, degradedMode } from "../electron/commander/resource-controller";
describe("semantic and long-horizon runtime", () => {
  it("uses DOM before vision and never repeats an uncertain submit", async () => {
    let vision = 0;
    const runtime = new SemanticRuntime([{ kind: "vision", supports: () => true, async execute() { vision++; return { status: "SUCCESS" }; } }, { kind: "dom", supports: () => true, async execute(action) { if (action.name === "submit") throw new Error("lost connection"); return { status: "SUCCESS", evidence: "text" }; } }]);
    expect((await runtime.execute({ name: "read_page", target: "page" })).backend).toBe("dom");
    expect((await runtime.execute({ name: "submit", target: "button" })).status).toBe("UNCERTAIN"); expect(vision).toBe(0);
  });
  it("falls back for unsupported reads and bounds a hung backend", async () => {
    const runtime = new SemanticRuntime([{ kind: "dom", supports: () => true, execute: () => new Promise(() => {}) }, { kind: "structured", supports: () => true, async execute() { return { status: "SUCCESS" }; } }]);
    expect((await runtime.execute({ name: "read_page", target: "page", timeoutMs: 5 })).backend).toBe("structured");
  });
  it("isolates memory namespaces and persists observed routing cost", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-memory-"));
    try {
      const memory = new ScopedMemory(root); memory.put("task", "a", "summary", "private task context");
      expect(memory.get("project", "a", "summary")).toBeUndefined(); expect(() => memory.get("task", "../outside", "summary")).toThrow();
      const file = path.join(root, "resources.json"); const resources = new ResourceController(file);
      for (let i = 0; i < 3; i++) { resources.record("cheap", true, 1, 10); resources.record("expensive", false, 3, 100); }
      expect(new ResourceController(file).score("cheap")).toBeLessThan(resources.score("expensive"));
      expect(degradedMode({ workers: 0, strong: false, cheap: false, native: true })).toBe("DETERMINISTIC");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
