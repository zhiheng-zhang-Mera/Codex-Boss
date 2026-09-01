export type ProviderId = string;
export type TaskStatus = "queued" | "running" | "waiting" | "completed" | "failed";
export type TaskMode = "direct" | "council";
export type AdapterOutcome = "SUCCESS" | "RETRYABLE_FAILURE" | "AUTH_REQUIRED" | "RATE_LIMITED" | "PAGE_CHANGED" | "FORMAT_INVALID" | "USER_ACTION_REQUIRED" | "UNSUPPORTED";
export type ProviderRunPhase = "queued" | "opening" | "prepared" | "sending" | "waiting" | "completed" | "failed" | "blocked";
export type CouncilStage = "proposals" | "peer_review" | "synthesis" | "completed" | "blocked";

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
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRun {
  id: string;
  taskId: string;
  providerId: ProviderId;
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

export interface AuditEvent {
  id: string;
  at: string;
  type: "task.created" | "task.started" | "task.status" | "window.opened" | "window.closed" | "provider.added" | "provider.removed" | "adapter.prepared" | "adapter.sent" | "adapter.outcome" | "artifact.captured" | "council.advanced";
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
  events: AuditEvent[];
}

export interface CreateTaskInput {
  title: string;
  prompt: string;
  providerIds: ProviderId[];
  mode?: TaskMode;
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
  addCustomProvider(input: CustomProviderInput): Promise<AppSnapshot>;
  removeCustomProvider(providerId: ProviderId): Promise<AppSnapshot>;
  launchTask(taskId: string): Promise<AppSnapshot>;
  prepareTask(taskId: string): Promise<AppSnapshot>;
  sendTask(taskId: string): Promise<AppSnapshot>;
  captureTask(taskId: string): Promise<AppSnapshot>;
  advanceCouncil(taskId: string): Promise<AppSnapshot>;
  openProvider(providerId: ProviderId): Promise<AppSnapshot>;
  closeProvider(providerId: ProviderId): Promise<AppSnapshot>;
  layoutViews(layout: Partial<Record<ProviderId, ViewBounds>>): Promise<void>;
  updateTask(taskId: string, status: TaskStatus): Promise<AppSnapshot>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
}
