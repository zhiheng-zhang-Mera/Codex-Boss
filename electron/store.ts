import { currentFinalResponse } from "../src/shared/final-response";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AdapterOutcome, ApiProviderSetting, AppMode, AppSnapshot, AuditEvent, BossConversation, BossTask, CodexReview, ControllerState, ConversationFolder, CouncilSession, DispatchCheckpoint, EvidenceBundle, FinalResponse, Provider, ProviderAccountMode, ProviderId, ProviderRun, ProviderRunPhase, RawArtifact, RemoteChannel, RemoteChannelSetting, RemoteChannelStatus, RemoteCommand, RemoteCommandStatus, RoleRouteView, RunTransport, RuntimeStatusView, TaskMode, TaskStatus } from "../src/shared/contracts";
import { HistoryRepository, safeSegment } from "./history-repository";

import { writeJson } from "./commander/durable-json";
import { TaskLedger } from "./commander/task-ledger";
import { defaultReviewPolicy, reviewResponse, type ReviewPolicy } from "../src/shared/execution";

const defaultFolderId = "folder-general";
const defaultConversationId = "conversation-default";

export const providerSeed: Provider[] = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", accent: "#6ee7b7", windowOpen: false, isCustom: false },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", accent: "#8ab4f8", windowOpen: false, isCustom: false },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", accent: "#f0a46b", windowOpen: false, isCustom: false },
  { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/", accent: "#5b8cff", windowOpen: false, isCustom: false },
  { id: "qwen", name: "Qwen", url: "https://chat.qwen.ai/", accent: "#8b7cf6", windowOpen: false, isCustom: false },
  { id: "kimi", name: "Kimi", url: "https://www.kimi.com/", accent: "#48c7b5", windowOpen: false, isCustom: false },
  { id: "grok", name: "Grok", url: "https://grok.com/", accent: "#d8d8d8", windowOpen: false, isCustom: false },
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/", accent: "#20b8a7", windowOpen: false, isCustom: false },
  { id: "copilot", name: "Microsoft Copilot", url: "https://copilot.microsoft.com/", accent: "#8d74ff", windowOpen: false, isCustom: false },
  { id: "mistral", name: "Mistral", url: "https://chat.mistral.ai/chat", accent: "#ff8c42", windowOpen: false, isCustom: false },
  { id: "doubao", name: "豆包", url: "https://www.doubao.com/chat/", accent: "#31a8ff", windowOpen: false, isCustom: false }
];

export class StateStore {
  private snapshotValue: AppSnapshot;
  private readonly ledger: TaskLedger;
  private readonly ledgerHashes = new Map<string, string>();

  constructor(private readonly filePath: string, private readonly history?: HistoryRepository) {
    this.ledger = new TaskLedger(path.join(path.dirname(filePath), ".boss", "tasks"));
    const restored = fs.existsSync(this.filePath);
    this.snapshotValue = this.read();
    if (restored) this.beginStartupSession();
    else this.history?.sync(this.snapshotValue);
  }

  snapshot(): AppSnapshot {
    return structuredClone(this.snapshotValue);
  }

  createTask(title: string, prompt: string, providerIds: ProviderId[], mode: TaskMode = "direct", appMode: AppMode = "chat", transportByProvider: Record<ProviderId, RunTransport> = {}, conversationId = this.snapshotValue.activeConversationId, parentTaskId?: string, runtimeJobId?: string): BossTask {
    const now = new Date().toISOString();
    const conversation = this.conversation(conversationId);
    const normalizedTransports = Object.fromEntries(providerIds.map((providerId) => [providerId, appMode === "chat" ? "web" : transportByProvider[providerId] ?? "web"])) as Record<ProviderId, RunTransport>;
    const task: BossTask = { id: randomUUID(), parentTaskId, runtimeJobId, conversationId, title, prompt, providerIds, status: "queued", mode, appMode, transportByProvider: normalizedTransports, createdAt: now, updatedAt: now };
    this.snapshotValue.tasks.unshift(task);
    if (!parentTaskId) conversation.taskIds.push(task.id);
    conversation.updatedAt = now;
    this.snapshotValue.runs.push(...providerIds.map((providerId) => this.newRun(task.id, providerId, 1, prompt, normalizedTransports[providerId])));
    if (mode === "council") {
      const council: CouncilSession = { id: randomUUID(), taskId: task.id, stage: "proposals", providerIds, round: 1, conflicts: [], minorityOpinions: [], createdAt: now, updatedAt: now };
      this.snapshotValue.councils.unshift(council);
    }
    this.event("task.created", `任务“${title}”已加入队列`, { taskId: task.id });
    this.persist();
    return task;
  }

  runsForTask(taskId: string): ProviderRun[] {
    return this.snapshotValue.runs.filter((run) => run.taskId === taskId);
  }

  createFolder(name: string): ConversationFolder {
    const now = new Date().toISOString();
    const folder: ConversationFolder = { id: randomUUID(), name: validName(name, "文件夹"), storageName: this.uniqueFolderStorageName(name), createdAt: now, updatedAt: now };
    this.snapshotValue.folders.push(folder);
    this.event("folder.created", `已创建历史文件夹“${folder.name}”`, {});
    this.persist();
    return folder;
  }

  renameFolder(folderId: string, name: string): void {
    const folder = this.folder(folderId);
    folder.name = validName(name, "文件夹");
    folder.storageName = this.uniqueFolderStorageName(folder.name, folder.id);
    folder.updatedAt = new Date().toISOString();
    this.event("folder.renamed", `历史文件夹已重命名为“${folder.name}”`, {});
    this.persist();
  }

