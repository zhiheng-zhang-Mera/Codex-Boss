import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { FederationCoordinator } from "../../electron/fleet/federation-coordinator";

/**
 * Phase D (R-402 / Scenario C): a two-node fleet — both nodes are independent
 * fleet participants (separate capability manifests, separate heartbeats,
 * independent task execution) under one coordinator. Node-B drops MID-RUN after
 * checkpointing; the fleet stays online, Node-A takes over B's checkpointed
 * work (and its other queued work), and unrelated completed work is untouched.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function file(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet2-")); dirs.push(dir); return path.join(dir, "fleet.json"); }

it("two-node joint run: Node-B drops mid-run after a checkpoint; Node-A resumes its work; unrelated work continues; fleet stays alive", async () => {
  let clock = 1000;
  const coordinator = new FederationCoordinator(file(), () => clock);

  // Node-A and Node-B join as independent fleet participants (B joined first so
  // coding first-fit lands on B; A additionally carries research).
  coordinator.join("node-B", ["coding"]);
  coordinator.join("node-A", ["coding", "research"]);
  clock += 1000;
  coordinator.heartbeat("node-A");
  coordinator.heartbeat("node-B");

  // Joint run: two nodes each get work (B first-fit for coding).
  const tA = coordinator.enqueue({ taskId: "task-A-unrelated", requiredCapabilities: ["research"], replaySafe: true });
  expect(tA.nodeId).toBe("node-A");
  coordinator.mark("task-A-unrelated", "COMPLETED"); // A finishes its own task before the dropout

  const tB = coordinator.enqueue({ taskId: "task-B", requiredCapabilities: ["coding"], replaySafe: true });
  expect(tB.nodeId).toBe("node-B"); // B picked first for coding
  // B makes progress and checkpoints mid-run.
  coordinator.checkpoint("task-B", { stage: "analysis", data: { partial: { n: 2 } } });

  // ... and then B goes silent (drops) while A keeps beating.
  clock += 100_000;
  coordinator.heartbeat("node-A");
  const { dropped } = coordinator.refreshStates();
  expect(dropped).toEqual(["node-B"]);
  expect(coordinator.listNodes().find((node) => node.nodeId === "node-B")?.state).toBe("OFFLINE");

  // Fleet stays online; unrelated completed work on A is untouched.
  expect(coordinator.listNodes().find((node) => node.nodeId === "node-A")?.state).toBe("READY");
  expect(coordinator.listAssignments().find((item) => item.taskId === "task-A-unrelated")?.state).toBe("COMPLETED");

  // B's checkpointed mid-run work is transferred to A with its checkpoint intact.
  const rerouted = coordinator.reassignAfterDropout("node-B");
  const resumed = rerouted.find((item) => item.taskId === "task-B");
  expect(resumed?.nodeId).toBe("node-A");
  expect(resumed?.checkpoint).toEqual({ stage: "analysis", data: { partial: { n: 2 } } });
  expect(resumed?.history.join(" ")).toContain("checkpointed:node-B transferred");

  // A resumes from the checkpoint and completes.
  coordinator.mark("task-B", "COMPLETED");
  expect(coordinator.listAssignments().find((item) => item.taskId === "task-B")?.state).toBe("COMPLETED");
});
