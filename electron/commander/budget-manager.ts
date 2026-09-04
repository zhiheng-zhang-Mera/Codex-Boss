import type { RuntimeId } from "../runtimes/runtime";

export type RuntimeBudgetLevel = "UNKNOWN" | "OK" | "LOW" | "EXHAUSTED";
export type RuntimeBudgetSource = "OBSERVED" | "API" | "USER_CONFIG" | "RATE_LIMIT_SIGNAL";

export interface RuntimeBudgetState {
  runtimeId: RuntimeId;
  state: RuntimeBudgetLevel;
  source: RuntimeBudgetSource;
  resetAt?: string;
  updatedAt: string;
}

export class BudgetManager {
  private readonly states = new Map<RuntimeId, RuntimeBudgetState>();

  get(runtimeId: RuntimeId): RuntimeBudgetState {
    return this.states.get(runtimeId) ?? { runtimeId, state: "UNKNOWN", source: "OBSERVED", updatedAt: new Date(0).toISOString() };
  }

  list(): RuntimeBudgetState[] { return [...this.states.values()]; }

  update(runtimeId: RuntimeId, state: RuntimeBudgetLevel, source: RuntimeBudgetSource, resetAt?: string): RuntimeBudgetState {
    const value = { runtimeId, state, source, ...(resetAt ? { resetAt } : {}), updatedAt: new Date().toISOString() };
    this.states.set(runtimeId, value);
    return value;
  }

  observeFailure(runtimeId: RuntimeId, message: string): RuntimeBudgetState | undefined {
    if (/quota|allowance|budget|额度|用量.*(耗尽|上限)|limit reached/i.test(message)) return this.update(runtimeId, "EXHAUSTED", "RATE_LIMIT_SIGNAL");
    if (/rate.?limit|too many requests|频率限制/i.test(message)) return this.update(runtimeId, "LOW", "RATE_LIMIT_SIGNAL");
    return undefined;
  }

  eligible(runtimeId: RuntimeId): boolean { return this.get(runtimeId).state !== "EXHAUSTED"; }
}
