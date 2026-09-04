import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore, providerSeed } from "../electron/store";
import { TaskFinalizer } from "../electron/commander/task-finalizer";
import { ProviderAutomation } from "../electron/provider-automation";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-final-")); dirs.push(dir);
  const file = path.join(dir, "state.json"); const store = new StateStore(file);
  const task = store.createTask("test", "answer", ["chatgpt"], "direct", "work", { chatgpt: "api" });
  let requests = 0; const finalizer = new TaskFinalizer(store);
  const automation = new ProviderAutomation(store, {} as never, (id) => providerSeed.find((p) => p.id === id)!, () => {}, {} as never,
    { validate() {}, async complete() { requests++; return { content: "A complete accepted answer", sourceUrl: "https://example.test", adapterVersion: "test" }; } } as never,
    undefined, async (id) => { await finalizer.finalize(id); });
  return { store, task, file, automation, finalizer, requests: () => requests };
}
describe("durable final response", () => {
  it("consumes direct COMPLETE, persists the full answer and never resends", async () => {
    const x = setup(); await x.automation.dispatchTask(x.task.id);
    await Promise.all([x.automation.continueIfReady(x.task.id), x.automation.continueIfReady(x.task.id)]);
    const saved = new StateStore(x.file).snapshot();
    expect(saved.finalResponses).toHaveLength(1); expect(saved.finalResponses[0].content).toBe("A complete accepted answer");
    expect(saved.evidenceBundles).toHaveLength(1); expect(x.requests()).toBe(1);
  });
  it("reconstructs COMPLETE after restart without sending", async () => {
    const x = setup(); await x.automation.dispatchTask(x.task.id);
    const saved = x.store.snapshot(); saved.finalResponses = []; fs.writeFileSync(x.file, JSON.stringify(saved));
    const restored = new StateStore(x.file); const finalizer = new TaskFinalizer(restored);
    await finalizer.finalize(x.task.id); await finalizer.finalize(x.task.id);
    expect(new StateStore(x.file).snapshot().finalResponses).toHaveLength(1); expect(x.requests()).toBe(1);
  });
  it("does not finalize a response before committed checkpoint", async () => {
    const x = setup(); x.store.captureArtifact(x.store.runsForTask(x.task.id)[0].id, "answer", "local:test");
    expect(await x.finalizer.finalize(x.task.id)).toBeUndefined();
  });
  it("retains original output when optional Codex fails", async () => {
    const x = setup(); await x.automation.dispatchTask(x.task.id);
    const saved = x.store.snapshot(); saved.finalResponses = []; fs.writeFileSync(x.file, JSON.stringify(saved));
    const restored = new StateStore(x.file);
    const result = await new TaskFinalizer(restored, () => {}, async () => { throw new Error("quota"); }).finalize(x.task.id, "CODEX_IF_AVAILABLE");
    expect(result?.content).toBe("A complete accepted answer"); expect(result?.source).toBe("worker");
  });
  it("required Codex defers without discarding accepted artifacts", async () => {
    const x = setup(); await x.automation.dispatchTask(x.task.id);
    const saved = x.store.snapshot(); saved.finalResponses = []; fs.writeFileSync(x.file, JSON.stringify(saved));
    const restored = new StateStore(x.file);
    expect(await new TaskFinalizer(restored).finalize(x.task.id, "CODEX_REQUIRED")).toBeUndefined();
    expect(restored.snapshot().artifacts).toHaveLength(1); expect(restored.snapshot().tasks[0].status).toBe("waiting");
    expect(await new TaskFinalizer(new StateStore(x.file)).finalize(x.task.id)).toBeUndefined();
  });
  it("finalizes only after explicit human release", async () => {
    const x = setup(); x.store.setReviewPolicy(x.task.id, { mode: "STRICT", approvalRequired: true, maxRetries: 2 });
    await x.automation.dispatchTask(x.task.id); expect(x.store.snapshot().finalResponses).toHaveLength(0);
    x.store.releaseReview(x.task.id); await x.automation.continueIfReady(x.task.id);
    expect(x.store.snapshot().finalResponses).toHaveLength(1);
  });
});
