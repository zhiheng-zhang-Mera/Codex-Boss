/**
 * Research capability registry (plan §20). Pure and shareable.
 *
 * A research run must not mechanically invoke every manuscript/analysis module
 * for every study. Each capability (module) is declared with the questions it
 * answers and when it is needed; a deterministic planner marks each capability
 * AVAILABLE / NEEDED / NOT_NEEDED / FAILED for a given run so only required
 * modules are called (§20), and the audit records which modules actually ran.
 */

export type ResearchCapabilityStatus = "AVAILABLE" | "NEEDED" | "NOT_NEEDED" | "FAILED";

export const RESEARCH_CAPABILITY_STATUSES: readonly ResearchCapabilityStatus[] = ["AVAILABLE", "NEEDED", "NOT_NEEDED", "FAILED"];

export type ResearchCapabilityId =
  | "literature-scout"
  | "citation-verifier"
  | "methodology-critic"
  | "experiment-designer"
  | "statistics-engine"
  | "replication-runner"
  | "figure-planner"
  | "chart-renderer"
  | "table-builder"
  | "architecture-diagram-builder"
  | "evidence-adjudicator"
  | "section-planner"
  | "section-writer"
  | "skeptical-reviewer"
  | "reproducibility-auditor"
  | "latex-compiler";

export const RESEARCH_CAPABILITY_IDS: readonly ResearchCapabilityId[] = [
  "literature-scout", "citation-verifier", "methodology-critic", "experiment-designer",
  "statistics-engine", "replication-runner", "figure-planner", "chart-renderer",
  "table-builder", "architecture-diagram-builder", "evidence-adjudicator",
  "section-planner", "section-writer", "skeptical-reviewer", "reproducibility-auditor", "latex-compiler"
];

export interface ResearchCapabilityDefinition {
  id: ResearchCapabilityId;
  label: string;
  /** Study property that triggers this module; empty = always applicable when available. */
  neededWhen: string;
}

export const RESEARCH_CAPABILITIES: readonly ResearchCapabilityDefinition[] = [
  { id: "literature-scout", label: "检索并获取相关文献", neededWhen: "contextual literature is part of the study" },
  { id: "citation-verifier", label: "核对引用来源与原文支持", neededWhen: "citations are bound to the paper" },
  { id: "methodology-critic", label: "审阅方法论设计缺陷", neededWhen: "a formal protocol/methodology is drafted" },
  { id: "experiment-designer", label: "设计真实实验方案", neededWhen: "study requires controlled experiments" },
  { id: "statistics-engine", label: "对记录数据做确定性统计", neededWhen: "quantitative experiment runs exist" },
  { id: "replication-runner", label: "以独立种子复跑验证", neededWhen: "quantitative finding must be reproducible" },
  { id: "figure-planner", label: "规划结果图", neededWhen: "quantitative results need visual evidence" },
  { id: "chart-renderer", label: "将记录指标渲染为图", neededWhen: "quantitative results need a figure" },
  { id: "table-builder", label: "构建结果表", neededWhen: "multi-metric or grouped results need a table" },
  { id: "architecture-diagram-builder", label: "构建架构/流程示意图", neededWhen: "study presents a system/architecture to explain" },
  { id: "evidence-adjudicator", label: "裁决证据>投票的 claim", neededWhen: "multiple reviewers/claims need adjudication" },
  { id: "section-planner", label: "规划论文章节结构", neededWhen: "a manuscript is being assembled" },
  { id: "section-writer", label: "撰写论文各章节", neededWhen: "manuscript sections must be drafted" },
  { id: "skeptical-reviewer", label: "对抗性审阅论文", neededWhen: "manuscript draft is complete" },
  { id: "reproducibility-auditor", label: "审计复现性", neededWhen: "recorded runs should reproduce the finding" },
  { id: "latex-compiler", label: "编译 TEX→PDF", neededWhen: "a compiled PDF deliverable is required" }
];

/** Study shape the planner matches against (kept coarse; host decides, not the model). */
export interface ResearchStudyProfile {
  hasQuantitativeExperiments: boolean;
  bindsCitations: boolean;
  hasFormalProtocol: boolean;
  hasArchitecture?: boolean;
  hasMultipleReviewers?: boolean;
}

/**
 * Deterministic NEEDED/NOT_NEEDED plan over the capability registry. The host
 * decides what a study needs; a capability is NEEDED when its trigger matches
 * the profile and NOT_NEEDED otherwise. The conductor still calls only the
 * capabilities its stage machine implements — this registry is the audit +
 * guard-rail surface (plan §20: only-needed invocation, never a shotgun).
 */
export function planResearchCapabilities(profile: ResearchStudyProfile): Record<ResearchCapabilityId, ResearchCapabilityStatus> {
  const plan = Object.fromEntries(RESEARCH_CAPABILITY_IDS.map((id) => [id, "AVAILABLE" as ResearchCapabilityStatus])) as Record<ResearchCapabilityId, ResearchCapabilityStatus>;
  const need = (id: ResearchCapabilityId, condition: boolean) => { plan[id] = condition ? "NEEDED" : "NOT_NEEDED"; };
  need("literature-scout", true); // contextual background is always scouted
  need("citation-verifier", profile.bindsCitations);
  need("methodology-critic", profile.hasFormalProtocol || profile.hasQuantitativeExperiments);
  need("experiment-designer", profile.hasQuantitativeExperiments);
  need("statistics-engine", profile.hasQuantitativeExperiments);
  need("replication-runner", profile.hasQuantitativeExperiments);
  need("figure-planner", profile.hasQuantitativeExperiments);
  need("chart-renderer", profile.hasQuantitativeExperiments);
  need("table-builder", profile.hasQuantitativeExperiments);
  need("architecture-diagram-builder", Boolean(profile.hasArchitecture));
  need("evidence-adjudicator", profile.hasMultipleReviewers === true || profile.hasQuantitativeExperiments);
  need("section-planner", true); // any manuscript needs an outline
  need("section-writer", true);
  need("skeptical-reviewer", true);
  need("reproducibility-auditor", profile.hasQuantitativeExperiments);
  need("latex-compiler", true);
  return plan;
}

export function isResearchCapabilityStatus(value: unknown): value is ResearchCapabilityStatus {
  return typeof value === "string" && (RESEARCH_CAPABILITY_STATUSES as readonly string[]).includes(value);
}

/** Registry row with the final execution outcome for a run. */
export interface ResearchCapabilityRunRow {
  capability: ResearchCapabilityId;
  planned: ResearchCapabilityStatus;
  outcome?: ResearchCapabilityStatus;
}
