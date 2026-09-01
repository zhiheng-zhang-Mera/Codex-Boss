import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountSessionManager } from "../electron/account-sessions";
import { StateStore } from "../electron/store";
import { isDispatchGroupSize } from "../src/shared/provider-policy";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function newStore(): StateStore {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-workflow-"));
  temporaryDirectories.push(directory);
  return new StateStore(path.join(directory, "state.json"));
}

describe("group dispatch checkpoints", () => {
  it("allows only three or five providers", () => {
    expect([1, 2, 3, 4, 5].filter(isDispatchGroupSize)).toEqual([3, 5]);
  });

  it("commits only after every provider artifact is captured", () => {
    const store = newStore();
    const task = store.createTask("group", "same prompt", ["chatgpt", "gemini", "claude"]);
    const runs = store.runsForTask(task.id);
    const { checkpoint } = store.beginDispatch(task.id, 1, task.providerIds);
    runs.forEach((run) => store.updateRun(run.id, "waiting", null, "sent"));
    store.markDispatchCollecting(checkpoint.id, task.providerIds);

    store.captureArtifact(runs[0].id, "a", "https://example.test/a");
    store.captureArtifact(runs[1].id, "b", "https://example.test/b");
    expect(store.snapshot().dispatchCheckpoints[0].status).toBe("COLLECTING");
    store.captureArtifact(runs[2].id, "c", "https://example.test/c");
    expect(store.snapshot().dispatchCheckpoints[0]).toEqual(expect.objectContaining({ status: "COMMITTED", successfulProviderIds: task.providerIds }));
  });

  it("restores the previous local run record when group preparation fails", () => {
    const store = newStore();
    const task = store.createTask("rollback", "same prompt", ["chatgpt", "gemini", "claude"]);
    const { checkpoint, baseline } = store.beginDispatch(task.id, 1, task.providerIds);
    store.updateRun(baseline[0].id, "prepared", "SUCCESS", "prepared");
    store.rollbackDispatch(checkpoint.id, baseline, ["gemini"], false, "prepare failed");
    expect(store.runsForTask(task.id).every((run) => run.phase === "queued")).toBe(true);
    expect(store.snapshot().dispatchCheckpoints[0]).toEqual(expect.objectContaining({ status: "ROLLED_BACK", successfulProviderIds: [], requiresReconciliation: false }));
  });
});

describe("persistent account sessions", () => {
  it("keeps one isolated persistent partition and recognizes guest-ready input", () => {
    const store = newStore();
    const accounts = new AccountSessionManager(store);
    accounts.ensure("gemini");
    accounts.recordProbe("gemini", true, true);
    expect(store.snapshot().accounts[0]).toEqual(expect.objectContaining({ providerId: "gemini", partition: "persist:codex-boss-gemini", persistent: true, mode: "GUEST_READY" }));
  });
});

describe("layout policy styles", () => {
  it("defines vertical thirds and a five-provider six-cell workspace", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src", "renderer", "styles.css"), "utf8");
    expect(css).toContain(".provider-grid.count-3 { grid-template-columns: 1fr; grid-template-rows: repeat(3");
    expect(css).toContain(".layout-five .chat-half { grid-column: 2; grid-row: 1;");
    expect(css).toContain(".layout-five .provider-grid.count-5 .provider-pane:nth-child(5) { grid-column: 3; grid-row: 2;");
  });
});
