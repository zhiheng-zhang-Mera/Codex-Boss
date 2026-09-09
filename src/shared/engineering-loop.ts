/**
 * Autonomous Engineering loop core (plan §26–§41). Pure and shareable.
 *
 * Defines the durable engineering_goal contract (§27), the iteration state
 * machine (§29), triage severity (§31), the product boundary guard (§28), the
 * regression ladder (§37) and the convergence/stagnation gates (§39/§40/§41).
 * Boss may only ever improve an already-decided product toward production-grade
 * engineering readiness — it never decides product direction, deletes user
 * features, or rewrites business logic without evidence.
 */

import type { WorkAgentCount } from "./work-mode";

/* ------------------------------------------------------------------ goal */

export type ProductChangeScope = "ALLOWED" | "PRODUCT_DECISION_REQUIRED";

export interface EngineeringGoalContract {
  schemaVersion: 1;
  id: string;
  /** Frozen user objective — the immutable anchor (§27). */
  objective: string;
  workspace: string;
  /** Product behaviors that must never change without an explicit product decision. */
  protectedProductBehavior: string[];
  allowedChangeScope: string[];
  forbiddenChangeScope: string[];
  verificationPolicy: "standard" | "strict";
  agentCount: WorkAgentCount;
  convergencePolicy: {
    /** Clean audit rounds with no new significant issue required (default 3). */
    cleanRoundsRequired: number;
    maxIterations?: number;
  };
  createdAt: string;
}

export function validateEngineeringGoalContract(value: unknown): value is EngineeringGoalContract {
  if (!value || typeof value !== "object") return false;
  const goal = value as Partial<EngineeringGoalContract>;
  if (goal.schemaVersion !== 1) return false;
  if (typeof goal.id !== "string" || !goal.id.trim()) return false;
  if (typeof goal.objective !== "string" || !goal.objective.trim()) return false;
  if (typeof goal.workspace !== "string" || !goal.workspace.trim()) return false;
  if (!Array.isArray(goal.protectedProductBehavior) || !Array.isArray(goal.allowedChangeScope) || !Array.isArray(goal.forbiddenChangeScope)) return false;
  if (!["standard", "strict"].includes(goal.verificationPolicy ?? "")) return false;
  if (![1, 3, 5].includes(goal.agentCount as number)) return false;
  if (!goal.convergencePolicy || typeof goal.convergencePolicy.cleanRoundsRequired !== "number") return false;
  return true;
}

/* ------------------------------------------------------------- boundary */

/**
 * Product boundary guard (§28): classify a proposed change against the frozen
 * contract. Allowed engineering verbs pass; inventing features, removing user
 * features, changing direction/UX meaning or rewriting business logic without
 * evidence are recorded as PRODUCT_DECISION_REQUIRED and skipped, not executed.
 */
export const ALLOWED_ENGINEERING_VERBS = [
  "fix", "refactor", "reliability", "performance", "security", "maintainability",
  "observability", "test", "dead code", "duplication", "state handling", "recovery"
];

/** Observable engineering symptoms — fixing these is always in-contract. */
const ENGINEERING_SYMPTOM_TOKENS = [
  "crash", "error", "bug", "exception", "fail", "timeout", "race", "corrupt",
  "leak", "deadlock", "hang", "freeze", "duplicat", "stale", "regression",
  "slow", "exception", "broken", "incorrect", "unavailable", "loses", "lost"
];

/** Explicit product-invention/removal markers that need a product decision. */
const PRODUCT_DECISION_TOKENS = [
  "add a", "new feature", "invent", "remove the user", "remove user feature",
  "product direction", "market", "roadmap", "ux redesign", "business logic rewrite",
  "social-feed", "pricing"
];

export function classifyEngineeringChange(goal: EngineeringGoalContract, changeDescription: string): ProductChangeScope {
  const lower = changeDescription.toLowerCase();
  if (goal.forbiddenChangeScope.some((forbidden) => lower.includes(forbidden.toLowerCase()))) return "PRODUCT_DECISION_REQUIRED";
  if (PRODUCT_DECISION_TOKENS.some((token) => lower.includes(token))) return "PRODUCT_DECISION_REQUIRED";
  if (ENGINEERING_SYMPTOM_TOKENS.some((token) => lower.includes(token))) return "ALLOWED";
  if (goal.allowedChangeScope.length && goal.allowedChangeScope.some((allowed) => lower.includes(allowed.toLowerCase()))) return "ALLOWED";
  if (ALLOWED_ENGINEERING_VERBS.some((verb) => lower.includes(verb))) return "ALLOWED";
  // Unknown intent is a product decision, never an implicit rewrite.
  return "PRODUCT_DECISION_REQUIRED";
}

