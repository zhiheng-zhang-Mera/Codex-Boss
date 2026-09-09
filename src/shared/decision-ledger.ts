/**
 * Decision ledger (Update-Plan/Owner-Result.md Rev.2 §38). Pure + shareable.
 *
 * Under OWNER_RESULT every internal decision is recorded for later audit —
 * 问题 / 候选 / 选择 / 证据 / 结果 / 是否回滚. The owner audits afterwards but
 * never pre-approves routine technical decisions. This module is the immutable
 * record model + append reducer; the durable JSON store lives in
 * electron/commander/decision-ledger-store.ts.
 */

export type DecisionOutcome = "APPLIED" | "ROLLED_BACK" | "DEFERRED";

export type DecisionSource =
  | "question-interceptor"
  | "direction-stall"
  | "planner"
  | "reviewer"
  | "executor"
  | "recovery"
  | "provider-replacement"
  | "result-validator";

export interface DecisionLedgerEntry {
  id: string;
  taskId: string;
  createdAt: string;
  /** §38: 问题 */
  question: string;
  /** §38: 候选 */
  candidates: string[];
  /** §38: 选择 */
  chosen: string;
  /** §38: 证据 */
  evidence: string[];
  /** §38: 结果 */
  outcome: DecisionOutcome;
  /** §38: 是否回滚 — how/why it was rolled back, when applicable. */
  rollback?: string;
  /** Stable policy id that produced the decision (auditability). */
  policy?: string;
  source: DecisionSource;
  /** Direction-stall escalation occurrence (§19), when applicable. */
  stallOccurrence?: number;
}

export function validateLedgerEntry(entry: DecisionLedgerEntry): void {
  if (!entry || typeof entry.id !== "string" || !entry.id.trim()) throw new Error("Ledger entry requires an id");
  if (typeof entry.taskId !== "string" || !entry.taskId.trim()) throw new Error("Ledger entry requires a taskId");
  if (typeof entry.createdAt !== "string" || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error("Ledger entry requires a valid createdAt");
  if (typeof entry.question !== "string" || !entry.question.trim() || entry.question.length > 2000) throw new Error("Ledger question invalid");
  if (!Array.isArray(entry.candidates) || entry.candidates.length > 10 || entry.candidates.some((item) => typeof item !== "string" || item.length > 200)) throw new Error("Ledger candidates invalid");
  if (typeof entry.chosen !== "string" || !entry.chosen.trim() || entry.chosen.length > 2000) throw new Error("Ledger chosen invalid");
  if (!Array.isArray(entry.evidence) || entry.evidence.length > 50 || entry.evidence.some((item) => typeof item !== "string" || item.length > 2000)) throw new Error("Ledger evidence invalid");
  if (!["APPLIED", "ROLLED_BACK", "DEFERRED"].includes(entry.outcome)) throw new Error("Ledger outcome invalid");
  if (entry.rollback !== undefined && (typeof entry.rollback !== "string" || entry.rollback.length > 2000)) throw new Error("Ledger rollback invalid");
  if (entry.policy !== undefined && (typeof entry.policy !== "string" || entry.policy.length > 200)) throw new Error("Ledger policy invalid");
  if (!["question-interceptor", "direction-stall", "planner", "reviewer", "executor", "recovery", "provider-replacement", "result-validator"].includes(entry.source)) {
    throw new Error("Ledger source invalid");
  }
}

/** Immutable append: returns a new array with the entry appended (id-deduplicated). */
export function appendToLedger(entries: readonly DecisionLedgerEntry[], entry: DecisionLedgerEntry): DecisionLedgerEntry[] {
  validateLedgerEntry(entry);
  if (entries.some((item) => item.id === entry.id)) throw new Error(`Ledger entry already exists: ${entry.id}`);
  return [...entries, entry];
}

export interface LedgerStats {
  total: number;
  bySource: Record<DecisionSource, number>;
  byOutcome: Record<DecisionOutcome, number>;
  rollbacks: number;
}

export function summarizeLedger(entries: readonly DecisionLedgerEntry[]): LedgerStats {
  const bySource = {
    "question-interceptor": 0, "direction-stall": 0, planner: 0, reviewer: 0, executor: 0,
    recovery: 0, "provider-replacement": 0, "result-validator": 0
  } as Record<DecisionSource, number>;
  const byOutcome = { APPLIED: 0, ROLLED_BACK: 0, DEFERRED: 0 } as Record<DecisionOutcome, number>;
  for (const entry of entries) {
    bySource[entry.source] += 1;
    byOutcome[entry.outcome] += 1;
  }
  return { total: entries.length, bySource, byOutcome, rollbacks: byOutcome.ROLLED_BACK };
}
