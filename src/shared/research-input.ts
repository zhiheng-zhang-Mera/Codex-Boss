/**
 * Human-defined research input (milestone §1/§36) — the 0-touch entry point.
 * A human supplies a falsifiable research question + an authorized workspace +
 * a budget (and optionally a hypothesis/constraints/provider policy/reviewers).
 * `researchQuestion` is the immutable user anchor: the IR's
 * `researchQuestions[0]` is set from it at start and every later stage must
 * preserve it (the conductor anchors and never rewrites it).
 *
 * Naming: ids and folders are derived from the research question — never from
 * timestamps — so artifacts stay stable and readable.
 */

import type { ResearchIR } from "./research-ir";

export interface HumanResearchBudget {
  maxSteps: number;
  maxExperiments: number;
  maxProviderCalls: number;
  maxRuntimeMinutes?: number;
}

export interface HumanDefinedResearchInput {
  id?: string;
  researchQuestion: string;
  workspace: string;
  hypothesis?: string;
  constraints?: string[];
  providerPolicy?: "AUTO" | "FIXED";
  reviewers?: string[];
  budget: HumanResearchBudget;
}

export function validateHumanResearchInput(input: HumanDefinedResearchInput): void {
  if (!input || typeof input.researchQuestion !== "string" || !input.researchQuestion.trim() || input.researchQuestion.length > 20000) throw new Error("researchQuestion is required (1–20000 chars) and immutable");
  if (typeof input.workspace !== "string" || !input.workspace.trim()) throw new Error("An authorized workspace is required");
  if (input.hypothesis !== undefined && (typeof input.hypothesis !== "string" || !input.hypothesis.trim() || input.hypothesis.length > 20000)) throw new Error("hypothesis invalid");
  if (input.constraints !== undefined && (!Array.isArray(input.constraints) || input.constraints.length > 50 || input.constraints.some((item) => typeof item !== "string" || item.length > 2000))) throw new Error("constraints invalid (max 50 strings)");
  if (input.providerPolicy !== undefined && !["AUTO", "FIXED"].includes(input.providerPolicy)) throw new Error("providerPolicy must be AUTO or FIXED");
  if (input.reviewers !== undefined && (!Array.isArray(input.reviewers) || input.reviewers.length < 1 || input.reviewers.length > 5)) throw new Error("reviewers must be 1–5 runtime ids");
  const budget = input.budget;
  if (!budget || !Number.isInteger(budget.maxSteps) || budget.maxSteps < 1 || !Number.isInteger(budget.maxExperiments) || budget.maxExperiments < 1 || !Number.isInteger(budget.maxProviderCalls) || budget.maxProviderCalls < 1) throw new Error("budget requires positive integer maxSteps / maxExperiments / maxProviderCalls");
  if (budget.maxRuntimeMinutes !== undefined && (!Number.isInteger(budget.maxRuntimeMinutes) || budget.maxRuntimeMinutes < 1)) throw new Error("maxRuntimeMinutes invalid");
}

/** ASCII folder/id slug from the research question (no timestamps). */
export function slugOf(question: string, maxTokens = 6): string {
  const tokens = question.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return (tokens.slice(0, maxTokens).join("-") || "research").slice(0, 60);
}

/** Deterministic-style run id: <question-slug>-<random hex> (never time-based). */
export function researchIdFor(question: string, entropy = 6): string {
  let hex = "";
  for (let index = 0; index < entropy * 2; index += 1) hex += Math.floor(Math.random() * 16).toString(16);
  return `${slugOf(question)}-${hex}`;
}

/** Builds the ResearchIR a research run starts from (milestone §1 input). */
export function humanResearchToIR(input: HumanDefinedResearchInput, now = new Date().toISOString()): ResearchIR {
  validateHumanResearchInput(input);
  const question = input.researchQuestion.trim();
  return {
    schemaVersion: 1,
    id: input.id ?? researchIdFor(question),
    goal: question,
    scope: {
      workspace: input.workspace.trim(),
      allowedDomains: [],
      reviewers: input.reviewers ?? ["research:auto"],
      autonomy: "AUTOPILOT",
      providerPolicy: input.providerPolicy ?? "AUTO",
      budget: {
        maxSteps: input.budget.maxSteps,
        maxExperiments: input.budget.maxExperiments,
        maxProviderCalls: input.budget.maxProviderCalls,
        ...(input.budget.maxRuntimeMinutes !== undefined ? { maxRuntimeMinutes: input.budget.maxRuntimeMinutes } : {})
      }
    },
    state: "SCOPING",
    researchQuestions: [question], // the immutable human anchor
    hypotheses: input.hypothesis ? [input.hypothesis.trim()] : [],
    createdAt: now,
    updatedAt: now
  };
}
