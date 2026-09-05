/**
 * Level-A autonomous research planning (plan 9-6 Phase 12). Pure and shareable.
 *
 * Given only a project goal (no research question / experiment / benchmark),
 * the planner drafts a publishable pipeline: repo signals → candidate
 * questions (web-AI proposers) → novelty/feasibility review → falsifiable RQ
 * selection → hypothesis → experiment spec with replication + benchmark plan.
 * Deterministic gates never adopt a question by vote alone; execution stays
 * live (real experiments), but the *plan* is produced automatically.
 */

import type { CandidateQuestion } from "./research-levelb";
import { isFalsifiable } from "./research-levelb";

export interface ProjectSignals {
  /** Repo facts observed by project inspection (bounded). */
  files: number;
  testFiles: number;
  languages: string[];
  topModules: string[];
}

export interface NoveltyReview {
  claimId: string;
  /** Heuristic novelty: how distinct the question is from what the repo already tests/documents. */
  noveltyScore: number;
  feasibilityScore: number;
  reasons: string[];
}

export interface ExperimentSpec {
  id: string;
  /** Deterministic primary metric the experiment computes. */
  primaryMetric: "mean" | "proportion" | "effect-size" | "rate";
  /** Number of independent replication runs required for a primary finding. */
  replicationRuns: number;
  purpose: "EXPERIMENT" | "DATA_PROCESSING";
  /** Placeholder command filled by the executor; structured spec lives in research-command.ts. */
  command: string[];
  seed: number;
  createdAt: string;
}

export interface LevelAPlan {
  selectedQuestion: CandidateQuestion;
  hypothesis: string;
  novelty: NoveltyReview;
  experiment: ExperimentSpec;
}

export function noveltyReview(candidate: CandidateQuestion, signals: ProjectSignals, overrides: { noveltyBias?: number; feasibilityBias?: number } = {}): NoveltyReview {
  const reasons: string[] = [];
  let novelty = 0;
  // Distinguish the candidate from what the repo already contains: a question
  // whose keywords appear across many tested modules is less novel.
  const overlap = signals.topModules.filter((module) => candidate.question.toLocaleLowerCase().includes(module.toLocaleLowerCase())).length;
  novelty += Math.max(0, 3 - overlap);
  if (signals.testFiles > 0 && overlap > 0) { novelty -= 1; reasons.push("question overlaps existing tested modules"); }
  if (signals.languages.length > 1) { novelty += 1; reasons.push("cross-language surface increases feasibility breadth"); }
  novelty += (candidate.noveltyScore ?? 0) * 0.5 + (overrides.noveltyBias ?? 0);

  let feasibility = (candidate.feasibilityScore ?? 0) + (overrides.feasibilityBias ?? 0);
  if (isFalsifiable(candidate)) { feasibility += 2; reasons.push("measurable + falsifiable"); }
  if (signals.testFiles === 0) { feasibility -= 1; reasons.push("no existing test harness in repo"); }
  feasibility = Math.max(0, Math.min(5, feasibility));
  novelty = Math.max(0, Math.min(5, novelty));
  return { claimId: candidate.id, noveltyScore: novelty, feasibilityScore: feasibility, reasons };
}

/** Level-A gate: a question may proceed only when novelty + feasibility both clear 2.0. */
export function levelAGate(review: NoveltyReview): { ok: boolean; reason?: string } {
  if (review.noveltyScore < 2) return { ok: false, reason: `novelty too low (${review.noveltyScore.toFixed(1)})` };
  if (review.feasibilityScore < 2) return { ok: false, reason: `feasibility too low (${review.feasibilityScore.toFixed(1)})` };
  return { ok: true };
}

export function buildExperimentSpec(input: { id: string; primaryMetric: ExperimentSpec["primaryMetric"]; replicationRuns?: number; seed?: number; createdAt?: string }): ExperimentSpec {
  return { id: input.id, primaryMetric: input.primaryMetric, replicationRuns: Math.max(2, Math.min(10, input.replicationRuns ?? 3)), purpose: "EXPERIMENT", command: [], seed: input.seed ?? 42, createdAt: input.createdAt ?? new Date().toISOString() };
}

export function validateLevelAPlan(plan: LevelAPlan): void {
  if (!plan || typeof plan.hypothesis !== "string" || !plan.hypothesis.trim() || plan.hypothesis.length > 2000) throw new Error("Level-A plan requires a hypothesis");
  if (!plan.experiment || typeof plan.experiment.id !== "string" || !plan.experiment.id) throw new Error("Level-A plan requires an experiment");
  if (plan.experiment.replicationRuns < 2) throw new Error("Primary finding requires >= 2 replication runs");
  if (!["mean", "proportion", "effect-size", "rate"].includes(plan.experiment.primaryMetric)) throw new Error("Invalid primary metric");
}
