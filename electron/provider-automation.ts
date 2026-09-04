import { continuationFor } from "./commander/continuation-router";
import type { RuntimeRequest, RuntimeResult } from "./runtimes/runtime";
import { SemanticRuntime } from "./computer/semantic-runtime";
import type { Provider, ProviderId, ProviderRun } from "../src/shared/contracts";
import { adapterFor } from "./adapters/registry";
import { prepareScript, probeScript, sendScript, verifyPromptScript, type PageProbe } from "./adapters/page-scripts";
import { ProviderViews } from "./provider-views";
import { StateStore } from "./store";
import { AccountSessionManager } from "./account-sessions";
import { isDispatchGroupSize } from "../src/shared/provider-policy";
import { ProviderApiClient, type ApiCompletion } from "./provider-api";

type ProbeState = { content: string; stableCount: number };

export class ProviderAutomation {
  private readonly continuedRounds = new Set<string>();
  private readonly dispatching = new Set<string>();
  private readonly baselines = new Map<string, string>();
  private readonly stability = new Map<string, ProbeState>();
  private readonly monitors = new Map<string, ReturnType<typeof setInterval>>();
  private readonly pollingTasks = new Set<string>();

  constructor(
    private readonly store: StateStore,
    private readonly views: ProviderViews,
    private readonly resolveProvider: (id: ProviderId) => Provider,
    private readonly publish: () => unknown,
    private readonly accounts: AccountSessionManager,
    private readonly api: ProviderApiClient,
    private readonly onRoundComplete?: (taskId: string) => Promise<void>
  ) {}

  async dispatchTask(taskId: string): Promise<void> {
    if (this.dispatching.has(taskId)) return;
    this.dispatching.add(taskId);
    try { await this.dispatch(taskId); } finally { this.dispatching.delete(taskId); }
    await this.continueIfReady(taskId);
  }

  async continueIfReady(taskId: string): Promise<void> {
    if (!this.onRoundComplete || continuationFor(this.store.snapshot(), taskId) !== "ADVANCE_COUNCIL") return;
    const key = taskId + ":" + this.latestRuns(taskId)[0].round;
    if (this.continuedRounds.has(key)) return;
    this.continuedRounds.add(key);
    try { await this.onRoundComplete(taskId); }
    catch (error) { this.continuedRounds.delete(key); this.store.setTaskStatus(taskId, "waiting"); throw error; }
  }

  async executeWorker(providerId: string, request: RuntimeRequest, signal?: AbortSignal): Promise<RuntimeResult> {
    if (signal?.aborted) return { runtimeId: "web:" + providerId, jobId: request.jobId, status: "CANCELLED" };
    const task = this.store.createTask(request.role, [request.context, request.prompt].filter(Boolean).join("\n\n"), [providerId]);
    try {
      await this.dispatchTask(task.id);
      const deadline = Date.now() + (request.timeoutMs ?? 180000);
      while (!signal?.aborted && Date.now() < deadline) {
        const run = this.latestRuns(task.id)[0];
        if (run.review?.status === "PASS" && run.response) return { runtimeId: "web:" + providerId, jobId: request.jobId, status: "SUCCESS", content: run.response.content };
        if (["failed", "blocked"].includes(run.phase)) return { runtimeId: "web:" + providerId, jobId: request.jobId, status: "PERMANENT_FAILURE", failure: { code: run.outcome === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "USER_ACTION_REQUIRED", message: run.message, retryable: false } };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!signal?.aborted) { this.store.setTaskStatus(task.id, "waiting"); return { runtimeId: "web:" + providerId, jobId: request.jobId, status: "PERMANENT_FAILURE", failure: { code: "TIMEOUT", message: "Web response deadline exceeded; inspect the existing session", retryable: false } }; }
      this.store.setTaskStatus(task.id, "cancelled");
      return { runtimeId: "web:" + providerId, jobId: request.jobId, status: "CANCELLED" };
    } finally {
      const timer = this.monitors.get(task.id); if (timer) clearInterval(timer); this.monitors.delete(task.id);
    }
  }

