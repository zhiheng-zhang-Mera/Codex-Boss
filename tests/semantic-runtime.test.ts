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

it("preserves uncertain mutation across restart and verifies its original expected effect", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-semantic-resume-"));
  try {
    const file = path.join(root, "pending.json"); let mutations = 0;
    const first = new SemanticRuntime([{ kind: "uia", supports: () => true, async execute() { mutations++; return { status: "UNCERTAIN" }; } }], file);
    await first.execute({ name: "enter_text", target: "editor", value: "expected text" });
    const restored = new SemanticRuntime([{ kind: "uia", supports: () => true, async execute(action) { if (action.name === "verify_state") expect(action.value).toBe("expected text"); else mutations++; return { status: "SUCCESS" }; } }], file);
    expect((await restored.execute({ name: "enter_text", target: "editor", value: "duplicate" })).status).toBe("UNCERTAIN");
    expect(mutations).toBe(1);
    expect((await restored.execute({ name: "verify_state", target: "editor", value: "unrelated" })).status).toBe("SUCCESS");
    expect((await restored.execute({ name: "enter_text", target: "editor", value: "next" })).status).toBe("SUCCESS"); expect(mutations).toBe(2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("serializes shared journals and canonicalizes UIA selectors", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-semantic-concurrent-"));
  try {
    const file = path.join(root, "pending.json"); let calls = 0;
    const backend = { kind: "uia" as const, supports: () => true, async execute() { calls++; await new Promise(r => setTimeout(r, 5)); return { status: "UNCERTAIN" as const }; } };
    const first = new SemanticRuntime([backend], file); const second = new SemanticRuntime([backend], file);
    await Promise.all([first.execute({ name: "click_control", target: 'uia:{"processId":42,"name":"Save"}' }), second.execute({ name: "click_control", target: 'uia:{"name":"Save","processId":42}' })]);
    expect(calls).toBe(1);
    await second.execute({ name: "enter_text", target: "another", value: "text" });
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")))).toHaveLength(2);
    expect((await first.execute({ name: "click_control", target: "another" })).status).toBe("UNCERTAIN");
    expect(calls).toBe(2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
