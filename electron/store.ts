import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AdapterOutcome, AppSnapshot, AuditEvent, BossTask, CodexReview, ControllerState, CouncilSession, DispatchCheckpoint, EvidenceBundle, Provider, ProviderAccountMode, ProviderId, ProviderRun, ProviderRunPhase, RawArtifact, TaskMode, TaskStatus } from "../src/shared/contracts";

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

  constructor(private readonly filePath: string) {
    this.snapshotValue = this.read();
  }

  snapshot(): AppSnapshot {
    return structuredClone(this.snapshotValue);
  }

  createTask(title: string, prompt: string, providerIds: ProviderId[], mode: TaskMode = "direct"): BossTask {
    const now = new Date().toISOString();
    const task: BossTask = { id: randomUUID(), title, prompt, providerIds, status: "queued", mode, createdAt: now, updatedAt: now };
    this.snapshotValue.tasks.unshift(task);
    this.snapshotValue.runs.push(...providerIds.map((providerId) => this.newRun(task.id, providerId, 1, prompt)));
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

  updateRun(runId: string, phase: ProviderRunPhase, outcome: AdapterOutcome | null, message: string, adapterVersion?: string): void {
    const run = this.snapshotValue.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    run.phase = phase;
    run.outcome = outcome;
    run.message = message;
    if (adapterVersion) run.adapterVersion = adapterVersion;
    run.updatedAt = new Date().toISOString();
    this.event(phase === "prepared" ? "adapter.prepared" : phase === "waiting" ? "adapter.sent" : "adapter.outcome", message, { taskId: run.taskId, providerId: run.providerId });
    this.persist();
  }

  captureArtifact(runId: string, content: string, sourceUrl: string): RawArtifact {
    const run = this.snapshotValue.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    const council = this.snapshotValue.councils.find((item) => item.taskId === run.taskId);
    const kind: RawArtifact["kind"] = council?.stage === "proposals" ? "proposal" : council?.stage === "peer_review" ? "peer_review" : council?.stage === "synthesis" ? "synthesis" : "response";
    const artifact: RawArtifact = { id: randomUUID(), taskId: run.taskId, runId, providerId: run.providerId, kind, content: content.slice(0, 100000), capturedAt: new Date().toISOString(), sourceUrl, untrusted: true };
    this.snapshotValue.artifacts.unshift(artifact);
    run.artifactId = artifact.id;
    run.phase = "completed";
    run.outcome = "SUCCESS";
    run.message = "已捕获原始回答，等待验证";
    run.updatedAt = artifact.capturedAt;
    this.event("artifact.captured", `已捕获 ${run.providerId} 原始回答`, { taskId: run.taskId, providerId: run.providerId });
    this.reconcileTask(run.taskId);
    this.commitDispatchForRound(run.taskId, run.round);
    this.persist();
    return artifact;
  }

  addCouncilRound(taskId: string, prompts: Map<ProviderId, string>, stage: CouncilSession["stage"]): void {
    const council = this.snapshotValue.councils.find((item) => item.taskId === taskId);
    if (!council) throw new Error(`Unknown council task: ${taskId}`);
    council.round += 1;
    council.stage = stage;
    council.updatedAt = new Date().toISOString();
    for (const providerId of council.providerIds) {
      const prompt = prompts.get(providerId);
      if (prompt) this.snapshotValue.runs.push(this.newRun(taskId, providerId, council.round, prompt));
    }
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
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
    this.event("dispatch.checkpoint", `第 ${checkpoint.round} 轮全部提交成功，开始顺序采集`, { taskId: checkpoint.taskId });
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
      if (prompt) this.snapshotValue.runs.push(this.newRun(taskId, providerId, nextRound, prompt));
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
    this.event("provider.added", `自定义网页 AI“${name}”已添加`, { providerId: provider.id });
    this.persist();
    return provider;
  }

  removeCustomProvider(providerId: ProviderId): void {
    const index = this.snapshotValue.providers.findIndex((item) => item.id === providerId && item.isCustom);
    if (index < 0) throw new Error(`Unknown custom provider: ${providerId}`);
    const [provider] = this.snapshotValue.providers.splice(index, 1);
    this.snapshotValue.accounts = this.snapshotValue.accounts.filter((account) => account.providerId !== providerId);
    this.event("provider.removed", `自定义网页 AI“${provider.name}”已移除`, { providerId });
    this.persist();
  }

  setTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
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
    this.event(open ? "window.opened" : "window.closed", `${provider.name} 子窗口已${open ? "打开" : "关闭"}`, { providerId });
    this.persist();
  }

  private event(type: AuditEvent["type"], message: string, refs: Pick<AuditEvent, "taskId" | "providerId">): void {
    this.snapshotValue.events.unshift({ id: randomUUID(), at: new Date().toISOString(), type, message, ...refs });
    this.snapshotValue.events = this.snapshotValue.events.slice(0, 200);
  }

  private newRun(taskId: string, providerId: ProviderId, round: number, inputPrompt: string): ProviderRun {
    const now = new Date().toISOString();
    return { id: randomUUID(), taskId, providerId, round, phase: "queued", outcome: null, message: "等待可见预填", inputPrompt, adapterVersion: "unresolved", createdAt: now, updatedAt: now };
  }

  private reconcileTask(taskId: string): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const maxRound = Math.max(...this.runsForTask(taskId).map((run) => run.round));
    const runs = this.runsForTask(taskId).filter((run) => run.round === maxRound);
    task.status = runs.every((run) => run.phase === "completed") ? "completed" : runs.some((run) => ["failed", "blocked"].includes(run.phase)) ? "waiting" : "running";
    task.updatedAt = new Date().toISOString();
  }

  private read(): AppSnapshot {
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AppSnapshot>;
      const builtins = providerSeed.map((seed) => ({ ...seed, ...(saved.providers?.find((item) => item.id === seed.id) ?? {}), windowOpen: false, isCustom: false }));
      const custom = (saved.providers ?? []).filter((item) => item.isCustom).map((item) => ({ ...item, windowOpen: false }));
      const providers = [...builtins, ...custom];
      const tasks = (saved.tasks ?? []).map((task) => {
        const legacy = task as BossTask & { providerId?: ProviderId };
        return { ...task, mode: task.mode ?? "direct", providerIds: task.providerIds ?? (legacy.providerId ? [legacy.providerId] : ["chatgpt"]) };
      });
      const accounts = (saved.accounts ?? []).filter((account) => providers.some((provider) => provider.id === account.providerId));
      return { providers, tasks, runs: saved.runs ?? [], artifacts: saved.artifacts ?? [], councils: saved.councils ?? [], evidenceBundles: saved.evidenceBundles ?? [], controller: saved.controller ?? { kind: "codex-cli", accountMode: "UNKNOWN", message: "正在检测 Codex 控制端" }, accounts, dispatchCheckpoints: saved.dispatchCheckpoints ?? [], events: saved.events ?? [] };
    } catch {
      return { providers: structuredClone(providerSeed), tasks: [], runs: [], artifacts: [], councils: [], evidenceBundles: [], controller: { kind: "codex-cli", accountMode: "UNKNOWN", message: "正在检测 Codex 控制端" }, accounts: [], dispatchCheckpoints: [], events: [] };
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.snapshotValue, null, 2), "utf8");
    try {
      fs.renameSync(temp, this.filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EEXIST", "EPERM"].includes(code ?? "")) throw error;
      fs.copyFileSync(temp, this.filePath);
      fs.unlinkSync(temp);
    }
  }

  private checkpoint(checkpointId: string): DispatchCheckpoint {
    const checkpoint = this.snapshotValue.dispatchCheckpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) throw new Error(`Unknown dispatch checkpoint: ${checkpointId}`);
    return checkpoint;
  }
}