  async resumePending(): Promise<void> {
    const reserved = new Set<string>();
    for (const task of this.store.snapshot().tasks.filter((item) => ["waiting", "running"].includes(item.status))) {
      for (const run of this.latestRuns(task.id).filter((item) => ["waiting", "sending"].includes(item.phase))) {
        if (reserved.has(run.providerId)) continue;
        reserved.add(run.providerId);
        const provider = this.resolveProvider(run.providerId);
        if (run.transport !== "web" || !run.sessionUrl || run.sessionUrl === provider.url) {
          this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", "中断前发送结果或会话地址不确定，请核对原页面；不会自动重发");
          continue;
        }
        try {
          if (new URL(run.sessionUrl).origin !== new URL(provider.url).origin) throw new Error("Session origin mismatch");
          const open = this.store.snapshot().providers.filter((item) => item.windowOpen).length;
          if (!this.views.get(run.providerId) && open >= 5) continue;
          const view = this.views.open(provider);
          await view.webContents.loadURL(run.sessionUrl);
          this.store.updateRun(run.id, "waiting", null, "已恢复原会话，继续采集；未重复发送");
          this.startMonitor(task.id);
        } catch (error) { this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", String(error)); }
      }
    }
    for (const task of this.store.snapshot().tasks) await this.continueIfReady(task.id);
    this.publish();
  }

  private async dispatch(taskId: string): Promise<void> {
    const task = this.store.snapshot().tasks.find((item) => item.id === taskId);
    if (!task || ["cancelled", "paused"].includes(task.status)) return;
    const allRuns = this.latestRuns(taskId);
    if (allRuns.some((run) => run.review?.status === "HUMAN_REQUIRED" || run.review?.status === "FAILED")) return;
    const latestCheckpoint = this.store.snapshot().dispatchCheckpoints.find((item) => item.taskId === taskId && item.round === allRuns[0]?.round);
    if (latestCheckpoint?.requiresReconciliation) throw new Error("请先核对上一次发送结果，避免重复提交");
    const otherActive = this.store.snapshot().runs.some((run) => run.taskId !== taskId && allRuns.some((item) => item.providerId === run.providerId) && ["sending", "waiting", "prepared"].includes(run.phase));
    if (otherActive) throw new Error("所选 AI 正在处理另一任务，请等待其完成");
    if (allRuns.some((run) => ["sending", "waiting"].includes(run.phase))) { this.startMonitor(taskId); return; }
    const runs = allRuns.filter((run) => run.phase !== "completed");
    if (runs.length === 0) return;
    if (!isDispatchGroupSize(runs.length)) throw new Error("请选择 1–5 个 AI");
    const round = runs[0]?.round ?? 0;
    const { checkpoint, baseline } = this.store.beginDispatch(taskId, round, allRuns.map((run) => run.providerId));
    for (const run of runs) await this.prepareRun(run);
    let current = this.latestRuns(taskId).filter((run) => run.phase !== "completed");
    const prepareFailures = current.filter((run) => run.phase !== "prepared").map((run) => run.providerId);
    if (prepareFailures.length > 0) {
      this.store.rollbackDispatch(checkpoint.id, baseline, prepareFailures, false, "至少一个网页未能完成预填；未执行任何发送");
      this.publish();
      return;
    }
    const apiAnswers = new Map<string, ApiCompletion>();
    await Promise.all(current.map(async (run) => {
      const answer = await this.sendRun(run);
      if (answer) apiAnswers.set(run.id, answer);
    }));
    current = this.latestRuns(taskId).filter((run) => run.phase !== "completed");
    const sendFailures = current.filter((run) => run.phase !== "waiting").map((run) => run.providerId);
    if (sendFailures.length > 0) {
      const partialExternalEffect = current.some((run) => run.phase === "waiting");
      this.store.rollbackDispatch(checkpoint.id, baseline, sendFailures, partialExternalEffect, partialExternalEffect ? "部分页面可能已经发送；本地记录已回退，必须人工核对后再操作" : "所有页面均未进入等待状态；本地记录已回退");
      this.publish();
      return;
    }
    this.store.markDispatchCollecting(checkpoint.id, current.map((run) => run.providerId));
    this.store.setTaskStatus(taskId, "running");
    for (const [runId, answer] of apiAnswers) this.store.captureArtifact(runId, answer.content, answer.sourceUrl);
    this.store.commitDispatchForRound(taskId, round);
    if (this.latestRuns(taskId).some((run) => run.phase === "waiting" || run.review?.status === "RETRY")) this.startMonitor(taskId);
    this.publish();
  }

  async prepareTask(taskId: string): Promise<void> {
    for (const run of this.latestRuns(taskId).filter((item) => ["queued", "blocked", "failed"].includes(item.phase))) await this.prepareRun(run);
    this.store.setTaskStatus(taskId, "waiting");
    this.publish();
  }

  async sendTask(taskId: string): Promise<void> {
    await this.dispatchTask(taskId);
  }

  async captureTask(taskId: string): Promise<void> {
    await this.poll(taskId, true);
    this.publish();
  }

  dispose(): void {
    for (const timer of this.monitors.values()) clearInterval(timer);
    this.monitors.clear();
  }

  private async readPage(providerId: string, script: string): Promise<PageProbe> {
    const view = this.views.get(providerId);
    if (!view) throw new Error("Browser unavailable");
    const result = await new SemanticRuntime([{ kind: "dom", supports: (action) => action.name === "read_page", async execute() { return { status: "SUCCESS", evidence: await view.webContents.executeJavaScript(script) }; } }]).execute({ name: "read_page", target: providerId });
    if (result.status !== "SUCCESS") throw new Error(result.message ?? "Page read failed");
    return result.evidence as PageProbe;
  }

  private async prepareRun(run: ProviderRun): Promise<void> {
    if (run.transport === "api") {
      try {
        this.api.validate(run.providerId);
        this.store.updateRun(run.id, "prepared", "SUCCESS", "API 设置和加密密钥已通过预检", "api/preflight-v1");
      } catch (error) {
        this.store.updateRun(run.id, "blocked", "AUTH_REQUIRED", `API 预检失败：${String(error)}`, "api/preflight-v1");
      }
      return;
    }
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
      const probe = await this.readPage(run.providerId, probeScript(definition));
      this.accounts.recordProbe(run.providerId, probe.inputFound, probe.loginLikely);
      if (probe.rateLimited) return this.store.updateRun(run.id, "blocked", "RATE_LIMITED", "页面报告请求频率或额度限制", definition.version);
      if (probe.loginLikely && !probe.inputFound) return this.store.updateRun(run.id, "blocked", "AUTH_REQUIRED", "需要用户在可见页面完成登录", definition.version);
      if (!probe.inputFound) return this.store.updateRun(run.id, "blocked", "PAGE_CHANGED", "未找到已版本化的输入区域，页面可能已变化", definition.version);
      let result = await view.webContents.executeJavaScript(prepareScript(definition, run.inputPrompt)) as { ok: boolean; reason?: string };
      if (definition.providerId === "grok" || (!result.ok && result.reason === "value-not-applied")) {
        view.webContents.focus();
        await view.webContents.executeJavaScript(prepareScript(definition, ""));
        await view.webContents.insertText(run.inputPrompt);
        await new Promise((resolve) => setTimeout(resolve, 300));
        result = await view.webContents.executeJavaScript(verifyPromptScript(definition, run.inputPrompt)) as { ok: boolean; reason?: string };
      }
      if (!result.ok) return this.store.updateRun(run.id, "blocked", "PAGE_CHANGED", `输入区域在预填时失效：${result.reason ?? "unknown"}`, definition.version);
      this.baselines.set(run.id, probe.latestResponse);
      this.store.setRunSession(run.id, probe.latestResponse, probe.sourceUrl);
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
        const runs = this.latestRuns(taskId);
        const round = runs[0]?.round ?? 0;
        this.store.failDispatchCollection(taskId, round, runs.find((run) => run.phase !== "completed")?.providerId ?? null, "等待回答超过 10 分钟，未达到全员成功条件");
        this.publish();
        return;
      }
      if (this.pollingTasks.has(taskId)) return;
      this.pollingTasks.add(taskId);
      void this.poll(taskId, false).then(() => this.publish()).catch((error) => { this.store.setTaskStatus(taskId, "waiting"); console.error("Response collection paused", error); this.publish(); }).finally(() => this.pollingTasks.delete(taskId));
    }, 4000);
    this.monitors.set(taskId, timer);
  }

  private async poll(taskId: string, manual: boolean): Promise<void> {
    const task = this.store.snapshot().tasks.find((item) => item.id === taskId);
    if (!task || ["cancelled", "paused"].includes(task.status)) return;
    const runs = this.latestRuns(taskId).filter((run) => run.phase === "waiting");
    const settled = await Promise.allSettled(runs.map(async (run) => {
      const definition = adapterFor(this.resolveProvider(run.providerId));
      const view = this.views.get(run.providerId);
      if (!definition || !view) return;
      try {
        const probe = await this.readPage(run.providerId, probeScript(definition));
        if (probe.sourceUrl !== run.sessionUrl) this.store.setRunSession(run.id, run.responseBaseline ?? "", probe.sourceUrl);
        if (probe.rateLimited) { this.store.updateRun(run.id, "blocked", "RATE_LIMITED", "页面报告请求频率或额度限制", definition.version); return; }
        if (probe.busy) { this.stability.delete(run.id); return; }
        const baseline = this.baselines.get(run.id) ?? run.responseBaseline ?? "";
        if (!probe.latestResponse || probe.latestResponse === baseline) {
          if (manual) this.store.updateRun(run.id, "waiting", "FORMAT_INVALID", "尚未发现可验证的新回答，可稍后重试或手动完成", definition.version);
          return;
        }
        const previous = this.stability.get(run.id);
        const stableCount = previous?.content === probe.latestResponse ? previous.stableCount + 1 : 1;
        this.stability.set(run.id, { content: probe.latestResponse, stableCount });
        if (manual || stableCount >= 2) this.store.captureArtifact(run.id, probe.latestResponse, probe.sourceUrl);
      } catch (error) { throw { run, definition, error }; }
    }));
    if (manual) {
      const failed = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
      if (failed) {
        const detail = failed.reason as { run: ProviderRun; definition: { version: string }; error: unknown };
        this.store.updateRun(detail.run.id, "failed", "RETRYABLE_FAILURE", `采集失败：${String(detail.error)}`, detail.definition.version);
        this.store.failDispatchCollection(taskId, detail.run.round, detail.run.providerId, "并行采集失败，未达到全员成功条件");
      }
    }
    const latest = this.latestRuns(taskId);
    if (latest.some((run) => run.review?.status === "RETRY" && run.phase === "queued") && !latest.some((run) => run.phase === "waiting")) await this.dispatchTask(taskId);
    if (this.latestRuns(taskId).every((run) => ["completed", "failed", "blocked"].includes(run.phase))) {
      const timer = this.monitors.get(taskId);
      if (timer) clearInterval(timer);
      this.monitors.delete(taskId);
    }
    await this.continueIfReady(taskId);
  }

  private latestRuns(taskId: string): ProviderRun[] {
    const runs = this.store.runsForTask(taskId);
    const round = Math.max(0, ...runs.map((run) => run.round));
    return runs.filter((run) => run.round === round);
  }

  private async sendRun(run: ProviderRun): Promise<ApiCompletion | undefined> {
    try { this.store.recordDispatchAttempt(run.id); }
    catch (error) { this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", String(error)); return; }
    this.store.updateRun(run.id, "sending", null, "发送前检查点已保存");
    if (run.transport === "api") {
      try {
        const answer = await this.api.complete(run.providerId, run.inputPrompt);
        this.store.updateRun(run.id, "waiting", null, "API 回答已返回，等待进入统一并发采集记录", answer.adapterVersion);
        return answer;
      } catch (error) {
        this.store.updateRun(run.id, "failed", "RETRYABLE_FAILURE", `API 请求失败：${String(error)}`, "api/request-v1");
        return;
      }
    }
    const definition = adapterFor(this.resolveProvider(run.providerId));
    const view = this.views.get(run.providerId);
    if (!definition || !view) {
      this.store.updateRun(run.id, "blocked", definition ? "RETRYABLE_FAILURE" : "UNSUPPORTED", definition ? "网页窗口未打开" : "该网页暂未提供可靠适配器");
      return;
    }
    try {
      const result = await view.webContents.executeJavaScript(sendScript(definition), true) as { ok: boolean };
      if (!result.ok) {
        this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", "未可靠定位发送按钮；整组不会进入下一步", definition.version);
        return;
      }
      this.store.updateRun(run.id, "waiting", null, "已一次提交；等待独立并发采集回答", definition.version);
    } catch (error) {
      this.store.updateRun(run.id, "failed", "RETRYABLE_FAILURE", `发送失败：${String(error)}`, definition.version);
    }
  }
}
