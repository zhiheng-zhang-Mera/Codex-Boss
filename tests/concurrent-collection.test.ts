import { describe, expect, it } from "vitest";
import { ProviderAutomation } from "../electron/provider-automation";
import { providerSeed } from "../electron/store";
import type { ProviderRun } from "../src/shared/contracts";

describe("provider completion collection", () => {
  it("observes and captures all waiting providers concurrently", async () => {
    const runs: ProviderRun[] = providerSeed.slice(0, 3).map((provider, index) => ({ id: `run-${index}`, taskId: "task", providerId: provider.id, transport: "web", round: 1, phase: "waiting", outcome: null, message: "", inputPrompt: "prompt", adapterVersion: "test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    let active = 0; let peak = 0; const captured: string[] = [];
    const store = { runsForTask: () => runs, updateRun() {}, captureArtifact(runId: string) { captured.push(runId); const run = runs.find((item) => item.id === runId)!; run.phase = "completed"; }, failDispatchCollection() {} };
    const views = { get(providerId: string) { return { webContents: { async executeJavaScript() { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 30)); active -= 1; return { inputFound: true, loginLikely: false, rateLimited: false, busy: false, latestResponse: `answer-${providerId}`, sourceUrl: "https://example.test" }; } } }; } };
    const automation = new ProviderAutomation(store as never, views as never, (id) => providerSeed.find((item) => item.id === id)!, () => undefined, {} as never, {} as never);
    await (automation as unknown as { poll(taskId: string, manual: boolean): Promise<void> }).poll("task", true);
    expect(peak).toBe(3);
    expect(captured).toHaveLength(3);
  });
});
