import { providerVisionSurface } from "./computer/backends/provider-vision-surface";
import { RecoveryScheduler } from "./commander/recovery-scheduler";
import { WebRecovery } from "./commander/web-recovery";
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { migrateBrowserProfile, migrateLegacyPersistentData } from "./runtime-paths";
import type { AppSnapshot, CreateConversationInput, CreateTaskInput, CustomProviderInput, ProviderId, TaskStatus, UpdateApiSettingInput, UpdateRemoteChannelInput, ViewBounds } from "../src/shared/contracts";
import { DEFAULT_PROVIDER_IDS, isDispatchGroupSize, MAX_ACTIVE_PROVIDERS, normalizeCustomProviderInput } from "../src/shared/provider-policy";
import { buildPeerReviewPrompts, buildSynthesisPrompts, extractCouncilFindings } from "../src/shared/council-engine";
import { ProviderAutomation } from "./provider-automation";
import { CodexCliRuntime } from "./runtimes/codex/codex-cli-runtime";
import { ProviderRuntimeAdapter } from "./runtimes/web/provider-runtime-adapter";
import { NativeRuntime, ApiRuntime } from "./runtimes/native-api-runtime";
import { RuntimeRegistry } from "./commander/runtime-registry";
import { BudgetManager } from "./commander/budget-manager";
import { RoleRouter } from "./commander/role-router";
import { Scheduler } from "./commander/scheduler";
import { ContextManager } from "./commander/context-manager";
import { ExecutionGate } from "./commander/execution-gate";
import { compileIntent } from "../src/shared/task-ir";
import { ResourceController } from "./commander/resource-controller";
import { TaskLedger } from "./commander/task-ledger";
import { CircuitBreaker } from "./commander/circuit-breaker";
import { DomainEventBus } from "./commander/event-bus";
import { attachContinuationWaker } from "./commander/continuation-waker";
import { WorkspaceRegistry } from "./workspace/workspace-registry";
import { durableFileFor } from "./workspace/durable-roots";
import { DEFAULT_WORKSPACE_ID } from "../src/shared/workspace";
import { SoftwareLeaseRegistry } from "./computer/software-lease";
import { PermissionManifestStore } from "./security/permission-manifest";
import { ProjectStateStore } from "./project/project-state";
import { ExperienceStore } from "./experience/experience-store";
import { attachExperienceRecorder } from "./experience/experience-recorder";
import { TelemetryStore } from "./telemetry/telemetry-store";
import { attachTelemetryRecorder } from "./telemetry/telemetry-recorder";
import { attachProgressRecorder } from "./commander/progress-recorder";
import { HumanGuidanceGate } from "./commander/human-guidance-gate";
import { ResearchLedger } from "./research/research-ledger";
import { ProtocolManager } from "./research/protocol-manager";
import { ResearchSupervisor } from "./research/research-supervisor";
import { DefaultLevelBExecutor } from "./research/default-levelb-executor";
import type { ResearchIR } from "../src/shared/research-ir";
import type { InterventionKind } from "../src/shared/intervention";
import { MainCommander } from "./commander/main-commander";
import { buildEvidenceBundle, buildRehydrationPrompts } from "./evidence-engine";
import { AccountSessionManager } from "./account-sessions";
import { ProviderViews } from "./provider-views";
import { StateStore } from "./store";
import { ApiSettingsStore } from "./api-settings";
import { ProviderApiClient } from "./provider-api";
import { HistoryRepository } from "./history-repository";
import { RemoteCommandRelay } from "./remote-relay";

let mainWindow: BrowserWindow | null = null;
let store: StateStore;
let providerViews: ProviderViews;
let automation: ProviderAutomation;
let codexRuntime: CodexCliRuntime;
let commander: MainCommander;
let recoveryScheduler: RecoveryScheduler;
let budgetManager: BudgetManager;
let accountSessions: AccountSessionManager;
let apiSettings: ApiSettingsStore;
let providerApi: ProviderApiClient;
let historyRepository: HistoryRepository;
let remoteRelay: RemoteCommandRelay;
let domainEventBus: DomainEventBus | undefined;
let detachContinuationWaker: (() => void) | undefined;
let progressAggregator: ReturnType<typeof attachProgressRecorder>["aggregator"] | undefined;
let humanGuidance: HumanGuidanceGate | undefined;
let researchLedgers: ResearchLedger | undefined;
let researchProtocols: ProtocolManager | undefined;
let researchSupervisor: ResearchSupervisor | undefined;

