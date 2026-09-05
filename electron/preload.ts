import { contextBridge, ipcRenderer } from "electron";
import type { AppSnapshot, BossBridge, CreateConversationInput, CreateTaskInput, CustomProviderInput, ProviderId, TaskStatus, UpdateApiSettingInput, UpdateRemoteChannelInput, ViewBounds } from "../src/shared/contracts";

const bridge: BossBridge = {
  snapshot: () => ipcRenderer.invoke("boss:snapshot"),
  progress: () => ipcRenderer.invoke("boss:progress"),
  activeIntervention: (taskId: string) => ipcRenderer.invoke("boss:active-intervention", taskId),
  listInterventions: (taskId?: string) => ipcRenderer.invoke("boss:list-interventions", taskId),
  resolveIntervention: (taskId: string, kind: import("../src/shared/intervention").InterventionKind, answer: string) => ipcRenderer.invoke("boss:resolve-intervention", taskId, kind, answer),
  researchStart: (input: { id?: string; goal: string; workspace: string; reviewers: string[]; autonomy?: "AUTOPILOT" | "GUIDED"; maxExperiments?: number; maxSteps?: number }) => ipcRenderer.invoke("boss:research-start", input),
  researchStatus: (id: string) => ipcRenderer.invoke("boss:research-status", id),
  researchStep: (id: string) => ipcRenderer.invoke("boss:research-step", id),
  researchProtocolFreeze: (id: string, protocol: import("../src/shared/research-protocol").ResearchProtocol) => ipcRenderer.invoke("boss:research-protocol-freeze", id, protocol),
  createTask: (input: CreateTaskInput) => ipcRenderer.invoke("boss:create-task", input),
  dispatchTask: (input: CreateTaskInput) => ipcRenderer.invoke("boss:dispatch-task", input),
  updateApiSetting: (input: UpdateApiSettingInput) => ipcRenderer.invoke("boss:update-api-setting", input),
  updateRemoteChannel: (input: UpdateRemoteChannelInput) => ipcRenderer.invoke("boss:update-remote-channel", input),
  updateRuntimeControl: (runtimeId: string, enabled: boolean, priority: number) => ipcRenderer.invoke("boss:update-runtime-control", runtimeId, enabled, priority),
  updateRoleRoute: (role, runtimeIds, fallback) => ipcRenderer.invoke("boss:update-role-route", role, runtimeIds, fallback),
  loadRemoteCommand: (commandId: string) => ipcRenderer.invoke("boss:load-remote-command", commandId),
  dismissRemoteCommand: (commandId: string) => ipcRenderer.invoke("boss:dismiss-remote-command", commandId),
  createFolder: (name: string) => ipcRenderer.invoke("boss:create-folder", name),
  renameFolder: (folderId: string, name: string) => ipcRenderer.invoke("boss:rename-folder", folderId, name),
  createConversation: (input: CreateConversationInput) => ipcRenderer.invoke("boss:create-conversation", input),
  renameConversation: (conversationId: string, title: string) => ipcRenderer.invoke("boss:rename-conversation", conversationId, title),
  moveConversation: (conversationId: string, folderId: string) => ipcRenderer.invoke("boss:move-conversation", conversationId, folderId),
  selectConversation: (conversationId: string) => ipcRenderer.invoke("boss:select-conversation", conversationId),
  archiveConversation: (conversationId: string, archived: boolean) => ipcRenderer.invoke("boss:archive-conversation", conversationId, archived),
  deleteConversation: (conversationId: string) => ipcRenderer.invoke("boss:delete-conversation", conversationId),
  duplicateConversation: (conversationId: string) => ipcRenderer.invoke("boss:duplicate-conversation", conversationId),
  exportConversation: (conversationId: string) => ipcRenderer.invoke("boss:export-conversation", conversationId),
  addCustomProvider: (input: CustomProviderInput) => ipcRenderer.invoke("boss:add-custom-provider", input),
  removeCustomProvider: (providerId: ProviderId) => ipcRenderer.invoke("boss:remove-custom-provider", providerId),
  launchTask: (taskId: string) => ipcRenderer.invoke("boss:launch-task", taskId),
  prepareTask: (taskId: string) => ipcRenderer.invoke("boss:prepare-task", taskId),
  sendTask: (taskId: string) => ipcRenderer.invoke("boss:send-task", taskId),
  captureTask: (taskId: string) => ipcRenderer.invoke("boss:capture-task", taskId),
  releaseReview: (taskId: string) => ipcRenderer.invoke("boss:release-review", taskId),
  advanceCouncil: (taskId: string) => ipcRenderer.invoke("boss:advance-council", taskId),
  buildEvidence: (taskId: string) => ipcRenderer.invoke("boss:build-evidence", taskId),
  rehydrateEvidence: (taskId: string) => ipcRenderer.invoke("boss:rehydrate-evidence", taskId),
  runCodexReview: (taskId: string) => ipcRenderer.invoke("boss:run-codex-review", taskId),
  openProvider: (providerId: ProviderId) => ipcRenderer.invoke("boss:open-provider", providerId),
  closeProvider: (providerId: ProviderId) => ipcRenderer.invoke("boss:close-provider", providerId),
  layoutViews: (layout: Partial<Record<ProviderId, ViewBounds>>) => ipcRenderer.invoke("boss:layout-views", layout),
  setProviderViewsVisible: (visible: boolean) => ipcRenderer.invoke("boss:set-provider-views-visible", visible),
  updateTask: (taskId: string, status: TaskStatus) => ipcRenderer.invoke("boss:update-task", taskId, status),
  projectState: (workspaceId?: string) => ipcRenderer.invoke("boss:project-state", workspaceId),
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on("boss:snapshot-updated", wrapped);
    return () => ipcRenderer.removeListener("boss:snapshot-updated", wrapped);
  }
};

contextBridge.exposeInMainWorld("boss", bridge);
