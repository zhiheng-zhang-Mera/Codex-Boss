import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore, providerSeed } from "../electron/store";
import { ProviderAutomation } from "../electron/provider-automation";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function workspace() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-loop-")); dirs.push(dir); const file = path.join(dir, "state.json"); return { file, store: new StateStore(file) }; }
describe("delivery and checkpoint integration", () => {
  it("completes an API answer through the real automation, store and gate", async () => {
    const { file, store } = workspace(); let requests = 0;
    const task = store.createTask("question", "answer", ["chatgpt"], "direct", "work", { chatgpt: "api" });
    const automation = new ProviderAutomation(store, {} as never, (id) => providerSeed.find((item) => item.id === id)!, () => undefined, {} as never, { validate() {}, async complete() { requests++; return { content: "The answer", sourceUrl: "https://example.test", adapterVersion: "test" }; } } as never);
    await Promise.all([automation.dispatchTask(task.id), automation.dispatchTask(task.id)]);
    automation.dispose();
    const snapshot = new StateStore(file).snapshot();
    expect(requests).toBe(1); expect(snapshot.tasks[0].status).toBe("completed"); expect(snapshot.runs[0].review?.status).toBe("PASS"); expect(snapshot.dispatchCheckpoints[0].status).toBe("COMMITTED");
  });
  it("finishes a persisted response whose process stopped before review", () => {
    const { file, store } = workspace(); const task = store.createTask("question", "answer", ["chatgpt"]);
    const run = store.runsForTask(task.id)[0]; store.captureArtifact(run.id, "persisted answer", "https://example.test");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.runs[0].phase = "waiting"; delete state.runs[0].review;
    state.tasks[0].status = "running"; state.tasks[0].executionPhase = "REVIEW_GATE";
    fs.writeFileSync(file, JSON.stringify(state));
    const restored = new StateStore(file).snapshot();
    expect(restored.tasks[0].status).toBe("completed"); expect(restored.runs[0].review.status).toBe("PASS"); expect(restored.artifacts).toHaveLength(1);
  });
  it("releases only the response explicitly approved by the user", () => {
    const { file, store } = workspace(); const task = store.createTask("question", "answer", ["chatgpt"]);
    store.setReviewPolicy(task.id, { mode: "AUTONOMOUS", maxRetries: 2, approvalRequired: true });
    store.captureArtifact(store.runsForTask(task.id)[0].id, "answer", "https://example.test");
    expect(store.snapshot().tasks[0].executionPhase).toBe("WAITING_FOR_USER");
    store.releaseReview(task.id);
    expect(new StateStore(file).snapshot().tasks[0]).toMatchObject({ status: "completed", reviewPolicy: { approvalRequired: true } });
  });
  it("leaves corrupt canonical state intact", () => {
    const { file } = workspace(); fs.writeFileSync(file, "{broken");
    expect(() => new StateStore(file)).toThrow("Cannot restore"); expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  });
});

// The continuation callback stands at the same boundary used by the Electron host.
describe("automatic round continuation", () => {
  it("continues only committed passing rounds and never repeats a completed round", async () => {
    const { store } = workspace();
    const task = store.createTask("council", "compare", ["chatgpt"], "council", "work", { chatgpt: "api" });
    let calls = 0; let continuations = 0; let automation: ProviderAutomation;
    automation = new ProviderAutomation(store, {} as never, (id) => providerSeed.find((item) => item.id === id)!, () => undefined, {} as never, { validate() {}, async complete() { calls++; return { content: "answer " + calls, sourceUrl: "https://example.test", adapterVersion: "test" }; } } as never, async (id) => {
      continuations++;
      const council = store.snapshot().councils.find((item) => item.taskId === id)!;
      if (council.stage === "synthesis") { store.updateCouncil(id, { stage: "completed" }); store.setTaskStatus(id, "completed"); }
      else { store.addCouncilRound(id, new Map([["chatgpt", "next"]]), council.stage === "proposals" ? "peer_review" : "synthesis"); await automation.dispatchTask(id); }
    });
    await automation.dispatchTask(task.id); await automation.continueIfReady(task.id); automation.dispose();
    expect(calls, JSON.stringify(store.snapshot().runs.map(({ phase, message }) => ({ phase, message })))).toBe(3); expect(continuations).toBe(3);
    expect(store.snapshot().tasks[0]).toMatchObject({ status: "completed", executionPhase: "COMPLETED" });
    expect(store.snapshot().dispatchCheckpoints.every((item) => item.status === "COMMITTED")).toBe(true);
  });
  it("does not accept task completion without evidence", () => {
    const { store } = workspace(); const task = store.createTask("task", "work", ["chatgpt"]);
    expect(() => store.setTaskStatus(task.id, "completed")).toThrow("persisted passing evidence");
  });
});
