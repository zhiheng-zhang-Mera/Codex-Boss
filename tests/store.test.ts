import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { providerSeed, StateStore } from "../electron/store";
import { buildEvidenceBundle } from "../electron/evidence-engine";
import { DEFAULT_PROVIDER_IDS, MAX_ACTIVE_PROVIDERS, normalizeCustomProviderInput } from "../src/shared/provider-policy";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("StateStore persistence", () => {
  it("ships more choices than the five-page active limit and defaults to three", () => {
    expect(providerSeed.map((provider) => provider.id)).toEqual(expect.arrayContaining(["chatgpt", "gemini", "claude", "deepseek", "qwen", "kimi"]));
    expect(providerSeed.length).toBeGreaterThan(MAX_ACTIVE_PROVIDERS);
    expect(DEFAULT_PROVIDER_IDS).toEqual(["chatgpt", "gemini", "claude"]);
  });

  it("persists and removes a custom web AI", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-store-"));
    temporaryDirectories.push(directory);
    const statePath = path.join(directory, "state.json");
    const store = new StateStore(statePath);
    const added = store.addCustomProvider("Team AI", "https://ai.example.test/chat");

    expect(new StateStore(statePath).snapshot().providers).toContainEqual(expect.objectContaining({ id: added.id, name: "Team AI", isCustom: true }));
    store.removeCustomProvider(added.id);
    expect(new StateStore(statePath).snapshot().providers.some((provider) => provider.id === added.id)).toBe(false);
  });

  it("normalizes HTTPS custom links and rejects insecure URLs", () => {
    expect(normalizeCustomProviderInput({ name: " Team AI ", url: "https://ai.example.test/chat" })).toEqual({ name: "Team AI", url: "https://ai.example.test/chat" });
    expect(() => normalizeCustomProviderInput({ name: "Unsafe", url: "http://ai.example.test" })).toThrow("仅支持 HTTPS");
  });

  it("falls back to copy-replace when Windows rejects the atomic rename", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-store-"));
    temporaryDirectories.push(directory);
    const statePath = path.join(directory, "state.json");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    });

    const store = new StateStore(statePath);
    store.createTask("test", "evidence", ["chatgpt"]);

    expect(JSON.parse(fs.readFileSync(statePath, "utf8")).tasks[0].title).toBe("test");
    expect(fs.existsSync(`${statePath}.tmp`)).toBe(false);
  });

  it("creates provider runs and a council session for council tasks", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-store-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(path.join(directory, "state.json"));
    const task = store.createTask("council", "compare evidence", ["chatgpt", "gemini", "claude"], "council");
    const snapshot = store.snapshot();
    expect(snapshot.runs.filter((run) => run.taskId === task.id)).toHaveLength(3);
    expect(snapshot.councils.find((council) => council.taskId === task.id)).toEqual(expect.objectContaining({ stage: "proposals", round: 1 }));
  });

  it("persists Phase 4 controller and evidence state", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-store-"));
    temporaryDirectories.push(directory);
    const statePath = path.join(directory, "state.json");
    const store = new StateStore(statePath);
    const task = store.createTask("evidence", "check evidence", ["gemini"]);
    store.setController({ kind: "codex-cli", accountMode: "CHATGPT", message: "current account" });
    store.saveEvidence(buildEvidenceBundle(task, []));

    const reloaded = new StateStore(statePath).snapshot();
    expect(reloaded.controller.accountMode).toBe("CHATGPT");
    expect(reloaded.evidenceBundles[0]).toEqual(expect.objectContaining({ taskId: task.id, decision: "HOLD_FOR_REVIEW" }));
  });
});
