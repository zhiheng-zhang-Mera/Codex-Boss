import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readJson, validId, writeJson } from "./durable-json";
import type { Interruption } from "./interruption";
import type { RuntimeResult } from "../runtimes/runtime";
export interface Consumption { modelCalls: number; estimatedInputTokens: number; estimatedOutputTokens: number; toolCalls: number; browserActions: number; retries: number; workerRuntimeMs: number; providerWaitMs: number; }
export interface WorkerSession { externalSessionId?: string; url?: string; id: string; provider: string; taskId: string; checkpoint: number; health: string; resumeStrategy: "RECONSTRUCT" | "EXPLICIT_SESSION" | "RESTORE_URL"; }
export interface LedgerJob { id: string; fingerprint: string; state: "RUNNING" | "COMPLETED" | "WAITING" | "FAILED"; sessionId: string; attempts: number; result?: RuntimeResult; retryAt?: number; }
export interface TaskLedgerRecord {
  schemaVersion: 1; taskId: string; objective: string; constraints: string[]; revision: number;
  completedSteps: string[]; currentStep: string | null; pendingSteps: string[]; modifiedFiles: string[];
  verificationState: "NOT_RUN" | "PASS" | "FAILED"; failureHistory: Interruption[];
  activeProvider: string | null; sessionId: string | null; nextAction: string;
  usage: Consumption; limits: { modelCalls: number; retries: number; toolCalls: number };
  mode: "NORMAL" | "LIGHTWEIGHT" | "DETERMINISTIC" | "PAUSED";
  sessions: WorkerSession[]; jobs: Record<string, LedgerJob>; checkpointReason: string;
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
  create(taskId: string, objective: string, constraints: string[] = []): TaskLedgerRecord {
    const existing = this.load(taskId); if (existing) return existing;
    return this.save({ schemaVersion: 1, taskId, objective, constraints, revision: 0, completedSteps: [], currentStep: null, pendingSteps: [], modifiedFiles: [], verificationState: "NOT_RUN", failureHistory: [], activeProvider: null, sessionId: null, nextAction: "COMPILE", usage: { modelCalls: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, toolCalls: 0, browserActions: 0, retries: 0, workerRuntimeMs: 0, providerWaitMs: 0 }, limits: { modelCalls: 12, retries: 3, toolCalls: 100 }, mode: "NORMAL", sessions: [], jobs: {}, checkpointReason: "task compiled" }, "task compiled");
  }
  save(record: TaskLedgerRecord, reason: string): TaskLedgerRecord {
    const current = this.load(record.taskId);
    if (current && current.revision !== record.revision) throw new Error("Stale task checkpoint");
    const next = structuredClone(record); next.revision += 1; next.checkpointReason = reason;
    writeJson(path.join(this.root, validId(next.taskId), "checkpoints", `${String(next.revision).padStart(8, "0")}.json`), next);
    return next;
  }
  update(taskId: string, reason: string, mutate: (record: TaskLedgerRecord) => void): TaskLedgerRecord {
    const record = this.load(taskId); if (!record) throw new Error("Unknown ledger task"); mutate(record); return this.save(record, reason);
  }
  static fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
}
