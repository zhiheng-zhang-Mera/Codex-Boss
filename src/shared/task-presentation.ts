import type { BossTask, FinalResponse, ProviderRun } from "./contracts";
export type UserTaskState = "RUNNING" | "WAITING_FOR_AI" | "REVIEWING" | "CONTINUING" | "WAITING_FOR_USER" | "RECOVERING" | "DEGRADED" | "FAILED" | "COMPLETED";
export function taskPresentation(task: BossTask, runs: ProviderRun[], final?: FinalResponse): { state: UserTaskState; label: string } {
  if (task.status === "cancelled") return { state: "FAILED", label: "已取消" };
  if (task.status === "failed" || task.executionPhase === "FAILED") return { state: "FAILED", label: "任务未完成" };
  if (final) return { state: "COMPLETED", label: "已完成" };
  if (task.status === "paused") return { state: "WAITING_FOR_USER", label: "已暂停" };
  if (task.recoveryAt) return { state: "RECOVERING", label: "等待恢复" };
  if (task.finalizationBlocker) return { state: "WAITING_FOR_USER", label: "等待 Codex 可用后整理答复" };
  if (task.executionPhase === "WAITING_FOR_USER" || ["HUMAN_REQUIRED", "VERIFY_SIDE_EFFECT", "WAIT_FOR_USER"].includes(task.nextAction ?? "") || runs.some(run => run.review?.status === "HUMAN_REQUIRED")) return { state: "WAITING_FOR_USER", label: "需要你处理" };
  if (task.nextAction === "DEFER_OR_NATIVE_TOOL") return { state: "DEGRADED", label: "使用受限能力继续" };
  if (task.executionPhase === "RETRY" || task.recoveryMessage) return { state: "RECOVERING", label: "正在恢复" };
  if (["RESPONSE_RECEIVED", "REVIEW_GATE"].includes(task.executionPhase ?? "")) return { state: "REVIEWING", label: "正在检查回答" };
  if (task.executionPhase === "NEXT_STEP" || task.executionPhase === "COMPLETED" || task.status === "completed") return { state: "CONTINUING", label: "正在整理最终答复" };
  if (task.executionPhase === "WAITING_FOR_RESPONSE" || runs.some(run => run.phase === "waiting")) return { state: "WAITING_FOR_AI", label: "等待 AI 回答" };
  return { state: "RUNNING", label: task.status === "queued" ? "任务已就绪" : "正在处理" };
}
