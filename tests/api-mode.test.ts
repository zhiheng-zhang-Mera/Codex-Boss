import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiSettingsStore } from "../electron/api-settings";
import { ProviderApiClient } from "../electron/provider-api";
import { StateStore } from "../electron/store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function temporaryFile(name: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-api-"));
  temporaryDirectories.push(directory);
  return path.join(directory, name);
}

const protect = (value: string) => Buffer.from(`protected:${value}`, "utf8").toString("base64");
const unprotect = (value: string) => Buffer.from(value, "base64").toString("utf8").replace(/^protected:/, "");

describe("Chat and Work transport policy", () => {
  it("forces every Chat run to web and freezes Work choices into the task", () => {
    const store = new StateStore(temporaryFile("state.json"));
    const chat = store.createTask("chat", "prompt", ["chatgpt", "gemini", "claude"], "direct", "chat", { chatgpt: "api" });
    expect(store.runsForTask(chat.id).every((run) => run.transport === "web")).toBe(true);

    const work = store.createTask("work", "prompt", ["chatgpt", "gemini", "claude"], "direct", "work", { chatgpt: "api", gemini: "web", claude: "api" });
    expect(work.transportByProvider).toEqual({ chatgpt: "api", gemini: "web", claude: "api" });
    expect(store.runsForTask(work.id).map((run) => run.transport)).toEqual(["api", "web", "api"]);
  });
});

describe("encrypted API settings and protocol client", () => {
  it("persists only protected keys and exposes only hasApiKey", () => {
    const file = temporaryFile("api-settings.json");
    const settings = new ApiSettingsStore(file, protect, unprotect);
    settings.update({ providerId: "chatgpt", enabled: true, protocol: "openai-compatible", baseUrl: "https://api.example.test/v1/", model: "test-model", apiKey: "secret-value" });
    expect(fs.readFileSync(file, "utf8")).not.toContain("secret-value");
    expect(settings.snapshot(["chatgpt"])[0]).toEqual(expect.objectContaining({ enabled: true, baseUrl: "https://api.example.test/v1", model: "test-model", hasApiKey: true }));
  });

  it("sends an OpenAI-compatible request and extracts the answer", async () => {
    const settings = new ApiSettingsStore(temporaryFile("api-settings.json"), protect, unprotect);
    settings.update({ providerId: "chatgpt", enabled: true, protocol: "openai-compatible", baseUrl: "https://api.example.test/v1", model: "test-model", apiKey: "secret-value" });
    const request = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await new ProviderApiClient(settings, request as typeof fetch).complete("chatgpt", "question");
    expect(result.content).toBe("answer");
    expect(request).toHaveBeenCalledOnce();
    const [, init] = request.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-value");
  });
});
