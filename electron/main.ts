import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import type { AppSnapshot, CreateTaskInput, ProviderId, TaskStatus } from "../src/shared/contracts";
import { ProviderWindows } from "./provider-windows";
import { StateStore } from "./store";

let mainWindow: BrowserWindow | null = null;
let store: StateStore;
let providerWindows: ProviderWindows;

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
  mainWindow.on("closed", () => { mainWindow = null; });
}

if (ownsInstance) app.whenReady().then(() => {
  store = new StateStore(path.join(app.getPath("userData"), "state.json"));
  providerWindows = new ProviderWindows((id, open) => {
    store.setWindow(id, open);
    publish();
  });

  ipcMain.handle("boss:snapshot", () => store.snapshot());
  ipcMain.handle("boss:create-task", (_event, input: CreateTaskInput) => {
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("Title and prompt are required");
    provider(input.providerId);
    store.createTask(input.title.trim(), input.prompt.trim(), input.providerId);
    return publish();
  });
  ipcMain.handle("boss:open-provider", (_event, providerId: ProviderId) => {
    providerWindows.open(provider(providerId));
    return publish();
  });
  ipcMain.handle("boss:launch-task", (_event, taskId: string) => {
    const task = store.snapshot().tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    providerWindows.open(provider(task.providerId));
    store.setTaskStatus(taskId, "running");
    return publish();
  });
  ipcMain.handle("boss:update-task", (_event, taskId: string, status: TaskStatus) => {
    store.setTaskStatus(taskId, status);
    return publish();
  });

  createMainWindow();
  app.on("second-instance", () => {
    if (!mainWindow) createMainWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

  if (process.argv.includes("--codex-boss-smoke-test")) {
    setTimeout(() => app.quit(), 2500);
  }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
