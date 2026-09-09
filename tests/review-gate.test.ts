import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reviewResponse, type WorkerResponse } from "../src/shared/execution";
import { StateStore } from "../electron/store";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const answer: WorkerResponse = { taskId: "t", workerId: "w", responseId: "r", content: "A valid response", outcome: "SUCCESS" };
describe("deterministic review and continuation", () => {
  it("passes ordinary text in every mode without a reviewer call", () => {
    for (const mode of ["STRICT", "BALANCED", "AUTONOMOUS"] as const) expect(reviewResponse(answer, { mode, maxRetries: 2 }).status).toBe("PASS");
    expect(reviewResponse({ ...answer, content: "To understand quota exceeded errors, check the limits." }).status).toBe("PASS");
  });
  it("bounds retry and preserves hard approvals in autonomous mode", () => {
    expect(reviewResponse({ ...answer, content: "" }).status).toBe("RETRY");
    expect(reviewResponse({ ...answer, content: "quota exceeded" }, undefined, 2).status).toBe("FAILED");
    expect(reviewResponse(answer, { mode: "AUTONOMOUS", maxRetries: 2, approvalRequired: true }).status).toBe("HUMAN_REQUIRED");
  });
  it("checks required JSON fields and types", () => {
    const policy = { mode: "BALANCED" as const, maxRetries: 1, output: { format: "json" as const, requiredFields: ["ok"], fieldTypes: { ok: "boolean" as const } } };
    expect(reviewResponse({ ...answer, content: '{"ok":true}' }, policy).status).toBe("PASS");
    for (const content of ['{"ok":"true"}', '{}', '[]', 'null', 'invalid']) expect(reviewResponse({ ...answer, content }, policy).status).toBe("RETRY");
  });
  it("persists response and gate before completion and never duplicates captured work", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-review-")); dirs.push(dir);
    const file = path.join(dir, "state.json"); const store = new StateStore(file);
    const task = store.createTask("answer", "answer this", ["chatgpt"]);
    const run = store.runsForTask(task.id)[0];
    store.captureArtifact(run.id, "answer", "https://example.test");
    store.captureArtifact(run.id, "duplicate", "https://example.test");
    const restored = new StateStore(file).snapshot();
    expect(restored.artifacts).toHaveLength(1);
    expect(restored.runs[0].review?.status).toBe("PASS");
    expect(restored.tasks[0].executionPhase).toBe("COMPLETED");
  });
  it("holds approvals and fails exhausted malformed replies instead of marking complete", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-review-")); dirs.push(dir);
    const store = new StateStore(path.join(dir, "state.json"));
    const task = store.createTask("answer", "answer this", ["chatgpt"]);
    store.setReviewPolicy(task.id, { mode: "BALANCED", maxRetries: 0 });
    store.captureArtifact(store.runsForTask(task.id)[0].id, "", "https://example.test");
    expect(store.snapshot().tasks[0].executionPhase).toBe("FAILED");
    expect(store.snapshot().tasks[0].status).not.toBe("completed");
  });
});
