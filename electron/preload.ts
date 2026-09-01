import { contextBridge, ipcRenderer } from "electron";
import type { AppSnapshot, BossBridge, CreateTaskInput, CustomProviderInput, ProviderId, TaskStatus, ViewBounds } from "../src/shared/contracts";

const bridge: BossBridge = {
  snapshot: () => ipcRenderer.invoke("boss:snapshot"),
  createTask: (input: CreateTaskInput) => ipcRenderer.invoke("boss:create-task", input),
  addCustomProvider: (input: CustomProviderInput) => ipcRenderer.invoke("boss:add-custom-provider", input),
  removeCustomProvider: (providerId: ProviderId) => ipcRenderer.invoke("boss:remove-custom-provider", providerId),
  launchTask: (taskId: string) => ipcRenderer.invoke("boss:launch-task", taskId),
  prepareTask: (taskId: string) => ipcRenderer.invoke("boss:prepare-task", taskId),
  sendTask: (taskId: string) => ipcRenderer.invoke("boss:send-task", taskId),
  captureTask: (taskId: string) => ipcRenderer.invoke("boss:capture-task", taskId),
  advanceCouncil: (taskId: string) => ipcRenderer.invoke("boss:advance-council", taskId),
  openProvider: (providerId: ProviderId) => ipcRenderer.invoke("boss:open-provider", providerId),
  closeProvider: (providerId: ProviderId) => ipcRenderer.invoke("boss:close-provider", providerId),
  layoutViews: (layout: Partial<Record<ProviderId, ViewBounds>>) => ipcRenderer.invoke("boss:layout-views", layout),
  updateTask: (taskId: string, status: TaskStatus) => ipcRenderer.invoke("boss:update-task", taskId, status),
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on("boss:snapshot-updated", wrapped);
    return () => ipcRenderer.removeListener("boss:snapshot-updated", wrapped);
  }
};

contextBridge.exposeInMainWorld("boss", bridge);
