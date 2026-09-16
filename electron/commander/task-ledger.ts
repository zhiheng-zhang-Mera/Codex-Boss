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
/**
 * What a task consumed.
 *
 * Two families, and the difference matters:
 *
 *  - `estimatedInputTokens` / `estimatedOutputTokens` are the platform's OWN `ceil(characters / 4)`
 *    figures. They are diagnostics: an approximation the platform computed, not a count any provider
 *    reported, and Gate 8 refuses to treat them as measurements.
 *  - `providerInputTokens` / `providerOutputTokens` / `providerTotalTokens` are what a PROVIDER said it
 *    used. They are absent when the provider returned no usage block, and absent is not zero.
 */
export interface Consumption {
  modelCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  /** Provider-reported prompt tokens. Absent when the provider reported no usage. */
  providerInputTokens?: number;
  /** Provider-reported completion tokens. Absent when the provider reported no usage. */
  providerOutputTokens?: number;
  /** Provider-reported total, when it reported one distinct from the two parts. */
  providerTotalTokens?: number;
  toolCalls: number;
  browserActions: number;
  retries: number;
  workerRuntimeMs: number;
  providerWaitMs: number;
}
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
/**
 * One stage the pipeline ACTUALLY executed, recorded as it ran.
 *
 * This exists because the alternative — inferring which stages ran from the finished record — is not
 * reliable enough to decide whether an extra Agent stage earns its place. The inference reads
 * `modifiedFiles` for `implement`, `verificationState` for `verify` and `retries`/`failureHistory`
 * for `repair`, so a stage that ran but produced no diff, no retry and no finding is invisible, and a
 * MANDATORY platform gate becomes indistinguishable from an OPTIONAL Agent stage. Gate 8 needs to
 * tell those apart, so the evidence is recorded rather than reconstructed.
 *
 * `kind` is the load-bearing field:
 *
 *  - `agent` — an optional Agent stage (planning, an independent review, a critique). These are what
 *    the economics adjudication exists to judge;
 *  - `platform` — a mandatory part of the task lifecycle (`intake`, `verify`, `finalize`). A
 *    mandatory contract gate is a platform invariant: it is not a candidate for removal, so it must
 *    never be the thing an experiment varies.
 */
export interface ExecutedStage {
  stage: string;
  kind: "agent" | "platform";
  /** When the stage started. Durable timing is what makes the trace auditable rather than assertive. */
  startedAt: string;
}

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
   * Findings an OPTIONAL review Agent raised, when one ran.
   *
   * Absent means no reviewer ran — which is a different fact from "the reviewer ran and found nothing",
   * and Gate 8 needs to tell them apart. Kept apart from `failureHistory` so a reviewer is never
   * credited with the failures it exists to catch.
   */
  reviewFindings?: number;
  /**
   * Policy decision chosen for this task (plan §29): recorded when the plan
   * is compiled so degradation selection can consume the chosen worker
   * count / context budget instead of fixed per-mode constants.
   */
  policy?: { complexity: "L0" | "L1" | "L2" | "L3"; decision: import("../../src/shared/policy").PolicyDecision; optimizer: string; decidedAt: string };
  /**
   * The stages this task actually executed, in the order they started.
   *
   * Absent on records written before the trace existed, which is why the coordination adapter still
   * carries an inference fallback for old ledgers — but new Gate 8 evidence reads this, never a guess.
   */
  executedStages?: ExecutedStage[];
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

  /**
   * Record that a stage started, AT THE MOMENT IT STARTS.
   *
   * Idempotent per stage: a stage that is entered twice (a replan, a repair loop) is one entry in the
   * trace, because the question the trace answers is *which* stages ran, not how many times. The
   * first `startedAt` is kept, so the order is the order the stages were first entered.
   *
   * Called from the places that actually do the work rather than from one summary pass at the end,
   * because a summary pass is the inference this replaces.
   */
  recordStage(taskId: string, stage: string, kind: ExecutedStage["kind"], at: string = new Date().toISOString()): TaskLedgerRecord | undefined {
    const record = this.load(taskId);
    if (!record) return undefined;
    const executed = record.executedStages ?? [];
    if (executed.some((entry) => entry.stage === stage)) return record;
    return this.save({ ...record, executedStages: [...executed, { stage, kind, startedAt: at }] }, `stage ${stage} started`);
  }

  /**
   * Record the MANDATORY verification lifecycle outcome.
   *
   * Separate from the Agent trace on purpose: this is a platform contract gate, so it is not a stage
   * that can be added to or removed from a pipeline — it is a precondition of completion. Keeping it
   * out of `executedStages` is what stops a safety gate from ever becoming an A/B variable.
   */
  markVerification(taskId: string, state: TaskLedgerRecord["verificationState"], reason: string): TaskLedgerRecord | undefined {
    const record = this.load(taskId);
    if (!record) return undefined;
    return this.save({ ...record, verificationState: state }, reason);
  }

  /**
   * Record how many findings an optional review Agent raised.
   *
   * Deliberately separate from `failureHistory`, which counts interruptions the loop suffered. A
   * reviewer that raises five findings and a loop that suffered five failures are different events, and
   * a single counter would let a review stage appear to have caused the failures it was there to catch.
   * Undefined until a review actually runs, so "no reviewer ran" stays distinguishable from "the
   * reviewer found nothing".
   */
  markReviewFindings(taskId: string, findings: number, reason: string): TaskLedgerRecord | undefined {
    const record = this.load(taskId);
    if (!record) return undefined;
    return this.save({ ...record, reviewFindings: (record.reviewFindings ?? 0) + findings }, reason);
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
