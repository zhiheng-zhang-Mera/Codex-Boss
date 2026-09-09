import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readJson, validId, writeJson } from "./durable-json";
import type { Interruption } from "./interruption";
import type { RuntimeResult } from "../runtimes/runtime";
import type { ConfigLayerName } from "../../src/shared/config-layering";
import { resolveOperationalLimits, type OperationalLimitOverrides } from "../../src/shared/config-layering";
import { validateReproductionSnapshot, type ReproductionSnapshot } from "../repro-snapshot";
import { pruneTaskCheckpoints } from "./storage-budget";
export interface Consumption { modelCalls: number; estimatedInputTokens: number; estimatedOutputTokens: number; toolCalls: number; browserActions: number; retries: number; workerRuntimeMs: number; providerWaitMs: number; }
export interface WorkerSession {
  externalSessionId?: string;
  url?: string;
  id: string;
  provider: string;
  taskId: string;
  checkpoint: number;
  health: string;
  resumeStrategy: "RECONSTRUCT" | "EXPLICIT_SESSION" | "RESTORE_URL";
  /** Explicit lifecycle kind (AP07a); absent on legacy records = NEW. */
  kind?: import("../../src/shared/session-state").SessionLifecycleKind;
  /** Workspace the session belongs to (AP07a binding); resolved from task workspace. */
  workspaceId?: string;
}
export interface LedgerJob { id: string; fingerprint: string; state: "RUNNING" | "COMPLETED" | "WAITING" | "FAILED"; sessionId: string; attempts: number; result?: RuntimeResult; retryAt?: number; /** Durable timing (§7.5/§16.1): when the job entered RUNNING. */ startedAt?: string; /** Durable timing: when the job reached a terminal state. */ completedAt?: string; }
export interface TaskLedgerRecord {
  projectMemoryOwner?: string;
  degradation?: import("./degraded-controller").DegradationState;
  workspace?: { path: string; strategy: "current" | "branch" | "worktree"; branch?: string; base?: string };
  schemaVersion: 1; taskId: string; objective: string; constraints: string[]; revision: number;
  completedSteps: string[]; currentStep: string | null; pendingSteps: string[]; modifiedFiles: string[];
  verificationState: "NOT_RUN" | "PASS" | "FAILED"; failureHistory: Interruption[];
  activeProvider: string | null; sessionId: string | null; nextAction: string;
  usage: Consumption; limits: { modelCalls: number; retries: number; toolCalls: number };
  mode: "NORMAL" | "LIGHTWEIGHT" | "DETERMINISTIC" | "PAUSED";
  sessions: WorkerSession[]; jobs: Record<string, LedgerJob>; checkpointReason: string;
  providerState?: import("../../src/shared/provider-state").ProviderStateRecord;
  /** Per-limit provenance (plan §7 explainable config), e.g. { modelCalls: "task" }. */
  limitsSource?: Partial<Record<"modelCalls" | "retries" | "toolCalls", ConfigLayerName>>;
  /**
   * Policy decision chosen for this task (plan §29): recorded when the plan
   * is compiled so degradation selection can consume the chosen worker
   * count / context budget instead of fixed per-mode constants.
   */
  policy?: { complexity: "L0" | "L1" | "L2" | "L3"; decision: import("../../src/shared/policy").PolicyDecision; optimizer: string; decidedAt: string };
}

/** Operational budget a task may override from the task config layer (plan §7). */
export interface TaskBudgetOptions extends OperationalLimitOverrides {}

export function explainTaskBudget(record: Pick<TaskLedgerRecord, "limits" | "limitsSource">): string[] {
  return (Object.keys(record.limits) as (keyof TaskLedgerRecord["limits"])[]).map((key) => `${key} = ${record.limits[key]} (source: ${record.limitsSource?.[key] ?? "system"})`);
}
export class TaskLedger {
  constructor(readonly root: string) {}
  load(taskId: string): TaskLedgerRecord | undefined {
    const directory = path.join(this.root, validId(taskId), "checkpoints");
    if (!fs.existsSync(directory)) return undefined;
    const files = fs.readdirSync(directory).filter((name) => /^\d{8}\.json$/.test(name)).sort();
    if (!files.length) return undefined;
    // Fail closed on a damaged newest generation: silently rolling back could repeat a side effect.
    const record = readJson<TaskLedgerRecord>(path.join(directory, files[files.length - 1]))!;
    if (record.schemaVersion !== 1 || record.taskId !== taskId || !Number.isInteger(record.revision)) throw new Error("Invalid task checkpoint");
    return record;
  }
  create(taskId: string, objective: string, constraints: string[] = [], budget: TaskBudgetOptions = {}): TaskLedgerRecord {
    const existing = this.load(taskId); if (existing) return existing;
    const resolved = resolveOperationalLimits(budget);
    return this.save({ schemaVersion: 1, taskId, objective, constraints, revision: 0, completedSteps: [], currentStep: null, pendingSteps: [], modifiedFiles: [], verificationState: "NOT_RUN", failureHistory: [], activeProvider: null, sessionId: null, nextAction: "COMPILE", usage: { modelCalls: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, toolCalls: 0, browserActions: 0, retries: 0, workerRuntimeMs: 0, providerWaitMs: 0 }, limits: resolved.values, limitsSource: resolved.sources, mode: "NORMAL", sessions: [], jobs: {}, checkpointReason: "task compiled" }, "task compiled");
  }
  save(record: TaskLedgerRecord, reason: string): TaskLedgerRecord {
    const current = this.load(record.taskId);
    if (current && current.revision !== record.revision) throw new Error("Stale task checkpoint");
    const next = structuredClone(record); next.revision += 1; next.checkpointReason = reason;
    writeJson(path.join(this.root, validId(next.taskId), "checkpoints", `${String(next.revision).padStart(8, "0")}.json`), next);
    // Bounded generation retention (plan §17): amortized prune so a long-running
    // task never accumulates unbounded checkpoints; recovery only reads newest.
    if (next.revision % 20 === 0) pruneTaskCheckpoints(this.root, next.taskId);
    return next;
  }
  update(taskId: string, reason: string, mutate: (record: TaskLedgerRecord) => void): TaskLedgerRecord {
    const record = this.load(taskId); if (!record) throw new Error("Unknown ledger task"); mutate(record); return this.save(record, reason);
  }

  /** Persist a reproducibility snapshot beside the task checkpoints (plan §11). */
  saveReproduction(taskId: string, snapshot: ReproductionSnapshot): void {
    writeJson(path.join(this.root, validId(taskId), "repro.json"), snapshot);
  }

  /** Removes all durable ledger state for a task (used by conversation cascade delete). */
  purgeTask(taskId: string): void {
    const directory = path.join(this.root, validId(taskId));
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  }

  /** Latest saved reproduction snapshot for a task, fail-closed on corruption. */
  loadReproduction(taskId: string): ReproductionSnapshot | undefined {
    const value = readJson<unknown>(path.join(this.root, validId(taskId), "repro.json"));
    return value ? validateReproductionSnapshot(value) : undefined;
  }
  static fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
}
