import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_ID, SCRATCH_WORKSPACE_ID } from "../src/shared/workspace";
import { WorkspaceRegistry } from "../electron/workspace/workspace-registry";
import { StateStore } from "../electron/store";
import { TaskLedger } from "../electron/commander/task-ledger";
import { RuntimeRegistry } from "../electron/commander/runtime-registry";
import { BudgetManager } from "../electron/commander/budget-manager";
import { RoleRouter } from "../electron/commander/role-router";
import { Scheduler } from "../electron/commander/scheduler";
import { ContextManager } from "../electron/commander/context-manager";
import { ExecutionGate } from "../electron/commander/execution-gate";
import { MainCommander } from "../electron/commander/main-commander";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-workspace-")); dirs.push(dir); return dir; }

describe("workspace registry + resolver", () => {
  it("creates multiple workspaces and shims default + scratch", () => {
    const file = path.join(root(), "workspaces.json");
    const registry = new WorkspaceRegistry(file);
    registry.ensureShims("C:/repo");
    expect(registry.get(DEFAULT_WORKSPACE_ID)?.repositories).toEqual(["C:/repo"]);
    expect(registry.get(SCRATCH_WORKSPACE_ID)).toBeDefined();
    registry.create({ name: "Project A", repositories: ["C:/repoA"] });
    registry.create({ name: "Project B", repositories: ["C:/repoB"] });
    expect(registry.list().map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID, SCRATCH_WORKSPACE_ID, "project-a", "project-b"]);
    expect(new WorkspaceRegistry(file).list()).toHaveLength(4); // persisted
  });

  it("resolves a path to the most specific repository workspace", () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, "repoB"), { recursive: true });
    const registry = new WorkspaceRegistry(path.join(root(), "workspaces.json"));
    registry.ensureShims(dir);
    registry.create({ id: "project-b", name: "Project B", repositories: [path.join(dir, "repoB")] });
    const resolved = registry.resolveForPath(path.join(dir, "repoB", "src"));
    expect(resolved.id).toBe("project-b");
    // A path outside any registered repository resolves to the default shim.
    expect(registry.resolveForPath(dir).id).toBe(DEFAULT_WORKSPACE_ID);
  });

  it("supports an active workspace and rejects unknown ids", () => {
    const file = path.join(root(), "workspaces.json");
    const registry = new WorkspaceRegistry(file);
    registry.ensureShims();
    registry.create({ id: "active-one", name: "Active" });
    registry.setActive("active-one");
    expect(registry.activeWorkspaceId()).toBe("active-one");
    expect(() => registry.setActive("missing")).toThrow(/Unknown workspace/);
    fs.writeFileSync(file, JSON.stringify({ schema_version: 9 }));
    expect(() => new WorkspaceRegistry(file).list()).toThrow(/Invalid/);
  });
});

describe("task workspace binding", () => {
  function makeCommander(dir: string, withRegistry: boolean) {
    const store = new StateStore(path.join(dir, "state.json"));
    const registry = new RuntimeRegistry();
    const budgets = new BudgetManager();
    const ledgerPath = path.join(dir, ".boss", "tasks");
    const workspaces = withRegistry ? new WorkspaceRegistry(path.join(dir, ".boss", "workspaces.json")) : undefined;
    workspaces?.ensureShims();
    return { store, commander: new MainCommander(store, registry, new Scheduler(), new RoleRouter(registry, budgets), budgets, new ContextManager(), new ExecutionGate(), withRegistry ? new TaskLedger(ledgerPath) : undefined, undefined, undefined, {}, undefined, undefined, workspaces) };
  }

  it("binds every task to the default workspace when a registry is configured", () => {
    const dir = root();
    const { store, commander } = makeCommander(dir, true);
    const task = commander.createTask({ title: "t", objective: "hello", providerIds: ["chatgpt"] });
    expect(store.snapshot().tasks.find((item) => item.id === task.id)?.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
  });

  it("leaves workspaceId unset (compat shim) when no registry is configured", () => {
    const dir = root();
    const { store, commander } = makeCommander(dir, false);
    const task = commander.createTask({ title: "t", objective: "hello", providerIds: ["chatgpt"] });
    expect(store.snapshot().tasks.find((item) => item.id === task.id)?.workspaceId).toBeUndefined();
  });
});
