/**
 * Phase 10E evidence test: task lease & ownership.
 * One valid owner per task; lease timeout → takeover from durable checkpoint;
 * replay-unsafe never blindly re-run; legally-transferred task can never be
 * reclaimed by the old owner; durable restart restore.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canReplay, isLeaseValid, planTakeover, wasLegallyTransferred, type TaskLeaseState } from "../../src/shared/tenx/fleet";
import { TenxTaskLeaseRegistry } from "../../electron/tenx/task-lease-registry";

describe("10E pure lease rules", () => {
  it("lease validity is purely time-based", () => {
    expect(isLeaseValid({ leaseExpiresAt: 100 }, 99)).toBe(true);
    expect(isLeaseValid({ leaseExpiresAt: 100 }, 100)).toBe(false);
  });

  it("replay safety: replayUnsafe needs a durable checkpoint", () => {
    expect(canReplay({ replaySafety: "replaySafe", checkpoint: undefined })).toBe(true);
    expect(canReplay({ replaySafety: "replayUnsafe", checkpoint: { ref: "cp" } })).toBe(true);
    expect(canReplay({ replaySafety: "replayUnsafe", checkpoint: undefined })).toBe(false);
    expect(canReplay({ replaySafety: "unknown", checkpoint: undefined })).toBe(false);
  });

  it("planTakeover gates expiry/takeoverAllowed/replay-safety", () => {
    const base: TaskLeaseState = { taskId: "t", ownerNode: "A", leaseId: "l", leaseExpiresAt: 0, takeoverAllowed: true, replaySafety: "replaySafe", state: "LEASED", history: [], updatedAt: "" };
    expect(planTakeover(100, base, "B").allowed).toBe(true);
    expect(planTakeover(100, { ...base, leaseExpiresAt: 500 }, "B").allowed).toBe(false);
    expect(planTakeover(100, { ...base, takeoverAllowed: false }, "B").allowed).toBe(false);
    expect(planTakeover(100, { ...base, replaySafety: "replayUnsafe" }, "B").allowed).toBe(false);
    expect(planTakeover(100, { ...base, replaySafety: "replayUnsafe", checkpoint: { ref: "cp" } }, "B").allowed).toBe(true);
  });

  it("wasLegallyTransferred reads transfer lineage from history", () => {
    const lease: TaskLeaseState = { taskId: "t", ownerNode: "B", leaseId: "l", leaseExpiresAt: 0, takeoverAllowed: true, replaySafety: "replaySafe", state: "TRANSFERRED", history: ["leased:A", "transferred:A->B (checkpoint)"], updatedAt: "" };
    expect(wasLegallyTransferred(lease, "A")).toBe(true);
    expect(wasLegallyTransferred(lease, "C")).toBe(false);
  });
});

describe("10E durable lease registry", () => {
  it("enforces exactly one valid owner per task", () => {
    let clock = 0;
    const registry = new TenxTaskLeaseRegistry(undefined, () => clock, 10_000);
    expect(registry.lease("t1", "A", { takeoverAllowed: true, replaySafety: "replaySafe" }).ok).toBe(true);
    const second = registry.lease("t1", "B", { takeoverAllowed: true, replaySafety: "replaySafe" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain("already leased");
  });

  it("lease expires → takeover resumes from the durable checkpoint", () => {
    let clock = 0;
    const registry = new TenxTaskLeaseRegistry(undefined, () => clock, 10_000);
    registry.lease("t1", "A", { takeoverAllowed: true, replaySafety: "replayUnsafe" });
    registry.checkpoint("t1", "cp-7", { step: 3 });
    expect(registry.get("t1")?.state).toBe("CHECKPOINTED");
    clock = 11_000; // lease expired
    const result = registry.takeover("t1", "B");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lease.ownerNode).toBe("B");
      expect(result.lease.checkpoint?.ref).toBe("cp-7");
      expect(result.lease.history.some((entry) => entry.includes("transferred:A->B (checkpoint)"))).toBe(true);
    }
  });

  it("a recovered old owner can never reclaim a legally transferred task", () => {
    let clock = 0;
    const registry = new TenxTaskLeaseRegistry(undefined, () => clock, 10_000);
    registry.lease("t1", "A", { takeoverAllowed: true, replaySafety: "replaySafe" });
    clock = 11_000;
    registry.takeover("t1", "B");
    // A comes back, its old lease is gone; A asks to take over its former task.
    registry.complete("t1"); // task finished on B (lease now COMPLETED)
    // create fresh scenario: transfer then A tries reclaim while task still active on B
    let clock2 = 0;
    const reg2 = new TenxTaskLeaseRegistry(undefined, () => clock2, 10_000);
    reg2.lease("t2", "A", { takeoverAllowed: true, replaySafety: "replaySafe" });
    clock2 = 11_000;
    reg2.takeover("t2", "B");
    expect(reg2.get("t2")?.ownerNode).toBe("B");
    // A attempts a new takeover of t2 (its previous owner node) after lease to B expires
    clock2 = 22_000;
    const reclaim = reg2.takeover("t2", "A");
    expect(reclaim.ok).toBe(false);
    if (!reclaim.ok) expect(reclaim.reason).toContain("may not reclaim");
  });

  it("durable restart restores leases and checkpoint refs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10e-"));
    const file = path.join(dir, "leases.json");
    try {
      let clock = 0;
      const first = new TenxTaskLeaseRegistry(file, () => clock, 10_000);
      first.lease("t1", "A", { takeoverAllowed: true, replaySafety: "replayUnsafe" });
      first.checkpoint("t1", "cp-1", { step: 9 });
      const second = new TenxTaskLeaseRegistry(file, () => clock, 10_000);
      const restored = second.get("t1")!;
      expect(restored.ownerNode).toBe("A");
      expect(restored.checkpoint?.ref).toBe("cp-1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("single-node usage works with no fleet controller present", () => {
    const registry = new TenxTaskLeaseRegistry(undefined, () => 0, 10_000);
    const leased = registry.lease("local-1", "node-a", { takeoverAllowed: false, replaySafety: "replaySafe" });
    expect(leased.ok).toBe(true);
    if (leased.ok) {
      registry.markRunning("local-1");
      registry.complete("local-1");
      expect(registry.get("local-1")?.state).toBe("COMPLETED");
    }
  });
});
