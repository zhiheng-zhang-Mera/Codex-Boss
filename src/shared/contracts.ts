import type { ExecutionPhase, ReviewPolicy, ReviewResult, WorkerResponse } from "./execution";
import type { InputObjectRef } from "./input-object";
import type { InteractionMode, ModeTransition } from "./capability-needs";
import type { WorkAgentCount, WorkRole } from "./work-mode";
export type ProviderId = string;
export type TaskStatus = "queued" | "running" | "waiting" | "paused" | "cancelled" | "completed" | "failed";
export type TaskMode = "direct" | "council";
export type AppMode = "chat" | "work";
export type RunTransport = "web" | "api";
export type ApiProtocol = "openai-compatible" | "anthropic" | "gemini";
export type AdapterOutcome = "SUCCESS" | "RETRYABLE_FAILURE" | "AUTH_REQUIRED" | "RATE_LIMITED" | "PAGE_CHANGED" | "FORMAT_INVALID" | "USER_ACTION_REQUIRED" | "UNSUPPORTED";
export type ProviderRunPhase = "queued" | "opening" | "prepared" | "sending" | "waiting" | "completed" | "failed" | "blocked";
export type CouncilStage = "proposals" | "peer_review" | "synthesis" | "rehydration" | "completed" | "blocked";
export type ClaimStatus = "UNVERIFIED" | "REFERENCED_NOT_VERIFIED" | "DISPUTED" | "INSUFFICIENT";
export type EvidenceDecision = "HOLD_FOR_REVIEW" | "READY_FOR_USER_REVIEW" | "PASS";
export type ProviderAccountMode = "UNKNOWN" | "GUEST_READY" | "AUTH_REQUIRED" | "READY";
export type DispatchCheckpointStatus = "PREPARING" | "COLLECTING" | "COMMITTED" | "ROLLED_BACK";
export type RemoteChannel = "wechat" | "qq";
export type RemoteChannelStatus = "disabled" | "waiting" | "ready" | "error";
export type RemoteCommandStatus = "pending" | "loaded" | "dismissed";

export interface Provider {
  id: ProviderId;
  name: string;
  url: string;
  accent: string;
  windowOpen: boolean;
  isCustom: boolean;
}

