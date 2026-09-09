import { continuationFor } from "./commander/continuation-router";
import type { RuntimeRequest, RuntimeResult } from "./runtimes/runtime";
import { SemanticRuntime } from "./computer/semantic-runtime";
import type { Provider, ProviderId, ProviderRun } from "../src/shared/contracts";
import { adapterFor } from "./adapters/registry";
import { prepareScript, probeScript, sendScript, uploadFilesScript, verifyPromptScript, verifyUploadScript, type PageProbe } from "./adapters/page-scripts";
import type { AttachmentStore } from "./input/attachment-store";
import { planAdapterUploads, planIsRoutable, resolveUploadsForTask } from "./input/attachment-upload";
import { ProviderViews } from "./provider-views";
import { StateStore } from "./store";
import { AccountSessionManager } from "./account-sessions";
import { isDispatchGroupSize } from "../src/shared/provider-policy";
import { ProviderHttpError, ProviderApiClient, type ApiCompletion } from "./provider-api";
import type { DomainEventBus } from "./commander/event-bus";
import fs from "node:fs";
import path from "node:path";

/**
 * Live diagnostic journal (direction 1 的纯程序替代): every automation step
 * (dispatch/prepare/send/poll/monitor/worker) appends one timestamped line to
 * a file so a wedged main process can be analyzed offline — the last entry
 * before the hang shows exactly where the event loop stopped. Writes are
 * best-effort and never throw into the automation path.
 */
