import type { AppSnapshot } from "../../src/shared/contracts";
export function continuationFor(snapshot: AppSnapshot, taskId: string): "WAIT" | "COMPLETE" | "ADVANCE_COUNCIL" {
  const task = snapshot.tasks.find((item) => item.id === taskId);
  if (!task || ["paused", "cancelled", "failed"].includes(task.status)) return "WAIT";
  const runs = snapshot.runs.filter((run) => run.taskId === taskId);
  const round = Math.max(0, ...runs.map((run) => run.round));
  const current = runs.filter((run) => run.round === round);
  if (!current.length || !current.every((run) => run.review?.status === "PASS" && run.phase === "completed")) return "WAIT";
  const checkpoint = snapshot.dispatchCheckpoints.find((item) => item.taskId === taskId && item.round === round);
  if (!checkpoint || checkpoint.status !== "COMMITTED" || checkpoint.requiresReconciliation) return "WAIT";
  const council = snapshot.councils.find((item) => item.taskId === taskId);
  return council && ["proposals", "peer_review", "synthesis"].includes(council.stage) ? "ADVANCE_COUNCIL" : "COMPLETE";
}