const overrideDataRoot = process.argv.find((arg) => arg.startsWith("--boss-data-dir="))?.slice("--boss-data-dir=".length);
const legacyDataRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "CodexBoss") : undefined;
const projectDataRoot = path.join(app.getAppPath(), "runtime-data");
const dataRoot = overrideDataRoot ? path.resolve(overrideDataRoot) : projectDataRoot;
app.setPath("userData", dataRoot);
app.setPath("sessionData", path.join(dataRoot, "Session Data"));

const ownsInstance = app.requestSingleInstanceLock();
const isSmokeTest = process.argv.includes("--codex-boss-smoke-test");
if (isSmokeTest) app.disableHardwareAcceleration();

if (!ownsInstance) {
  app.quit();
}
if (ownsInstance) {
  fs.mkdirSync(dataRoot, { recursive: true });
  if (!overrideDataRoot && legacyDataRoot) {
    migrateLegacyPersistentData(legacyDataRoot, dataRoot, path.join(app.getAppPath(), "history"));
  }
  const cacheRoot = path.join(overrideDataRoot ? path.resolve(overrideDataRoot) : app.getAppPath(), ".cache");
  const sessionRoot = path.join(cacheRoot, "browser-profile");
  const oldSessionRoot = !overrideDataRoot && legacyDataRoot ? path.join(legacyDataRoot, "Session Data") : app.getPath("sessionData");
  // Migrate only after acquiring the instance lock, before any browser starts.
  migrateBrowserProfile(oldSessionRoot, sessionRoot);
  for (const name of ["tmp", "crash-dumps"]) fs.mkdirSync(path.join(cacheRoot, name), { recursive: true });
  app.setPath("sessionData", sessionRoot);
  app.setPath("temp", path.join(cacheRoot, "tmp"));
  app.setPath("crashDumps", path.join(cacheRoot, "crash-dumps"));
  process.env.TEMP = process.env.TMP = path.join(cacheRoot, "tmp");
}

function publish(): AppSnapshot {
  store.setApiSettings(apiSettings.snapshot(store.snapshot().providers.map((item) => item.id)));
  const snapshot = store.snapshot();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("boss:snapshot-updated", snapshot);
  }
  return snapshot;
}

function provider(id: ProviderId) {
  const match = store.snapshot().providers.find((item) => item.id === id);
  if (!match) throw new Error(`Unknown provider: ${id}`);
  return match;
}

function taskTransports(input: CreateTaskInput, providerIds: ProviderId[]) {
  const appMode = input.appMode ?? "chat";
  const transports = Object.fromEntries(providerIds.map((providerId) => {
    const requested = input.transportByProvider?.[providerId] ?? "web";
    if (requested !== "web" && requested !== "api") throw new Error(`无效执行通道：${providerId}`);
    return [providerId, appMode === "chat" ? "web" : requested];
  }));
  return { appMode, transports };
}

