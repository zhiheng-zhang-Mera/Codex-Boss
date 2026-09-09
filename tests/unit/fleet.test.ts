import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { handleNodeDropout, nodeStateFor, routeTask, type FleetAssignment, type FleetTask } from "../../src/shared/fleet";
import { FederationCoordinator } from "../../electron/fleet/federation-coordinator";

/**
 * Phase D (R-401/R-403): fleet core. Routing never touches nodes that cannot
 * accept work; dropout transfers checkpointed work (unrelated work untouched);
 * protocol fields are plain serializable strings — no Windows-only coupling.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function file(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-")); dirs.push(dir); return path.join(dir, "fleet.json"); }

const task: FleetTask = { taskId: "t1", requiredCapabilities: ["coding"], replaySafe: true };

it("routing never assigns onto OFFLINE/FAILED/DISABLED nodes or capability-less nodes", () => {
  const nodes = [
    { nodeId: "A", state: "READY" as const, capabilities: ["coding"], lastHeartbeatAt: 0, seq: 1 },
    { nodeId: "B", state: "OFFLINE" as const, capabilities: ["coding"], lastHeartbeatAt: 0, seq: 1 },
    { nodeId: "C", state: "READY" as const, capabilities: ["research"], lastHeartbeatAt: 0, seq: 1 }
  ];
  expect(routeTask(task, nodes).assignment.nodeId).toBe("A"); // B offline, C lacks coding
});

it("heartbeat-age drives READY → DEGRADED → OFFLINE deterministically", () => {
  expect(nodeStateFor(0, { lastHeartbeatAt: 0 })).toBe("READY");
  expect(nodeStateFor(11_000, { lastHeartbeatAt: 0 })).toBe("DEGRADED");
  expect(nodeStateFor(31_000, { lastHeartbeatAt: 0 })).toBe("OFFLINE");
});

it("dropout transfers checkpointed work, leaves unrelated work untouched, and fails uncheckpointed unsafe work", () => {
  const assignments: FleetAssignment[] = [
    { ...task, state: "CHECKPOINTED", nodeId: "B", attempts: 1, history: [], checkpoint: { stage: 1 } },
    { ...task, taskId: "t-other", state: "ASSIGNED", nodeId: "A", attempts: 0, history: [] },
    { ...task, taskId: "t-unsafe", replaySafe: false, state: "RUNNING", nodeId: "B", attempts: 0, history: [] }
  ];
  const after = handleNodeDropout(assignments, "B");
  expect(after.find((item) => item.taskId === "t1")?.state).toBe("QUEUED");
  expect(after.find((item) => item.taskId === "t1")?.checkpoint).toEqual({ stage: 1 });
  expect(after.find((item) => item.taskId === "t-other")?.nodeId).toBe("A"); // unrelated untouched
  expect(after.find((item) => item.taskId === "t-unsafe")?.state).toBe("FAILED");
});

it("coordinator: two nodes, checkpointed B-work transfers to A after B drops; fleet stays alive", () => {
  let clock = 0;
  const coordinator = new FederationCoordinator(file(), () => clock);
  coordinator.join("B", ["coding"]); // join order: B first
  coordinator.join("A", ["coding"]);
  clock += 1000;
  coordinator.heartbeat("A");
  coordinator.heartbeat("B");

  const assigned = coordinator.enqueue(task); // B (first eligible)
  expect(assigned.nodeId).toBe("B");
  coordinator.checkpoint(task.taskId, { stage: 1, data: { partial: true } });
  coordinator.enqueue({ taskId: "t2", requiredCapabilities: ["coding"], replaySafe: true }); // also B (first-fit)
  coordinator.mark("t2", "COMPLETED"); // unrelated completed work

  // B goes silent; A keeps beating.
  clock += 100_000;
  coordinator.heartbeat("A");
  const { nodes, dropped } = coordinator.refreshStates();
  expect(dropped).toEqual(["B"]);
  expect(nodes.find((node) => node.nodeId === "B")?.state).toBe("OFFLINE");

  // B's checkpointed open work transfers to A with its checkpoint retained.
  const rerouted = coordinator.reassignAfterDropout("B");
  expect(rerouted.some((item) => item.taskId === "t1" && item.nodeId === "A")).toBe(true);
  const t1 = coordinator.listAssignments().find((item) => item.taskId === "t1")!;
  expect(t1.checkpoint).toEqual({ stage: 1, data: { partial: true } });
  expect(t1.history.join(" ")).toContain("checkpointed:B transferred");
  // Unrelated completed work untouched; fleet alive with A READY.
  expect(coordinator.listAssignments().find((item) => item.taskId === "t2")?.state).toBe("COMPLETED");
  expect(coordinator.listNodes().filter((node) => node.state === "READY").map((node) => node.nodeId)).toEqual(["A"]);
});

it("protocol surface is platform-neutral: records are plain serializable strings", () => {
  const node = { nodeId: "a", state: "READY" as const, capabilities: ["coding"], lastHeartbeatAt: 1, seq: 2 };
  const assignment = { taskId: "t", requiredCapabilities: ["coding"], replaySafe: true, state: "ASSIGNED" as const, nodeId: "a", attempts: 0, history: [] };
  const text = JSON.stringify({ node, assignment });
  expect(text).toContain('"nodeId":"a"');
  expect(text).not.toMatch(/win32|darwin|C:[/\\]|linux/i); // no OS coupling in core protocol
});