  createConversation(folderId: string, title: string): BossConversation {
    this.folder(folderId);
    const now = new Date().toISOString();
    const conversation: BossConversation = { id: randomUUID(), folderId, title: validName(title, "对话"), storageName: this.uniqueConversationStorageName(folderId, title), taskIds: [], createdAt: now, updatedAt: now };
    this.snapshotValue.conversations.unshift(conversation);
    this.snapshotValue.activeConversationId = conversation.id;
    this.event("conversation.created", `已创建对话“${conversation.title}”`, {});
    this.persist();
    return conversation;
  }

  renameConversation(conversationId: string, title: string): void {
    const conversation = this.conversation(conversationId);
    conversation.title = validName(title, "对话");
    conversation.storageName = this.uniqueConversationStorageName(conversation.folderId, conversation.title, conversation.id);
    conversation.updatedAt = new Date().toISOString();
    this.event("conversation.renamed", `对话已重命名为“${conversation.title}”`, {});
    this.persist();
  }

  moveConversation(conversationId: string, folderId: string): void {
    const conversation = this.conversation(conversationId);
    this.folder(folderId);
    conversation.folderId = folderId;
    conversation.storageName = this.uniqueConversationStorageName(folderId, conversation.title, conversation.id);
    conversation.updatedAt = new Date().toISOString();
    this.event("conversation.moved", `对话“${conversation.title}”已移动`, {});
    this.persist();
  }

  selectConversation(conversationId: string): void {
    const conversation = this.conversation(conversationId);
    this.snapshotValue.activeConversationId = conversation.id;
    this.event("conversation.selected", `已切换到对话“${conversation.title}”`, {});
    this.persist();
  }

  updateRemoteChannel(channel: RemoteChannel, enabled: boolean, commandPrefix: string): void {
    const setting = this.snapshotValue.remoteChannels.find((item) => item.channel === channel);
    if (!setting) throw new Error(`Unknown remote channel: ${channel}`);
    const prefix = validCommandPrefix(commandPrefix);
    Object.assign(setting, {
      enabled,
      commandPrefix: prefix,
      status: enabled ? "waiting" as const : "disabled" as const,
      message: enabled ? "正在启动本机桌面监听器" : "远程指令监听已关闭",
      updatedAt: new Date().toISOString()
    });
    this.event("remote.channel", `${channel} 远程指令监听已${enabled ? "启用" : "关闭"}`, {});
    this.persist();
  }

  setRemoteChannelRuntime(channel: RemoteChannel, status: RemoteChannelStatus, message: string): void {
    const setting = this.snapshotValue.remoteChannels.find((item) => item.channel === channel);
    if (!setting || (setting.status === status && setting.message === message)) return;
    setting.status = setting.enabled ? status : "disabled";
    setting.message = message.slice(0, 500);
    setting.updatedAt = new Date().toISOString();
    this.persist();
  }

  receiveRemoteCommand(channel: RemoteChannel, body: string, sourceWindow: string): RemoteCommand | null {
    const setting = this.snapshotValue.remoteChannels.find((item) => item.channel === channel);
    if (!setting?.enabled) return null;
    const normalized = body.trim().slice(0, 10000);
    if (!normalized) return null;
    const now = Date.now();
    const duplicate = this.snapshotValue.remoteCommands.some((item) => item.channel === channel && item.body === normalized && item.sourceWindow === sourceWindow && now - Date.parse(item.receivedAt) < 5000);
    if (duplicate) return null;
    const command: RemoteCommand = { id: randomUUID(), channel, body: normalized, sourceWindow: sourceWindow.slice(0, 200), status: "pending", receivedAt: new Date(now).toISOString() };
    this.snapshotValue.remoteCommands.unshift(command);
    this.snapshotValue.remoteCommands = this.snapshotValue.remoteCommands.slice(0, 100);
    this.event("remote.command", `收到 ${channel} 待确认指令`, {});
    this.persist();
    return command;
  }

  setRemoteCommandStatus(commandId: string, status: RemoteCommandStatus): void {
    const command = this.snapshotValue.remoteCommands.find((item) => item.id === commandId);
    if (!command) throw new Error(`Unknown remote command: ${commandId}`);
    command.status = status;
    this.event("remote.command", `${command.channel} 指令已${status === "loaded" ? "载入" : "忽略"}`, {});
    this.persist();
  }

  updateRun(runId: string, phase: ProviderRunPhase, outcome: AdapterOutcome | null, message: string, adapterVersion?: string): void {
    const run = this.snapshotValue.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    run.phase = phase;
    run.outcome = outcome;
    run.message = message;
    if (adapterVersion) run.adapterVersion = adapterVersion;
    const runtime = this.snapshotValue.runtimeStatuses.find((item) => item.runtimeId === `${run.transport}:${run.providerId}`);
    if (runtime && outcome) {
      runtime.availability = outcome === "RATE_LIMITED" ? "RATE_LIMITED" : outcome === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : outcome === "PAGE_CHANGED" ? "PAGE_CHANGED" : outcome === "USER_ACTION_REQUIRED" ? "USER_ACTION_REQUIRED" : outcome === "UNSUPPORTED" ? "UNSUPPORTED" : outcome === "SUCCESS" ? "AVAILABLE" : runtime.availability;
      runtime.budget = outcome === "RATE_LIMITED" ? "LOW" : runtime.budget;
      runtime.message = message;
    }
    const task = this.snapshotValue.tasks.find((item) => item.id === run.taskId);
    if (task && !["cancelled", "paused", "completed"].includes(task.status)) {
      task.executionPhase = phase === "waiting" ? "WAITING_FOR_RESPONSE" : phase === "sending" ? "DISPATCHING" : phase === "blocked" ? "WAITING_FOR_USER" : phase === "failed" ? "FAILED" : "IDLE";
      if (phase === "blocked") task.status = "waiting";
    }
    run.updatedAt = new Date().toISOString();
    this.event(phase === "prepared" ? "adapter.prepared" : phase === "waiting" ? "adapter.sent" : "adapter.outcome", message, { taskId: run.taskId, providerId: run.providerId, stepId: run.id, runtimeId: `${run.transport}:${run.providerId}` });
    this.persist();
  }

