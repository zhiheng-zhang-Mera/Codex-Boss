import type { ProviderRun, Provider } from "../../src/shared/contracts";
import type { StateStore } from "../store";
import type { ProviderViews } from "../provider-views";
import type { ProviderAutomation } from "../provider-automation";
import { adapterFor } from "../adapters/registry";
import { probeScript, type PageProbe } from "../adapters/page-scripts";
import { BudgetManager } from "./budget-manager";
import { RecoveryScheduler, type RecoveryResult, type RecoveryWakeup } from "./recovery-scheduler";
export type WebRecoveryStrategy = "CAPTURE_EXISTING" | "RETRY_UNSENT";
export class WebRecovery {
  constructor(private readonly store: StateStore, private readonly views: ProviderViews,
    private readonly automation: () => ProviderAutomation, private readonly provider: (id: string) => Provider,
    private readonly queue: RecoveryScheduler, private readonly budgets: BudgetManager) {
    queue.register("web", (record) => this.resume(record));
  }
  defer(run: ProviderRun, strategy: WebRecoveryStrategy, retryAt = Date.now() + 60000): void {
    const runtimeId = run.transport + ":" + run.providerId;
    if (run.outcome === "RATE_LIMITED") this.budgets.observeFailure(runtimeId, "rate limit");
    this.queue.schedule({ id: "web:" + run.taskId, taskId: run.taskId, kind: "web", retryAt, payload: { strategy, runId: run.id } });
    this.store.setRecoveryState(run.taskId, this.queue.list().find((item) => item.id === "web:" + run.taskId)?.retryAt ?? retryAt, "等待原会话恢复；不会重复发送已提交请求");
  }
  private async resume(record: RecoveryWakeup): Promise<RecoveryResult> {
    const snapshot = this.store.snapshot(); const task = snapshot.tasks.find((item) => item.id === record.taskId);
    if (!task || ["cancelled", "completed", "failed"].includes(task.status)) return { done: true };
    if (task.status === "paused") return { done: false, error: "User paused task" };
    const payload = record.payload as { strategy: WebRecoveryStrategy; runId: string };
    const runs = this.store.runsForTask(task.id); const round = Math.max(...runs.map((item) => item.round));
    const current = runs.filter((item) => item.round === round && item.phase !== "completed");
    for (const run of current) {
      if (run.transport !== "web") continue;
      if (snapshot.runs.some((item) => item.taskId !== task.id && item.providerId === run.providerId && ["waiting", "sending", "prepared"].includes(item.phase))) return this.pause(task.id, "同一网页正在处理其他任务，等待人工选择恢复顺序");
      const provider = this.provider(run.providerId); const definition = adapterFor(provider);
      if (!definition) return this.pause(task.id, "Unsupported provider adapter");
      if (payload.strategy === "CAPTURE_EXISTING" && (!run.sessionUrl || run.sessionUrl === provider.url || new URL(run.sessionUrl).origin !== new URL(provider.url).origin)) return this.pause(task.id, "原会话地址不明确，需人工核对上次发送结果");
      let view = this.views.get(run.providerId);
      if (payload.strategy === "CAPTURE_EXISTING") {
        if (!run.sessionUrl || run.sessionUrl === provider.url || new URL(run.sessionUrl).origin !== new URL(provider.url).origin) return this.pause(task.id, "原会话地址不明确，需人工核对上次发送结果");
        if (!view || view.webContents.isCrashed()) {
          this.views.close(run.providerId); view = this.views.open(provider, false);
        }
        // A failed load can retain the requested URL while displaying a Chromium error page.
        await view.webContents.loadURL(run.sessionUrl!);
      } else {
        if (!view || view.webContents.isCrashed()) { this.views.close(run.providerId); view = this.views.open(provider, false); }
        await view.webContents.loadURL(provider.url);
      }
      const probe = await view!.webContents.executeJavaScript(probeScript(definition)) as PageProbe;
      if (probe.loginLikely) return this.pause(task.id, "请在原网页完成登录后恢复任务");
      if (payload.strategy === "CAPTURE_EXISTING" && probe.sourceUrl !== run.sessionUrl) return this.pause(task.id, "恢复后的页面不是记录中的原会话，需人工核对；不会采集其他对话");
      if (probe.rateLimited) return { done: false, retryAt: Date.now() + 60000, error: "Provider still rate limited" };
      this.budgets.update("web:" + run.providerId, "UNKNOWN", "OBSERVED");
      if (payload.strategy === "CAPTURE_EXISTING") this.store.updateRun(run.id, "waiting", null, "已恢复原会话，仅继续采集");
    }
    this.store.setRecoveryState(task.id, undefined, undefined);
    if (payload.strategy === "CAPTURE_EXISTING") await this.automation().resumePending(task.id);
    else {
      const checkpoint = this.store.snapshot().dispatchCheckpoints.find((item) => item.taskId === task.id && item.round === round);
      if (checkpoint?.requiresReconciliation) return this.pause(task.id, "上次提交有不确定结果，不能自动重发");
      await this.automation().dispatchTask(task.id);
      if (this.store.snapshot().tasks.find((item) => item.id === task.id)?.recoveryAt) return { done: false, retryAt: Date.now() + 60000, error: "Provider still unavailable" };
    }
    return { done: true };
  }
  private pause(taskId: string, reason: string): RecoveryResult {
    this.store.setRecoveryState(taskId, undefined, reason); return { done: false, error: reason };
  }
}
