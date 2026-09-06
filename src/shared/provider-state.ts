export type ProviderState = "ACTIVE" | "WAITING_PROVIDER" | "PAUSED_PROVIDER";
export const PROVIDER_STATES: readonly ProviderState[] = ["ACTIVE", "WAITING_PROVIDER", "PAUSED_PROVIDER"];

/**
 * Named, serialized provider lifecycle state (plan AP03 / §1.3 GOOD example).
 * WAITING_PROVIDER = the task is waiting because the provider is not ready yet
 * (retry deadline, rate-limit reset, session rebuild); it resumes automatically.
 * PAUSED_PROVIDER = waiting on a provider-side user action (login, approval,
 * side-effect reconciliation, exhausted budget) and must NOT auto-resume.
 */
export interface ProviderStateRecord {
  state: ProviderState;
  reason: string;
  autoResume: boolean;
  retryAt?: number;
  updatedAt: string;
}

const AUTO_ACTIONS = new Set(["WAIT", "RETRY", "RECONSTRUCT", "DEFER"]);
const PAUSED_ACTIONS = new Set(["HUMAN_REQUIRED", "VERIFY_SIDE_EFFECT"]);

export function stateForRecovery(action: string, reason: string, retryAt: number | undefined, now = Date.now()): ProviderStateRecord {
  if (AUTO_ACTIONS.has(action)) {
    return { state: "WAITING_PROVIDER", reason: reason || "等待服务商恢复", autoResume: true, ...(retryAt !== undefined ? { retryAt } : {}), updatedAt: new Date(now).toISOString() };
  }
  if (PAUSED_ACTIONS.has(action)) {
    return { state: "PAUSED_PROVIDER", reason: reason || "等待服务商人工处理", autoResume: false, ...(retryAt !== undefined ? { retryAt } : {}), updatedAt: new Date(now).toISOString() };
  }
  return { state: "ACTIVE", reason: reason || "运行中", autoResume: true, ...(retryAt !== undefined ? { retryAt } : {}), updatedAt: new Date(now).toISOString() };
}

export function pausedForProvider(reason: string, now = Date.now()): ProviderStateRecord {
  return { state: "PAUSED_PROVIDER", reason, autoResume: false, updatedAt: new Date(now).toISOString() };
}

export function providerStateLabel(state: ProviderState): string {
  return ({ ACTIVE: "等待中", WAITING_PROVIDER: "等待服务商恢复", PAUSED_PROVIDER: "等待服务商人工处理" })[state];
}
