/**
 * Research IR + state machine (plan 9-6 Phases 5/7). Pure and shareable.
 *
 * The research supervisor drives a research run through the plan's state list
 * (SCOPING → … → READY) with control states RECOVERING / WAITING_FOR_PROVIDER /
 * WAITING_FOR_USER / FAILED. This module defines the states, the deterministic
 * transition graph, and the ResearchIR scaffold (goal + workspace + reviewer
 * policy) so Phase 7's protocol freeze has a schema to live on.
 */

export type ResearchState =
  | "SCOPING"
  | "PROJECT_INSPECTION"
  | "LITERATURE_REVIEW"
  | "QUESTION_FORMULATION"
  | "PROTOCOL_DRAFT"
  | "PROTOCOL_FROZEN"
  | "EXPERIMENT_GENERATION"
  | "EXPERIMENT_EXECUTION"
  | "ANALYSIS"
  | "REPLICATION"
  | "CLAIM_REVIEW"
  | "MANUSCRIPT"
  | "CITATION_AUDIT"
  | "REPRO_AUDIT"
  | "BUILD"
  | "READY"
  // control states
  | "RECOVERING"
  | "WAITING_FOR_PROVIDER"
  | "WAITING_FOR_USER"
  | "FAILED";

export const RESEARCH_MAIN_STATES: readonly ResearchState[] = [
  "SCOPING", "PROJECT_INSPECTION", "LITERATURE_REVIEW", "QUESTION_FORMULATION",
  "PROTOCOL_DRAFT", "PROTOCOL_FROZEN", "EXPERIMENT_GENERATION", "EXPERIMENT_EXECUTION",
  "ANALYSIS", "REPLICATION", "CLAIM_REVIEW", "MANUSCRIPT", "CITATION_AUDIT", "REPRO_AUDIT", "BUILD", "READY"
];

/** Main-flow successors in the plan order. */
export const RESEARCH_NEXT: Readonly<Record<ResearchState, ResearchState>> = {
  SCOPING: "PROJECT_INSPECTION",
  PROJECT_INSPECTION: "LITERATURE_REVIEW",
  LITERATURE_REVIEW: "QUESTION_FORMULATION",
  QUESTION_FORMULATION: "PROTOCOL_DRAFT",
  PROTOCOL_DRAFT: "PROTOCOL_FROZEN",
  PROTOCOL_FROZEN: "EXPERIMENT_GENERATION",
  EXPERIMENT_GENERATION: "EXPERIMENT_EXECUTION",
  EXPERIMENT_EXECUTION: "ANALYSIS",
  ANALYSIS: "REPLICATION",
  REPLICATION: "CLAIM_REVIEW",
  CLAIM_REVIEW: "MANUSCRIPT",
  MANUSCRIPT: "CITATION_AUDIT",
  CITATION_AUDIT: "REPRO_AUDIT",
  REPRO_AUDIT: "BUILD",
  BUILD: "READY",
  READY: "READY",
  RECOVERING: "SCOPING",
  WAITING_FOR_PROVIDER: "SCOPING",
  WAITING_FOR_USER: "SCOPING",
  FAILED: "FAILED"
};

export function canAdvance(state: ResearchState): boolean {
  return state !== "FAILED" && state !== "READY" && state !== "WAITING_FOR_PROVIDER" && state !== "WAITING_FOR_USER";
}

export type ResearchStageLabel = string;

export interface ResearchScope {
  workspace: string;
  allowedDomains: string[];
  reviewers: string[];      // provider/runtime ids used as web-AI reviewers
  autonomy: "AUTOPILOT" | "GUIDED";
  /** Milestone §1: AUTO = Boss may switch providers; FIXED = stay on the given reviewer set. */
  providerPolicy?: "AUTO" | "FIXED";
  budget: {
    maxExperiments: number;
    maxSteps: number;
    /** Milestone §1 human budget: bounded provider calls and runtime minutes. */
    maxProviderCalls?: number;
    maxRuntimeMinutes?: number;
  };
}

export interface ResearchIR {
  schemaVersion: 1;
  id: string;
  goal: string;
  scope: ResearchScope;
  state: ResearchState;
  /** When paused at a reviewer/decision gate, the stage to resume into. */
  pendingStage?: ResearchState;
  protocolHash?: string;
  researchQuestions: string[];
  hypotheses: string[];
  createdAt: string;
  updatedAt: string;
}

export function validateResearchIR(ir: ResearchIR): void {
  if (!ir || ir.schemaVersion !== 1 || typeof ir.id !== "string" || !ir.id.trim()) throw new Error("Invalid research IR id");
  if (typeof ir.goal !== "string" || !ir.goal.trim() || ir.goal.length > 20000) throw new Error("Research goal must be 1–20000 characters");
  if (!ir.scope || typeof ir.scope.workspace !== "string" || !ir.scope.workspace.trim()) throw new Error("Research requires a workspace");
  if (!Array.isArray(ir.scope.allowedDomains) || ir.scope.allowedDomains.length > 50) throw new Error("Invalid allowedDomains");
  if (!Array.isArray(ir.scope.reviewers) || ir.scope.reviewers.length < 1 || ir.scope.reviewers.length > 5) throw new Error("Research requires 1–5 reviewers");
  if (!["AUTOPILOT", "GUIDED"].includes(ir.scope.autonomy)) throw new Error("Invalid autonomy mode");
  if (!Number.isInteger(ir.scope.budget.maxExperiments) || ir.scope.budget.maxExperiments < 1 || !Number.isInteger(ir.scope.budget.maxSteps) || ir.scope.budget.maxSteps < 1) throw new Error("Invalid research budget");
  if (!RESEARCH_MAIN_STATES.includes(ir.state) && !["RECOVERING", "WAITING_FOR_PROVIDER", "WAITING_FOR_USER", "FAILED"].includes(ir.state)) throw new Error("Invalid research state");
  if (ir.pendingStage !== undefined && !RESEARCH_MAIN_STATES.includes(ir.pendingStage)) throw new Error("Invalid pending research stage");
}

/** Deterministic successor: control states return to SCOPING on resume unless FAILED/READY. */
export function nextResearchState(current: ResearchState, allowControl = false): ResearchState | null {
  if (current === "FAILED" || current === "READY") return null;
  if (!allowControl && ["RECOVERING", "WAITING_FOR_PROVIDER", "WAITING_FOR_USER"].includes(current)) return null;
  return RESEARCH_NEXT[current];
}
