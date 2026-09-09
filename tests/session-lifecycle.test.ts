import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isSessionLifecycleKind, SESSION_LIFECYCLE_KINDS, sessionKindActive, sessionKindForResumeStrategy, sessionKindLabel, transitionSessionKind } from "../src/shared/session-state";
import { TaskLedger } from "../electron/commander/task-ledger";
import { ProviderSessionRegistry } from "../electron/commander/provider-session-registry";
import { ExecutionSupervisor } from "../electron/commander/execution-supervisor";
import { StateStore } from "../electron/store";
import type { RuntimeAdapter } from "../electron/runtimes/runtime";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-session-lifecycle-")); dirs.push(dir); return dir; }

describe("session lifecycle kinds", () => {
  it("exposes the fixed kind vocabulary and labels", () => {
    expect(SESSION_LIFECYCLE_KINDS).toEqual(["NEW", "CONTINUE", "FORK", "REVIEW", "ARCHIVED"]);
    expect(sessionKindLabel("REVIEW")).toBeTruthy();
    expect(sessionKindActive("ARCHIVED")).toBe(false);
    expect(sessionKindActive("CONTINUE")).toBe(true);
    for (const kind of SESSION_LIFECYCLE_KINDS) expect(isSessionLifecycleKind(kind)).toBe(true);
    expect(isSessionLifecycleKind("OTHER")).toBe(false);
  });

  it("validates allowed transitions and rejects invalid ones", () => {
    expect(transitionSessionKind("NEW", "CONTINUE")).toBe("CONTINUE");
    expect(transitionSessionKind("NEW", "FORK")).toBe("FORK");
    expect(transitionSessionKind("CONTINUE", "REVIEW")).toBe("REVIEW");
    expect(transitionSessionKind("REVIEW", "ARCHIVED")).toBe("ARCHIVED");
    expect(transitionSessionKind("CONTINUE", "ARCHIVED")).toBe("ARCHIVED");
    expect(() => transitionSessionKind("NEW", "ARCHIVED")).not.toThrow();
    expect(() => transitionSessionKind("ARCHIVED", "CONTINUE")).toThrow(/Invalid session transition/);
    expect(() => transitionSessionKind("FORK", "NEW")).toThrow(/Invalid session transition/);
  });

  it("derives the lifecycle kind from the resume strategy", () => {
    expect(sessionKindForResumeStrategy("RECONSTRUCT")).toBe("NEW");
    expect(sessionKindForResumeStrategy("RESTORE_URL")).toBe("CONTINUE");
    expect(sessionKindForResumeStrategy("EXPLICIT_SESSION")).toBe("CONTINUE");
  });
});

describe("provider session registry lifecycle", () => {
  it("creates NEW sessions, continues on reuse and archives on request", () => {
    const ledger = new TaskLedger(root());
    ledger.create("task", "objective");
    const registry = new ProviderSessionRegistry(ledger);
    const created = registry.sessionFor("task", "api:x", "ws-fingerprint");
    expect(created.kind).toBe("NEW");
    expect(created.workspaceId).toBe("ws-fingerprint");
    const again = registry.sessionFor("task", "api:x", "ws-fingerprint");
    expect(again.kind).toBe("NEW"); // no explicit transition request yet
    const continued = registry.sessionFor("task", "api:x", "ws-fingerprint", "CONTINUE");
    expect(continued.kind).toBe("CONTINUE");
    expect(() => registry.sessionFor("task", "api:x", undefined, "NEW")).toThrow(/Invalid session transition/); // CONTINUE -> NEW invalid
    const archived = registry.archive("task", created.id);
    expect(archived?.kind).toBe("ARCHIVED");
  });

  it("persists lifecycle kind and workspace binding across reload", () => {
    const dir = root();
    const ledger = new TaskLedger(dir);
    ledger.create("task", "objective");
    new ProviderSessionRegistry(ledger).sessionFor("task", "web:chatgpt", "ws-1");
    const restored = new TaskLedger(dir).load("task");
    expect(restored?.sessions[0].kind).toBe("NEW");
    expect(restored?.sessions[0].workspaceId).toBe("ws-1");
  });
});

describe("execution supervisor session lifecycle integration", () => {
  function worker(execute: RuntimeAdapter["execute"], id = "api:x"): RuntimeAdapter {
    return { id, kind: "api", capabilities: { roles: ["coding"], supportsCancellation: true, supportsStreaming: false }, execute, async healthCheck() { return { runtimeId: id, availability: "AVAILABLE", message: "ok", checkedAt: "now" }; } };
  }

  it("creates a NEW session and binds the workspace when running a step", async () => {
    const ledger = new TaskLedger(path.join(root(), "tasks"));
    const runtime = worker(async (item) => ({ runtimeId: "api:x", jobId: item.jobId, status: "SUCCESS", content: "ok" }));
    await new ExecutionSupervisor(ledger).execute({ taskId: "task", jobId: "job", role: "coding", prompt: "work", replaySafe: true }, [runtime]);
    const record = ledger.load("task");
    expect(record?.sessions).toHaveLength(1);
    expect(record?.sessions[0].kind).toBe("NEW");
    expect(record?.sessions[0].provider).toBe("api:x");
  });

  it("marks a reused provider session CONTINUE on a second step", async () => {
    const ledger = new TaskLedger(path.join(root(), "tasks"));
    const runtime = worker(async (item) => ({ runtimeId: "api:x", jobId: item.jobId, status: "SUCCESS", content: "ok" }));
    const supervisor = new ExecutionSupervisor(ledger);
    await supervisor.execute({ taskId: "task", jobId: "job1", role: "coding", prompt: "work", replaySafe: true }, [runtime]);
    await supervisor.execute({ taskId: "task", jobId: "job2", role: "coding", prompt: "more", replaySafe: true }, [runtime]);
    const sessions = ledger.load("task")!.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].kind).toBe("CONTINUE");
    expect(ledger.load("task")!.jobs["job2"].state).toBe("COMPLETED");
  });
});

describe("store ledger mirror binds session kind", () => {
  it("mirrors a RESTORE_URL run as a CONTINUE session with workspace binding", () => {
    const dir = root();
    const store = new StateStore(path.join(dir, "state.json"));
    const task = store.createTask("t", "question", ["chatgpt"], "direct", "work", { chatgpt: "web" });
    store.setTaskWorkspace(task.id, "ws-path");
    store.setRunSession(store.runsForTask(task.id)[0].id, "baseline", "https://chatgpt.com/c/existing");
    store.captureArtifact(store.runsForTask(task.id)[0].id, "answer", "https://chatgpt.com/c/existing");
    const ledger = new TaskLedger(path.join(dir, ".boss", "tasks")).load(task.id);
    const session = ledger?.sessions.find((item) => item.provider === "web:chatgpt");
    expect(session?.kind).toBe("CONTINUE");
    expect(session?.workspaceId).toBeTruthy();
  });
});
