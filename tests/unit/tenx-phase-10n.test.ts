/**
 * Phase 10N evidence test: session lifecycle vNext.
 * TEMPORARY/REUSABLE/PERSISTENT/AUTO_DELETE; default TEMPORARY for autonomous
 * tasks unless long-lived context requested; bounded pool; stale reaping;
 * deterministic GC suggestion; durable restart.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decideSessionKind, reapableWhenStale, staleSessions, suggestPoolGc } from "../../src/shared/tenx/session";
import { TenxSessionLifecycle } from "../../electron/tenx/session-lifecycle";

const at = "2026-09-10T00:00:00.000Z";

describe("10N pure session policy", () => {
  it("defaults long autonomous tasks to TEMPORARY; interactive to REUSABLE; long-lived to PERSISTENT", () => {
    expect(decideSessionKind({ taskKind: "autonomous" }).kind).toBe("TEMPORARY");
    expect(decideSessionKind({ taskKind: "interactive" }).kind).toBe("REUSABLE");
    expect(decideSessionKind({ taskKind: "autonomous", longLivedContextRequired: true }).kind).toBe("PERSISTENT");
  });

  it("only TEMPORARY/AUTO_DELETE are reapable when stale", () => {
    expect(reapableWhenStale("TEMPORARY")).toBe(true);
    expect(reapableWhenStale("AUTO_DELETE")).toBe(true);
    expect(reapableWhenStale("REUSABLE")).toBe(false);
    expect(reapableWhenStale("PERSISTENT")).toBe(false);
  });

  it("staleSessions selects oldest inactive reapable sessions past max age", () => {
    const records = [
      { sessionId: "a", provider: "p1", kind: "TEMPORARY" as const, lastUsedAt: "2026-09-01T00:00:00.000Z", createdAt: at, active: false },
      { sessionId: "b", provider: "p1", kind: "PERSISTENT" as const, lastUsedAt: "2026-09-01T00:00:00.000Z", createdAt: at, active: false },
      { sessionId: "c", provider: "p1", kind: "AUTO_DELETE" as const, lastUsedAt: "2026-09-09T23:59:00.000Z", createdAt: at, active: false }
    ];
    const stale = staleSessions(records, "2026-09-10T00:00:00.000Z", 24 * 60 * 60 * 1000);
    expect(stale.map((record) => record.sessionId)).toEqual(["a"]);
  });

  it("suggestPoolGc returns oldest reapable drops when over the bound", () => {
    const records = ["1", "2", "3"].map((id, index) => ({ sessionId: id, provider: "p", kind: "TEMPORARY" as const, lastUsedAt: `2026-09-0${index + 1}T00:00:00.000Z`, createdAt: at, active: false }));
    const gc = suggestPoolGc(records, 2);
    expect(gc.overflow).toBe(1);
    expect(gc.suggestDropIds).toEqual(["1"]);
  });
});

describe("10N durable lifecycle manager", () => {
  it("opens a TEMPORARY session for autonomous tasks and tracks the decision", () => {
    const manager = new TenxSessionLifecycle(undefined, () => at, 1000, 8);
    const { session, decision } = manager.open("p1", { taskKind: "autonomous" });
    expect(session.kind).toBe("TEMPORARY");
    expect(decision.kind).toBe("TEMPORARY");
    expect(manager.count()).toBe(1);
  });

  it("long-lived tasks get PERSISTENT sessions that reaping never touches", () => {
    const manager = new TenxSessionLifecycle(undefined, () => at, -1, 8); // stale after negative ⇒ everything stale
    const { session } = manager.open("p1", { taskKind: "autonomous", longLivedContextRequired: true });
    manager.release(session.sessionId);
    const { removed } = manager.reap();
    expect(removed).toEqual([]); // PERSISTENT never reaped
    expect(manager.list("p1").length).toBe(1);
  });

  it("reaps inactive stale TEMPORARY/AUTO_DELETE sessions", () => {
    let clock = "2026-09-10T00:00:00.000Z";
    const manager = new TenxSessionLifecycle(undefined, () => clock, 1000, 8);
    const t1 = manager.open("p1", { taskKind: "autonomous" }).session; // TEMPORARY
    manager.release(t1.sessionId);
    clock = "2026-09-10T00:00:05.000Z";
    const { removed } = manager.reap();
    expect(removed).toContain(t1.sessionId);
  });

  it("bounds the pool deterministically (oldest reapable dropped)", () => {
    const manager = new TenxSessionLifecycle(undefined, () => at, 1000, 2);
    const s1 = manager.open("p1", { taskKind: "autonomous" }).session;
    manager.release(s1.sessionId);
    const s2 = manager.open("p1", { taskKind: "autonomous" }).session;
    manager.release(s2.sessionId);
    const third = manager.open("p1", { taskKind: "autonomous" }).session;
    expect(manager.count()).toBeLessThanOrEqual(2);
    expect(manager.list().some((session) => session.sessionId === s1.sessionId)).toBe(false); // oldest dropped
    void third;
  });

  it("durable restart restores the pool", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10n-"));
    const file = path.join(dir, "sessions.json");
    try {
      const first = new TenxSessionLifecycle(file, () => at, 1000, 8);
      first.open("p1", { taskKind: "autonomous" });
      const second = new TenxSessionLifecycle(file, () => at, 1000, 8);
      expect(second.count()).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
