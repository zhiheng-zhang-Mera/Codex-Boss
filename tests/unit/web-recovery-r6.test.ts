import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { WebRecovery, type WebRecoveryRepair } from "../../electron/commander/web-recovery";
import { RecoveryScheduler } from "../../electron/commander/recovery-scheduler";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { StateStore } from "../../electron/store";
import type { ProviderAutomation } from "../../electron/provider-automation";
import type { ProviderViews } from "../../electron/provider-views";

/**
 * P0-6 R6 slot (§26/§28): the WebRecovery RETRY_UNSENT ladder consults a
 * guarded Computer-Use repair hook ONLY when the failing send/input classifies
 * as a CU_REPAIR need. REPAIRED → the retried dispatch proceeds; NEEDS_HUMAN /
 * FAILED → the task pauses honestly (never an auto re-send over an unverified
 * page); no hook / non-CU failure → the legacy path is byte-identical.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-web-r6-")); dirs.push(dir); return dir; }

interface Env {
  store: StateStore;
  queue: RecoveryScheduler;
  dispatchCalls: () => number;
  repairCalls: () => number;
  recover: () => Promise<void>;
}

function makeEnv(message: string, repair?: WebRecoveryRepair): Env {
  const dir = root();
  const store = new StateStore(path.join(dir, ".boss", "state.json"));
  const task = store.createTask("r6 task", "task needing work capability", ["chatgpt"], "direct", "chat");
  const run = store.runsForTask(task.id)[0];
  store.updateRun(run.id, "prepared", null, message);

  const probe = { loginLikely: false, rateLimited: false, sourceUrl: "https://chatgpt.com/" };
  const view = {
    webContents: {
      isCrashed: () => false,
      loadURL: async () => undefined,
      executeJavaScript: async () => probe
    }
  };
  let dispatchCalls = 0;
  let repairCalls = 0;
  const wrappedRepair: WebRecoveryRepair | undefined = repair ? async (input) => { repairCalls++; return repair(input); } : undefined;
  const views = { get: () => view, close: () => undefined, open: () => view };
  const automation = {
    dispatchTask: async () => { dispatchCalls++; },
    resumePending: async () => undefined
  };
  const provider = () => ({ id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", accent: "#6ee7b7", windowOpen: true, isCustom: false });
  const queue = new RecoveryScheduler(path.join(dir, "recovery.json"));
  const recovery = new WebRecovery(store, views as unknown as ProviderViews, () => automation as unknown as ProviderAutomation, provider, queue, new BudgetManager(), wrappedRepair);
  return {
    store,
    queue,
    dispatchCalls: () => dispatchCalls,
    repairCalls: () => repairCalls,
    recover: async () => {
      recovery.defer(run, "RETRY_UNSENT", Date.now());
      await queue.runDue(Date.now() + 100);
    }
  };
}

it("R6: a CU_REPAIR failure with a REPAIRED hook proceeds to the retried dispatch once", async () => {
  const env = makeEnv("send button not found", async () => ({ status: "REPAIRED" as const, message: "send control repaired via Computer Use" }));
  await env.recover();
  expect(env.repairCalls()).toBe(1);
  expect(env.dispatchCalls()).toBe(1);
  expect(env.queue.list()).toHaveLength(0); // recovery completed
});

it("R6: NEEDS_HUMAN repair verdict pauses the task and never re-dispatches", async () => {
  const env = makeEnv("send button not found", async () => ({ status: "NEEDS_HUMAN" as const, message: "发送控件需人工确认" }));
  const taskId = env.store.snapshot().tasks[0].id;
  await env.recover();
  expect(env.repairCalls()).toBe(1);
  expect(env.dispatchCalls()).toBe(0);
  const task = env.store.snapshot().tasks.find((item) => item.id === taskId)!;
  expect(task.recoveryMessage ?? "").toContain("人工");
  expect(env.queue.list().some((record) => record.state === "PAUSED" && (record.error ?? "").includes("人工"))).toBe(true);
});

it("R6: FAILED repair verdict pauses honestly (no auto re-send over an unverified page)", async () => {
  const env = makeEnv("找不到发送按钮", async () => ({ status: "FAILED" as const, message: "Computer-Use 修复步骤失败" }));
  const taskId = env.store.snapshot().tasks[0].id;
  await env.recover();
  expect(env.dispatchCalls()).toBe(0);
  expect(env.store.snapshot().tasks.find((item) => item.id === taskId)!.recoveryMessage ?? "").toContain("Computer-Use");
});

it("R6: without a repair hook the CU_REPAIR failure keeps the legacy retry path", async () => {
  const env = makeEnv("send button not found");
  await env.recover();
  expect(env.repairCalls()).toBe(0);
  expect(env.dispatchCalls()).toBe(1); // byte-identical legacy behavior
});

it("R6: a non-CU failure (e.g. provider timeout) never invokes the repair hook", async () => {
  const env = makeEnv("provider timed out", async () => ({ status: "REPAIRED" as const }));
  await env.recover();
  expect(env.repairCalls()).toBe(0);
  expect(env.dispatchCalls()).toBe(1);
});
