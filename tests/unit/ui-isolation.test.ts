import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ExecutionSupervisor } from "../../electron/commander/execution-supervisor";
import { TaskLedger } from "../../electron/commander/task-ledger";
import { Scheduler } from "../../electron/commander/scheduler";
import { StateStore } from "../../electron/store";
import type { RuntimeAdapter, RuntimeRequest, RuntimeResult } from "../../electron/runtimes/runtime";

/**
 * Phase I (R-902/R-903): UI isolation + status surfaces. Background tasks never
 * depend on the UI lifecycle (no publish/UI listener is required to run and
 * complete); a later UI reconnect reads the same durable state. The Owner UI
 * strip shows module/provider/node/task/degraded/blocked/recovery status.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-isolation-")); dirs.push(dir); return dir; }

it("R-902: a background task completes with NO UI/subscriber at all; ledger stays authoritative", async () => {
  const dir = root();
  const ledger = new TaskLedger(path.join(dir, "ledger"));
  const runtime: RuntimeAdapter = {
    id: "local:worker", kind: "local", capabilities: { consumesModel: false, roles: ["planner"], supportsCancellation: true, supportsStreaming: false },
    healthCheck: async () => ({ runtimeId: "local:worker", availability: "AVAILABLE", message: "ok", checkedAt: "now" }),
    execute: async (_request: RuntimeRequest) => ({ runtimeId: "local:worker", jobId: "j1", status: "SUCCESS", content: "background result" } as RuntimeResult)
  };
  const supervisor = new ExecutionSupervisor(ledger, new Scheduler());
  // No publish callback, no UI, no renderer: the work still runs to completion.
  const result = await supervisor.execute({ taskId: "t1", jobId: "j1", role: "planner", prompt: "work", replaySafe: true, timeoutMs: 30_000 }, [runtime]);
  expect(result.status).toBe("SUCCESS");
  expect(ledger.load("t1")!.jobs["j1"].state).toBe("COMPLETED");
});

it("R-902/R-903: durable state is readable by a later (re)connect; status fields exist for the strip", async () => {
  const dir = root();
  const file = path.join(dir, ".boss", "state.json");
  const first = new StateStore(file);
  const task = first.createTask("title", "objective", ["chatgpt"], "direct", "chat");
  // A UI that crashed and reconnects reads the same authoritative snapshot.
  const reconnected = new StateStore(file);
  const found = reconnected.snapshot().tasks.find((item) => item.id === task.id);
  expect(found?.title).toBe("title");
  // The Owner strip reads node/providers/tasks/degraded/recovery from snapshot +
  // nodeStatus (see OwnerSummary.tsx) — fields exist on the shared model.
  expect(reconnected.snapshot().tasks[0]).toHaveProperty("status");
  expect(reconnected.snapshot()).toHaveProperty("runtimeStatuses");
  expect(reconnected.snapshot()).toHaveProperty("providers");
});
