import { validateGraph, type TaskIR, type TaskStep } from "./task-ir";

/**
 * Microtask DAG + recursive decomposition (plan AP12 / §13 incremental). A
 * TaskIR step is a single acceptance unit; this module lets a step expand into
 * a bounded sub-DAG of microtasks (read → propose → verify) while preserving
 * the parent contract. Pure and deterministic; the executor (EngineeringRuntime)
 * can consume the flattened graph unchanged.
 */

export type MicrotaskKind = "read" | "propose" | "verify" | "join";

export interface Microtask {
  id: string;
  kind: MicrotaskKind;
  parentStepId: string;
  description: string;
  dependencies: string[];
  requiredFiles: string[];
}

/** Canonical single-file-scope decomposition used when a step owns one file group. */
export function singleMicrotask(step: TaskStep): Microtask[] {
  const group = step.requiredFiles.slice(0, 50);
  const read: Microtask = { id: `${step.id}_read_0`, kind: "read", parentStepId: step.id, description: `Read ${step.id} scope`, dependencies: step.dependencies, requiredFiles: group };
  const propose: Microtask = { id: `${step.id}_propose_0`, kind: "propose", parentStepId: step.id, description: `Propose change for ${step.id}`, dependencies: [read.id], requiredFiles: group };
  const verify: Microtask = { id: `${step.id}_verify`, kind: "verify", parentStepId: step.id, description: `Verify ${step.id} acceptance`, dependencies: [propose.id], requiredFiles: group };
  return [read, propose, verify];
}

/** Expands an edit/worker step into the canonical microtask pattern. */
export function decomposeStep(step: TaskStep, options: { splitJoin?: boolean; maxFilesPerProposal?: number } = {}): Microtask[] {
  const maxPerProposal = options.maxFilesPerProposal ?? 10;
  const fileGroups = chunk(step.requiredFiles, maxPerProposal);
  const microtasks: Microtask[] = [];
  fileGroups.forEach((group, index) => {
    const read: Microtask = { id: `${step.id}_read_${index}`, kind: "read", parentStepId: step.id, description: `Read scope ${index + 1}`, dependencies: step.dependencies, requiredFiles: group };
    microtasks.push(read);
    const propose: Microtask = { id: `${step.id}_propose_${index}`, kind: "propose", parentStepId: step.id, description: `Propose change for scope ${index + 1}`, dependencies: [read.id], requiredFiles: group };
    microtasks.push(propose);
  });
  if (microtasks.length === 0) {
    const single: Microtask = { id: `${step.id}_read_0`, kind: "read", parentStepId: step.id, description: `Read scope`, dependencies: step.dependencies, requiredFiles: step.requiredFiles };
    microtasks.push(single);
  }
  const proposals = microtasks.filter((item) => item.kind === "propose");
  const verify: Microtask = { id: `${step.id}_verify`, kind: "verify", parentStepId: step.id, description: `Verify ${step.id} acceptance`, dependencies: proposals.map((item) => item.id), requiredFiles: step.requiredFiles };
  microtasks.push(verify);
  if (options.splitJoin) {
    const join: Microtask = { id: `${step.id}_join`, kind: "join", parentStepId: step.id, description: `Join ${step.id}`, dependencies: [verify.id], requiredFiles: [] };
    microtasks.push(join);
  }
  return microtasks;
}

/** Ready microtasks = not completed and all dependencies completed. */
export function readyMicrotasks(micro: Microtask[], completed: Set<string>): Microtask[] {
  return micro.filter((item) => !completed.has(item.id) && item.dependencies.every((dependency) => completed.has(dependency)));
}

export function validateMicrotasks(micro: Microtask[]): void {
  const ids = new Set(micro.map((item) => item.id));
  if (ids.size !== micro.length) throw new Error("Duplicate microtask id");
  for (const item of micro) {
    if (item.dependencies.some((dependency) => !ids.has(dependency))) throw new Error(`Missing microtask dependency ${item.id}`);
    if (item.requiredFiles.length > 50) throw new Error("Microtask file scope exceeds budget");
  }
  const steps: TaskStep[] = micro.map((item) => ({ id: item.id, kind: item.kind === "propose" ? "edit" : "worker", description: item.description, dependencies: item.dependencies, requiredFiles: item.requiredFiles }));
  validateGraph(steps);
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += Math.max(1, size)) result.push(items.slice(index, index + size));
  return result;
}
