import type { RawArtifact } from "../../src/shared/contracts";
import type { CompatibilityDeclaration } from "../../src/shared/compatibility";

export type RuntimeId = string;
export type RuntimeKind = "web" | "codex" | "api" | "local";
export type RuntimeAvailability = "AVAILABLE" | "BUSY" | "AUTH_REQUIRED" | "RATE_LIMITED" | "BUDGET_EXHAUSTED" | "PAGE_CHANGED" | "USER_ACTION_REQUIRED" | "UNSUPPORTED" | "DOWN" | "UNKNOWN";
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

/**
 * Token usage a PROVIDER actually reported for one completion.
 *
 * Every field is optional and means "the provider told us this number". An absent field is not zero and
 * is never estimated: the platform's own `ceil(characters / 4)` figures stay on the ledger as
 * diagnostics and must not be promoted into these fields, because a Gate 8 cost comparison that
 * accepted a heuristic as a measurement would be comparing arithmetic the platform invented.
 *
 * The names are deliberately provider-neutral. Each adapter maps its own response schema onto this
 * shape so nothing upstream has to know whether a vendor calls them `prompt_tokens`, `input_tokens` or
 * `promptTokenCount`.
 */
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface RuntimeResult {
  runtimeId: RuntimeId;
  jobId: string;
  status: "SUCCESS" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE" | "CANCELLED";
  artifact?: RawArtifact;
  content?: string;
  failure?: RuntimeFailure;
  metrics?: RuntimeMetrics;
  /**
   * What the provider reported about this call, when it reported anything.
   *
   * Carried on the RESULT rather than only inside the artifact so the supervisor can persist it: a
   * usage figure that stops at the adapter is a figure the ledger never sees, and the coordination
   * record is derived from the ledger.
   */
  usage?: ProviderUsage;
}

export interface RuntimeAdapter {
  readonly id: RuntimeId;
  readonly kind: RuntimeKind;
  readonly capabilities: RuntimeCapabilities;
  /**
   * Declared compatibility windows (plan §6). Absence is treated as a legacy
   * unversioned adapter that is accepted; a declaration that does not contain
   * the current core version is rejected at registration (fail fast).
   */
  readonly compatibility?: CompatibilityDeclaration;
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
    case "DOWN":
    case "UNKNOWN": return false;
  }
}
