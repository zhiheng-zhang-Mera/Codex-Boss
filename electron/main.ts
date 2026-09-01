import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type { AppSnapshot, CreateTaskInput, ProviderId, TaskStatus, ViewBounds } from "../src/shared/contracts";
import { ProviderViews } from "./provider-views";
import { StateStore } from "./store";

let mainWindow: BrowserWindow | null = null;
let store: StateStore;
let providerViews: ProviderViews;

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

function attachProviderViews(): void {
  if (!mainWindow) throw new Error("Main window was not created");
  providerViews = new ProviderViews(mainWindow, (id, open) => {
    store.setWindow(id, open);
    publish();
  });
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
    providerIds.forEach(provider);
    store.createTask(input.title.trim(), input.prompt.trim(), providerIds);
    return publish();
  });
  ipcMain.handle("boss:open-provider", (_event, providerId: ProviderId) => {
    providerViews.open(provider(providerId));
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
    task.providerIds.forEach((providerId) => providerViews.open(provider(providerId)));
    store.setTaskStatus(taskId, "running");
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
