import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import path from "node:path";
import type { AppSnapshot, CreateTaskInput, CustomProviderInput, ProviderId, TaskStatus, UpdateApiSettingInput, ViewBounds } from "../src/shared/contracts";
import { DEFAULT_PROVIDER_IDS, isDispatchGroupSize, MAX_ACTIVE_PROVIDERS, normalizeCustomProviderInput } from "../src/shared/provider-policy";
import { buildPeerReviewPrompts, buildSynthesisPrompts, extractCouncilFindings } from "../src/shared/council-engine";
import { ProviderAutomation } from "./provider-automation";
import { CodexController } from "./codex-controller";
import { buildEvidenceBundle, buildRehydrationPrompts } from "./evidence-engine";
import { AccountSessionManager } from "./account-sessions";
import { ProviderViews } from "./provider-views";
import { StateStore } from "./store";
import { ApiSettingsStore } from "./api-settings";
import { ProviderApiClient } from "./provider-api";

let mainWindow: BrowserWindow | null = null;
let store: StateStore;
let providerViews: ProviderViews;
let automation: ProviderAutomation;
let codexController: CodexController;
let accountSessions: AccountSessionManager;
let apiSettings: ApiSettingsStore;
let providerApi: ProviderApiClient;

const localAppData = process.env.LOCALAPPDATA;
if (localAppData) {
  const localDataRoot = path.join(localAppData, "CodexBoss");
  app.setPath("userData", localDataRoot);
  app.setPath("sessionData", path.join(localDataRoot, "Session Data"));
}

const ownsInstance = app.requestSingleInstanceLock();
const isSmokeTest = process.argv.includes("--codex-boss-smoke-test");

if (!ownsInstance) {
  app.quit();
}

function publish(): AppSnapshot {
  store.setApiSettings(apiSettings.snapshot(store.snapshot().providers.map((item) => item.id)));
  const snapshot = store.snapshot();
  mainWindow?.webContents.send("boss:snapshot-updated", snapshot);
  return snapshot;
}

function provider(id: ProviderId) {
  const match = store.snapshot().providers.find((item) => item.id === id);
  if (!match) throw new Error(`Unknown provider: ${id}`);
  return match;
}

function openProviderWithinLimit(providerId: ProviderId): void {
  const target = provider(providerId);
  const openCount = store.snapshot().providers.filter((item) => item.windowOpen).length;
  if (!target.windowOpen && openCount >= MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时打开 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
  providerViews.open(target);
}

function attachProviderViews(): void {
  if (!mainWindow) throw new Error("Main window was not created");
  providerViews = new ProviderViews(mainWindow, (id, open) => {
    store.setWindow(id, open);
    publish();
  }, accountSessions);
  automation?.dispose();
  automation = new ProviderAutomation(store, providerViews, provider, publish, accountSessions, providerApi);
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#0b0d10",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
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
    automation?.dispose();
    providerViews?.destroyAll();
    mainWindow = null;
  });
}

if (ownsInstance) app.whenReady().then(() => {
  store = new StateStore(path.join(app.getPath("userData"), "state.json"));
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
  codexController = new CodexController(app.getPath("userData"));
  void codexController.detect().then((controller) => { store.setController(controller); publish(); });
  createMainWindow();
  attachProviderViews();
  if (!isSmokeTest) DEFAULT_PROVIDER_IDS.forEach(openProviderWithinLimit);

  ipcMain.handle("boss:snapshot", () => store.snapshot());
  ipcMain.handle("boss:create-task", (_event, input: CreateTaskInput) => {
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("Title and prompt are required");
    const providerIds = [...new Set(input.providerIds)];
    if (providerIds.length === 0) throw new Error("At least one provider is required");
    if (providerIds.length > MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时选择 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
    providerIds.forEach(provider);
    store.createTask(input.title.trim(), input.prompt.trim(), providerIds, input.mode ?? "direct", input.appMode ?? "chat", input.transportByProvider ?? {});
    return publish();
  });
  ipcMain.handle("boss:dispatch-task", async (_event, input: CreateTaskInput) => {
    const providerIds = [...new Set(input.providerIds)];
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("Title and prompt are required");
    if (!isDispatchGroupSize(providerIds.length)) throw new Error("一次提交必须选择 3 或 5 个网页版 AI");
    providerIds.forEach(provider);
    const openIds = new Set(store.snapshot().providers.filter((item) => item.windowOpen).map((item) => item.id));
    if (providerIds.some((id) => !openIds.has(id))) throw new Error("所选 AI 必须全部处于已打开状态");
    if ((input.appMode ?? "chat") === "chat" && Object.values(input.transportByProvider ?? {}).some((transport) => transport === "api")) throw new Error("Chat 模式只允许使用网页版 AI");
    const task = store.createTask(input.title.trim(), input.prompt.trim(), providerIds, input.mode ?? "direct", input.appMode ?? "chat", input.transportByProvider ?? {});
    store.setTaskStatus(task.id, "running");
    await automation.dispatchTask(task.id);
    return publish();
  });
  ipcMain.handle("boss:update-api-setting", (_event, input: UpdateApiSettingInput) => {
    provider(input.providerId);
    apiSettings.update(input);
    return publish();
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
  ipcMain.handle("boss:capture-task", async (_event, taskId: string) => {
    await automation.captureTask(taskId);
    return publish();
  });
  ipcMain.handle("boss:advance-council", async (_event, taskId: string) => {
    const snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    const council = snapshot.councils.find((item) => item.taskId === taskId);
    if (!task || !council) throw new Error("Council task not found");
    const checkpoint = snapshot.dispatchCheckpoints.find((item) => item.taskId === taskId && item.round === council.round);
    if (!checkpoint || checkpoint.status !== "COMMITTED" || checkpoint.requiresReconciliation) throw new Error("当前轮次未达到 3/5 个网页 AI 全员成功检查点");
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
    } else {
      throw new Error(`Council cannot advance from ${council.stage}`);
    }
    return publish();
  });
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
      const content = await codexController.review(bundle, snapshot.artifacts);
      store.updateCodexReview(bundle.id, { status: "COMPLETED", content, completedAt: new Date().toISOString() });
    } catch (error) {
      store.updateCodexReview(bundle.id, { status: "FAILED", error: String(error), completedAt: new Date().toISOString() });
    }
    return publish();
  });
  ipcMain.handle("boss:update-task", (_event, taskId: string, status: TaskStatus) => {
    store.setTaskStatus(taskId, status);
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
    setTimeout(() => app.exit(0), 2500);
  }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
