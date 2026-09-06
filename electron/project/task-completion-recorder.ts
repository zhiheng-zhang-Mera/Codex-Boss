import type { AppSnapshot, BossTask } from "../../src/shared/contracts";
import type { ProjectStateStore } from "./project-state";

/**
 * Task-completion → project-state wiring (plan AP15 seam). When a task reaches
 * a durable final response, its workspace's project state records the outcome:
 * the goal it advanced (matched by title or explicit goal id) is marked done,
 * an accepted decision with evidence refs is appended, and a research-ledger
 * entry links the question → findings → decision. Next actions come from the
 * task's declared continuation, never from a model summary.
 */

export interface TaskCompletionInput {
  workspaceId: string;
  task: Pick<BossTask, "id" | "title" | "prompt">;
  findings: string;
  goalId?: string;
  nextActions?: string[];
}

export function recordTaskCompletion(store: ProjectStateStore, input: TaskCompletionInput): { decisionId: string; researchId: string; goalDone: boolean } {
  const state = store.load(input.workspaceId);
  const goal = input.goalId ? state.goals.find((item) => item.id === input.goalId) : state.goals.find((item) => item.title.toLocaleLowerCase() === input.task.title.toLocaleLowerCase());
  const result = store.recordTaskCompletion(input.workspaceId, {
    taskId: input.task.id,
    title: input.task.title,
    goalId: input.goalId,
    findings: input.findings,
    nextActions: input.nextActions
  });
  return { decisionId: result.decision.id, researchId: result.research.id, goalDone: Boolean(goal) };
}

/**
 * Finds the task's workspace from the snapshot; falls back to the default
 * workspace id supplied by the caller when the task predates workspace binding.
 */
export function workspaceForTask(snapshot: AppSnapshot, taskId: string, fallbackWorkspaceId?: string): string | undefined {
  const task = snapshot.tasks.find((item) => item.id === taskId);
  return task?.workspaceId ?? fallbackWorkspaceId;
}