function openProviderWithinLimit(providerId: ProviderId): void {
  const target = provider(providerId);
  const openCount = store.snapshot().providers.filter((item) => item.windowOpen).length;
  if (!target.windowOpen && openCount >= MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时打开 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
  providerViews.open(target);
}

function openProjectState(workspaceId: string): ProjectStateStore {
  return new ProjectStateStore(durableFileFor(app.getPath("userData"), workspaceId, path.join(".boss", "project-state.json")));
}

/** Records a durable task completion into its workspace's project state (AP15 seam). */
function recordTaskOutcome(taskId: string): void {
  const snapshot = store.snapshot();
  const task = snapshot.tasks.find((item) => item.id === taskId);
  const final = store.finalResponseForTask(taskId);
  if (!task || !final) return;
  const workspaceId = task.workspaceId ?? DEFAULT_WORKSPACE_ID;
  try {
    openProjectState(workspaceId).recordTaskCompletion(workspaceId, {
      taskId: task.id,
      title: task.title,
      findings: final.content.slice(0, 2000),
      nextActions: task.plan && task.plan.steps.some((step) => step.kind === "edit") ? ["verify merged changes with the full test suite"] : undefined
    });
  } catch { /* project state recording is advisory; never blocks completion */ }
}

async function advanceCouncilRound(taskId: string): Promise<void> {
    const snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    const council = snapshot.councils.find((item) => item.taskId === taskId);
    if (!task || !council) throw new Error("Council task not found");
    const checkpoint = snapshot.dispatchCheckpoints.find((item) => item.taskId === taskId && item.round === council.round);
    if (!checkpoint || checkpoint.status !== "COMMITTED" || checkpoint.requiresReconciliation) throw new Error("当前轮次未达到 所选 AI 全员成功检查点");
    const roundRuns = snapshot.runs.filter((run) => run.taskId === taskId && run.round === council.round);
    if (roundRuns.length !== council.providerIds.length || !roundRuns.every((run) => run.phase === "completed" && run.artifactId)) throw new Error("当前 Council 阶段尚未收齐全部可验证回答");
    const artifacts = roundRuns.map((run) => snapshot.artifacts.find((artifact) => artifact.id === run.artifactId)).filter((artifact) => artifact !== undefined);
    if (council.stage === "proposals") {
      store.addCouncilRound(taskId, buildPeerReviewPrompts(task.prompt, artifacts, council.providerIds), "peer_review");
      await automation.dispatchTask(taskId);
    } else if (council.stage === "peer_review") {
      const allProposals = snapshot.artifacts.filter((artifact) => artifact.taskId === taskId && artifact.kind === "proposal");
      const analysis = extractCouncilFindings(artifacts);
      store.updateCouncil(taskId, analysis);
      store.addCouncilRound(taskId, buildSynthesisPrompts(task.prompt, allProposals, artifacts, council.providerIds, analysis), "synthesis");
      await automation.dispatchTask(taskId);
    } else if (council.stage === "synthesis") {
      store.updateCouncil(taskId, { stage: "completed" });
      store.setTaskStatus(taskId, "completed");
      recordTaskOutcome(taskId);
    } else {
      throw new Error(`Council cannot advance from ${council.stage}`);
    }
    publish();
}

function attachProviderViews(): void {
  if (!mainWindow) throw new Error("Main window was not created");
  providerViews = new ProviderViews(mainWindow, (id, open) => {
    store.setWindow(id, open);
    publish();
  }, accountSessions, (providerId, suggestedName) => historyRepository.generatedFilePath(store.snapshot(), store.snapshot().activeConversationId, providerId, suggestedName));
  automation?.dispose();
  const finalizer = { finalize: (id: string) => commander.finalizeTask(id, publish) };
  const recovery = new WebRecovery(store, providerViews, () => automation, provider, recoveryScheduler, budgetManager);
  automation = new ProviderAutomation(store, providerViews, provider, publish, accountSessions, providerApi, advanceCouncilRound, async (id) => { if (store.finalResponseForTask(id)) { recordTaskOutcome(id); return; } await finalizer.finalize(id); recordTaskOutcome(id); for (const run of store.runsForTask(id).filter((item) => item.review?.status === "PASS")) budgetManager.observeSuccess(run.transport + ":" + run.providerId); }, (run, strategy, retryAt) => recovery.defer(run, strategy, retryAt), domainEventBus);
  detachContinuationWaker?.();
  detachContinuationWaker = domainEventBus ? attachContinuationWaker(domainEventBus, (taskId) => automation.continueIfReady(taskId)) : undefined;
  recoveryScheduler.start();
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    show: !isSmokeTest,
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: "Codex Boss — Controller",
    backgroundColor: "#0b0d10",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      offscreen: isSmokeTest,
      backgroundThrottling: !isSmokeTest,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`Renderer failed to load: ${code} ${description} ${url}`);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    automation?.dispose();
    providerViews?.destroyAll();
  });
}

