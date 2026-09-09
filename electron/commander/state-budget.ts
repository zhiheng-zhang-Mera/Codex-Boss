import type { AppSnapshot } from "../../src/shared/contracts";
import { classifyRecord, emptyPruneReport, validateBudgetPolicy, type LifecyclePruneReport, type StorageBudgetPolicy } from "../../src/shared/data-lifecycle";
export type { LifecyclePruneReport, StorageBudgetPolicy } from "../../src/shared/data-lifecycle";

/**
 * State.json array budget (plan §17 seam). The ledger checkpoints were already
 * bounded (storage-budget.ts); this module bounds the in-memory + persisted
 * arrays inside state.json (tasks/runs/artifacts/councils/evidence/final
 * responses/checkpoints). Hard rules:
 *  - active work is NEVER pruned (queued/running/waiting/paused tasks and their runs);
 *  - completed tasks beyond the per-conversation cap are removed together with their
 *    orphaned rows (cascade) — evidence bundles of retained tasks are never dropped;
 *  - per-task run history and tier TTL are enforced only when the policy opts in.
 */

export function applyStateStorageBudget(snapshot: AppSnapshot, policy: StorageBudgetPolicy, now = Date.now()): { snapshot: AppSnapshot; report: LifecyclePruneReport } {
  validateBudgetPolicy(policy);
  const report = emptyPruneReport();
  const active = new Set(snapshot.tasks.filter((task) => ["queued", "running", "waiting", "paused"].includes(task.status)).map((task) => task.id));
  const protectedIds = new Set(policy.protectedFamilies ?? []);
  // Completed tasks per conversation, newest kept when capped.
  const terminal = snapshot.tasks.filter((task) => !active.has(task.id) && task.status !== "cancelled");
  if (policy.maxCompletedTasksPerConversation > 0) {
    const kept = new Set<string>();
    for (const conversation of snapshot.conversations) {
      const completed = terminal.filter((task) => task.conversationId === conversation.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, policy.maxCompletedTasksPerConversation);
      completed.forEach((task) => kept.add(task.id));
    }
    const removedTasks = terminal.filter((task) => !kept.has(task.id) && !protectedIds.has(task.id));
    if (removedTasks.length) report.removed.push({ family: "task", count: removedTasks.length });
    const removedIds = new Set(removedTasks.map((task) => task.id));
    snapshot = { ...snapshot, tasks: snapshot.tasks.filter((task) => !removedIds.has(task.id)) };
  }

  // Cascade-remove rows that belong to tasks no longer retained.
  const retainedIds = new Set(snapshot.tasks.map((task) => task.id));
  const rows: Array<[keyof AppSnapshot, (item: { taskId: string }) => boolean, string]> = [
    ["runs", (item) => !retainedIds.has(item.taskId), "run"],
    ["artifacts", (item) => !retainedIds.has(item.taskId), "artifact"],
    ["councils", (item) => !retainedIds.has(item.taskId), "council"],
    ["evidenceBundles", (item) => !retainedIds.has(item.taskId), "evidence"],
    ["finalResponses", (item) => !retainedIds.has(item.taskId), "final-response"],
    ["dispatchCheckpoints", (item) => !retainedIds.has(item.taskId), "checkpoint"]
  ];
  for (const [key, belongsToTask, family] of rows) {
    const list = snapshot[key] as Array<{ taskId: string }>;
    const dropped = list.filter(belongsToTask);
    if (dropped.length) report.removed.push({ family, count: dropped.length });
    snapshot = { ...snapshot, [key]: list.filter((item) => !belongsToTask(item)) };
  }

  // Per-task run-history cap (oldest first removed).
  if (policy.maxRunsPerTask > 0) {
    const removedRuns: string[] = [];
    const capped = snapshot.runs.filter((run) => {
      const runs = snapshot.runs.filter((item) => item.taskId === run.taskId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const index = runs.indexOf(run);
      const over = runs.length - policy.maxRunsPerTask;
      if (over > 0 && index < over) { removedRuns.push(run.id); return false; }
      return true;
    });
    if (removedRuns.length) report.removed.push({ family: "run-history", count: removedRuns.length });
    snapshot = { ...snapshot, runs: capped };
  }

  // TTL enforcement for non-protected terminal rows (opt-in): a terminal task
  // that has aged past the warm tier (classifyRecord → L4) is pruned.
  if (policy.enforceTtl) {
    const expired = snapshot.tasks.filter((task) => !["queued", "running", "waiting", "paused"].includes(task.status) && classifyRecord({ family: "task", updatedAt: task.updatedAt, terminal: true, now }) === "L4" && !protectedIds.has(task.id));
    if (expired.length) {
      report.removed.push({ family: "task-ttl", count: expired.length });
      const removedIds = new Set(expired.map((task) => task.id));
      snapshot = { ...snapshot, tasks: snapshot.tasks.filter((task) => !removedIds.has(task.id)) };
    }
  }
  report.retainedTasks = snapshot.tasks.length;
  return { snapshot, report };
}
