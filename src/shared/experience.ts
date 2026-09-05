/** Experience hierarchy + promotion (plan §14). Pure and shareable. */

export type ExperienceLevel = "task" | "workspace" | "domain" | "global";

export const EXPERIENCE_LEVEL_ORDER: readonly ExperienceLevel[] = ["task", "workspace", "domain", "global"];

/** Worker contribution metric (plan §16): how this observation's worker performed. */
export interface ExperienceContribution {
  outcome: "success" | "failure";
  /** 1.0 default; runtime cost/token normalization may scale it later. */
  weight?: number;
}

export interface ExperienceObservation {
  level: ExperienceLevel;
  at: string;
  source: string;   // task or workspace id
  contribution?: ExperienceContribution;
}

export interface ExperienceEntry {
  id: string;
  /** Canonical claim, e.g. a routing/verification insight. */
  claim: string;
  domain: string;
  level: ExperienceLevel;
  observations: ExperienceObservation[];
  promotedFrom?: ExperienceLevel;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionDecision {
  nextLevel: ExperienceLevel | null;
  reasons: string[];
}

/**
 * Promotion rules (plan §14):
 *  - a claim promoted from task→workspace needs repeated evidence (>= 2) in one workspace;
 *  - workspace→domain needs observations from >= 2 distinct workspaces;
 *  - domain→global needs >= 3 distinct workspaces and a broad trust baseline.
 * Single-project accidental observations never reach domain/global.
 */
export function decidePromotion(entry: ExperienceEntry, thresholds: { workspaceObservations: number; domainWorkspaces: number; globalWorkspaces: number } = { workspaceObservations: 2, domainWorkspaces: 2, globalWorkspaces: 3 }): PromotionDecision {
  const workspaces = new Set(entry.observations.map((observation) => observation.source));
  const ownEvidence = entry.observations.length;
  switch (entry.level) {
    case "task": {
      if (ownEvidence >= thresholds.workspaceObservations) return { nextLevel: "workspace", reasons: [`observed ${ownEvidence}x in workspace evidence`] };
      return { nextLevel: null, reasons: [] };
    }
    case "workspace": {
      if (workspaces.size >= thresholds.domainWorkspaces) return { nextLevel: "domain", reasons: [`seen in ${workspaces.size} workspaces`] };
      return { nextLevel: null, reasons: [] };
    }
    case "domain": {
      if (workspaces.size >= thresholds.globalWorkspaces) return { nextLevel: "global", reasons: [`seen in ${workspaces.size} workspaces`] };
      return { nextLevel: null, reasons: [] };
    }
    default:
      return { nextLevel: null, reasons: [] };
  }
}

/** Contribution stats over an entry's observations (plan §16 worker contribution metrics). */
export function contributionStats(entry: Pick<ExperienceEntry, "observations">): { success: number; failure: number; rate: number | null } {
  const success = entry.observations.filter((observation) => observation.contribution?.outcome === "success").length;
  const failure = entry.observations.filter((observation) => observation.contribution?.outcome === "failure").length;
  return { success, failure, rate: success + failure > 0 ? success / (success + failure) : null };
}