if (ownsInstance) app.whenReady().then(() => {
  historyRepository = new HistoryRepository(path.join(overrideDataRoot ? dataRoot : app.getAppPath(), "history"));
  store = new StateStore(path.join(app.getPath("userData"), "state.json"), historyRepository);
  apiSettings = new ApiSettingsStore(
    path.join(app.getPath("userData"), "api-settings.json"),
    (plainText) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统安全存储不可用，无法保存 API Key");
      return safeStorage.encryptString(plainText).toString("base64");
    },
    (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, "base64"))
  );
  providerApi = new ProviderApiClient(apiSettings);
  store.setApiSettings(apiSettings.snapshot(store.snapshot().providers.map((item) => item.id)));
  accountSessions = new AccountSessionManager(store, publish);
  remoteRelay = new RemoteCommandRelay(
    path.join(app.getAppPath(), "scripts", "pc-chat-relay.ps1"),
    (channel, status, message) => { store.setRemoteChannelRuntime(channel, status, message); publish(); },
    (channel, body, sourceWindow) => { if (store.receiveRemoteCommand(channel, body, sourceWindow)) publish(); }
  );
  remoteRelay.sync(store.snapshot().remoteChannels);
  const runtimeRegistry = new RuntimeRegistry();
  budgetManager = new BudgetManager(path.join(app.getPath("userData"), ".boss", "runtime-budget.json"));
  const domainEvents = new DomainEventBus();
  domainEventBus = domainEvents;
  progressAggregator = attachProgressRecorder(domainEvents).aggregator;
  humanGuidance = new HumanGuidanceGate(path.join(app.getPath("userData"), ".boss", "interventions.json"));
  researchLedgers = new ResearchLedger(path.join(app.getPath("userData"), ".boss", "research"));
  researchProtocols = new ProtocolManager(path.join(app.getPath("userData"), ".boss", "research-protocols"));
  researchSupervisor = new ResearchSupervisor({ ledger: researchLedgers, executor: new DefaultLevelBExecutor() });
  attachTelemetryRecorder(domainEvents, new TelemetryStore(path.join(app.getPath("userData"), ".boss", "telemetry.json")));  const workspaces = new WorkspaceRegistry(path.join(app.getPath("userData"), ".boss", "workspaces.json"));
  workspaces.ensureShims(fs.realpathSync(app.getAppPath()));
  const permissionManifests = new PermissionManifestStore(durableFileFor(app.getPath("userData"), workspaces.activeWorkspaceId(), path.join(".boss", "permission-manifest.json")));
  const projectStates = new ProjectStateStore(durableFileFor(app.getPath("userData"), workspaces.activeWorkspaceId(), path.join(".boss", "project-state.json")));
  const experiences = new ExperienceStore(durableFileFor(app.getPath("userData"), workspaces.activeWorkspaceId(), path.join(".boss", "experience.json")));
  attachExperienceRecorder(domainEvents, experiences, { sourceFor: (taskId) => store.snapshot().tasks.find((task) => task.id === taskId)?.workspaceId ?? taskId });
  const softwareLeases = new SoftwareLeaseRegistry();
  recoveryScheduler = new RecoveryScheduler(path.join(app.getPath("userData"), ".boss", "recovery.json"), () => {
    for (const item of recoveryScheduler.list().filter((record) => record.state === "PAUSED")) {
      const task = store.snapshot().tasks.find((task) => task.id === item.taskId);
      if (task && (task.recoveryAt || task.recoveryMessage !== item.error)) store.setRecoveryState(item.taskId, undefined, item.error ?? "Recovery paused");
    }
    publish();
  }, domainEvents);
  const resourceController = new ResourceController(path.join(app.getPath("userData"), ".boss", "runtime-resources.json"));
  codexRuntime = new CodexCliRuntime(path.join(app.getPath("userData"), ".codex-boss"));
  runtimeRegistry.register(codexRuntime);
  runtimeRegistry.register(new NativeRuntime(app.getAppPath()));
  for (const item of store.snapshot().providers) runtimeRegistry.register(new ApiRuntime(item.id, providerApi));
  const contextManager = new ContextManager(path.join(app.getPath("userData"), "task-contexts.json"));
  contextManager.retainTaskIds(store.snapshot().tasks.map((task) => task.id));
  const circuitBreaker = new CircuitBreaker(path.join(app.getPath("userData"), ".boss", "circuit-breaker.json"));
  commander = new MainCommander(store, runtimeRegistry, new Scheduler(), new RoleRouter(runtimeRegistry, budgetManager, resourceController), budgetManager, contextManager, new ExecutionGate(), new TaskLedger(path.join(app.getPath("userData"), ".boss", "tasks")), resourceController, recoveryScheduler, { visionSurface: providerVisionSurface(() => providerViews, path.join(dataRoot, ".boss", "vision")), readBrowser: async (id) => {
    const view = providerViews.get(provider(id).id);
    if (!view) throw new Error("Provider page is not open");
    return view.webContents.executeJavaScript("JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText??'').slice(0,30000)})");
  } }, circuitBreaker, domainEvents, workspaces, softwareLeases);
  void codexRuntime.detect().then((controller) => { store.setController(controller); publish(); });
  createMainWindow();
  attachProviderViews();
  for (const item of store.snapshot().providers) runtimeRegistry.register(new ProviderRuntimeAdapter("web:" + item.id, {
    async healthCheck() { return { runtimeId: "web:" + item.id, availability: providerViews.get(item.id) ? "AVAILABLE" : "DOWN", message: "Visible provider session", checkedAt: new Date().toISOString() }; },
    execute: (request, signal) => automation.executeWorker(item.id, request, signal)
  }));
  const resumeLocalTasks = async () => {
    for (const task of store.snapshot().tasks.filter((item) => item.workspacePath && ["running", "waiting", "queued"].includes(item.status) && commander.canResumeTask(item.id))) {
      try {
        if (await commander.executeDeterministic(task.id, task.workspacePath!)) await automation.continueIfReady(task.id);
        else await commander.executePlan(task.id, task.workspacePath!);
        publish();
      } catch (error) { store.setRecoveryState(task.id, undefined, String(error)); publish(); }
    }
  };
  if (!isSmokeTest) {
    DEFAULT_PROVIDER_IDS.forEach(openProviderWithinLimit);
    void automation.resumePending().catch((error) => console.error("Resume paused", error));
    void resumeLocalTasks();
  }

  ipcMain.handle("boss:snapshot", () => store.snapshot());
  ipcMain.handle("boss:progress", () => ({ summaries: progressAggregator?.summaries() ?? [], detail: (progressAggregator?.detail() ?? []).slice(-100) }));
  ipcMain.handle("boss:active-intervention", (_event, taskId: string) => humanGuidance?.activeFor(taskId) ?? undefined);
  ipcMain.handle("boss:list-interventions", (_event, taskId?: string) => humanGuidance?.list(taskId) ?? []);
  ipcMain.handle("boss:resolve-intervention", (_event, taskId: string, kind: InterventionKind, answer: string) => humanGuidance?.resolve(taskId, kind, answer));

  // Research mode (plan 9-6 Phase 5+): durable ledger + protocol manager surface.
  ipcMain.handle("boss:research-start", (_event, input: { id?: string; goal: string; workspace: string; reviewers: string[]; autonomy?: "AUTOPILOT" | "GUIDED"; maxExperiments?: number; maxSteps?: number }) => {
    if (!input.goal.trim() || !input.workspace.trim()) throw new Error("Research goal and workspace are required");
    if (!input.reviewers.length) throw new Error("Research requires at least one reviewer");
    const ir: ResearchIR = {
      schemaVersion: 1,
      id: input.id ?? `research-${Date.now()}`,
      goal: input.goal.trim(),
      scope: { workspace: input.workspace.trim(), allowedDomains: [], reviewers: input.reviewers, autonomy: input.autonomy ?? "AUTOPILOT", budget: { maxExperiments: input.maxExperiments ?? 5, maxSteps: input.maxSteps ?? 100 } },
      state: "SCOPING",
      researchQuestions: [],
      hypotheses: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const record = researchLedgers!.create(ir);
    domainEvents.publish({ type: "TOOL_RESULT_READY", taskId: ir.id, message: `research ${ir.id} started` });
    return record;
  });
  ipcMain.handle("boss:research-status", (_event, id: string) => researchLedgers?.load(id) ?? null);
  ipcMain.handle("boss:research-step", async (_event, id: string) => researchSupervisor?.step(id) ?? null);
  ipcMain.handle("boss:research-protocol-freeze", (_event, id: string, protocol: import("../src/shared/research-protocol").ResearchProtocol) => researchProtocols?.freeze(id, protocol));
  ipcMain.handle("boss:project-state", (_event, workspaceId?: string) => {
    const target = workspaceId ?? workspaces.activeWorkspaceId();
    return openProjectState(target).summary(target);
  });
  ipcMain.handle("boss:create-task", (_event, input: CreateTaskInput) => {
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("Title and prompt are required");
    const providerIds = [...new Set(input.providerIds)];
    if (providerIds.length === 0) throw new Error("At least one provider is required");
    if (providerIds.length > MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时选择 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
    providerIds.forEach(provider);
    const { appMode, transports } = taskTransports(input, providerIds);
    commander.createTask({ title: input.title.trim(), objective: input.prompt.trim(), providerIds, mode: input.mode ?? "direct", appMode, transports, conversationId: input.conversationId, reviewPolicy: input.reviewPolicy, finalizationPolicy: input.finalizationPolicy });
    return publish();
  });
  ipcMain.handle("boss:dispatch-task", async (_event, input: CreateTaskInput) => {
    const providerIds = [...new Set(input.providerIds)];
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("Title and prompt are required");
    if (compileIntent(input.prompt).estimatedComplexity !== "L0" && !isDispatchGroupSize(providerIds.length)) throw new Error("请选择 1–5 个 AI；默认使用单 AI");
    providerIds.forEach(provider);
    const openIds = new Set(store.snapshot().providers.filter((item) => item.windowOpen).map((item) => item.id));
    if (providerIds.some((id) => !openIds.has(id))) throw new Error("所选 AI 必须全部处于已打开状态");
    const { appMode, transports } = taskTransports(input, providerIds);
    const task = commander.createTask({ title: input.title.trim(), objective: input.prompt.trim(), providerIds, mode: input.mode ?? "direct", appMode, transports, conversationId: input.conversationId, reviewPolicy: input.reviewPolicy, finalizationPolicy: input.finalizationPolicy });
    commander.startTask(task.id);
    publish();
    const workspace = input.workspacePath ? fs.realpathSync(input.workspacePath) : app.getAppPath();
    try { if (!await commander.executeDeterministic(task.id, workspace) && !await commander.executePlan(task.id, workspace)) await automation.dispatchTask(task.id); }
    catch (error) { store.setRecoveryState(task.id, undefined, String(error)); publish(); throw error; }
    await automation.continueIfReady(task.id);
    return publish();
  });
  ipcMain.handle("boss:update-api-setting", (_event, input: UpdateApiSettingInput) => {
    provider(input.providerId);
    apiSettings.update(input);
    return publish();
  });
  ipcMain.handle("boss:update-remote-channel", (_event, input: UpdateRemoteChannelInput) => {
    store.updateRemoteChannel(input.channel, input.enabled, input.commandPrefix);
    remoteRelay.sync(store.snapshot().remoteChannels);
    return publish();
  });
  ipcMain.handle("boss:update-runtime-control", (_event, runtimeId: string, enabled: boolean, priority: number) => { store.setRuntimeControl(runtimeId, Boolean(enabled), Number(priority)); return publish(); });
  ipcMain.handle("boss:update-role-route", (_event, role, runtimeIds: string[], fallback: boolean) => { store.setRoleRoute(role, runtimeIds, Boolean(fallback)); return publish(); });
  ipcMain.handle("boss:load-remote-command", (_event, commandId: string) => { store.setRemoteCommandStatus(commandId, "loaded"); return publish(); });
  ipcMain.handle("boss:dismiss-remote-command", (_event, commandId: string) => { store.setRemoteCommandStatus(commandId, "dismissed"); return publish(); });
  ipcMain.handle("boss:create-folder", (_event, name: string) => { store.createFolder(name); return publish(); });
  ipcMain.handle("boss:rename-folder", (_event, folderId: string, name: string) => { store.renameFolder(folderId, name); return publish(); });
  ipcMain.handle("boss:create-conversation", (_event, input: CreateConversationInput) => { store.createConversation(input.folderId, input.title); return publish(); });
  ipcMain.handle("boss:rename-conversation", (_event, conversationId: string, title: string) => { store.renameConversation(conversationId, title); return publish(); });
  ipcMain.handle("boss:move-conversation", (_event, conversationId: string, folderId: string) => { store.moveConversation(conversationId, folderId); return publish(); });
  ipcMain.handle("boss:select-conversation", (_event, conversationId: string) => { store.selectConversation(conversationId); return publish(); });
  ipcMain.handle("boss:archive-conversation", (_event, conversationId: string, archived: boolean) => { store.setConversationArchived(conversationId, Boolean(archived)); return publish(); });
  ipcMain.handle("boss:delete-conversation", (_event, conversationId: string) => { store.deleteConversation(conversationId); return publish(); });
  ipcMain.handle("boss:duplicate-conversation", (_event, conversationId: string) => { store.duplicateConversation(conversationId); return publish(); });
  ipcMain.handle("boss:export-conversation", async (_event, conversationId: string) => {
    const exportRoot = path.join(app.getPath("userData"), "exports");
    const destination = historyRepository.exportConversation(store.snapshot(), conversationId, exportRoot);
    const { shell } = await import("electron");
    shell.showItemInFolder(destination);
    return destination;
  });
  ipcMain.handle("boss:add-custom-provider", (_event, input: CustomProviderInput) => {
    const normalized = normalizeCustomProviderInput(input);
    store.addCustomProvider(normalized.name, normalized.url);
    return publish();
  });
  ipcMain.handle("boss:remove-custom-provider", (_event, providerId: ProviderId) => {
    providerViews.close(providerId);
    store.removeCustomProvider(providerId);
    return publish();
  });
  ipcMain.handle("boss:open-provider", (_event, providerId: ProviderId) => {
    openProviderWithinLimit(providerId);
    return publish();
  });
  ipcMain.handle("boss:close-provider", (_event, providerId: ProviderId) => {
    provider(providerId);
    providerViews.close(providerId);
    return publish();
  });
  ipcMain.handle("boss:layout-views", (_event, layout: Partial<Record<ProviderId, ViewBounds>>) => {
    const safeLayout: Partial<Record<ProviderId, ViewBounds>> = {};
    for (const item of store.snapshot().providers) {
      const bounds = layout[item.id];
      if (!bounds) continue;
      if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) continue;
      safeLayout[item.id] = bounds;
    }
    providerViews.layout(safeLayout);
  });
  ipcMain.handle("boss:set-provider-views-visible", (_event, visible: boolean) => providerViews.setVisible(Boolean(visible)));
  ipcMain.handle("boss:launch-task", (_event, taskId: string) => {
    const task = store.snapshot().tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    const current = new Set(store.snapshot().providers.filter((item) => item.windowOpen).map((item) => item.id));
    task.providerIds.forEach((providerId) => current.add(providerId));
    if (current.size > MAX_ACTIVE_PROVIDERS) throw new Error(`当前任务会使已打开页面超过 ${MAX_ACTIVE_PROVIDERS} 个，请先关闭部分页面`);
    task.providerIds.forEach(openProviderWithinLimit);
    store.setTaskStatus(taskId, "running");
    return publish();
  });
  ipcMain.handle("boss:prepare-task", async (_event, taskId: string) => {
    await automation.prepareTask(taskId);
    return publish();
  });
  ipcMain.handle("boss:send-task", async (_event, taskId: string) => {
    await automation.sendTask(taskId);
    return publish();
  });
  ipcMain.handle("boss:release-review", async (_event, taskId: string) => { store.releaseReview(taskId); domainEvents.publish({ type: "HUMAN_APPROVED", taskId, message: "operator approved the review gate" }); await automation.continueIfReady(taskId); return publish(); });
  ipcMain.handle("boss:capture-task", async (_event, taskId: string) => {
    await automation.captureTask(taskId);
    return publish();
  });
  ipcMain.handle("boss:advance-council", async (_event, taskId: string) => { await automation.continueIfReady(taskId); return publish(); });

  ipcMain.handle("boss:build-evidence", (_event, taskId: string) => {
    const snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    const council = snapshot.councils.find((item) => item.taskId === taskId);
    const previous = snapshot.evidenceBundles.find((item) => item.taskId === taskId);
    store.saveEvidence(buildEvidenceBundle(task, snapshot.artifacts, council, previous?.codexReview));
    return publish();
  });
  ipcMain.handle("boss:rehydrate-evidence", async (_event, taskId: string) => {
    let snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    let bundle = snapshot.evidenceBundles.find((item) => item.taskId === taskId);
    if (!bundle) {
      bundle = buildEvidenceBundle(task, snapshot.artifacts, snapshot.councils.find((item) => item.taskId === taskId));
      store.saveEvidence(bundle);
      snapshot = store.snapshot();
    }
    if (!bundle.claims.some((claim) => claim.status === "DISPUTED" || claim.status === "INSUFFICIENT")) throw new Error("当前证据包没有需要选择性回填的 claim");
    store.addRehydrationRound(taskId, buildRehydrationPrompts(task, bundle, snapshot.artifacts, task.providerIds));
    await automation.dispatchTask(taskId);
    return publish();
  });
  ipcMain.handle("boss:run-codex-review", async (_event, taskId: string) => {
    let snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    let bundle = snapshot.evidenceBundles.find((item) => item.taskId === taskId);
    if (!bundle) {
      bundle = buildEvidenceBundle(task, snapshot.artifacts, snapshot.councils.find((item) => item.taskId === taskId));
      store.saveEvidence(bundle);
      snapshot = store.snapshot();
    }
    store.updateCodexReview(bundle.id, { status: "RUNNING" });
    publish();
    try {
      const content = await codexRuntime.review(bundle, snapshot.artifacts);
      store.updateCodexReview(bundle.id, { status: "COMPLETED", content, completedAt: new Date().toISOString() });
    } catch (error) {
      store.observeRuntimeFailure("codex:cli", String(error));
      store.updateCodexReview(bundle.id, { status: "FAILED", error: String(error), completedAt: new Date().toISOString() });
    }
    return publish();
  });
  ipcMain.handle("boss:update-task", async (_event, taskId: string, status: TaskStatus) => {
    store.setTaskStatus(taskId, status);
    if (status === "running" && recoveryScheduler.resumeTask(taskId)) {
      const deadline = Math.min(...recoveryScheduler.list().filter((item) => item.taskId === taskId && item.state === "WAITING").map((item) => item.retryAt));
      store.setRecoveryState(taskId, deadline, "用户已继续任务；按记录的时间恢复原会话");
    }
    if (status === "running" && store.snapshot().tasks.find((item) => item.id === taskId)?.finalizationBlocker) await commander.finalizeTask(taskId, publish);
    return publish();
  });

  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      attachProviderViews();
    }
  });

  if (isSmokeTest) {
    const smoke = async () => {
      if (!mainWindow) throw new Error("Smoke renderer missing");
      const ready = await mainWindow.webContents.executeJavaScript('Boolean(window.boss && document.querySelector(".composer-zone"))');
      if (!ready) throw new Error("Renderer bridge or UI not ready");
      if (process.argv.includes("--boss-restart-seed")) {
        fs.writeFileSync(path.join(dataRoot, "restart-evidence.txt"), "BOSS_RESTART_EVIDENCE");
        store.captureArtifact = () => { fs.writeFileSync(path.join(dataRoot, "restart-seeded.json"), JSON.stringify({ phase: "before_artifact", pid: process.pid })); process.exit(0); };
        await mainWindow.webContents.executeJavaScript("window.boss.dispatchTask(" + JSON.stringify({ title: "Restart acceptance", prompt: "读取终端日志 restart-evidence.txt", providerIds: [], appMode: "work", workspacePath: dataRoot }) + ")");
        throw new Error("Restart seed did not exit");
      }
      if (process.argv.includes("--boss-restart-verify")) {
        await resumeLocalTasks();
        const snapshot = store.snapshot();
        const task = snapshot.tasks.find((item) => item.title === "Restart acceptance");
        if (!task || task.status !== "completed") throw new Error("Restart task not completed");
        const final = store.finalResponseForTask(task.id);
        if (!final?.content.includes("BOSS_RESTART_EVIDENCE")) throw new Error("Restart final evidence absent");
        const ledger = commander.ledger!.load(task.id)!;
        if (ledger.jobs.graph_execute.attempts !== 1) throw new Error("Restart repeated native execution");
        if (snapshot.artifacts.filter((item) => item.taskId === task.id).length !== 1) throw new Error("Restart duplicated artifact");
        let visible = false;
        for (let i = 0; i < 30; i++) {
          visible = await mainWindow.webContents.executeJavaScript('Boolean(document.querySelector(".final-response")?.textContent.includes("BOSS_RESTART_EVIDENCE"))');
          if (visible) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!visible) throw new Error("Restart final not rendered");
        fs.writeFileSync(path.join(dataRoot, "restart-result.json"), JSON.stringify({ kind: "CONTROLLED_ELECTRON_RESTART", status: "PASS", pid: process.pid, taskId: task.id, attempts: ledger.jobs.graph_execute.attempts, finalVisible: visible }, null, 2));
        app.exit(0); return;
      }
      const result = await mainWindow.webContents.executeJavaScript('window.boss.dispatchTask({title:"Native smoke verification",prompt:"list files",providerIds:[],appMode:"work"})') as AppSnapshot;
      if (!result.tasks.some((task) => task.title === "Native smoke verification" && task.status === "completed")) throw new Error("Native IPC execution did not complete");
      let rendered = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        rendered = await mainWindow.webContents.executeJavaScript('Boolean(document.querySelector(".conversation-turn .user-message")?.textContent.includes("list files") && document.querySelector(".final-response pre"))');
        if (rendered) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!rendered) throw new Error("Completed task was not rendered");
      mainWindow.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const root = app.getPath("userData");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "smoke.png"), (await mainWindow.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(root, "smoke-result.json"), JSON.stringify({ rendererLoaded: true, nativeCompleted: true, completionVisible: true, generatedAt: new Date().toISOString() }, null, 2));
      app.exit(0);
    };
    setTimeout(() => { void smoke().catch((error) => { console.error(error); app.exit(1); }); }, 1500);
  }
});

app.on("window-all-closed", () => {
  recoveryScheduler?.dispose();
  remoteRelay?.dispose();
  if (process.platform !== "darwin") app.quit();
});
