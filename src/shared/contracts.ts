export type ProviderId = string;
export type TaskStatus = "queued" | "running" | "waiting" | "completed" | "failed";
export type TaskMode = "direct" | "council";
export type AppMode = "chat" | "work";
export type RunTransport = "web" | "api";
export type ApiProtocol = "openai-compatible" | "anthropic" | "gemini";
export type AdapterOutcome = "SUCCESS" | "RETRYABLE_FAILURE" | "AUTH_REQUIRED" | "RATE_LIMITED" | "PAGE_CHANGED" | "FORMAT_INVALID" | "USER_ACTION_REQUIRED" | "UNSUPPORTED";
export type ProviderRunPhase = "queued" | "opening" | "prepared" | "sending" | "waiting" | "completed" | "failed" | "blocked";
export type CouncilStage = "proposals" | "peer_review" | "synthesis" | "rehydration" | "completed" | "blocked";
export type ClaimStatus = "UNVERIFIED" | "REFERENCED_NOT_VERIFIED" | "DISPUTED" | "INSUFFICIENT";
export type EvidenceDecision = "HOLD_FOR_REVIEW" | "READY_FOR_USER_REVIEW";
export type ProviderAccountMode = "UNKNOWN" | "GUEST_READY" | "AUTH_REQUIRED" | "READY";
export type DispatchCheckpointStatus = "PREPARING" | "COLLECTING" | "COMMITTED" | "ROLLED_BACK";

export interface Provider {
  id: ProviderId;
  name: string;
  url: string;
  accent: string;
  windowOpen: boolean;
  isCustom: boolean;
}

export interface BossTask {
  id: string;
  title: string;
  prompt: string;
  providerIds: ProviderId[];
  status: TaskStatus;
  mode: TaskMode;
  appMode: AppMode;
  transportByProvider: Record<ProviderId, RunTransport>;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRun {
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
  type: "task.created" | "task.started" | "task.status" | "window.opened" | "window.closed" | "provider.added" | "provider.removed" | "adapter.prepared" | "adapter.sent" | "adapter.outcome" | "artifact.captured" | "council.advanced" | "evidence.built" | "evidence.rehydration" | "codex.review" | "account.status" | "dispatch.checkpoint";
  taskId?: string;
  providerId?: ProviderId;
  message: string;
}

export interface AppSnapshot {
  providers: Provider[];
  tasks: BossTask[];
  runs: ProviderRun[];
  artifacts: RawArtifact[];
  councils: CouncilSession[];
  evidenceBundles: EvidenceBundle[];
  controller: ControllerState;
  accounts: ProviderAccountState[];
  apiSettings: ApiProviderSetting[];
  dispatchCheckpoints: DispatchCheckpoint[];
  events: AuditEvent[];
}

export interface CreateTaskInput {
  title: string;
  prompt: string;
  providerIds: ProviderId[];
  mode?: TaskMode;
  appMode?: AppMode;
  transportByProvider?: Record<ProviderId, RunTransport>;
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
  createTask(input: CreateTaskInput): Promise<AppSnapshot>;
  dispatchTask(input: CreateTaskInput): Promise<AppSnapshot>;
  updateApiSetting(input: UpdateApiSettingInput): Promise<AppSnapshot>;
  addCustomProvider(input: CustomProviderInput): Promise<AppSnapshot>;
  removeCustomProvider(providerId: ProviderId): Promise<AppSnapshot>;
  launchTask(taskId: string): Promise<AppSnapshot>;
  prepareTask(taskId: string): Promise<AppSnapshot>;
  sendTask(taskId: string): Promise<AppSnapshot>;
  captureTask(taskId: string): Promise<AppSnapshot>;
  advanceCouncil(taskId: string): Promise<AppSnapshot>;
  buildEvidence(taskId: string): Promise<AppSnapshot>;
  rehydrateEvidence(taskId: string): Promise<AppSnapshot>;
  runCodexReview(taskId: string): Promise<AppSnapshot>;
  openProvider(providerId: ProviderId): Promise<AppSnapshot>;
  closeProvider(providerId: ProviderId): Promise<AppSnapshot>;
  layoutViews(layout: Partial<Record<ProviderId, ViewBounds>>): Promise<void>;
  updateTask(taskId: string, status: TaskStatus): Promise<AppSnapshot>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
}