  recordDispatchAttempt(runId: string): void {
    const run = this.snapshotValue.runs.find((item) => item.id === runId);
    if (!run) throw new Error("Unknown run");
    this.ledger.update(run.taskId, "provider dispatch budget", (state) => {
      if (state.usage.modelCalls >= state.limits.modelCalls) throw new Error("Task model-call budget exhausted");
      state.usage.modelCalls++;
      state.usage.estimatedInputTokens += Math.ceil(run.inputPrompt.length / 4);
      if (run.attempts) state.usage.retries++;
      if (run.transport === "web") state.usage.browserActions++;
    });
  }

  releaseReview(taskId: string): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Unknown task");
    for (const run of this.runsForTask(taskId)) {
      if (run.review?.status !== "HUMAN_REQUIRED" || !run.response) continue;
      // User releases this response only; the task's policy remains in force for future responses.
      run.review = reviewResponse(run.response, { ...(task.reviewPolicy ?? defaultReviewPolicy), approvalRequired: false, highImpact: false, externalAction: false }, run.attempts ?? 0);
      run.phase = run.review.status === "PASS" ? "completed" : "failed";
      run.message = run.review.retry_reason ?? "用户已确认接收回答";
    }
    this.reconcileTask(taskId); this.persist();
    for (const run of this.runsForTask(taskId)) this.commitDispatchForRound(taskId, run.round);
  }

  setTaskWorkspace(taskId: string, workspace: string): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Unknown task"); task.workspacePath = workspace; this.persist();
  }

  beginPlanExecution(taskId: string, workspace: string): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Unknown task");
    if (!task.selectedProviderIds) {
      if (this.runsForTask(taskId).some((run) => run.phase !== "queued")) throw new Error("Cannot replace already dispatched work");
      task.selectedProviderIds = [...task.providerIds]; task.providerIds = ["commander:plan"];
      this.snapshotValue.runs = this.snapshotValue.runs.filter((run) => run.taskId !== taskId);
      this.snapshotValue.runs.push(this.newRun(taskId, "commander:plan", 1, task.prompt, "api"));
    }
    task.workspacePath = workspace; this.persist();
  }

  setTaskPlan(taskId: string, plan: import("../src/shared/task-ir").TaskIR): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Unknown task");
    task.plan = structuredClone(plan); this.persist();
  }

  setReviewPolicy(taskId: string, policy: ReviewPolicy): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Unknown task");
    task.reviewPolicy = structuredClone(policy);
    this.persist();
  }

  setRunSession(runId: string, baseline: string, url: string): void {
    const run = this.snapshotValue.runs.find((item) => item.id === runId);
    if (!run) throw new Error("Unknown run");
    run.responseBaseline = baseline;
    run.sessionUrl = url;
    this.persist();
  }

  captureArtifact(runId: string, content: string, sourceUrl: string): RawArtifact {
    const run = this.snapshotValue.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    if (run.review?.status === "PASS" && run.artifactId) return this.snapshotValue.artifacts.find((item) => item.id === run.artifactId)!;
    const task = this.snapshotValue.tasks.find((item) => item.id === run.taskId)!;
    task.executionPhase = "RESPONSE_RECEIVED";
    const council = this.snapshotValue.councils.find((item) => item.taskId === run.taskId);
    const kind: RawArtifact["kind"] = council?.stage === "proposals" ? "proposal" : council?.stage === "peer_review" ? "peer_review" : council?.stage === "synthesis" ? "synthesis" : "response";
    const storedContent = content.slice(0, 100000);
    const producer: string = run.providerId.startsWith("native:") || run.providerId === "local:plan" ? "local:native" : `${run.transport}:${run.providerId}`;
    const artifact: RawArtifact = { id: randomUUID(), taskId: run.taskId, runId, providerId: run.providerId, kind, content: storedContent, capturedAt: new Date().toISOString(), sourceUrl, untrusted: true, version: 1, contentHash: sha256Hex(storedContent), producer, classification: "INTERNAL" };
    this.snapshotValue.artifacts.unshift(artifact);
    run.artifactId = artifact.id;
    run.response = { taskId: run.taskId, workerId: run.providerId, responseId: artifact.id, content: artifact.content, outcome: "SUCCESS" };
    task.executionPhase = "REVIEW_GATE";
    this.persist();
    run.review = reviewResponse(run.response, task.reviewPolicy ?? defaultReviewPolicy, run.attempts ?? 0);
    run.phase = run.review.status === "PASS" ? "completed" : run.review.status === "RETRY" ? "queued" : run.review.status === "FAILED" ? "failed" : "blocked";
    run.outcome = run.review.status === "PASS" ? "SUCCESS" : "FORMAT_INVALID";
    run.message = run.review.retry_reason ?? run.review.human_review_reason ?? "回答已通过确定性审查";
    task.executionPhase = run.review.status === "PASS" ? "NEXT_STEP" : run.review.status === "HUMAN_REQUIRED" ? "WAITING_FOR_USER" : run.review.status;
    task.nextAction = run.review.next_action;
    if (run.review.status === "RETRY") run.attempts = (run.attempts ?? 0) + 1;
    // Persist evidence, review and continuation together before releasing the gate.
    this.persist();
    run.updatedAt = artifact.capturedAt;
    this.event("artifact.captured", `已捕获 ${run.providerId} 原始回答`, { taskId: run.taskId, providerId: run.providerId, stepId: run.id, runtimeId: `${run.transport}:${run.providerId}`, evidenceRef: artifact.id });
    this.reconcileTask(run.taskId);
    this.commitDispatchForRound(run.taskId, run.round);
    this.persist();
    return artifact;
  }

  addCouncilRound(taskId: string, prompts: Map<ProviderId, string>, stage: CouncilSession["stage"]): void {
    const council = this.snapshotValue.councils.find((item) => item.taskId === taskId);
    if (!council) throw new Error(`Unknown council task: ${taskId}`);
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    council.round += 1;
    council.stage = stage;
    council.updatedAt = new Date().toISOString();
    for (const providerId of council.providerIds) {
      const prompt = prompts.get(providerId);
      if (prompt) this.snapshotValue.runs.push(this.newRun(taskId, providerId, council.round, prompt, task?.transportByProvider[providerId] ?? "web"));
    }
    if (task) { task.status = "queued"; task.updatedAt = council.updatedAt; }
    this.event("council.advanced", `Council 进入 ${stage} 阶段`, { taskId });
    this.persist();
  }

  updateCouncil(taskId: string, patch: Partial<Pick<CouncilSession, "stage" | "conflicts" | "minorityOpinions" | "finalArtifactId">>): void {
    const council = this.snapshotValue.councils.find((item) => item.taskId === taskId);
    if (!council) throw new Error(`Unknown council task: ${taskId}`);
    Object.assign(council, patch, { updatedAt: new Date().toISOString() });
    this.persist();
  }

  setController(controller: ControllerState): void {
    this.snapshotValue.controller = controller;
    const runtime = this.snapshotValue.runtimeStatuses.find((item) => item.runtimeId === "codex:cli");
    if (runtime) {
      runtime.availability = controller.accountMode === "CHATGPT" ? "AVAILABLE" : controller.accountMode === "NOT_AUTHENTICATED" ? "AUTH_REQUIRED" : "DOWN";
      runtime.message = controller.message;
    }
    this.persist();
  }

  setRuntimeControl(runtimeId: string, enabled: boolean, priority: number): void {
    const runtime = this.snapshotValue.runtimeStatuses.find((item) => item.runtimeId === runtimeId);
    if (!runtime) throw new Error(`Unknown runtime: ${runtimeId}`);
    runtime.enabled = enabled;
    runtime.priority = Math.max(0, Math.min(999, Math.trunc(priority)));
    this.event("runtime.policy", `${runtimeId} ${enabled ? "enabled" : "disabled"}; priority=${runtime.priority}`, {});
    this.persist();
  }

  observeRuntimeFailure(runtimeId: string, message: string): void {
    const runtime = this.snapshotValue.runtimeStatuses.find((item) => item.runtimeId === runtimeId);
    if (!runtime) return;
    if (/quota|allowance|budget|额度|用量.*(耗尽|上限)|limit reached/i.test(message)) { runtime.availability = "BUDGET_EXHAUSTED"; runtime.budget = "EXHAUSTED"; }
    else if (/rate.?limit|too many requests|频率限制/i.test(message)) { runtime.availability = "RATE_LIMITED"; runtime.budget = "LOW"; }
    else runtime.availability = "DOWN";
    runtime.message = message.slice(0, 500);
    this.event("runtime.policy", `${runtimeId} failure isolated: ${runtime.availability}`, {});
    this.persist();
  }

  setRoleRoute(role: RoleRouteView["role"], runtimeIds: string[], fallback: boolean): void {
    const route = this.snapshotValue.roleRoutes.find((item) => item.role === role);
    if (!route) throw new Error(`Unknown role: ${role}`);
    const known = new Set(this.snapshotValue.runtimeStatuses.map((item) => item.runtimeId));
    route.runtimeIds = [...new Set(runtimeIds)].filter((id) => known.has(id));
    route.fallback = fallback;
    this.event("runtime.policy", `${role} route updated`, {});
    this.persist();
  }

  setApiSettings(settings: ApiProviderSetting[]): void {
    if (JSON.stringify(this.snapshotValue.apiSettings) === JSON.stringify(settings)) return;
    this.snapshotValue.apiSettings = structuredClone(settings);
    this.persist();
  }

  setAccount(providerId: ProviderId, partition: string, mode: ProviderAccountMode, message: string): void {
    const now = new Date().toISOString();
    const existing = this.snapshotValue.accounts.find((account) => account.providerId === providerId);
    if (existing && existing.partition === partition && existing.mode === mode && existing.message === message) return;
    if (existing) Object.assign(existing, { partition, mode, message, persistent: true as const, updatedAt: now });
    else this.snapshotValue.accounts.push({ providerId, partition, mode, persistent: true, message, updatedAt: now });
    this.event("account.status", `${providerId} 账户会话：${mode}`, { providerId });
    this.persist();
  }

  beginDispatch(taskId: string, round: number, expectedProviderIds: ProviderId[]): { checkpoint: DispatchCheckpoint; baseline: ProviderRun[] } {
    const baseline = this.runsForTask(taskId).filter((run) => run.round === round).map((run) => structuredClone(run));
    const now = new Date().toISOString();
    const checkpoint: DispatchCheckpoint = { id: randomUUID(), taskId, round, expectedProviderIds, successfulProviderIds: [], failedProviderIds: [], status: "PREPARING", requiresReconciliation: false, message: "正在向全部网页 AI 准备同一轮提示", createdAt: now, updatedAt: now };
    this.snapshotValue.dispatchCheckpoints.unshift(checkpoint);
    this.snapshotValue.dispatchCheckpoints = this.snapshotValue.dispatchCheckpoints.slice(0, 100);
    this.event("dispatch.checkpoint", `第 ${round} 轮已建立提交检查点`, { taskId });
    this.persist();
    return { checkpoint: structuredClone(checkpoint), baseline };
  }

  markDispatchCollecting(checkpointId: string, successfulProviderIds: ProviderId[]): void {
    const checkpoint = this.checkpoint(checkpointId);
    Object.assign(checkpoint, { status: "COLLECTING" as const, successfulProviderIds, failedProviderIds: [], message: "已一次提交到全部网页 AI；正在按顺序收集回答", updatedAt: new Date().toISOString() });
    this.event("dispatch.checkpoint", `第 ${checkpoint.round} 轮全部提交成功，开始并发采集`, { taskId: checkpoint.taskId });
    this.persist();
  }

  commitDispatchForRound(taskId: string, round: number): void {
    const checkpoint = this.snapshotValue.dispatchCheckpoints.find((item) => item.taskId === taskId && item.round === round && item.status === "COLLECTING");
    if (!checkpoint) return;
    const runs = this.runsForTask(taskId).filter((run) => run.round === round);
    if (runs.length !== checkpoint.expectedProviderIds.length || !runs.every((run) => run.phase === "completed" && run.artifactId)) return;
    Object.assign(checkpoint, { status: "COMMITTED" as const, successfulProviderIds: checkpoint.expectedProviderIds, message: "全部网页 AI 回答已成功收集，检查点已提交", updatedAt: new Date().toISOString() });
    this.event("dispatch.checkpoint", `第 ${round} 轮全员成功，允许下一步`, { taskId });
    this.persist();
  }

  failDispatchCollection(taskId: string, round: number, failedProviderId: ProviderId | null, message: string): void {
    const checkpoint = this.snapshotValue.dispatchCheckpoints.find((item) => item.taskId === taskId && item.round === round && item.status === "COLLECTING");
    if (!checkpoint) return;
    const completed = this.runsForTask(taskId).filter((run) => run.round === round && run.phase === "completed").map((run) => run.providerId);
    Object.assign(checkpoint, { status: "ROLLED_BACK" as const, successfulProviderIds: completed, failedProviderIds: failedProviderId ? [failedProviderId] : checkpoint.expectedProviderIds.filter((id) => !completed.includes(id)), requiresReconciliation: true, message, updatedAt: new Date().toISOString() });
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (task) { task.status = "waiting"; task.updatedAt = checkpoint.updatedAt; }
    this.event("dispatch.checkpoint", `第 ${round} 轮采集未全员成功，保持上一次已提交记录：${message}`, { taskId });
    this.persist();
  }

  rollbackDispatch(checkpointId: string, baseline: ProviderRun[], failedProviderIds: ProviderId[], requiresReconciliation: boolean, message: string): void {
    const checkpoint = this.checkpoint(checkpointId);
    for (const saved of baseline) {
      const index = this.snapshotValue.runs.findIndex((run) => run.id === saved.id);
      if (index >= 0) this.snapshotValue.runs[index] = structuredClone(saved);
    }
    Object.assign(checkpoint, { status: "ROLLED_BACK" as const, failedProviderIds, successfulProviderIds: requiresReconciliation ? checkpoint.expectedProviderIds.filter((id) => !failedProviderIds.includes(id)) : [], requiresReconciliation, message, updatedAt: new Date().toISOString() });
    const task = this.snapshotValue.tasks.find((item) => item.id === checkpoint.taskId);
    if (task) { task.status = "waiting"; task.updatedAt = checkpoint.updatedAt; }
    this.event("dispatch.checkpoint", `第 ${checkpoint.round} 轮已回退到提交前记录：${message}`, { taskId: checkpoint.taskId });
    this.persist();
  }

  setRecoveryState(taskId: string, retryAt?: number, message?: string): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Unknown task");
    task.recoveryAt = retryAt; task.recoveryMessage = message;
    if (message) { task.status = "waiting"; task.nextAction = retryAt ? "WAIT" : "HUMAN_REQUIRED"; }
    this.event("task.status", message ?? "Recovery resumed", { taskId }); this.persist();
  }

  setFinalizationPolicy(taskId: string, policy: import("../src/shared/contracts").FinalizationPolicy, blocker?: string): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Unknown task");
    task.finalizationPolicy = policy; task.finalizationBlocker = blocker;
    this.persist();
  }

  finalResponseForTask(taskId: string): FinalResponse | undefined {
    const result = currentFinalResponse(this.snapshotValue, taskId);
    return result ? structuredClone(result) : undefined;
  }

  saveFinalResponse(response: FinalResponse): void {
    if (this.finalResponseForTask(response.taskId)) return;
    const task = this.snapshotValue.tasks.find((item) => item.id === response.taskId);
    if (!task || task.conversationId !== response.conversationId || !response.content.trim()) throw new Error("Invalid final response");
    task.status = "completed"; task.executionPhase = "COMPLETED"; task.nextAction = "REPORT_EVIDENCE";
    task.finalizationBlocker = undefined; task.recoveryAt = undefined; task.recoveryMessage = undefined; task.updatedAt = response.finalizedAt;
    this.snapshotValue.finalResponses.push(structuredClone(response));
    this.event("task.finalized", "最终答复已保存", { taskId: task.id, evidenceRef: response.evidenceBundleId ?? response.id });
    this.persist();
  }

  saveEvidence(bundle: EvidenceBundle): void {
    this.snapshotValue.evidenceBundles.unshift(bundle);
    this.snapshotValue.evidenceBundles = this.snapshotValue.evidenceBundles.slice(0, 50);
    this.event("evidence.built", `证据包已生成：${bundle.manifest.length} 个 artifact，决策 ${bundle.decision}`, { taskId: bundle.taskId });
    this.persist();
  }

  updateCodexReview(bundleId: string, review: CodexReview): void {
    const bundle = this.snapshotValue.evidenceBundles.find((item) => item.id === bundleId);
    if (!bundle) throw new Error(`Unknown evidence bundle: ${bundleId}`);
    bundle.codexReview = review;
    this.event("codex.review", `Codex 控制端审查状态：${review.status}`, { taskId: bundle.taskId });
    this.persist();
  }

  recordRehydration(taskId: string): void {
    this.event("evidence.rehydration", "已创建选择性证据回填轮次", { taskId });
    this.persist();
  }

  addRehydrationRound(taskId: string, prompts: Map<ProviderId, string>): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    const currentRound = Math.max(0, ...this.runsForTask(taskId).map((run) => run.round));
    const nextRound = currentRound + 1;
    for (const providerId of task.providerIds) {
      const prompt = prompts.get(providerId);
      if (prompt) this.snapshotValue.runs.push(this.newRun(taskId, providerId, nextRound, prompt, task.transportByProvider[providerId] ?? "web"));
    }
    const council = this.snapshotValue.councils.find((item) => item.taskId === taskId);
    if (council) { council.round = nextRound; council.stage = "rehydration"; council.updatedAt = new Date().toISOString(); }
    task.status = "queued";
    task.updatedAt = new Date().toISOString();
    this.event("evidence.rehydration", "已创建选择性证据回填轮次", { taskId });
    this.persist();
  }

  addCustomProvider(name: string, url: string): Provider {
    const provider: Provider = {
      id: `custom-${randomUUID()}`,
      name,
      url,
      accent: "#d9f99d",
      windowOpen: false,
      isCustom: true
    };
    this.snapshotValue.providers.push(provider);
    this.snapshotValue.runtimeStatuses.push({ runtimeId: `web:${provider.id}`, label: `${provider.name} Web`, kind: "web", availability: "DOWN", budget: "UNKNOWN", enabled: true, priority: 100, message: "Visible session closed" });
    this.event("provider.added", `自定义网页 AI“${name}”已添加`, { providerId: provider.id });
    this.persist();
    return provider;
  }

  removeCustomProvider(providerId: ProviderId): void {
    const index = this.snapshotValue.providers.findIndex((item) => item.id === providerId && item.isCustom);
    if (index < 0) throw new Error(`Unknown custom provider: ${providerId}`);
    const [provider] = this.snapshotValue.providers.splice(index, 1);
    this.snapshotValue.accounts = this.snapshotValue.accounts.filter((account) => account.providerId !== providerId);
    this.snapshotValue.runtimeStatuses = this.snapshotValue.runtimeStatuses.filter((runtime) => runtime.runtimeId !== `web:${providerId}`);
    for (const route of this.snapshotValue.roleRoutes) route.runtimeIds = route.runtimeIds.filter((runtimeId) => runtimeId !== `web:${providerId}`);
    this.event("provider.removed", `自定义网页 AI“${provider.name}”已移除`, { providerId });
    this.persist();
  }

  setTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    if (status === "completed") {
      const runs = this.runsForTask(taskId); const round = Math.max(0, ...runs.map((run) => run.round));
      const current = runs.filter((run) => run.round === round);
      if (!current.length || !current.every((run) => run.artifactId && run.review?.status === "PASS" && run.phase === "completed")) throw new Error("Completion requires persisted passing evidence");
      task.executionPhase = "COMPLETED"; task.nextAction = "REPORT_EVIDENCE";
    } else if (status === "failed") { task.executionPhase = "FAILED"; task.nextAction = "STOP"; }
    task.status = status;
    task.updatedAt = new Date().toISOString();
    this.event(status === "running" ? "task.started" : "task.status", `任务“${task.title}”状态变更为 ${status}`, { taskId });
    this.persist();
  }

  setWindow(providerId: ProviderId, open: boolean): void {
    const provider = this.snapshotValue.providers.find((item) => item.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    if (provider.windowOpen === open) return;
    provider.windowOpen = open;
    const runtime = this.snapshotValue.runtimeStatuses.find((item) => item.runtimeId === `web:${providerId}`);
    if (runtime) {
      runtime.availability = open ? "AVAILABLE" : "DOWN";
      runtime.message = open ? "Visible session open" : "Visible session closed";
    }
    this.event(open ? "window.opened" : "window.closed", `${provider.name} 子窗口已${open ? "打开" : "关闭"}`, { providerId });
    this.persist();
  }

  private event(type: AuditEvent["type"], message: string, refs: Pick<AuditEvent, "taskId" | "providerId" | "stepId" | "runtimeId" | "evidenceRef" | "budgetDelta">): void {
    this.snapshotValue.events.unshift({ id: randomUUID(), at: new Date().toISOString(), type, message, ...refs });
    this.snapshotValue.events = this.snapshotValue.events.slice(0, 200);
  }

  private newRun(taskId: string, providerId: ProviderId, round: number, inputPrompt: string, transport: RunTransport = "web"): ProviderRun {
    const now = new Date().toISOString();
    return { id: randomUUID(), taskId, providerId, transport, round, phase: "queued", outcome: null, message: transport === "api" ? "等待 API 预检" : "等待可见预填", inputPrompt, adapterVersion: "unresolved", createdAt: now, updatedAt: now };
  }

  private reconcileTask(taskId: string): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const maxRound = Math.max(...this.runsForTask(taskId).map((run) => run.round));
    const runs = this.runsForTask(taskId).filter((run) => run.round === maxRound);
    if (runs.length === 0 || ["cancelled", "paused"].includes(task.status)) return;
    task.status = runs.every((run) => run.phase === "completed") ? "completed" : runs.some((run) => run.phase === "failed") ? "failed" : runs.some((run) => run.phase === "blocked") ? "waiting" : "running";
    if (task.status === "completed") {
      const council = this.snapshotValue.councils.find((item) => item.taskId === taskId);
      if (council && council.stage !== "completed") { task.status = "running"; task.executionPhase = "NEXT_STEP"; task.nextAction = "ADVANCE_COUNCIL"; }
      else { task.executionPhase = "COMPLETED"; task.nextAction = "REPORT_EVIDENCE"; }
    }
    task.updatedAt = new Date().toISOString();
  }

  private beginStartupSession(): void {
    const previousActiveId = this.snapshotValue.activeConversationId;
    const previousActive = this.snapshotValue.conversations.find((item) => item.id === previousActiveId);

    for (const task of this.snapshotValue.tasks) {
      if (!["queued", "running", "waiting"].includes(task.status)) continue;
      const runs = this.runsForTask(task.id);
      for (const run of runs) {
        if (!run.response || run.review?.response_id === run.response.responseId) continue;
        run.review = reviewResponse(run.response, task.reviewPolicy ?? defaultReviewPolicy, run.attempts ?? 0);
        run.phase = run.review.status === "PASS" ? "completed" : run.review.status === "RETRY" ? "queued" : run.review.status === "FAILED" ? "failed" : "blocked";
        if (run.review.status === "RETRY") run.attempts = (run.attempts ?? 0) + 1;
        task.executionPhase = run.review.status === "PASS" ? "NEXT_STEP" : run.review.status === "HUMAN_REQUIRED" ? "WAITING_FOR_USER" : run.review.status;
        task.nextAction = run.review.next_action;
      }
      this.reconcileTask(task.id);
      for (const run of runs) this.commitDispatchForRound(task.id, run.round);
      if (runs.some((run) => ["sending", "waiting"].includes(run.phase))) {
        task.status = "waiting";
        task.executionPhase = "WAITING_FOR_RESPONSE";
        task.nextAction = "RESTORE_SESSION_AND_CAPTURE";
      }
    }
    this.snapshotValue.activeConversationId = previousActive?.id ?? this.snapshotValue.conversations[0].id;
    this.event("conversation.selected", "应用启动；已恢复活动对话、未完成任务和证据", {});
    this.persist();
  }

  private read(): AppSnapshot {
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AppSnapshot>;
      const sourceVersion = saved.schemaVersion ?? 1;
      if (sourceVersion !== 1 && sourceVersion !== 2) throw new Error(`Unsupported state schema version: ${sourceVersion}`);
      if (sourceVersion === 1) {
        const backup = `${this.filePath}.pre-v2.bak`;
        if (!fs.existsSync(backup)) fs.copyFileSync(this.filePath, backup, fs.constants.COPYFILE_EXCL);
      }
      const builtins = providerSeed.map((seed) => ({ ...seed, ...(saved.providers?.find((item) => item.id === seed.id) ?? {}), windowOpen: false, isCustom: false }));
      const custom = (saved.providers ?? []).filter((item) => item.isCustom).map((item) => ({ ...item, windowOpen: false }));
      const providers = [...builtins, ...custom];
      const tasks = (saved.tasks ?? []).map((task) => {
        const legacy = task as BossTask & { providerId?: ProviderId };
        const providerIds = task.providerIds ?? (legacy.providerId ? [legacy.providerId] : ["chatgpt"]);
        const appMode = task.appMode ?? "chat";
        return { ...task, conversationId: task.conversationId ?? defaultConversationId, mode: task.mode ?? "direct", appMode, providerIds, transportByProvider: task.transportByProvider ?? Object.fromEntries(providerIds.map((id) => [id, "web"])) };
      });
      const now = new Date().toISOString();
      const folders = saved.folders?.length ? saved.folders : [{ id: defaultFolderId, name: "常规", storageName: "常规", createdAt: now, updatedAt: now }];
      const conversations = saved.conversations?.length ? saved.conversations : [{ id: defaultConversationId, folderId: folders[0].id, title: tasks.length ? "既有对话" : "新对话", storageName: tasks.length ? "既有对话" : "新对话", taskIds: tasks.map((task) => task.id), createdAt: tasks.at(-1)?.createdAt ?? now, updatedAt: tasks[0]?.updatedAt ?? now }];
      const conversationIds = new Set(conversations.map((conversation) => conversation.id));
      for (const task of tasks) if (!conversationIds.has(task.conversationId)) task.conversationId = conversations[0].id;
      for (const conversation of conversations) conversation.taskIds = tasks.filter((task) => !task.parentTaskId && task.conversationId === conversation.id).map((task) => task.id).reverse();
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const runs = (saved.runs ?? []).map((run) => ({ ...run, transport: run.transport ?? taskById.get(run.taskId)?.transportByProvider[run.providerId] ?? "web" }));
      const accounts = (saved.accounts ?? []).filter((account) => providers.some((provider) => provider.id === account.providerId));
      const remoteChannels = remoteChannelDefaults(now).map((fallback) => ({ ...fallback, ...(saved.remoteChannels ?? []).find((item) => item.channel === fallback.channel), status: "disabled" as const, message: "应用启动后等待监听器同步" }));
      const controller = saved.controller ?? { kind: "codex-cli" as const, accountMode: "UNKNOWN" as const, message: "正在检测 Codex Runtime" };
      return { schemaVersion: 2, providers, tasks, runs, artifacts: saved.artifacts ?? [], councils: saved.councils ?? [], evidenceBundles: saved.evidenceBundles ?? [], finalResponses: saved.finalResponses ?? [], controller, runtimeStatuses: mergeRuntimeStatuses(providers, controller, saved.runtimeStatuses), roleRoutes: mergeRoleRoutes(saved.roleRoutes), accounts, apiSettings: saved.apiSettings ?? [], remoteChannels, remoteCommands: saved.remoteCommands ?? [], folders, conversations, activeConversationId: conversationIds.has(saved.activeConversationId ?? "") ? saved.activeConversationId! : conversations[0].id, dispatchCheckpoints: saved.dispatchCheckpoints ?? [], events: saved.events ?? [] };
    } catch (error) {
      if (fs.existsSync(this.filePath)) throw new Error(`Cannot restore task state: ${String(error)}`);
      const now = new Date().toISOString();
      const providers = structuredClone(providerSeed);
      const controller = { kind: "codex-cli" as const, accountMode: "UNKNOWN" as const, message: "正在检测 Codex Runtime" };
      return { schemaVersion: 2, providers, tasks: [], runs: [], artifacts: [], councils: [], evidenceBundles: [], finalResponses: [], controller, runtimeStatuses: mergeRuntimeStatuses(providers, controller), roleRoutes: mergeRoleRoutes(), accounts: [], apiSettings: [], remoteChannels: remoteChannelDefaults(now), remoteCommands: [], folders: [{ id: defaultFolderId, name: "常规", storageName: "常规", createdAt: now, updatedAt: now }], conversations: [{ id: defaultConversationId, folderId: defaultFolderId, title: "新对话", storageName: "新对话", taskIds: [], createdAt: now, updatedAt: now }], activeConversationId: defaultConversationId, dispatchCheckpoints: [], events: [] };
    }
  }

  private persist(): void {
    writeJson(this.filePath, this.snapshotValue);
    for (const task of this.snapshotValue.tasks) {
      const runs = this.runsForTask(task.id);
      const fingerprint = TaskLedger.fingerprint({ task, runs });
      if (this.ledgerHashes.get(task.id) === fingerprint) continue;
      this.ledger.create(task.id, task.prompt);
      this.ledger.update(task.id, "task/run transition", (state) => {
        state.completedSteps = [...state.completedSteps.filter((id) => !runs.some((run) => run.id === id)), ...runs.filter((run) => run.review?.status === "PASS").map((run) => run.id)];
        state.pendingSteps = [...state.pendingSteps.filter((id) => !runs.some((run) => run.id === id)), ...runs.filter((run) => !["completed", "failed"].includes(run.phase)).map((run) => run.id)];
        state.currentStep = state.pendingSteps[0] ?? null;
        state.nextAction = task.nextAction ?? task.executionPhase ?? task.status;
        state.usage.browserActions = Math.max(state.usage.browserActions, runs.filter((run) => run.phase === "sending" || run.phase === "waiting" || run.artifactId).length);
        for (const run of runs) {
          const session = { id: run.id, taskId: task.id, provider: run.transport + ":" + run.providerId, checkpoint: state.revision, health: run.outcome ?? "UNKNOWN", url: run.sessionUrl, resumeStrategy: run.sessionUrl ? "RESTORE_URL" as const : "RECONSTRUCT" as const };
          const index = state.sessions.findIndex((item) => item.id === run.id);
          if (index < 0) state.sessions.push(session); else state.sessions[index] = { ...state.sessions[index], ...session };
        }
      });
      this.ledgerHashes.set(task.id, fingerprint);
    }
    this.history?.sync(this.snapshotValue);
  }

  private checkpoint(checkpointId: string): DispatchCheckpoint {
    const checkpoint = this.snapshotValue.dispatchCheckpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) throw new Error(`Unknown dispatch checkpoint: ${checkpointId}`);
    return checkpoint;
  }

  private folder(folderId: string): ConversationFolder {
    const folder = this.snapshotValue.folders.find((item) => item.id === folderId);
    if (!folder) throw new Error(`Unknown folder: ${folderId}`);
    return folder;
  }

  private conversation(conversationId: string): BossConversation {
    const conversation = this.snapshotValue.conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error(`Unknown conversation: ${conversationId}`);
    return conversation;
  }

  private uniqueFolderStorageName(name: string, exceptId?: string): string {
    return uniqueName(safeSegment(validName(name, "文件夹")), this.snapshotValue.folders.filter((item) => item.id !== exceptId).map((item) => item.storageName));
  }

  private uniqueConversationStorageName(folderId: string, title: string, exceptId?: string): string {
    return uniqueName(safeSegment(validName(title, "对话")), this.snapshotValue.conversations.filter((item) => item.folderId === folderId && item.id !== exceptId).map((item) => item.storageName));
  }
}