function automationLogFile(): string {
  return process.env.LIVE_AUTOMATION_LOG ?? path.join(process.cwd(), "runtime-data", ".boss", "live-automation.log");
}
function appendLog(entry: Record<string, unknown>): void {
  try {
    const file = automationLogFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} ${JSON.stringify(entry)}\n`, "utf8");
  } catch { /* journaling must never break automation */ }
}

type ProbeState = { content: string; stableCount: number };

export class ProviderAutomation {
  private readonly continuedRounds = new Set<string>();
  private readonly dispatching = new Set<string>();
  private readonly baselines = new Map<string, string>();
  private readonly stability = new Map<string, ProbeState>();
  private readonly monitors = new Map<string, ReturnType<typeof setInterval>>();
  private readonly pollingTasks = new Set<string>();
  private readonly preparingProviders = new Map<ProviderId, string>();

  constructor(
    private readonly store: StateStore,
    private readonly views: ProviderViews,
    private readonly resolveProvider: (id: ProviderId) => Provider,
    private readonly publish: () => unknown,
    private readonly accounts: AccountSessionManager,
    private readonly api: ProviderApiClient,
    private readonly onRoundComplete?: (taskId: string) => Promise<void>,
    private readonly onTaskComplete?: (taskId: string) => Promise<void>,
    private readonly onRecovery?: (run: ProviderRun, strategy: "CAPTURE_EXISTING" | "RETRY_UNSENT", retryAt?: number) => void,
    private readonly events?: DomainEventBus,
    private readonly attachments?: AttachmentStore
  ) {}

  /** Publishes a TOOL_RESULT_READY domain event when a round's answers are fully collected (AP13). */
  private notifyToolResultReady(taskId: string, runId: string): void {
    this.events?.publish({ type: "TOOL_RESULT_READY", taskId, jobId: runId, message: "provider round answers collected" });
  }

  /**
   * Cancelling a task must immediately free its providers: without this, runs
   * that were mid-dispatch/monitor keep a `waiting` phase and the busy guard
   * blocks every later task on that provider for up to the 10-minute monitor
   * timeout. Mark such runs terminal + drop the monitor right away.
   */
  cancelRuns(taskId: string): void {
    this.log("cancelRuns", { taskId });
    const timer = this.monitors.get(taskId);
    if (timer) clearInterval(timer);
    this.monitors.delete(taskId);
    this.stability.clear();
    for (const run of this.latestRuns(taskId)) {
      if (["waiting", "sending", "prepared", "queued"].includes(run.phase)) {
        this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", "任务已取消；该 provider 已释放，可重新发起任务", "cancel/v1");
      }
    }
  }

  async dispatchTask(taskId: string): Promise<void> {
    if (this.dispatching.has(taskId)) return;
    this.dispatching.add(taskId);
    try { await this.dispatch(taskId); } finally { this.dispatching.delete(taskId); }
    await this.continueIfReady(taskId);
  }

  async continueIfReady(taskId: string): Promise<void> {
    if (!this.onRoundComplete && !this.onTaskComplete) return;
    const continuation = continuationFor(this.store.snapshot(), taskId);
    if (continuation === "COMPLETE") { await this.onTaskComplete?.(taskId); return; }
    if (!this.onRoundComplete || continuation !== "ADVANCE_COUNCIL") return;
    const key = taskId + ":" + this.latestRuns(taskId)[0].round;
    if (this.continuedRounds.has(key)) return;
    this.continuedRounds.add(key);
    try { await this.onRoundComplete(taskId); await this.continueIfReady(taskId); }
    catch (error) { this.continuedRounds.delete(key); this.store.setTaskStatus(taskId, "waiting"); throw error; }
  }

  async executeWorker(providerId: string, request: RuntimeRequest, signal?: AbortSignal): Promise<RuntimeResult> {
    this.log("executeWorker.enter", { providerId, taskId: request.taskId, jobId: request.jobId });
    if (signal?.aborted) return { runtimeId: "web:" + providerId, jobId: request.jobId, status: "CANCELLED" };
    const parent = this.store.snapshot().tasks.find((item) => item.id === request.taskId);
    const existing = this.store.snapshot().tasks.find((item) => item.parentTaskId === request.taskId && item.runtimeJobId === request.jobId && item.providerIds.includes(providerId));
    const task = existing ?? this.store.createTask(request.role, [request.context, request.prompt].filter(Boolean).join("\n\n"), [providerId], "direct", "work", {}, parent?.conversationId, request.taskId, request.jobId);
    try {
      if (existing && this.latestRuns(task.id).some((run) => ["waiting", "sending"].includes(run.phase))) await this.resumePending(task.id);
      else if (!existing) await this.dispatchTask(task.id);
      if (existing && this.latestRuns(task.id).some((run) => ["queued", "prepared"].includes(run.phase))) return { runtimeId: "web:" + providerId, jobId: request.jobId, status: "PERMANENT_FAILURE", failure: { code: "USER_ACTION_REQUIRED", message: "Interrupted worker has no confirmed send state; reconcile before retry", retryable: false } };
      const checkpoint = this.store.snapshot().dispatchCheckpoints.find((item) => item.taskId === task.id);
      if (checkpoint?.status === "ROLLED_BACK") {
        this.store.setTaskStatus(task.id, "failed");
        return { runtimeId: "web:" + providerId, jobId: request.jobId, status: "PERMANENT_FAILURE", failure: { code: checkpoint.requiresReconciliation ? "USER_ACTION_REQUIRED" : "PAGE_CHANGED", message: checkpoint.message, retryable: false } };
      }
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
      this.log("executeWorker.finally", { providerId, taskId: request.taskId, jobId: request.jobId });
      const timer = this.monitors.get(task.id); if (timer) clearInterval(timer); this.monitors.delete(task.id);
    }
  }

  private deferRecovery(run: ProviderRun, strategy: "CAPTURE_EXISTING" | "RETRY_UNSENT", retryAt?: number): void {
    if (!this.onRecovery) return;
    const timer = this.monitors.get(run.taskId); if (timer) clearInterval(timer);
    this.monitors.delete(run.taskId);
    this.onRecovery(run, strategy, retryAt);
  }

  async resumePending(taskId?: string): Promise<void> {
    const reserved = new Set<string>();
    for (const task of this.store.snapshot().tasks.filter((item) => (!taskId || item.id === taskId) && ["waiting", "running"].includes(item.status))) {
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
          const view = this.views.open(provider, false);
          await view.webContents.loadURL(run.sessionUrl);
          this.store.updateRun(run.id, "waiting", null, "已恢复原会话，继续采集；未重复发送");
          this.startMonitor(task.id);
        } catch (error) { this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", String(error)); }
      }
    }
    for (const task of this.store.snapshot().tasks) await this.continueIfReady(task.id);
    this.publish();
  }

  private log(step: string, detail: Record<string, unknown> = {}): void {
    appendLog({ step, ...detail, at: Date.now() });
  }

  private async dispatch(taskId: string): Promise<void> {
    const task = this.store.snapshot().tasks.find((item) => item.id === taskId);
    this.log("dispatch.start", { taskId, exists: Boolean(task), status: task?.status });
    if (!task || ["cancelled", "paused"].includes(task.status)) return;
    const allRuns = this.latestRuns(taskId);
    if (allRuns.some((run) => run.review?.status === "HUMAN_REQUIRED" || run.review?.status === "FAILED")) return;
    const latestCheckpoint = this.store.snapshot().dispatchCheckpoints.find((item) => item.taskId === taskId && item.round === allRuns[0]?.round);
    if (latestCheckpoint?.requiresReconciliation) throw new Error("请先核对上一次发送结果，避免重复提交");
    const activeTaskIds = new Set(this.store.snapshot().tasks.filter((item) => ["queued", "running", "waiting"].includes(item.status)).map((item) => item.id));
    const otherActive = this.store.snapshot().runs.some((run) => activeTaskIds.has(run.taskId) && run.taskId !== taskId && allRuns.some((item) => item.providerId === run.providerId) && ["sending", "waiting", "prepared"].includes(run.phase));
    if (otherActive) { this.log("dispatch.busy_guard", { taskId, providers: allRuns.map((run) => run.providerId) }); throw new Error("所选 AI 正在处理另一任务，请等待其完成"); }
    if (allRuns.some((run) => ["sending", "waiting"].includes(run.phase))) { this.startMonitor(taskId); return; }
    const runs = allRuns.filter((run) => run.phase !== "completed");
    if (runs.length === 0) return;
    if (!isDispatchGroupSize(runs.length)) throw new Error("请选择 1–5 个 AI");
    const round = runs[0]?.round ?? 0;
    const { checkpoint, baseline } = this.store.beginDispatch(taskId, round, allRuns.map((run) => run.providerId));
    for (const run of runs) await this.prepareRun(run);
    // One resilience pass: a provider that transiently fails to expose its
    // composer (page still loading / landed on a different route, e.g. Grok)
    // gets a fresh navigation + a single re-prepare before the group rolls
    // back, instead of failing the whole group on a page race.
    for (let attempt = 0; attempt < 1; attempt += 1) {
      const before = this.latestRuns(taskId).filter((run) => run.phase !== "completed");
      const retryable = before.filter((run) => run.transport === "web" && run.phase !== "prepared" && /未找到|页面可能已变化|input-not-found/i.test(run.message ?? ""));
      if (!retryable.length) break;
      for (const run of retryable) {
        const retryDef = adapterFor(this.resolveProvider(run.providerId));
        const retryView = this.views.get(run.providerId);
        if (!retryDef || !retryView) continue;
        this.log("prepare.retry_navigate", { providerId: run.providerId, taskId });
        try {
          await retryView.webContents.loadURL(retryDef.newConversationUrl ?? this.resolveProvider(run.providerId).url);
          await new Promise((resolve) => setTimeout(resolve, 2500));
          await this.prepareRun(run);
        } catch (error) { this.log("prepare.retry_error", { providerId: run.providerId, error: String(error) }); }
      }
    }
    let current = this.latestRuns(taskId).filter((run) => run.phase !== "completed");
    const prepareFailures = current.filter((run) => run.phase !== "prepared").map((run) => run.providerId);
    if (prepareFailures.length > 0) {
      this.log("dispatch.prepare_failed", { taskId, providers: prepareFailures });
      // Keep the per-run failure reason visible: rollback restores run rows to
      // their pre-dispatch baseline, so the reason must ride on the checkpoint.
      const reasons = current.filter((run) => run.phase !== "prepared").map((run) => {
        const label = this.resolveProvider(run.providerId).name;
        return run.message ? `${label}：${run.message}` : label;
      });
      const summary = reasons.length ? reasons.join("；") : "至少一个运行未能完成预填";
      this.store.rollbackDispatch(checkpoint.id, baseline, prepareFailures, false, `${summary}；未执行任何发送`);
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
      this.log("dispatch.send_failed", { taskId, providers: sendFailures });
      const partialExternalEffect = current.some((run) => run.phase === "waiting");
      this.store.rollbackDispatch(checkpoint.id, baseline, sendFailures, partialExternalEffect, partialExternalEffect ? "部分页面可能已经发送；本地记录已回退，必须人工核对后再操作" : "所有页面均未进入等待状态；本地记录已回退");
      this.publish();
      return;
    }
    this.store.markDispatchCollecting(checkpoint.id, current.map((run) => run.providerId));
    this.store.setTaskStatus(taskId, "running");
    for (const [runId, answer] of apiAnswers) this.store.captureArtifact(runId, answer.content, answer.sourceUrl);
    this.store.commitDispatchForRound(taskId, round);
    if (apiAnswers.size) this.notifyToolResultReady(taskId, [...apiAnswers.keys()][0]);
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
    this.log("readPage.start", { providerId });
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
        // U1 P0 (no false success): the API request body is text-only today, so
        // a task carrying file attachments can never deliver them over an API
        // transport. Fail the run closed with the exact reason instead of
        // letting dispatch send a text-only prompt and claim completion.
        if (this.attachments) {
          const attached = resolveUploadsForTask(this.store, this.attachments, run.taskId);
          if (attached.length) {
            const names = attached.map((file) => file.originalName).join("、");
            this.store.updateRun(run.id, "blocked", "UNSUPPORTED", `附件无法经 API 通道发送（不会静默丢弃）：${names}。请改用网页通道，或移除附件后重试。`, "api/preflight-v1");
            return;
          }
        }
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
    const owner = this.preparingProviders.get(run.providerId);
    if (owner && owner !== run.taskId) {
      this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", "该 AI 正在准备另一个任务；当前任务未导航、未发送", definition.version);
      return;
    }
    this.preparingProviders.set(run.providerId, run.taskId);
    try {
      const task = this.store.snapshot().tasks.find((item) => item.id === run.taskId);
      // U6 §12.1 fresh external conversation: a new WORK task (or a child
      // worker) with no recorded session navigates to a brand-new conversation
      // instead of reusing whatever the provider page shows; repair/continue
      // restores the recorded sessionUrl (see web-recovery + resumePending) and
      // never navigates away.
      if (!run.sessionUrl && (task?.parentTaskId || task?.freshWebConversation)) {
        await view.webContents.loadURL(definition.newConversationUrl ?? this.resolveProvider(run.providerId).url);
      }
      let probe = await this.readPage(run.providerId, probeScript(definition));
      this.accounts.recordProbe(run.providerId, probe.inputFound, probe.loginLikely);
      // Bounded input-readiness wait: pages (especially after a fresh
      // navigation) can take seconds to render their composer; probe up to
      // ~12s before treating a missing input area as a page change.
      for (let wait = 0; !probe.inputFound && !probe.loginLikely && !probe.rateLimited && wait < 8; wait += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        probe = await this.readPage(run.providerId, probeScript(definition));
        this.accounts.recordProbe(run.providerId, probe.inputFound, probe.loginLikely);
      }
      this.log("prepare.probe", { providerId: run.providerId, inputFound: probe.inputFound, loginLikely: probe.loginLikely, rateLimited: probe.rateLimited });
      if (probe.rateLimited) { this.store.updateRun(run.id, "blocked", "RATE_LIMITED", "页面报告请求频率或额度限制", definition.version); this.deferRecovery(run, "RETRY_UNSENT"); return; }
      if (probe.loginLikely && !probe.inputFound) return this.store.updateRun(run.id, "blocked", "AUTH_REQUIRED", "需要用户在可见页面完成登录", definition.version);
      if (!probe.inputFound) return this.store.updateRun(run.id, "blocked", "PAGE_CHANGED", "未找到已版本化的输入区域，页面可能已变化", definition.version);
      if (this.attachments) {
        const uploadBlocked = await this.prepareUploads(run, definition, view);
        if (uploadBlocked) return;
      }
      let result = await view.webContents.executeJavaScript(prepareScript(definition, run.inputPrompt)) as { ok: boolean; reason?: string };
      this.log("prepare.executed", { providerId: run.providerId, ok: result.ok, reason: result.reason });
      if (definition.providerId === "grok" || (!result.ok && result.reason === "value-not-applied")) {
        view.webContents.focus();
        await view.webContents.executeJavaScript(prepareScript(definition, ""));
        await view.webContents.insertText(run.inputPrompt);
        await new Promise((resolve) => setTimeout(resolve, 300));
        result = await view.webContents.executeJavaScript(verifyPromptScript(definition, run.inputPrompt)) as { ok: boolean; reason?: string };
        this.log("prepare.verified", { providerId: run.providerId, ok: result.ok, reason: result.reason });
      }
      if (!result.ok) return this.store.updateRun(run.id, "blocked", "PAGE_CHANGED", `输入区域在预填时失效：${result.reason ?? "unknown"}`, definition.version);
      this.baselines.set(run.id, probe.latestResponse);
      this.store.setRunSession(run.id, probe.latestResponse, probe.sourceUrl);
      this.store.updateRun(run.id, "prepared", "SUCCESS", "提示词已在可见页面预填；整组准备完成后自动发送", definition.version);
    } catch (error) {
      this.store.updateRun(run.id, "failed", "RETRYABLE_FAILURE", `页面适配器执行失败：${String(error)}`, definition.version);
    } finally {
      if (this.preparingProviders.get(run.providerId) === run.taskId) this.preparingProviders.delete(run.providerId);
    }
  }

  /**
   * Phase D upload: when the task carries attachments and the adapter is
   * versioned to accept them, inject the files and verify the rendered chips
   * BEFORE any prompt text is filled. Returns a blocking outcome (run already
   * marked) or undefined to continue.
   */
  private async prepareUploads(run: ProviderRun, definition: NonNullable<ReturnType<typeof adapterFor>>, view: { webContents: { executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown> } }): Promise<boolean> {
    const task = this.store.snapshot().tasks.find((item) => item.id === run.taskId);
    if (!task?.inputObjectIds?.length) return false;
    const resolved = resolveUploadsForTask(this.store, this.attachments!, task.id);
    if (!resolved.length) return false;
    const plan = planAdapterUploads(definition, resolved);
    if (!planIsRoutable(plan)) {
      const unsupportedNames = [...plan.unsupported, ...plan.oversized].map((file) => file.originalName).join("、");
      this.store.updateRun(run.id, "blocked", "UNSUPPORTED", `该网页适配器当前无法验证上传：${unsupportedNames}（不会发送未确认的附件）`, definition.version);
      return true;
    }
    try {
      await view.webContents.executeJavaScript(uploadFilesScript(definition, plan.uploads), true);
      const deadline = Date.now() + 30000;
      let verified = false;
      while (Date.now() < deadline) {
        const result = await view.webContents.executeJavaScript(verifyUploadScript(definition, plan.uploads.map((file) => file.name))) as { ok?: boolean; missing?: string[] };
        if (result.ok) { verified = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (!verified) {
        this.store.updateRun(run.id, "blocked", "PAGE_CHANGED", "上传后未在页面确认附件 chip（UPLOAD_NOT_CONFIRMED）；未填写提示词，不会发送", definition.version);
        return true;
      }
      this.store.updateRun(run.id, "queued", null, `已上传并确认 ${plan.uploads.length} 个附件`, definition.version);
      return false;
    } catch (error) {
      this.store.updateRun(run.id, "failed", "RETRYABLE_FAILURE", `附件上传失败：${String(error)}`, definition.version);
      return true;
    }
  }

  private startMonitor(taskId: string): void {
    this.log("monitor.schedule", { taskId });
    if (this.monitors.has(taskId)) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > 25 * 60 * 1000) {
        clearInterval(timer);
        this.monitors.delete(taskId);
        const runs = this.latestRuns(taskId);
        const round = runs[0]?.round ?? 0;
        // Slow providers (e.g. ChatGPT under load) can take >10 minutes to
        // settle; before failing the collection, force one final capture pass
        // so an answer that already appeared on the page is still collected.
        void this.poll(taskId, true).then(() => {
          const after = this.latestRuns(taskId);
          if (after.every((run) => ["completed", "failed", "blocked"].includes(run.phase))) return;
          this.store.failDispatchCollection(taskId, round, runs.find((run) => run.phase !== "completed")?.providerId ?? null, "等待回答超过 25 分钟，未达到全员成功条件");
          this.publish();
        }).catch(() => {
          this.store.failDispatchCollection(taskId, round, runs.find((run) => run.phase !== "completed")?.providerId ?? null, "等待回答超过 25 分钟，未达到全员成功条件");
          this.publish();
        });
        return;
      }
      if (this.pollingTasks.has(taskId)) return;
      this.pollingTasks.add(taskId);
      void this.poll(taskId, false).then(() => this.publish()).catch((error) => { this.store.setTaskStatus(taskId, "waiting"); console.error("Response collection paused", error); this.publish(); }).finally(() => this.pollingTasks.delete(taskId));
    }, 4000);
    this.monitors.set(taskId, timer);
  }

  private async poll(taskId: string, manual: boolean): Promise<void> {
    this.log("poll.head", { taskId, manual });
    const task = this.store.snapshot().tasks.find((item) => item.id === taskId);
    if (!task || ["cancelled", "paused"].includes(task.status)) return;
    const runs = this.latestRuns(taskId).filter((run) => run.phase === "waiting");
    const settled = await Promise.allSettled(runs.map(async (run) => {
      const definition = adapterFor(this.resolveProvider(run.providerId));
      const view = this.views.get(run.providerId);
      if (!definition || !view) { if (!view) this.onRecovery?.(run, "CAPTURE_EXISTING"); return; }
      try {
        const probe = await this.readPage(run.providerId, probeScript(definition));
        this.log("poll.probe", { taskId, providerId: run.providerId, manual, sourceUrlChanged: probe.sourceUrl !== run.sessionUrl, rateLimited: probe.rateLimited, busy: probe.busy, latestLen: (probe.latestResponse || "").length, sessionUrl: run.sessionUrl, sourceUrl: probe.sourceUrl });
        if (probe.sourceUrl !== run.sessionUrl) this.store.setRunSession(run.id, run.responseBaseline ?? "", probe.sourceUrl);
        if (probe.rateLimited) { this.store.updateRun(run.id, "blocked", "RATE_LIMITED", "页面报告请求频率或额度限制", definition.version); this.onRecovery?.(run, "CAPTURE_EXISTING"); return; }
        // NOTE: `busy` (a visible stop button) is NOT a hard skip. ChatGPT can
        // keep its stop affordance rendered after the final answer is on the
        // page, which previously left the run waiting forever; stability
        // (identical content twice) already prevents capturing mid-stream
        // partial text, so the busy flag is advisory only.
        const baseline = this.baselines.get(run.id) ?? run.responseBaseline ?? "";
        if (!probe.latestResponse || probe.latestResponse === baseline) {
          if (manual) this.store.updateRun(run.id, "waiting", "FORMAT_INVALID", "尚未发现可验证的新回答，可稍后重试或手动完成", definition.version);
          return;
        }
        const previous = this.stability.get(run.id);
        const stableCount = previous?.content === probe.latestResponse ? previous.stableCount + 1 : 1;
        this.stability.set(run.id, { content: probe.latestResponse, stableCount });
        if (manual || stableCount >= 2) this.store.captureArtifact(run.id, probe.latestResponse, probe.sourceUrl);
      } catch (error) { this.onRecovery?.(run, "CAPTURE_EXISTING"); throw { run, definition, error }; }
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
    this.log("poll.tail", { taskId, manual });
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
        this.store.updateRun(run.id, "failed", error instanceof ProviderHttpError && error.status === 429 ? "RATE_LIMITED" : "RETRYABLE_FAILURE", `API 请求失败：${String(error)}`, "api/request-v1");
        if (error instanceof ProviderHttpError && error.status === 429) this.onRecovery?.(run, "RETRY_UNSENT", error.retryAt);
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
      if (definition.sendMode === "enter") {
        this.log("send.enter.start", { providerId: run.providerId, taskId: run.taskId });
        await view.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
        await view.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const cleared = await view.webContents.executeJavaScript("(()=>{const el=document.querySelector('textarea,[contenteditable=true]');return el ? ((el.value!==undefined?(el.value):(el.innerText||'')).trim().length===0) : true;})()") as boolean;
        this.log("send.enter.done", { providerId: run.providerId, cleared });
        if (cleared !== true) {
          this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", "回车未完成提交（enter-did-not-submit）；整组不会进入下一步", definition.version);
          return;
        }
      } else {
        this.log("send.click.start", { providerId: run.providerId, taskId: run.taskId });
        const result = await view.webContents.executeJavaScript(sendScript(definition), true) as { ok: boolean };
        this.log("send.click.done", { providerId: run.providerId, ok: result.ok });
        if (!result.ok) {
          this.store.updateRun(run.id, "blocked", "USER_ACTION_REQUIRED", "未可靠定位发送按钮；整组不会进入下一步", definition.version);
          return;
        }
      }
      this.store.updateRun(run.id, "waiting", null, "已一次提交；等待独立并发采集回答", definition.version);
    } catch (error) {
      this.log("send.error", { providerId: run.providerId, error: String(error) });
      this.store.updateRun(run.id, "failed", "RETRYABLE_FAILURE", `发送失败：${String(error)}`, definition.version);
    }
  }
}
