import fs from "node:fs";
import path from "node:path";
import { writeJson, readJson } from "../commander/durable-json";
import { handleNodeDropout, nodeStateFor, routeTask, type AssignmentState, type FleetAssignment, type FleetNode, type FleetTask } from "../../src/shared/fleet";

/**
 * R43 Phase D (R-401): FederationCoordinator — durable fleet coordinator.
 * Heartbeats drive READY→DEGRADED→OFFLINE; assignment routing only touches
 * nodes that can accept work; dropout transfers checkpointed work and leaves
 * unrelated work untouched. No single non-essential coordinator failure kills
 * unrelated work (records are isolated per assignment/node and fail closed).
 */
export interface CoordinatorFile {
  schemaVersion: 1;
  nodes: FleetNode[];
  assignments: FleetAssignment[];
}

export class FederationCoordinator {
  private readonly nodes = new Map<string, FleetNode>();
  private readonly assignments = new Map<string, FleetAssignment>();

  constructor(private readonly filePath?: string, private readonly now: () => number = Date.now) {
    this.restore();
  }

  join(nodeId: string, capabilities: string[]): FleetNode {
    const existing = this.nodes.get(nodeId);
    const node: FleetNode = existing
      ? { ...existing, state: nodeStateFor(this.now(), existing) === "OFFLINE" ? "READY" : existing.state, capabilities: [...new Set(capabilities)], lastHeartbeatAt: this.now(), seq: existing.seq + 1 }
      : { nodeId, state: "READY", capabilities: [...new Set(capabilities)], lastHeartbeatAt: this.now(), seq: 1 };
    this.nodes.set(nodeId, node);
    this.persist();
    return structuredClone(node);
  }

  heartbeat(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const next: FleetNode = { ...node, lastHeartbeatAt: this.now(), seq: node.seq + 1, state: "READY" };
    this.nodes.set(nodeId, next);
    this.persist();
  }

  refreshStates(): { nodes: FleetNode[]; dropped: string[] } {
    const now = this.now();
    const dropped: string[] = [];
    for (const [nodeId, node] of [...this.nodes.entries()]) {
      const state = nodeStateFor(now, node);
      if (state === "OFFLINE" && node.state !== "OFFLINE") dropped.push(nodeId);
      if (state !== node.state) this.nodes.set(nodeId, { ...node, state });
    }
    this.persist();
    return { nodes: this.listNodes(), dropped };
  }

  enqueue(task: FleetTask): FleetAssignment {
    const nodes = [...this.nodes.values()].map((node) => ({ ...node, state: nodeStateFor(this.now(), node) }));
    const { assignment } = routeTask(task, nodes);
    const existing = this.assignments.get(task.taskId);
    if (existing) return structuredClone(existing);
    this.assignments.set(task.taskId, assignment);
    this.persist();
    return structuredClone(assignment);
  }

  checkpoint(taskId: string, blob: unknown): void {
    const assignment = this.assignments.get(taskId);
    if (!assignment) return;
    const next: FleetAssignment = { ...assignment, state: "CHECKPOINTED", checkpoint: blob, history: [...assignment.history, `checkpoint:${assignment.nodeId}`] };
    this.assignments.set(taskId, next);
    this.persist();
  }

  mark(taskId: string, state: Extract<AssignmentState, "COMPLETED" | "FAILED">): void {
    const assignment = this.assignments.get(taskId);
    if (!assignment) return;
    this.assignments.set(taskId, { ...assignment, state, history: [...assignment.history, state.toLowerCase()] });
    this.persist();
  }

  reassignAfterDropout(nodeId: string): FleetAssignment[] {
    const now = this.now();
    const updated = handleNodeDropout([...this.assignments.values()], nodeId);
    const rerouted: FleetAssignment[] = [];
    for (const assignment of updated) {
      if (!(assignment.nodeId === undefined && assignment.state === "QUEUED")) {
        this.assignments.set(assignment.taskId, assignment);
        continue;
      }
      const routed = routeTask(
        { taskId: assignment.taskId, requiredCapabilities: assignment.requiredCapabilities, checkpoint: assignment.checkpoint, replaySafe: assignment.replaySafe },
        [...this.nodes.values()].map((node) => ({ ...node, state: nodeStateFor(now, node) }))
      );
      // Preserve the dropout history + attempt count and the transferred checkpoint.
      const merged: FleetAssignment = {
        ...assignment,
        ...routed.assignment,
        attempts: assignment.attempts,
        history: [...assignment.history, ...routed.assignment.history]
      };
      this.assignments.set(assignment.taskId, merged);
      rerouted.push(structuredClone(merged));
    }
    this.persist();
    return rerouted;
  }

  listNodes(): FleetNode[] {
    return [...this.nodes.values()].map((node) => structuredClone(node)).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  }

  listAssignments(): FleetAssignment[] {
    return [...this.assignments.values()].map((assignment) => structuredClone(assignment)).sort((a, b) => a.taskId.localeCompare(b.taskId));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<CoordinatorFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.assignments)) throw new Error("Invalid fleet coordinator state");
    for (const node of parsed.nodes) {
      if (!node || typeof node.nodeId !== "string") throw new Error("Invalid fleet node");
      this.nodes.set(node.nodeId, node);
    }
    for (const assignment of parsed.assignments) {
      if (!assignment || typeof assignment.taskId !== "string") throw new Error("Invalid fleet assignment");
      this.assignments.set(assignment.taskId, assignment);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: CoordinatorFile = { schemaVersion: 1, nodes: [...this.nodes.values()], assignments: [...this.assignments.values()] };
    writeJson(this.filePath, file);
  }
}
