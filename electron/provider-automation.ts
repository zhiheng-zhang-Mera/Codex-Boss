import type { Provider, ProviderId, ProviderRun } from "../src/shared/contracts";
import { adapterFor } from "./adapters/registry";
import { prepareScript, probeScript, sendScript, type PageProbe } from "./adapters/page-scripts";
import { ProviderViews } from "./provider-views";
import { StateStore } from "./store";

type ProbeState = { content: string; stableCount: number };

export class ProviderAutomation {
  private readonly baselines = new Map<string, string>();
  private readonly stability = new Map<string, ProbeState>();
  private readonly monitors = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly store: StateStore,
    private readonly views: ProviderViews,
    private readonly resolveProvider: (id: ProviderId) => Provider,
    private readonly publish: () => unknown
  ) {}

  async prepareTask(taskId: string): Promise<void> {
    for (const run of this.latestRuns(taskId).filter((item) => ["queued", "blocked", "failed"].includes(item.phase))) await this.prepareRun(run);
    this.store.setTaskStatus(taskId, "waiting");
    this.publish();
  }

  async sendTask(taskId: string): Promise<void> {
    for (const run of this.latestRuns(taskId)) {
      if (run.phase !== "prepared") continue;
      const definition = adapterFor(this.resolveProvider(run.providerId));
      const view = this.views.get(run.providerId);
      if (!definition || !view) {
        this.store.updateRun(run.id, "blocked", definition ? "RETRYABLE_FAILURE" : "UNSUPPORTED", definition ? "网页窗口未打开" : "该网页暂未提供可靠适配器");
        continue;
      }
      try {
        const result = await view.webContents.executeJavaScript(sendScript(definition), true) as { ok: boolean };
        if (!result.ok) {
          this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", "未可靠定位发送按钮，请在可见网页中手动发送");
          continue;
        }
        this.store.updateRun(run.id, "waiting", null, "已由用户确认发送，正在观察回答", definition.version);
      } catch (error) {
        this.store.updateRun(run.id, "failed", "RETRYABLE_FAILURE", `发送失败：${String(error)}`, definition.version);
      }
    }
    this.store.setTaskStatus(taskId, "running");
    this.startMonitor(taskId);
    this.publish();
  }

  async captureTask(taskId: string): Promise<void> {
    await this.poll(taskId, true);
    this.publish();
  }

  dispose(): void {
    for (const timer of this.monitors.values()) clearInterval(timer);
    this.monitors.clear();
  }

  private async prepareRun(run: ProviderRun): Promise<void> {
    const definition = adapterFor(this.resolveProvider(run.providerId));
    if (!definition) {
      this.store.updateRun(run.id, "blocked", "UNSUPPORTED", "该网页暂未提供可靠适配器；仍可由用户手动操作");
      return;
    }
    const view = this.views.get(run.providerId);
    if (!view) {
      this.store.updateRun(run.id, "failed", "RETRYABLE_FAILURE", "网页窗口未打开", definition.version);
      return;
    }
    try {
      const probe = await view.webContents.executeJavaScript(probeScript(definition)) as PageProbe;
      if (probe.rateLimited) return this.store.updateRun(run.id, "blocked", "RATE_LIMITED", "页面报告请求频率或额度限制", definition.version);
      if (probe.loginLikely) return this.store.updateRun(run.id, "blocked", "AUTH_REQUIRED", "需要用户在可见页面完成登录", definition.version);
      if (!probe.inputFound) return this.store.updateRun(run.id, "blocked", "PAGE_CHANGED", "未找到已版本化的输入区域，页面可能已变化", definition.version);
      const result = await view.webContents.executeJavaScript(prepareScript(definition, run.inputPrompt)) as { ok: boolean };
      if (!result.ok) return this.store.updateRun(run.id, "blocked", "PAGE_CHANGED", "输入区域在预填时失效", definition.version);
      this.baselines.set(run.id, probe.latestResponse);
      this.store.updateRun(run.id, "prepared", "SUCCESS", "提示词已在可见页面预填；等待用户确认发送", definition.version);
    } catch (error) {
      this.store.updateRun(run.id, "failed", "RETRYABLE_FAILURE", `页面适配器执行失败：${String(error)}`, definition.version);
    }
  }

  private startMonitor(taskId: string): void {
    if (this.monitors.has(taskId)) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > 10 * 60 * 1000) {
        clearInterval(timer);
        this.monitors.delete(taskId);
        return;
      }
      void this.poll(taskId, false).then(() => this.publish());
    }, 4000);
    this.monitors.set(taskId, timer);
  }

  private async poll(taskId: string, manual: boolean): Promise<void> {
    const runs = this.latestRuns(taskId).filter((run) => run.phase === "waiting");
    for (const run of runs) {
      const definition = adapterFor(this.resolveProvider(run.providerId));
      const view = this.views.get(run.providerId);
      if (!definition || !view) continue;
      try {
        const probe = await view.webContents.executeJavaScript(probeScript(definition)) as PageProbe;
        if (probe.rateLimited) { this.store.updateRun(run.id, "blocked", "RATE_LIMITED", "页面报告请求频率或额度限制", definition.version); continue; }
        if (probe.busy) { this.stability.delete(run.id); continue; }
        const baseline = this.baselines.get(run.id) ?? "";
        if (!probe.latestResponse || probe.latestResponse === baseline) {
          if (manual) this.store.updateRun(run.id, "waiting", "FORMAT_INVALID", "尚未发现可验证的新回答，可稍后重试或手动完成", definition.version);
          continue;
        }
        const previous = this.stability.get(run.id);
        const stableCount = previous?.content === probe.latestResponse ? previous.stableCount + 1 : 1;
        this.stability.set(run.id, { content: probe.latestResponse, stableCount });
        if (manual || stableCount >= 2) this.store.captureArtifact(run.id, probe.latestResponse, probe.sourceUrl);
      } catch (error) {
        if (manual) this.store.updateRun(run.id, "failed", "RETRYABLE_FAILURE", `采集失败：${String(error)}`, definition.version);
      }
    }
    if (this.latestRuns(taskId).every((run) => run.phase === "completed")) {
      const timer = this.monitors.get(taskId);
      if (timer) clearInterval(timer);
      this.monitors.delete(taskId);
    }
  }

  private latestRuns(taskId: string): ProviderRun[] {
    const runs = this.store.runsForTask(taskId);
    const round = Math.max(0, ...runs.map((run) => run.round));
    return runs.filter((run) => run.round === round);
  }
}
