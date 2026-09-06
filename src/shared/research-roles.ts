/**
 * Research role router + typed stage artifacts (plan 9-7 §27/§28). Pure and
 * shareable: every research stage routes to a research role and is expected to
 * produce a typed artifact (never prose-only output). Deterministic mapping —
 * a model may not be needed to answer "which role owns this stage".
 */

import type { ResearchState } from "./research-ir";

export type ResearchRole = "literature" | "planner" | "experiment" | "coder" | "analyst" | "reviewer" | "reporter";

/** Typed artifact kinds each stage may emit (evidence > prose). */
export type ResearchArtifactKind =
  | "repo-scan"
  | "literature-notes"
  | "research-question"
  | "protocol"
  | "experiment-design"
  | "experiment-run"
  | "statistic"
  | "analysis"
  | "claim"
  | "manuscript-section"
  | "citation-audit"
  | "repro-audit"
  | "build-artifact";

export const RESEARCH_ROLES: readonly ResearchRole[] = ["literature", "planner", "experiment", "coder", "analyst", "reviewer", "reporter"];

/** Stage → owning role (deterministic; mirrors the supervisor's autopilot flow). */
const STAGE_ROLE: Record<ResearchState, ResearchRole> = {
  SCOPING: "planner",
  PROJECT_INSPECTION: "coder",
  LITERATURE_REVIEW: "literature",
  QUESTION_FORMULATION: "planner",
  PROTOCOL_DRAFT: "planner",
  PROTOCOL_FROZEN: "reviewer",
  EXPERIMENT_GENERATION: "experiment",
  EXPERIMENT_EXECUTION: "coder",
  ANALYSIS: "analyst",
  REPLICATION: "analyst",
  CLAIM_REVIEW: "reviewer",
  MANUSCRIPT: "reporter",
  CITATION_AUDIT: "reviewer",
  REPRO_AUDIT: "reviewer",
  BUILD: "reporter",
  READY: "reporter",
  RECOVERING: "planner",
  WAITING_FOR_PROVIDER: "reviewer",
  WAITING_FOR_USER: "reviewer",
  FAILED: "reviewer"
};

/** Stage → expected typed artifact kind. */
const STAGE_ARTIFACT: Record<ResearchState, ResearchArtifactKind> = {
  SCOPING: "research-question",
  PROJECT_INSPECTION: "repo-scan",
  LITERATURE_REVIEW: "literature-notes",
  QUESTION_FORMULATION: "research-question",
  PROTOCOL_DRAFT: "protocol",
  PROTOCOL_FROZEN: "protocol",
  EXPERIMENT_GENERATION: "experiment-design",
  EXPERIMENT_EXECUTION: "experiment-run",
  ANALYSIS: "statistic",
  REPLICATION: "analysis",
  CLAIM_REVIEW: "claim",
  MANUSCRIPT: "manuscript-section",
  CITATION_AUDIT: "citation-audit",
  REPRO_AUDIT: "repro-audit",
  BUILD: "build-artifact",
  READY: "build-artifact",
  RECOVERING: "research-question",
  WAITING_FOR_PROVIDER: "claim",
  WAITING_FOR_USER: "claim",
  FAILED: "claim"
};

export function roleForStage(stage: ResearchState): ResearchRole {
  return STAGE_ROLE[stage];
}

export function artifactKindForStage(stage: ResearchState): ResearchArtifactKind {
  return STAGE_ARTIFACT[stage];
}

/** A typed stage artifact: kind + structured payload + evidence refs. */
export interface ResearchStageArtifact {
  kind: ResearchArtifactKind;
  stage: ResearchState;
  role: ResearchRole;
  /** Stable reference used by evidence binding (claim→artifact). */
  artifactId: string;
  summary: string;
  evidenceRefs: string[];
  createdAt: string;
}

export interface TypedStageArtifactBuilder {
  stage: ResearchState;
  summary: string;
  evidenceRefs?: string[];
}

/** Builds a typed artifact skeleton for a stage (caller fills typed payloads). */
export function stageArtifact(input: TypedStageArtifactBuilder, now = new Date().toISOString()): ResearchStageArtifact {
  const kind = artifactKindForStage(input.stage);
  const role = roleForStage(input.stage);
  return {
    kind,
    stage: input.stage,
    role,
    artifactId: `${input.stage.toLowerCase()}:${now.replace(/[:.]/g, "-")}`,
    summary: input.summary.slice(0, 500),
    evidenceRefs: input.evidenceRefs ?? [],
    createdAt: now
  };
}