/* ------------------------------------------------------------ triage */

export type EngineeringSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OPTIONAL";

export const ENGINEERING_SEVERITIES: readonly EngineeringSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "OPTIONAL"];

export interface EngineeringFinding {
  id: string;
  area: string;
  description: string;
  severity: EngineeringSeverity;
  evidence?: string;
}

/** §31 priority: Critical → High → significant Medium → structural debt → Low → cosmetic. */
export function priorityOrder(severity: EngineeringSeverity): number {
  return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, OPTIONAL: 4 }[severity];
}

/** Significant mediums are those touching state, concurrency, or data integrity. */
export function isSignificantMedium(finding: EngineeringFinding): boolean {
  return finding.severity === "MEDIUM" && /\b(state|concurrency|data|recovery|security|correctness|persistence)\b/i.test(finding.description);
}

/* ---------------------------------------------------- iteration machine */

export type EngineeringIterationStage =
  | "AUDIT" | "TRIAGE" | "PLAN" | "IMPLEMENT" | "BUILD" | "TEST" | "REVIEW"
  | "VERIFY" | "REGRESSION" | "RE_AUDIT" | "CONVERGENCE_CHECK";

export const ENGINEERING_STAGES: readonly EngineeringIterationStage[] = [
  "AUDIT", "TRIAGE", "PLAN", "IMPLEMENT", "BUILD", "TEST", "REVIEW",
  "VERIFY", "REGRESSION", "RE_AUDIT", "CONVERGENCE_CHECK"
];

export interface EngineeringIterationRecord {
  schemaVersion: 1;
  goalId: string;
  iteration: number;
  stage: EngineeringIterationStage;
  findings: EngineeringFinding[];
  changedFiles: string[];
  buildPassed?: boolean;
  testsPassed?: boolean;
  regressionPassed?: boolean;
  reviewFindings: string[];
  remainingRisk: string;
  status: "RUNNING" | "CONVERGED" | "STAGNANT" | "ABORTED" | "OPTIONAL_IMPROVEMENTS";
  startedAt: string;
  updatedAt: string;
}

/** §29 valid next stage in the strict dependency order. */
export function nextEngineeringStage(stage: EngineeringIterationStage): EngineeringIterationStage | null {
  const index = ENGINEERING_STAGES.indexOf(stage);
  return index >= 0 && index < ENGINEERING_STAGES.length - 1 ? ENGINEERING_STAGES[index + 1] : null;
}

export interface EngineeringRunResult {
  state: "NEXT_ITERATION" | "ENGINEERING_CONVERGED" | "OPTIONAL_IMPROVEMENTS" | "STAGNANT" | "ABORTED";
  cleanRounds: number;
}

/**
 * §40 convergence gate: converged when every significant issue is resolved or
 * explicitly accepted (no Critical/High, no significant Medium), build/core
 * tests/integration/regression pass, and N clean audit rounds found nothing
 * new. §41: when only cosmetic items remain, stop and report OPTIONAL.
 */
export function decideConvergence(input: {
  findings: EngineeringFinding[];
  buildPassed: boolean;
  testsPassed: boolean;
  regressionPassed: boolean;
  cleanRounds: number;
  cleanRoundsRequired: number;
  acceptedRisks?: string[];
}): EngineeringRunResult {
  const blocked = input.findings.some((finding) => {
    if (finding.severity === "CRITICAL" || finding.severity === "HIGH") return true;
    return isSignificantMedium(finding) && !(input.acceptedRisks ?? []).includes(finding.id);
  });
  if (blocked || !input.buildPassed || !input.testsPassed || !input.regressionPassed) return { state: "NEXT_ITERATION", cleanRounds: 0 };
  if (input.cleanRounds >= input.cleanRoundsRequired) return { state: "ENGINEERING_CONVERGED", cleanRounds: input.cleanRounds };
  // §41: when only cosmetic/low findings remain (and at least one round ran)
  // stop polishing instead of opening another cosmetic round; with zero
  // findings the loop still audits again until it holds the required number of
  // consecutive clean rounds.
  const onlyCosmetic = input.cleanRounds > 0 && input.findings.length > 0 && input.findings.every((finding) => finding.severity === "LOW" || finding.severity === "OPTIONAL");
  return onlyCosmetic ? { state: "OPTIONAL_IMPROVEMENTS", cleanRounds: input.cleanRounds } : { state: "NEXT_ITERATION", cleanRounds: input.cleanRounds };
}

