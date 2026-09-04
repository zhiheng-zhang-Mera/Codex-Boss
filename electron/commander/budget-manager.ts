import { readJson, writeJson } from "./durable-json";
import type { RuntimeId } from "../runtimes/runtime";

export type RuntimeBudgetLevel = "UNKNOWN" | "OK" | "LOW" | "EXHAUSTED";
export type RuntimeBudgetSource = "OBSERVED" | "API" | "USER_CONFIG" | "RATE_LIMIT_SIGNAL";

export interface RuntimeBudgetState {
  runtimeId: RuntimeId;
  state: RuntimeBudgetLevel;
  source: RuntimeBudgetSource;
  resetAt?: string;
  updatedAt: string;
  failureCount?: number;
  lastSuccessAt?: string;
}

export class BudgetManager {
  private readonly states = new Map<RuntimeId, RuntimeBudgetState>();

  constructor(private readonly file?: string) {
    if (file) for (const value of readJson<RuntimeBudgetState[]>(file) ?? []) {
      if (!value.runtimeId || !["UNKNOWN", "OK", "LOW", "EXHAUSTED"].includes(value.state)) throw new Error("Invalid runtime budget state");
      this.states.set(value.runtimeId, value);
    }
  }
  observeSuccess(runtimeId: RuntimeId): void {
    this.update(runtimeId, "OK", "OBSERVED");
    const value = this.states.get(runtimeId)!; value.lastSuccessAt = new Date().toISOString(); value.failureCount = 0;
    if (this.file) writeJson(this.file, this.list());
  }

  get(runtimeId: RuntimeId): RuntimeBudgetState {
    return this.states.get(runtimeId) ?? { runtimeId, state: "UNKNOWN", source: "OBSERVED", updatedAt: new Date(0).toISOString() };
  }

  list(): RuntimeBudgetState[] { return [...this.states.values()]; }

  update(runtimeId: RuntimeId, state: RuntimeBudgetLevel, source: RuntimeBudgetSource, resetAt?: string): RuntimeBudgetState {
    const previous = this.get(runtimeId);
    const value = { runtimeId, state, source, failureCount: (previous.failureCount ?? 0) + (source === "RATE_LIMIT_SIGNAL" ? 1 : 0), lastSuccessAt: previous.lastSuccessAt, ...(resetAt ? { resetAt } : {}), updatedAt: new Date().toISOString() };
    this.states.set(runtimeId, value);
    if (this.file) writeJson(this.file, this.list());
    return value;
  }

  observeFailure(runtimeId: RuntimeId, message: string, resetAt?: string): RuntimeBudgetState | undefined {
    if (/quota|allowance|budget|额度|用量.*(耗尽|上限)|limit reached/i.test(message)) return this.update(runtimeId, "EXHAUSTED", "RATE_LIMIT_SIGNAL", resetAt);
    if (/rate.?limit|too many requests|频率限制/i.test(message)) return this.update(runtimeId, "LOW", "RATE_LIMIT_SIGNAL", resetAt);
    return undefined;
  }

  eligible(runtimeId: RuntimeId): boolean {
    const state = this.get(runtimeId);
    if (state.resetAt && Date.parse(state.resetAt) <= Date.now()) this.update(runtimeId, "UNKNOWN", "OBSERVED");
    return this.get(runtimeId).state !== "EXHAUSTED";
  }
}
