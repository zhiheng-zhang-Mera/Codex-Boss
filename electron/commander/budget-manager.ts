import { readJson, writeJson } from "./durable-json";
import type { RuntimeId } from "../runtimes/runtime";

type RuntimeBudgetLevel = "UNKNOWN" | "OK" | "LOW" | "EXHAUSTED";
type RuntimeBudgetSource = "OBSERVED" | "API" | "USER_CONFIG" | "RATE_LIMIT_SIGNAL";

interface RuntimeBudgetState {
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

  /**
   * Whether a runtime may be dispatched to.
   *
   * PURE: no clock read that mutates, no I/O, no throwing. This is a hot-path predicate — the
   * scheduler and the execution supervisor call it per dispatch candidate — and it previously called
   * `update()` when a reset window had passed, which writes the whole budget file to disk from inside
   * a question. A write failure then escaped from a method whose callers treat it as pure.
   *
   * The expiry decision itself is unchanged; only WHERE it is applied moved. Call `reconcile()` to
   * apply due expirations, then ask this. A caller that only asks still gets the right answer for the
   * state as it currently stands, it just does not trigger a state transition as a side effect of
   * asking.
   */
  eligible(runtimeId: RuntimeId): boolean {
    return this.get(runtimeId).state !== "EXHAUSTED";
  }

  /**
   * Apply every reset window that has passed, in memory, and report what changed.
   *
   * Deliberately does NOT persist. The reconciliation is a state correction derived from the clock, so
   * it is recomputed on the next call rather than written on every check — the durability contract for
   * this store is that OBSERVED transitions persist (see `observeSuccess` / `observeFailure` /
   * `update`), and a clock tick is not an observation.
   *
   * Returns the runtime ids that were released, so a caller can report the transition instead of it
   * happening invisibly inside a predicate.
   */
  reconcile(now: number = Date.now()): RuntimeId[] {
    const released: RuntimeId[] = [];
    for (const [runtimeId, state] of [...this.states]) {
      if (!state.resetAt || Date.parse(state.resetAt) > now) continue;
      // The reset window has passed: the previous level was a forecast, not a verdict, so the runtime
      // returns to UNKNOWN and is eligible again until something observes otherwise.
      this.states.set(runtimeId, { ...state, state: "UNKNOWN", source: "OBSERVED", updatedAt: new Date(now).toISOString(), resetAt: undefined });
      released.push(runtimeId);
    }
    return released;
  }
}
