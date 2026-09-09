/**
 * Token budget manager (plan 9-7 §26). Durable per-task ledger of model
 * spend with soft thresholds per stage, plus a deterministic degradation
 * ladder (compress context → drop stale artifacts → switch Pro→Flash where
 * safe → request only delta) so expensive calls stay explainable.
 */
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "./durable-json";

export type TokenStage = "router" | "planner" | "worker" | "synthesis" | "research" | "reviewer";

export interface TokenSpend {
  taskId: string;
  stage: TokenStage;
  model: string;
  inputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  estimatedCost: number;
  recordedAt: string;
}

export interface BudgetLedgerEntry extends TokenSpend {
  id: string;
}

export interface TokenBudgetLedgerFile {
  schemaVersion: 1;
  entries: BudgetLedgerEntry[];
}

export interface BudgetStatus {
  taskTokens: number;
  softLimit: number;
  overSoftLimit: boolean;
  recommendation?: string;
}

/** Soft input-token ceilings per stage (plan §26). */
const STAGE_SOFT_LIMITS: Record<TokenStage, number> = {
  router: 2_000,
  planner: 8_000,
  worker: 24_000,
  synthesis: 24_000,
  research: 80_000,
  reviewer: 12_000
};

export const TOKEN_STAGES: readonly TokenStage[] = Object.keys(STAGE_SOFT_LIMITS) as TokenStage[];

export class TokenBudgetManager {
  private readonly filePath: string;
  private entries: BudgetLedgerEntry[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.restore();
  }

  private restore(): void {
    const saved = readJson<Partial<TokenBudgetLedgerFile>>(this.filePath);
    if (!saved || saved.schemaVersion !== 1 || !Array.isArray(saved.entries)) return;
    this.entries = saved.entries;
  }

  private persist(): void {
    writeJson(this.filePath, { schemaVersion: 1, entries: this.entries } satisfies TokenBudgetLedgerFile);
  }

  /** Records one model call against its stage soft budget. */
  record(spend: TokenSpend): BudgetLedgerEntry {
    if (spend.inputTokens < 0 || spend.outputTokens < 0 || spend.estimatedCost < 0) throw new Error("Token spend cannot be negative");
    if (!TOKEN_STAGES.includes(spend.stage)) throw new Error(`Unknown token stage: ${spend.stage}`);
    const entry: BudgetLedgerEntry = { ...spend, id: `${Date.now()}-${this.entries.length}-${Math.random().toString(36).slice(2, 8)}` };
    this.entries.push(entry);
    this.entries = this.entries.slice(-2000);
    this.persist();
    return entry;
  }

  /** Aggregate spend for one task (or all tasks when omitted). */
  spendFor(taskId?: string): { inputTokens: number; cacheHitTokens: number; cacheMissTokens: number; outputTokens: number; estimatedCost: number } {
    const rows = taskId ? this.entries.filter((entry) => entry.taskId === taskId) : this.entries;
    return rows.reduce(
      (sum, entry) => ({
        inputTokens: sum.inputTokens + entry.inputTokens,
        cacheHitTokens: sum.cacheHitTokens + entry.cacheHitTokens,
        cacheMissTokens: sum.cacheMissTokens + entry.cacheMissTokens,
        outputTokens: sum.outputTokens + entry.outputTokens,
        estimatedCost: sum.estimatedCost + entry.estimatedCost
      }),
      { inputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0, estimatedCost: 0 }
    );
  }

  /** Soft-budget status for a task/stage with a concrete next action. */
  statusFor(taskId: string, stage: TokenStage): BudgetStatus {
    const spend = this.spendFor(taskId);
    const softLimit = STAGE_SOFT_LIMITS[stage];
    const taskTokens = spend.inputTokens + spend.outputTokens;
    if (taskTokens <= softLimit) return { taskTokens, softLimit, overSoftLimit: false };
    const cacheHitRatio = spend.inputTokens > 0 ? spend.cacheHitTokens / spend.inputTokens : 0;
    const lowHit = cacheHitRatio < 0.3;
    const recommendation = taskTokens > softLimit * 2
      ? "drop stale artifacts; switch Pro→Flash where safe; request only delta"
      : lowHit
        ? "compress context; cache hit is low — stabilize the prompt prefix"
        : "compress context";
    return { taskTokens, softLimit, overSoftLimit: true, recommendation };
  }

  /** Latest N recorded rows (audit / explainability). */
  recent(limit = 50): BudgetLedgerEntry[] {
    return [...this.entries].slice(-limit).reverse();
  }
}
