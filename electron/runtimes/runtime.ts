import type { RawArtifact } from "../../src/shared/contracts";

export type RuntimeId = string;
export type RuntimeKind = "web" | "codex" | "api" | "local";
export type RuntimeAvailability = "AVAILABLE" | "BUSY" | "AUTH_REQUIRED" | "RATE_LIMITED" | "BUDGET_EXHAUSTED" | "PAGE_CHANGED" | "USER_ACTION_REQUIRED" | "UNSUPPORTED" | "DOWN";
export type RuntimeCapability = "planning" | "research" | "review" | "synthesis" | "coding" | "validation" | "critique";

export interface RuntimeCapabilities {
  consumesModel?: boolean;
  roles: readonly RuntimeCapability[];
  supportsCancellation: boolean;
  supportsStreaming: boolean;
}

export interface RuntimeHealth {
  runtimeId: RuntimeId;
  availability: RuntimeAvailability;
  message: string;
  checkedAt: string;
}

export interface RuntimeRequest {
  sessionId?: string;
  replaySafe?: boolean;
  timeoutMs?: number;
  jobId: string;
  taskId: string;
  role: RuntimeCapability;
  prompt: string;
  context?: string;
}

export interface RuntimeFailure {
  retryAt?: number;
  code: RuntimeAvailability | "TIMEOUT" | "UNKNOWN";
  message: string;
  retryable: boolean;
}

export interface RuntimeMetrics {
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface RuntimeResult {
  runtimeId: RuntimeId;
  jobId: string;
  status: "SUCCESS" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE" | "CANCELLED";
  artifact?: RawArtifact;
  content?: string;
  failure?: RuntimeFailure;
  metrics?: RuntimeMetrics;
}

export interface RuntimeAdapter {
  readonly id: RuntimeId;
  readonly kind: RuntimeKind;
  readonly capabilities: RuntimeCapabilities;
  healthCheck(): Promise<RuntimeHealth>;
  execute(request: RuntimeRequest, signal?: AbortSignal): Promise<RuntimeResult>;
  cancel?(jobId: string): Promise<void>;
}

export function isRuntimeAvailable(availability: RuntimeAvailability): boolean {
  switch (availability) {
    case "AVAILABLE": return true;
    case "BUSY":
    case "AUTH_REQUIRED":
    case "RATE_LIMITED":
    case "BUDGET_EXHAUSTED":
    case "PAGE_CHANGED":
    case "USER_ACTION_REQUIRED":
    case "UNSUPPORTED":
    case "DOWN": return false;
  }
}