/* ------------------------------------------------------ stagnation (§39) */

export interface StagnationSignals {
  /** Same issue re-proposed on consecutive iterations. */
  repeatedIssueCount: number;
  /** Identical test failing across iterations. */
  sameTestFailCount: number;
  /** No measurable improvement over recent rounds. */
  noImprovementRounds: number;
}

export const STAGNATION_LIMITS = { repeatedIssueCount: 3, sameTestFailCount: 3, noImprovementRounds: 3 };

/** §39: identical symptoms across consecutive rounds → stop current strategy and replan. */
export function isStagnating(signals: StagnationSignals): boolean {
  return signals.repeatedIssueCount >= STAGNATION_LIMITS.repeatedIssueCount
    || signals.sameTestFailCount >= STAGNATION_LIMITS.sameTestFailCount
    || signals.noImprovementRounds >= STAGNATION_LIMITS.noImprovementRounds;
}

/** Returns whether an engineering iteration should be recorded as CONVERGED given the gate. */
export function iterationConverged(record: EngineeringIterationRecord, requiredCleanRounds: number, acceptedRisks: string[] = []): boolean {
  const result = decideConvergence({
    findings: record.findings,
    buildPassed: record.buildPassed === true,
    testsPassed: record.testsPassed === true,
    regressionPassed: record.regressionPassed === true,
    cleanRounds: requiredCleanRounds,
    cleanRoundsRequired: requiredCleanRounds,
    acceptedRisks
  });
  return result.state === "ENGINEERING_CONVERGED" || result.state === "OPTIONAL_IMPROVEMENTS";
}

/* ------------------------------------------ goal status read-model (UI) */

/**
 * Deterministic UI-facing snapshot of one engineering goal (plan §26–§41 start
 * surface). Pure aggregation of the durable store state — the renderer/start
 * surface renders this without reading raw iteration rows.
 */
export interface EngineeringGoalSnapshot {
  goalId?: string;
  objective?: string;
  workspace?: string;
  agentCount: number;
  iterations: number;
  cleanRounds: number;
  cleanRoundsRequired: number;
  acceptedRiskCount: number;
  /** Stage of the most recent iteration. */
  lastStage?: string;
  /** Terminal/nominal status of the most recent iteration. */
  lastStatus?: string;
  /** Last recorded run state (from remainingRisk when set, else lastStatus). */
  lastRisk: string;
  /** Every file touched across iterations (stable order, deduped). */
  changedFiles: string[];
  /** Findings still open from the newest iteration that are not accepted risks. */
  openFindings: EngineeringFinding[];
  /** True when a goal has converged or stopped on optional improvements. */
  settled: boolean;
}

export function summarizeEngineeringLoop(input: {
  goal?: EngineeringGoalContract;
  iterations: readonly EngineeringIterationRecord[];
  acceptedRisks?: readonly string[];
  cleanRounds?: number;
}): EngineeringGoalSnapshot {
  const iterations = [...input.iterations].sort((a, b) => a.iteration - b.iteration);
  const last = iterations.length ? iterations[iterations.length - 1] : undefined;
  const changedFiles = [...new Set(iterations.flatMap((item) => item.changedFiles))];
  const accepted = new Set(input.acceptedRisks ?? []);
  const openFindings = last ? last.findings.filter((finding) => !accepted.has(finding.id)) : [];
  const settled = last?.status === "CONVERGED" || last?.status === "OPTIONAL_IMPROVEMENTS";
  return {
    ...(input.goal ? { goalId: input.goal.id, objective: input.goal.objective, workspace: input.goal.workspace } : {}),
    agentCount: input.goal?.agentCount ?? 1,
    iterations: iterations.length,
    cleanRounds: input.cleanRounds ?? 0,
    cleanRoundsRequired: input.goal?.convergencePolicy.cleanRoundsRequired ?? 1,
    acceptedRiskCount: accepted.size,
    ...(last ? { lastStage: last.stage, lastStatus: last.status } : {}),
    lastRisk: last?.remainingRisk ?? "",
    changedFiles,
    openFindings,
    settled
  };
}
