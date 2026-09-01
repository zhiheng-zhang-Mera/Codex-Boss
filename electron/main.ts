import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type { AppSnapshot, CreateTaskInput, CustomProviderInput, ProviderId, TaskStatus, ViewBounds } from "../src/shared/contracts";
import { MAX_ACTIVE_PROVIDERS, normalizeCustomProviderInput } from "../src/shared/provider-policy";
import { buildPeerReviewPrompts, buildSynthesisPrompts, extractCouncilFindings } from "../src/shared/council-engine";
import { ProviderAutomation } from "./provider-automation";
import { ProviderViews } from "./provider-views";
import { StateStore } from "./store";

let mainWindow: BrowserWindow | null = null;
let store: StateStore;
let providerViews: ProviderViews;
let automation: ProviderAutomation;

const localAppData = process.env.LOCALAPPDATA;
if (localAppData) {
  const localDataRoot = path.join(localAppData, "CodexBoss");
  app.setPath("userData", localDataRoot);
  app.setPath("sessionData", path.join(localDataRoot, "Session Data"));
}

const ownsInstance = app.requestSingleInstanceLock();

if (!ownsInstance) {
  app.quit();
}

function publish(): AppSnapshot {
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
  });
  automation?.dispose();
  automation = new ProviderAutomation(store, providerViews, provider, publish);
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
  createMainWindow();
  attachProviderViews();

  ipcMain.handle("boss:snapshot", () => store.snapshot());
  ipcMain.handle("boss:create-task", (_event, input: CreateTaskInput) => {
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("Title and prompt are required");
    const providerIds = [...new Set(input.providerIds)];
    if (providerIds.length === 0) throw new Error("At least one provider is required");
    if (providerIds.length > MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时选择 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
    providerIds.forEach(provider);
    store.createTask(input.title.trim(), input.prompt.trim(), providerIds, input.mode ?? "direct");
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
  ipcMain.handle("boss:advance-council", (_event, taskId: string) => {
    const snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    const council = snapshot.councils.find((item) => item.taskId === taskId);
    if (!task || !council) throw new Error("Council task not found");
    const roundRuns = snapshot.runs.filter((run) => run.taskId === taskId && run.round === council.round);
    if (roundRuns.length !== council.providerIds.length || !roundRuns.every((run) => run.phase === "completed" && run.artifactId)) throw new Error("当前 Council 阶段尚未收齐全部可验证回答");
    const artifacts = roundRuns.map((run) => snapshot.artifacts.find((artifact) => artifact.id === run.artifactId)).filter((artifact) => artifact !== undefined);
    if (council.stage === "proposals") {
      store.addCouncilRound(taskId, buildPeerReviewPrompts(task.prompt, artifacts, council.providerIds), "peer_review");
    } else if (council.stage === "peer_review") {
      const allProposals = snapshot.artifacts.filter((artifact) => artifact.taskId === taskId && artifact.kind === "proposal");
      const analysis = extractCouncilFindings(artifacts);
      store.updateCouncil(taskId, analysis);
      store.addCouncilRound(taskId, buildSynthesisPrompts(task.prompt, allProposals, artifacts, council.providerIds, analysis), "synthesis");
    } else if (council.stage === "synthesis") {
      store.updateCouncil(taskId, { stage: "completed" });
      store.setTaskStatus(taskId, "completed");
    } else {
      throw new Error(`Council cannot advance from ${council.stage}`);
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

  if (process.argv.includes("--codex-boss-smoke-test")) {
    setTimeout(() => app.quit(), 2500);
  }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
