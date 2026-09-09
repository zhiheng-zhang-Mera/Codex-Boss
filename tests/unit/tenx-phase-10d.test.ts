/**
 * Phase 10D evidence test: minimal forward Fleet Controller.
 * Registration/deregistration/heartbeat/health/capability inventory/lease/
 * transfer/checkpoint/dropout detection. Scenarios: single node w/o controller;
 * controller restart restores durable state; node offline never fails unrelated
 * tasks; dropout parks recoverable leases + fails replay-unsafe ones honestly.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { controllerNodeStateFor, detectDropouts, planTakeover, isLeaseValid } from "../../src/shared/tenx/fleet";
import { TenxFleetController } from "../../electron/tenx/fleet-controller";

describe("10D pure controller-state derivation", () => {
  it("derives READY→DEGRADED→OFFLINE from heartbeat age; FAILED/DISABLED stick", () => {
    const base = { lastHeartbeatAt: 0, state: "READY" as const };
    expect(controllerNodeStateFor(1_000, base)).toBe("READY");
    expect(controllerNodeStateFor(11_000, base)).toBe("DEGRADED");
    expect(controllerNodeStateFor(31_000, base)).toBe("OFFLINE");
    expect(controllerNodeStateFor(99_000, { lastHeartbeatAt: 0, state: "FAILED" as const })).toBe("FAILED");
    expect(controllerNodeStateFor(99_000, { lastHeartbeatAt: 0, state: "DISABLED" as const })).toBe("DISABLED");
  });

  it("detectDropouts only reports members that newly cross to OFFLINE", () => {
    const members = [
      { nodeId: "a", state: "READY" as const, lastHeartbeatAt: 0 },
      { nodeId: "b", state: "OFFLINE" as const, lastHeartbeatAt: 0 },
      { nodeId: "c", state: "READY" as const, lastHeartbeatAt: 1_000_000 }
    ];
    expect(detectDropouts(31_000, members)).toEqual(["a"]);
  });
});

describe("10D fleet controller", () => {
  it("Scenario 1: node A offline never fails node B's leased task", () => {
    let clock = 0;
    const controller = new TenxFleetController(undefined, () => clock, () => 60_000);
    controller.join("A", ["compute", "web"]);
    controller.join("B", ["compute"]);
    clock += 1_000;
    controller.heartbeat("A");
    controller.heartbeat("B");

    controller.lease("task-1", "A", { takeoverAllowed: true, replaySafety: "replaySafe" });
    controller.lease("task-2", "B", { takeoverAllowed: true, replaySafety: "replaySafe" });

    clock += 40_000; // A misses heartbeats → offline; B still fresh
    controller.heartbeat("B");
    const { dropped } = controller.refreshStates();
    expect(dropped).toEqual(["A"]);
    controller.handleDropout("A"); // detection → handling pipeline

    const leases = controller.listLeases();
    const aLease = leases.find((lease) => lease.taskId === "task-1")!;
    const bLease = leases.find((lease) => lease.taskId === "task-2")!;
    expect(aLease.history.some((entry) => entry.startsWith("owner-dropped:A"))).toBe(true); // A's work parked
    expect(bLease.state).toBe("LEASED"); // B untouched (never parked/FAILED by A's dropout)
    expect(bLease.history.some((entry) => entry.startsWith("owner-dropped"))).toBe(false);
    void isLeaseValid;
  });

  it("Scenario 5: controller restart restores durable members + leases", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenx-10d-"));
    const file = path.join(dir, "fleet.json");
    try {
      let clock = 0;
      const first = new TenxFleetController(file, () => clock, () => 60_000);
      first.join("A", ["compute"]);
      first.join("B", ["gpu"]);
      clock += 1_000;
      first.heartbeat("A");
      first.heartbeat("B");
      first.lease("task-1", "A", { takeoverAllowed: true, replaySafety: "replaySafe" });
      first.checkpoint("task-1", { ref: "cp-1", blob: { step: 2 } });

      // restart
      const second = new TenxFleetController(file, () => clock, () => 60_000);
      expect(second.listMembers().map((member) => member.nodeId).sort()).toEqual(["A", "B"]);
      const restored = second.listLeases().find((lease) => lease.taskId === "task-1")!;
      expect(restored.ownerNode).toBe("A");
      expect(restored.checkpoint?.ref).toBe("cp-1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leases only to online members; capability inventory only lists available nodes", () => {
    const controller = new TenxFleetController(undefined, () => 0, () => 60_000);
    controller.join("A", ["compute"]);
    controller.join("B", ["gpu"]);
    controller.heartbeat("A");
    controller.heartbeat("B");
    expect(controller.lease("t1", "A", { takeoverAllowed: false, replaySafety: "replayUnsafe" })?.ownerNode).toBe("A");
    // B never joined as an owner when offline — deregister then lease attempt fails
    controller.deregister("B");
    expect(controller.lease("t2", "B", { takeoverAllowed: true, replaySafety: "replaySafe" })).toBeUndefined();
    expect(controller.inventory()).toEqual({ A: ["compute"] });
  });

  it("transfer resumes an expired checkpointed lease onto a new node", () => {
    let clock = 0;
    const controller = new TenxFleetController(undefined, () => clock, () => 10_000);
    controller.join("A", ["compute"]);
    controller.join("B", ["compute"]);
    controller.heartbeat("A");
    controller.heartbeat("B");
    controller.lease("t1", "A", { takeoverAllowed: true, replaySafety: "replayUnsafe" });
    controller.checkpoint("t1", { ref: "cp-1", blob: { step: 5 } });
    clock += 11_000; // lease expired

    const result = controller.transfer("t1", "B");
    if (result && "error" in result) {
      throw new Error(`transfer should succeed, got error: ${result.error}`);
    }
    const lease = result;
    expect(lease?.ownerNode).toBe("B");
    expect(lease?.history.some((entry) => entry.includes("transferred:A->B (checkpoint)"))).toBe(true);
    // resume from checkpoint: activate RUNNING for B
    const running = controller.activate("t1");
    expect(running?.state).toBe("RUNNING");
    expect(running?.checkpoint?.blob).toEqual({ step: 5 });
  });

  it("replay-unsafe task without checkpoint fails honestly on dropout (never blind re-run)", () => {
    let clock = 0;
    const controller = new TenxFleetController(undefined, () => clock, () => 60_000);
    controller.join("A", ["compute"]);
    controller.heartbeat("A");
    controller.lease("t1", "A", { takeoverAllowed: true, replaySafety: "replayUnsafe" });
    const affected = controller.handleDropout("A");
    expect(affected.length).toBe(1);
    expect(controller.listLeases()[0].state).toBe("FAILED");
    expect(controller.listLeases()[0].history.some((entry) => entry.includes("replay-unsafe"))).toBe(true);
  });

  it("dropout parks checkpointed takeover-allowed work as QUEUED (no phantom owner)", () => {
    let clock = 0;
    const controller = new TenxFleetController(undefined, () => clock, () => 60_000);
    controller.join("A", ["compute"]);
    controller.heartbeat("A");
    controller.lease("t1", "A", { takeoverAllowed: true, replaySafety: "replayUnsafe" });
    controller.checkpoint("t1", { ref: "cp-1" });
    controller.handleDropout("A");
    const parked = controller.listLeases()[0];
    expect(parked.state).toBe("QUEUED");
    expect(parked.leaseExpiresAt).toBe(0);
    expect(parked.checkpoint?.ref).toBe("cp-1");
  });

  it("takeover-not-allowed lease fails honestly when its only owner drops", () => {
    let clock = 0;
    const controller = new TenxFleetController(undefined, () => clock, () => 60_000);
    controller.join("A", ["compute"]);
    controller.heartbeat("A");
    controller.lease("t1", "A", { takeoverAllowed: false, replaySafety: "replayUnsafe" });
    controller.checkpoint("t1", { ref: "cp-1" });
    controller.handleDropout("A");
    expect(controller.listLeases()[0].state).toBe("FAILED");
    expect(controller.listLeases()[0].history.some((entry) => entry.includes("takeover not allowed"))).toBe(true);
  });

  it("planTakeover rejects valid leases, honors takeoverAllowed and replay safety", () => {
    const expired = { taskId: "t", ownerNode: "A", leaseId: "l", leaseExpiresAt: 0, takeoverAllowed: true, replaySafety: "replaySafe" as const, state: "LEASED" as const, history: [], updatedAt: "" };
    expect(planTakeover(100, expired, "B").allowed).toBe(true);
    const stillValid = { ...expired, leaseExpiresAt: 1000 };
    expect(planTakeover(100, stillValid, "B").allowed).toBe(false);
    expect(planTakeover(100, { ...expired, takeoverAllowed: false }, "B").allowed).toBe(false);
    expect(planTakeover(100, { ...expired, replaySafety: "replayUnsafe" as const }, "B").allowed).toBe(false);
    expect(planTakeover(100, { ...expired, replaySafety: "replayUnsafe" as const, checkpoint: { ref: "cp" } }, "B").allowed).toBe(true);
  });
});
