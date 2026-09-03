import { contextBridge, ipcRenderer } from "electron";
import type { AppSnapshot, BossBridge, CreateConversationInput, CreateTaskInput, CustomProviderInput, ProviderId, TaskStatus, UpdateApiSettingInput, UpdateRemoteChannelInput, ViewBounds } from "../src/shared/contracts";

const bridge: BossBridge = {
  snapshot: () => ipcRenderer.invoke("boss:snapshot"),
  createTask: (input: CreateTaskInput) => ipcRenderer.invoke("boss:create-task", input),
  dispatchTask: (input: CreateTaskInput) => ipcRenderer.invoke("boss:dispatch-task", input),
  updateApiSetting: (input: UpdateApiSettingInput) => ipcRenderer.invoke("boss:update-api-setting", input),
  updateRemoteChannel: (input: UpdateRemoteChannelInput) => ipcRenderer.invoke("boss:update-remote-channel", input),
  loadRemoteCommand: (commandId: string) => ipcRenderer.invoke("boss:load-remote-command", commandId),
  dismissRemoteCommand: (commandId: string) => ipcRenderer.invoke("boss:dismiss-remote-command", commandId),
  createFolder: (name: string) => ipcRenderer.invoke("boss:create-folder", name),
  renameFolder: (folderId: string, name: string) => ipcRenderer.invoke("boss:rename-folder", folderId, name),
  createConversation: (input: CreateConversationInput) => ipcRenderer.invoke("boss:create-conversation", input),
  renameConversation: (conversationId: string, title: string) => ipcRenderer.invoke("boss:rename-conversation", conversationId, title),
  moveConversation: (conversationId: string, folderId: string) => ipcRenderer.invoke("boss:move-conversation", conversationId, folderId),
  selectConversation: (conversationId: string) => ipcRenderer.invoke("boss:select-conversation", conversationId),
  addCustomProvider: (input: CustomProviderInput) => ipcRenderer.invoke("boss:add-custom-provider", input),
  removeCustomProvider: (providerId: ProviderId) => ipcRenderer.invoke("boss:remove-custom-provider", providerId),
  launchTask: (taskId: string) => ipcRenderer.invoke("boss:launch-task", taskId),
  prepareTask: (taskId: string) => ipcRenderer.invoke("boss:prepare-task", taskId),
  sendTask: (taskId: string) => ipcRenderer.invoke("boss:send-task", taskId),
  captureTask: (taskId: string) => ipcRenderer.invoke("boss:capture-task", taskId),
  advanceCouncil: (taskId: string) => ipcRenderer.invoke("boss:advance-council", taskId),
  buildEvidence: (taskId: string) => ipcRenderer.invoke("boss:build-evidence", taskId),
  rehydrateEvidence: (taskId: string) => ipcRenderer.invoke("boss:rehydrate-evidence", taskId),
  runCodexReview: (taskId: string) => ipcRenderer.invoke("boss:run-codex-review", taskId),
  openProvider: (providerId: ProviderId) => ipcRenderer.invoke("boss:open-provider", providerId),
  closeProvider: (providerId: ProviderId) => ipcRenderer.invoke("boss:close-provider", providerId),
  layoutViews: (layout: Partial<Record<ProviderId, ViewBounds>>) => ipcRenderer.invoke("boss:layout-views", layout),
  setProviderViewsVisible: (visible: boolean) => ipcRenderer.invoke("boss:set-provider-views-visible", visible),
  updateTask: (taskId: string, status: TaskStatus) => ipcRenderer.invoke("boss:update-task", taskId, status),
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on("boss:snapshot-updated", wrapped);
    return () => ipcRenderer.removeListener("boss:snapshot-updated", wrapped);
  }
};

contextBridge.exposeInMainWorld("boss", bridge);
