import type { AppSnapshot, BossTask, TaskStatus } from "../shared/contracts";

export const emptySnapshot: AppSnapshot = { schemaVersion: 2, providers: [], tasks: [], runs: [], artifacts: [], councils: [], evidenceBundles: [], finalResponses: [], controller: { kind: "codex-cli", accountMode: "UNKNOWN", message: "正在检测 Codex Runtime" }, runtimeStatuses: [], roleRoutes: [], accounts: [], apiSettings: [], remoteChannels: [], remoteCommands: [], folders: [], conversations: [], activeConversationId: "", dispatchCheckpoints: [], events: [] };

export function taskCounts(tasks: BossTask[]): Record<TaskStatus, number> {
  return tasks.reduce<Record<TaskStatus, number>>(
    (counts, task) => ({ ...counts, [task.status]: counts[task.status] + 1 }),
    { queued: 0, running: 0, waiting: 0, paused: 0, cancelled: 0, completed: 0, failed: 0 }
  );
}

export function shortTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/** Humanized next-action labels for the wait read-model (Overcomplete §12.3). */
export function nextActionLabel(action: string | undefined): string {
  if (!action) return "";
  const labels: Record<string, string> = {
    COMPILE: "编译任务图",
    WAIT: "等待运行时恢复",
    WAIT_FOR_RESPONSE: "等待 AI 回答",
    NEXT_STEP: "继续下一步",
    REPORT_EVIDENCE: "汇总证据并交付",
    REPAIR_OR_REPLAN: "修复或重新规划",
    HUMAN_REQUIRED: "等待人工确认",
    VERIFY_SIDE_EFFECT: "核对副作用",
    STOP: "已停止",
    PROPOSE_WORK: "等待提案审批",
    DEFER_OR_NATIVE_TOOL: "降级本地执行"
  };
  return labels[action] ?? action;
}

/**
 * Read-model line for the main task surface (Overcomplete §12.3): why the task
 * waits, until when, and which action resumes it — one status string.
 */
export function waitingLine(task: Pick<BossTask, "status" | "recoveryAt" | "recoveryMessage" | "nextAction">): string {
  if (task.status !== "waiting" && !task.recoveryMessage) return "";
  const reason = task.recoveryMessage?.trim();
  const due = task.recoveryAt ? `等待到 ${new Date(task.recoveryAt).toLocaleString()}` : "";
  const next = task.nextAction ? `下一动作：${nextActionLabel(task.nextAction)}` : "";
  return [reason, due, next].filter(Boolean).join(" · ");
}
