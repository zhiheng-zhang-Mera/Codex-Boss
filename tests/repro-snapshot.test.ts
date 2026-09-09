import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReproductionSnapshot, configHash, dependencyLock, validateReproductionSnapshot } from "../electron/repro-snapshot";
import { TaskLedger } from "../electron/commander/task-ledger";
import { MainCommander } from "../electron/commander/main-commander";
import { StateStore } from "../electron/store";
import { RuntimeRegistry } from "../electron/commander/runtime-registry";
import { BudgetManager } from "../electron/commander/budget-manager";
import { RoleRouter } from "../electron/commander/role-router";
import { Scheduler } from "../electron/commander/scheduler";
import { ContextManager } from "../electron/commander/context-manager";
import { ExecutionGate } from "../electron/commander/execution-gate";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-repro-")); dirs.push(dir); return dir; }
function git(dir: string, ...args: string[]) { return execFileSync("git", args, { cwd: dir, windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.test", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.test" }, encoding: "utf8" }).trim(); }

describe("reproducibility snapshot writer", () => {
  it("captures git commit, branch, dirty state, config and lock hashes", async () => {
    const dir = root();
    git(dir, "init");
    git(dir, "config", "user.email", "test@example.test");
    git(dir, "config", "user.name", "test");
    fs.writeFileSync(path.join(dir, "a.txt"), "content");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "base");
    const snapshot = await buildReproductionSnapshot({ workspace: dir, provider: "plan-failed", harness: "codex-boss", contextFingerprint: "fp" });
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.workspace?.gitCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(snapshot.workspace?.dirty).toBe(false);
    expect(snapshot.provider).toBe("plan-failed");
    expect(snapshot.contextFingerprint).toBe("fp");
    // A non-git workspace yields nulls instead of throwing.
    const plain = await buildReproductionSnapshot({ workspace: root() });
    expect(plain.workspace?.gitCommit).toBeUndefined();
  });

  it("hashes shipped config and reports the dependency lock presence", () => {
    const dir = root();
    const configDir = path.join(dir, ".codex-boss", "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "runtime-policy.json"), '{"maxParallel":3,"roles":{}}');
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9");
    const hash = configHash(dir);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(dependencyLock(dir)).toMatchObject({ present: true });
    expect(dependencyLock(dir).hash).toMatch(/^[a-f0-9]{64}$/);
    expect(dependencyLock(root())).toEqual({ present: false, hash: null });
  });

  it("validates fail-closed and stores/restores beside the ledger", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    const snapshot: import("../electron/repro-snapshot").ReproductionSnapshot = { schemaVersion: 1, capturedAt: new Date(0).toISOString(), inputArtifactHashes: ["h1"] };
    ledger.saveReproduction("task", snapshot);
    expect(ledger.loadReproduction("task")).toEqual(snapshot);
    expect(() => validateReproductionSnapshot({ schemaVersion: 2 })).toThrow(/Invalid/);
    fs.writeFileSync(path.join(dir, "task", "repro.json"), JSON.stringify({ schemaVersion: 2 }));
    expect(() => ledger.loadReproduction("task")).toThrow(/Invalid/);
    fs.writeFileSync(path.join(dir, "task", "repro.json"), "corrupt");
    expect(() => ledger.loadReproduction("task")).toThrow();
  });

  it("writes a plan-compile-failed snapshot through the commander", async () => {
    const dir = root();
    const store = new StateStore(path.join(dir, "state.json"));
    const registry = new RuntimeRegistry();
    const budgets = new BudgetManager();
    const ledger = new TaskLedger(path.join(dir, ".boss", "tasks"));
    registry.register({ id: "local:planner", kind: "local", capabilities: { roles: ["planning"], supportsCancellation: true, supportsStreaming: false }, async healthCheck() { return { runtimeId: this.id, availability: "AVAILABLE", message: "ready", checkedAt: "now" }; }, async execute() { return { runtimeId: this.id, jobId: "planner", status: "PERMANENT_FAILURE", failure: { code: "DOWN", message: "no backend", retryable: false } }; } });
    const commander = new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), ledger);
    const task = commander.createTask({ title: "failing", objective: "First compare options then choose a cache policy and write it to a file", providerIds: ["chatgpt"] });
    await expect(commander.executePlan(task.id, dir)).rejects.toThrow();
    const snapshot = ledger.loadReproduction(task.id);
    expect(snapshot?.provider).toBe("plan-compile-failed");
    expect(snapshot?.workspace?.path).toBe(dir);
    expect(snapshot?.contextFingerprint).toBeTruthy();
  });
});
