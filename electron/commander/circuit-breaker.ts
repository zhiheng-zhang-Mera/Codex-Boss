import { readJson, writeJson } from "./durable-json";
import type { InterruptionKind } from "./interruption";
import type { RuntimeId } from "../runtimes/runtime";

/**
 * Interruptions that mean the provider itself is unhealthy. User/auth, quota and
 * side-effect states are excluded: they have their own gates (budget reset,
 * human reconciliation) and must not trip the provider health breaker.
 */
const PROVIDER_TECHNICAL_KINDS: ReadonlySet<InterruptionKind> = new Set([
  "NETWORK_FAILURE", "PROVIDER_5XX", "TOOL_TIMEOUT", "BROWSER_CRASH", "PROCESS_CRASH", "RESOURCE_EXHAUSTED"
]);

export function providerTechnicalInterruption(kind: InterruptionKind): boolean {
  return PROVIDER_TECHNICAL_KINDS.has(kind);
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Consecutive provider-technical failures that trip the breaker OPEN. Default 3. */
  failureThreshold?: number;
  /** Milliseconds an OPEN breaker stays closed before HALF_OPEN admits one probe. Default 60000. */
  cooldownMs?: number;
  /** Injectable clock for deterministic tests. Default Date.now. */
  now?: () => number;
}

interface StoredRecord {
  runtimeId: RuntimeId;
  state: "CLOSED" | "OPEN";
  consecutiveFailures: number;
  openedAt?: number;
  updatedAt: string;
}

interface CircuitBreakerFile {
  schemaVersion: 1;
  records: StoredRecord[];
}

const DEFAULTS = { failureThreshold: 3, cooldownMs: 60000 };

/**
 * Per-runtime provider health breaker (plan §9). Repeated provider-technical
 * failures trip a runtime OPEN for a cooldown; after the cooldown HALF_OPEN
 * admits at most one probe whose outcome decides CLOSED (success) or OPEN
 * (failure). A broken provider is isolated instead of dragging the whole BOSS
 * dispatch path down. Human/auth/side-effect states never trip the breaker.
 */
export class CircuitBreaker {
  private readonly records = new Map<RuntimeId, StoredRecord>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly halfOpenProbes = new Map<RuntimeId, number>();

  constructor(private readonly file?: string, options: CircuitBreakerOptions = {}) {
    this.failureThreshold = clampInt(options.failureThreshold ?? DEFAULTS.failureThreshold, 1, 20);
    this.cooldownMs = clampInt(options.cooldownMs ?? DEFAULTS.cooldownMs, 1, 7 * 24 * 3600 * 1000);
    this.now = options.now ?? Date.now;
    if (file) {
      const value = readJson<Partial<CircuitBreakerFile>>(file);
      if (!value) return;
      if (value.schemaVersion !== 1 || !Array.isArray(value.records)) throw new Error("Invalid circuit breaker state");
      for (const record of value.records) {
        if (!record || typeof record.runtimeId !== "string" || !["CLOSED", "OPEN"].includes(record.state) || !Number.isInteger(record.consecutiveFailures) || record.consecutiveFailures < 0) throw new Error("Invalid circuit breaker record");
        this.records.set(record.runtimeId, { ...record, state: record.state });
      }
    }
  }

  /** Current health state; OPEN whose cooldown elapsed is reported as HALF_OPEN. */
  state(runtimeId: RuntimeId): CircuitState {
    const record = this.records.get(runtimeId);
    if (!record) return "CLOSED";
    if (record.state === "OPEN" && record.openedAt !== undefined && this.now() - record.openedAt >= this.cooldownMs) return "HALF_OPEN";
    return record.state;
  }

  /** True while the breaker is tripped and the cooldown has NOT yet elapsed. */
  isOpen(runtimeId: RuntimeId): boolean {
    return this.state(runtimeId) === "OPEN";
  }

  /** Dispatch gate. False while OPEN; once the cooldown elapses HALF_OPEN admits a bounded probe. */
  admit(runtimeId: RuntimeId): boolean {
    const state = this.state(runtimeId);
    if (state === "CLOSED") return true;
    if (state === "OPEN") return false;
    const probes = this.halfOpenProbes.get(runtimeId) ?? 0;
    if (probes >= 1) return false;
    this.halfOpenProbes.set(runtimeId, probes + 1);
    return true;
  }

  /** A verified provider success closes the breaker and clears the failure streak. */
  observeSuccess(runtimeId: RuntimeId): CircuitState {
    const current = this.records.get(runtimeId);
    if (!current || current.state !== "CLOSED" || current.consecutiveFailures !== 0) {
      this.records.set(runtimeId, { runtimeId, state: "CLOSED", consecutiveFailures: 0, updatedAt: new Date(this.now()).toISOString() });
      this.persist();
    }
    this.halfOpenProbes.delete(runtimeId);
    return "CLOSED";
  }

  /** A provider-technical failure counts toward the threshold; a HALF_OPEN probe failure reopens. */
  observeFailure(runtimeId: RuntimeId): CircuitState {
    const now = this.now();
    const current = this.records.get(runtimeId);
    if (current?.state === "OPEN") {
      const elapsed = current.openedAt !== undefined && now - current.openedAt >= this.cooldownMs;
      if (!elapsed) return "OPEN"; // still cooling down; a long outage must not extend the cooldown forever
      // The HALF_OPEN probe failed: reopen with a fresh cooldown.
      this.records.set(runtimeId, { ...current, consecutiveFailures: this.failureThreshold, openedAt: now, updatedAt: new Date(now).toISOString() });
      this.persist();
      this.halfOpenProbes.delete(runtimeId);
      return "OPEN";
    }
    const failures = (current?.consecutiveFailures ?? 0) + 1;
    if (failures >= this.failureThreshold) {
      this.records.set(runtimeId, { runtimeId, state: "OPEN", consecutiveFailures: failures, openedAt: now, updatedAt: new Date(now).toISOString() });
      this.persist();
      this.halfOpenProbes.delete(runtimeId);
      return "OPEN";
    }
    this.records.set(runtimeId, { runtimeId, state: "CLOSED", consecutiveFailures: failures, updatedAt: new Date(now).toISOString() });
    this.persist();
    return "CLOSED";
  }

  /** User cancellation must free a consumed HALF_OPEN probe without changing breaker state. */
  cancelProbe(runtimeId: RuntimeId): void {
    this.halfOpenProbes.delete(runtimeId);
  }

  list(): { runtimeId: RuntimeId; state: CircuitState; consecutiveFailures: number; }[] {
    return [...this.records.values()].map((record) => ({ runtimeId: record.runtimeId, state: this.state(record.runtimeId), consecutiveFailures: record.consecutiveFailures }));
  }

  reset(runtimeId: RuntimeId): void {
    this.records.delete(runtimeId);
    this.halfOpenProbes.delete(runtimeId);
    this.persist();
  }

  private persist(): void {
    if (!this.file) return;
    const payload: CircuitBreakerFile = { schemaVersion: 1, records: [...this.records.values()] };
    writeJson(this.file, payload);
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) throw new Error("Circuit breaker option must be an integer");
  return Math.min(max, Math.max(min, value));
}