function validName(value: string, label: string): string {
  const result = value.trim();
  if (!result || result.length > 80) throw new Error(`${label}名称需为 1–80 个字符`);
  return result;
}

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

function validCommandPrefix(value: string): string {
  const prefix = value.trim();
  if (!/^\/[^\s]{1,19}$/.test(prefix)) throw new Error("指令前缀必须以 / 开头，长度为 2–20 且不能包含空格");
  return prefix;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function remoteChannelDefaults(now: string): RemoteChannelSetting[] {
  return (["wechat", "qq"] as const).map((channel) => ({ channel, enabled: false, commandPrefix: "/boss", status: "disabled", message: "远程指令监听未启用", updatedAt: now }));
}

const roles: RoleRouteView["role"][] = ["planner", "researcher", "reviewer", "synthesizer", "coder", "validator", "critic"];

function mergeRuntimeStatuses(providers: Provider[], controller: ControllerState, saved: RuntimeStatusView[] = []): RuntimeStatusView[] {
  const defaults: RuntimeStatusView[] = [
    ...providers.map((provider, index) => ({ runtimeId: `web:${provider.id}`, label: `${provider.name} Web`, kind: "web" as const, availability: provider.windowOpen ? "AVAILABLE" as const : "DOWN" as const, budget: "UNKNOWN" as const, enabled: true, priority: index + 10, message: provider.windowOpen ? "Visible session open" : "Visible session closed" })),
    { runtimeId: "codex:cli", label: "Codex CLI", kind: "codex", availability: controller.accountMode === "CHATGPT" ? "AVAILABLE" : controller.accountMode === "NOT_AUTHENTICATED" ? "AUTH_REQUIRED" : "DOWN", budget: "UNKNOWN", enabled: true, priority: 50, message: controller.message }
  ];
  return defaults.map((fallback) => ({ ...fallback, ...(saved.find((item) => item.runtimeId === fallback.runtimeId) ?? {}), availability: fallback.availability, message: fallback.message }));
}

function mergeRoleRoutes(saved: RoleRouteView[] = []): RoleRouteView[] {
  return roles.map((role) => saved.find((item) => item.role === role) ?? { role, runtimeIds: role === "coder" ? ["codex:cli", "web:chatgpt"] : ["web:chatgpt", "web:claude", "web:gemini", "codex:cli"], fallback: true });
}