export interface BossTask {
  parentTaskId?: string;
  runtimeJobId?: string;
  workspacePath?: string;
  /** Workspace this task belongs to (plan AP01); absent = default shim workspace. */
  workspaceId?: string;
  selectedProviderIds?: ProviderId[];
  recoveryAt?: number;
  recoveryMessage?: string;
  finalizationPolicy?: FinalizationPolicy;
  finalizationBlocker?: string;
  plan?: import("./task-ir").TaskIR;
  reviewPolicy?: ReviewPolicy;
  executionPhase?: ExecutionPhase;
  nextAction?: string;
  id: string;
  conversationId: string;
  title: string;
  prompt: string;
  /** Attachments/inputs bound to this task (plan 9-7 §3). Absent = legacy pure-text task. */
  inputObjectIds?: string[];
  /** Chat→Work escalation lifecycle (plan 9-7 §2.4). CHAT by default. */
  interactionMode?: InteractionMode;
  /** Pending or approved Chat→Work transition (one-time user confirmation). */
  modeTransition?: ModeTransition;
  /** Work cognitive/review pool size 1|3|5 (plan §6). Set only for WORK tasks; absent = 3 default. */
  workAgentCount?: WorkAgentCount;
  /** Explicit work-role list in provider order (plan §6.4); absent = default auto mapping. */
  workRoles?: WorkRole[];
  providerIds: ProviderId[];
  status: TaskStatus;
  mode: TaskMode;
  appMode: AppMode;
  transportByProvider: Record<ProviderId, RunTransport>;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRun {
  response?: WorkerResponse;
  review?: ReviewResult;
  attempts?: number;
  responseBaseline?: string;
  sessionUrl?: string;
  id: string;
  taskId: string;
  providerId: ProviderId;
  transport: RunTransport;
  round: number;
  phase: ProviderRunPhase;
  outcome: AdapterOutcome | null;
  message: string;
  inputPrompt: string;
  adapterVersion: string;
  artifactId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ArtifactClassification = "PUBLIC" | "INTERNAL" | "SECRET" | "GUARDIAN";

export interface RawArtifact {
  id: string;
  taskId: string;
  runId: string;
  providerId: ProviderId;
  kind: "proposal" | "peer_review" | "synthesis" | "response";
  content: string;
  capturedAt: string;
  sourceUrl: string;
  untrusted: true;
  /** Artifact schema version (plan §4.3/§6); 1 = conformance fields present. */
  version?: 1;
  /** sha256 of `content` computed at capture; evidence engine verifies it fail-closed. */
  contentHash?: string;
  /** Executor that produced the artifact (e.g. "web:chatgpt", "local:native"). */
  producer?: string;
  /** Security classification; defaults to INTERNAL (plan §18 vocabulary reserved). */
  classification?: ArtifactClassification;
}

export interface CouncilFinding {
  topic: string;
  positions: string[];
  providerIds: ProviderId[];
}

export interface CouncilSession {
  id: string;
  taskId: string;
  stage: CouncilStage;
  providerIds: ProviderId[];
  round: number;
  conflicts: CouncilFinding[];
  minorityOpinions: string[];
  finalArtifactId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceManifestEntry {
  artifactId: string;
  providerId: ProviderId;
  sha256: string;
  bytes: number;
  capturedAt: string;
}

export interface ClaimRecord {
  id: string;
  text: string;
  status: ClaimStatus;
  evidenceArtifactIds: string[];
  missingEvidenceLabels: string[];
}

export interface DisputeRecord {
  id: string;
  topic: string;
  positions: string[];
  evidenceArtifactIds: string[];
  unresolved: true;
}

export interface CodexReview {
  status: "NOT_RUN" | "RUNNING" | "COMPLETED" | "FAILED";
  content?: string;
  error?: string;
  completedAt?: string;
}

export interface EvidenceBundle {
  id: string;
  taskId: string;
  manifest: EvidenceManifestEntry[];
  integrityRoot: string;
  claims: ClaimRecord[];
  disputes: DisputeRecord[];
  missingProviderIds: ProviderId[];
  decision: EvidenceDecision;
  codexReview: CodexReview;
  createdAt: string;
}

export interface ControllerState {
  kind: "codex-cli";
  accountMode: "CHATGPT" | "NOT_AUTHENTICATED" | "UNAVAILABLE" | "UNKNOWN";
  message: string;
}

export interface RuntimeStatusView {
  runtimeId: string;
  label: string;
  kind: "web" | "codex" | "api" | "local";
  availability: "AVAILABLE" | "BUSY" | "AUTH_REQUIRED" | "RATE_LIMITED" | "BUDGET_EXHAUSTED" | "PAGE_CHANGED" | "USER_ACTION_REQUIRED" | "UNSUPPORTED" | "DOWN" | "UNKNOWN";
  budget: "UNKNOWN" | "OK" | "LOW" | "EXHAUSTED";
  enabled: boolean;
  priority: number;
  message: string;
}

export interface RoleRouteView { role: "planner" | "researcher" | "reviewer" | "synthesizer" | "coder" | "validator" | "critic"; runtimeIds: string[]; fallback: boolean; }

export interface ProviderAccountState {
  providerId: ProviderId;
  partition: string;
  mode: ProviderAccountMode;
  persistent: true;
  message: string;
  updatedAt: string;
}

export interface DispatchCheckpoint {
  id: string;
  taskId: string;
  round: number;
  expectedProviderIds: ProviderId[];
  successfulProviderIds: ProviderId[];
  failedProviderIds: ProviderId[];
  status: DispatchCheckpointStatus;
  requiresReconciliation: boolean;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiProviderSetting {
  providerId: ProviderId;
  enabled: boolean;
  protocol: ApiProtocol;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  updatedAt: string;
}

export interface RemoteChannelSetting {
  channel: RemoteChannel;
  enabled: boolean;
  commandPrefix: string;
  status: RemoteChannelStatus;
  message: string;
  updatedAt: string;
}

export interface RemoteCommand {
  id: string;
  channel: RemoteChannel;
  body: string;
  sourceWindow: string;
  status: RemoteCommandStatus;
  receivedAt: string;
}

export interface UpdateRemoteChannelInput {
  channel: RemoteChannel;
  enabled: boolean;
  commandPrefix: string;
}

export interface ConversationFolder {
  id: string;
  name: string;
  storageName: string;
  createdAt: string;
  updatedAt: string;
}

export interface BossConversation {
  id: string;
  folderId: string;
  title: string;
  storageName: string;
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
  /** Conversation-scoped input objects (plan 9-7 §3/§5); restored after restart. */
  inputObjects?: InputObjectRef[];
  /** Archived conversations are hidden from the default list but never deleted. */
  archived?: boolean;
}

export interface UpdateApiSettingInput {
  providerId: ProviderId;
  enabled: boolean;
  protocol: ApiProtocol;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface AuditEvent {
  id: string;
  at: string;
  type: "task.created" | "task.started" | "task.status" | "window.opened" | "window.closed" | "provider.added" | "provider.removed" | "adapter.prepared" | "adapter.sent" | "adapter.outcome" | "task.finalized" | "artifact.captured" | "council.advanced" | "evidence.built" | "evidence.rehydration" | "codex.review" | "account.status" | "dispatch.checkpoint" | "folder.created" | "folder.renamed" | "conversation.created" | "conversation.renamed" | "conversation.moved" | "conversation.selected" | "conversation.archived" | "conversation.deleted" | "conversation.duplicated" | "conversation.exported" | "remote.channel" | "remote.command" | "runtime.policy" | "input.object.registered" | "input.object.removed";
  taskId?: string;
  providerId?: ProviderId;
  stepId?: string;
  runtimeId?: string;
  evidenceRef?: string;
  budgetDelta?: Partial<Record<"modelCalls" | "toolCalls" | "browserActions" | "retries", number>>;
  message: string;
}

export type FinalizationPolicy = "DIRECT" | "CODEX_IF_AVAILABLE" | "CODEX_REQUIRED";
export interface FinalResponse {
  id: string;
  taskId: string;
  conversationId: string;
  source: "worker" | "council_synthesis" | "codex_synthesis" | "deterministic";
  content: string;
  evidenceBundleId?: string;
  sourceArtifactIds: string[];
  finalizedAt: string;
}

export interface AppSnapshot {
  schemaVersion: 2;
  finalResponses: FinalResponse[];
  providers: Provider[];
  tasks: BossTask[];
  runs: ProviderRun[];
  artifacts: RawArtifact[];
  councils: CouncilSession[];
  evidenceBundles: EvidenceBundle[];
  controller: ControllerState;
  runtimeStatuses: RuntimeStatusView[];
  roleRoutes: RoleRouteView[];
  accounts: ProviderAccountState[];
  apiSettings: ApiProviderSetting[];
  remoteChannels: RemoteChannelSetting[];
  remoteCommands: RemoteCommand[];
  folders: ConversationFolder[];
  conversations: BossConversation[];
  activeConversationId: string;
  dispatchCheckpoints: DispatchCheckpoint[];
  events: AuditEvent[];
}

export interface CreateTaskInput {
  finalizationPolicy?: FinalizationPolicy;
  workspacePath?: string;
  reviewPolicy?: ReviewPolicy;
  title: string;
  prompt: string;
  /** Input objects bound to this task; ids must already exist on the conversation. */
  inputObjectIds?: string[];
  /** Optional explicit work pool size 1|3|5 (defaults: 1 for 1 worker, else 3 for ≤3, 5 for >3). */
  workAgentCount?: import("./work-mode").WorkAgentCount;
  providerIds: ProviderId[];
  mode?: TaskMode;
  appMode?: AppMode;
  transportByProvider?: Record<ProviderId, RunTransport>;
  conversationId?: string;
}

export interface CreateConversationInput {
  folderId: string;
  title: string;
}

export interface CustomProviderInput {
  name: string;
  url: string;
}

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BossBridge {
  snapshot(): Promise<AppSnapshot>;
  progress(): Promise<import("./progress").ProgressSummary[]>;
  activeIntervention(taskId: string): Promise<import("./intervention").HumanInterventionRequest | undefined>;
  listInterventions(taskId?: string): Promise<import("./intervention").HumanInterventionRequest[]>;
  resolveIntervention(taskId: string, kind: import("./intervention").InterventionKind, answer: string): Promise<import("./intervention").HumanInterventionRequest>;
  researchStart(input: { id?: string; researchQuestion?: string; goal?: string; workspace: string; reviewers: string[]; autonomy?: "AUTOPILOT" | "GUIDED"; hypothesis?: string; providerPolicy?: "AUTO" | "FIXED"; maxExperiments?: number; maxSteps?: number; maxProviderCalls?: number }): Promise<unknown>;
  researchStatus(id: string): Promise<unknown>;
  researchList(): Promise<Array<{ id: string; goal: string; state: string; revision: number; updatedAt: string; protocolHash?: string; pendingStage?: string }>>;
  researchStep(id: string): Promise<unknown>;
  /** Runs the research autopilot until a genuine block or terminal state (plan 9-7 §28). */
  researchAutopilot(id: string, maxSteps?: number): Promise<unknown>;
  /** Compiles a research manuscript paper.tex → paper.pdf and returns the audit + paths (plan 9-7 §31/§33). */
  researchCompilePdf(id: string): Promise<{ status: "PASS" | "FAIL"; engine: string | null; tex: string; pdf: string | null; logTail: string; compiledAt: string; researchCache: string }>;
  /** Resumes a control-paused research run to its pending stage; true when it actually resumed. */
  researchResume(id: string): Promise<boolean>;
  researchWait(input: { id: string; kind: import("./intervention").InterventionKind; question: string; options?: string[]; blockingStepId: string; contextSummary?: string }): Promise<unknown>;
  researchProtocolFreeze(id: string, protocol: import("./research-protocol").ResearchProtocol): Promise<unknown>;
  /** Opens a native multi-file dialog and imports each picked file into the conversation's attachment store. */
  pickAttachments(conversationId: string): Promise<AppSnapshot>;
  /** Imports raw bytes (drag/drop or clipboard paste) as one attachment. */
  addAttachmentBytes(input: { conversationId: string; originalName: string; mime?: string; bytes: Uint8Array }): Promise<AppSnapshot>;
  /** Removes an attachment from the store and the conversation registry. */
  removeAttachment(conversationId: string, inputObjectId: string): Promise<AppSnapshot>;
  /** Resolves the durable local path of a stored attachment, if present. */
  attachmentPath(conversationId: string, inputObjectId: string): Promise<string | undefined>;
  createTask(input: CreateTaskInput): Promise<AppSnapshot>;
  dispatchTask(input: CreateTaskInput): Promise<AppSnapshot>;
  /** One-time Chat→Work decision: approve runs the task as Work, decline keeps Chat (plan §2.3). */
  resolveModeProposal(taskId: string, approveWork: boolean): Promise<AppSnapshot>;
  updateApiSetting(input: UpdateApiSettingInput): Promise<AppSnapshot>;
  updateRemoteChannel(input: UpdateRemoteChannelInput): Promise<AppSnapshot>;
  updateRuntimeControl(runtimeId: string, enabled: boolean, priority: number): Promise<AppSnapshot>;
  updateRoleRoute(role: RoleRouteView["role"], runtimeIds: string[], fallback: boolean): Promise<AppSnapshot>;
  loadRemoteCommand(commandId: string): Promise<AppSnapshot>;
  dismissRemoteCommand(commandId: string): Promise<AppSnapshot>;
  createFolder(name: string): Promise<AppSnapshot>;
  renameFolder(folderId: string, name: string): Promise<AppSnapshot>;
  createConversation(input: CreateConversationInput): Promise<AppSnapshot>;
  renameConversation(conversationId: string, title: string): Promise<AppSnapshot>;
  moveConversation(conversationId: string, folderId: string): Promise<AppSnapshot>;
  selectConversation(conversationId: string): Promise<AppSnapshot>;
  archiveConversation(conversationId: string, archived: boolean): Promise<AppSnapshot>;
  /** Deletes a conversation (tasks/runs/evidence/final answers + history files). Requires explicit user confirmation (U1 P1 §13). */
  deleteConversation(conversationId: string, userConfirmed: boolean): Promise<AppSnapshot>;
  /** Bulk-deletes several conversations in one action (multi-select history); requires explicit user confirmation. */
  deleteConversations(conversationIds: string[], userConfirmed: boolean): Promise<AppSnapshot>;
  duplicateConversation(conversationId: string): Promise<AppSnapshot>;
  exportConversation(conversationId: string): Promise<string>;
  addCustomProvider(input: CustomProviderInput): Promise<AppSnapshot>;
  removeCustomProvider(providerId: ProviderId): Promise<AppSnapshot>;
  launchTask(taskId: string): Promise<AppSnapshot>;
  prepareTask(taskId: string): Promise<AppSnapshot>;
  sendTask(taskId: string): Promise<AppSnapshot>;
  captureTask(taskId: string): Promise<AppSnapshot>;
  releaseReview(taskId: string): Promise<AppSnapshot>;
  advanceCouncil(taskId: string): Promise<AppSnapshot>;
  buildEvidence(taskId: string): Promise<AppSnapshot>;
  /** Operator explicitly accepts the held (DISPUTED/INSUFFICIENT) evidence and finalizes (U3 §2.3). */
  acceptEvidence(taskId: string): Promise<AppSnapshot>;
  rehydrateEvidence(taskId: string): Promise<AppSnapshot>;
  runCodexReview(taskId: string): Promise<AppSnapshot>;
  openProvider(providerId: ProviderId): Promise<AppSnapshot>;
  closeProvider(providerId: ProviderId): Promise<AppSnapshot>;
  layoutViews(layout: Partial<Record<ProviderId, ViewBounds>>): Promise<void>;
  setProviderViewsVisible(visible: boolean): Promise<void>;
  /** U4 §9.2: force a manual zoom factor on one provider pane. */
  setProviderZoom(providerId: ProviderId, factor: number): Promise<void>;
  /** U4 §9.2: reload one provider pane (visible session reset). */
  reloadProvider(providerId: ProviderId): Promise<void>;
  updateTask(taskId: string, status: TaskStatus): Promise<AppSnapshot>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
  projectState(workspaceId?: string): Promise<import("./project-tree").ProjectStateSummary>;
}
