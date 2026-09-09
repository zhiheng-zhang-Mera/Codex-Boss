import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { conversationPolicyFor, isConversationPolicy } from "../../src/shared/conversation-policy";
import { StateStore } from "../../electron/store";
import { MainCommander } from "../../electron/commander/main-commander";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { RoleRouter } from "../../electron/commander/role-router";
import { Scheduler } from "../../electron/commander/scheduler";
import { ContextManager } from "../../electron/commander/context-manager";
import { ExecutionGate } from "../../electron/commander/execution-gate";
import { TaskLedger } from "../../electron/commander/task-ledger";

/**
 * R-204: conversation policy. Deterministic defaults keep behavior stable
 * (chat ⇒ PERSISTENT; automated WORK fresh conversation ⇒ TEMPORARY), and an
 * explicit policy (TEMPORARY / REUSABLE / PERSISTENT / AUTO_DELETE) is
 * selectable per task and persisted durably.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-policy-")); dirs.push(dir); return dir; }

it("deterministic defaults: fresh automated conversation ⇒ TEMPORARY; chat ⇒ PERSISTENT; resume ⇒ REUSABLE", () => {
  expect(conversationPolicyFor({ appMode: "work", freshWebConversation: true })).toBe("TEMPORARY");
  expect(conversationPolicyFor({ appMode: "chat" })).toBe("PERSISTENT");
  expect(conversationPolicyFor({ resumeConversation: true })).toBe("REUSABLE");
  expect(isConversationPolicy("AUTO_DELETE")).toBe(true);
  expect(isConversationPolicy("PERSISTENT")).toBe(true);
  expect(isConversationPolicy("nope")).toBe(false);
});

it("createTask persists the deterministic default per mode (chat PERSISTENT / work TEMPORARY)", () => {
  const dir = root();
  const store = new StateStore(path.join(dir, ".boss", "state.json"));
  const registry = new RuntimeRegistry();
  const budgets = new BudgetManager();
  const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
  const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);

  const chat = commander.createTask({ title: "chat", objective: "ask", providerIds: ["chatgpt"], appMode: "chat" });
  expect(chat.conversationPolicy).toBe("PERSISTENT");

  const work = commander.createTask({ title: "work", objective: "task", providerIds: ["chatgpt"], appMode: "work" });
  expect(work.conversationPolicy).toBe("TEMPORARY");

  const explicit = commander.createTask({ title: "bulk", objective: "task", providerIds: ["chatgpt"], appMode: "work", conversationPolicy: "AUTO_DELETE" });
  expect(explicit.conversationPolicy).toBe("AUTO_DELETE");

  // Durable across a store reload.
  const reloaded = new StateStore(path.join(dir, ".boss", "state.json"));
  expect(reloaded.snapshot().tasks.find((item) => item.id === work.id)?.conversationPolicy).toBe("TEMPORARY");
  expect(reloaded.snapshot().tasks.find((item) => item.id === explicit.id)?.conversationPolicy).toBe("AUTO_DELETE");
});
