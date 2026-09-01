export type ProviderId = "chatgpt" | "claude" | "gemini";
export type TaskStatus = "queued" | "running" | "waiting" | "completed" | "failed";

export interface Provider {
  id: ProviderId;
  name: string;
  url: string;
  accent: string;
  windowOpen: boolean;
}

export interface BossTask {
  id: string;
  title: string;
  prompt: string;
  providerIds: ProviderId[];
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  type: "task.created" | "task.started" | "task.status" | "window.opened" | "window.closed";
  taskId?: string;
  providerId?: ProviderId;
  message: string;
}

export interface AppSnapshot {
  providers: Provider[];
  tasks: BossTask[];
  events: AuditEvent[];
}

export interface CreateTaskInput {
  title: string;
  prompt: string;
  providerIds: ProviderId[];
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
  launchTask(taskId: string): Promise<AppSnapshot>;
  openProvider(providerId: ProviderId): Promise<AppSnapshot>;
  closeProvider(providerId: ProviderId): Promise<AppSnapshot>;
  layoutViews(layout: Partial<Record<ProviderId, ViewBounds>>): Promise<void>;
  updateTask(taskId: string, status: TaskStatus): Promise<AppSnapshot>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
}
