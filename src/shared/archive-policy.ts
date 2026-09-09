/**
 * Conversation archive policy (plan §13/§51). Pure and shareable.
 *
 * §13 hard rule: Boss may auto-archive but must NEVER auto-delete. §51 says a
 * completed task's conversation is archived automatically. This module decides
 * WHEN auto-archiving is safe: the just-completed conversation must contain no
 * other ACTIVE task (queued/running/waiting/paused) and no pending mode
 * proposal, otherwise archiving would hide live work from the default list.
 *
 * Archive is a local flag only — the external web conversation is never
 * deleted, and the operator can always un-archive from the UI.
 */

import type { AppSnapshot } from "./contracts";

export const ACTIVE_TASK_STATUSES = new Set(["queued", "running", "waiting", "paused"]);

/** Tasks that still need the conversation visible on the default list. */
export function conversationHasActiveTask(snapshot: AppSnapshot, conversationId: string): boolean {
  return snapshot.tasks.some((task) => task.conversationId === conversationId && ACTIVE_TASK_STATUSES.has(task.status));
}

/** The completed task itself still counts as active until fully finalized. */
export function isTaskFinalized(snapshot: AppSnapshot, taskId: string): boolean {
  const task = snapshot.tasks.find((item) => item.id === taskId);
  return Boolean(task && (task.status === "completed" || task.status === "failed" || task.status === "cancelled"));
}

export interface ArchiveDecision {
  archive: boolean;
  reason: string;
}

/**
 * Whether a conversation should be auto-archived after task `taskId` finishes.
 * Auto-archive only when the finished task is the conversation's last active
 * one (no sibling active task, no pending Chat→Work decision). A conversation
 * with unfinished work stays on the default list; nothing is ever deleted.
 */
export function autoArchiveDecision(snapshot: AppSnapshot, taskId: string): ArchiveDecision {
  const task = snapshot.tasks.find((item) => item.id === taskId);
  if (!task) return { archive: false, reason: "task unknown" };
  if (!isTaskFinalized(snapshot, taskId)) return { archive: false, reason: "task not finalized" };
  if (conversationHasActiveTask(snapshot, task.conversationId)) return { archive: false, reason: "conversation still has active tasks" };
  const conversation = snapshot.conversations.find((item) => item.id === task.conversationId);
  if (!conversation) return { archive: false, reason: "conversation unknown" };
  if (conversation.archived) return { archive: false, reason: "already archived" };
  return { archive: true, reason: `task ${task.id} finished and no sibling task remains active` };
}
