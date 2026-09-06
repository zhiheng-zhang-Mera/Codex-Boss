/**
 * DeepSeek V4 model policy (plan 9-7 §17/§18/§25). V4 defaults thinking ON at
 * high effort, so every call must explicitly state model + thinking + effort +
 * maxOutputTokens. Policy lives in code (pure) and is chosen per stage/role —
 * never "everything on Pro max".
 */

import { assembleStablePrompt, type DynamicPromptSections, type StaticPromptSections } from "./prompt-layout";

export type V4Model = "deepseek-v4-flash" | "deepseek-v4-pro";
export type V4Effort = "low" | "high" | "max";

export interface ModelPolicy {
  model: V4Model;
  thinking: "disabled" | "enabled";
  effort?: V4Effort;            // required when thinking is enabled
  maxOutputTokens: number;
  /** True when the caller must receive JSON only (plan §25). */
  jsonOutput?: boolean;
  /** Stable contract name for audit + cache keying (plan §21). */
  promptVersion?: string;
}

/** Policy selection key — mirrors stages where a model choice is explainable. */
export type PolicyStage = "classify" | "route" | "plan" | "code" | "review" | "research" | "synthesis" | "adjudicate";

/** §17.1 flash/non-thinking — classification, schema normalization, metadata. */
export const CLASSIFY_POLICY: ModelPolicy = { model: "deepseek-v4-flash", thinking: "disabled", maxOutputTokens: 1000, jsonOutput: true, promptVersion: "flash-classify-v1" };
/** §17.2 flash/low — routing, small code retrieval, simple review, diff summary. */
export const ROUTE_POLICY: ModelPolicy = { model: "deepseek-v4-flash", thinking: "enabled", effort: "low", maxOutputTokens: 2000, promptVersion: "flash-low-v1" };
/** §17.3 pro/high — multi-module planning, complex debugging, research, synthesis. */
export const PRO_HIGH_POLICY: ModelPolicy = { model: "deepseek-v4-pro", thinking: "enabled", effort: "high", maxOutputTokens: 8000, promptVersion: "pro-high-v1" };
/** §17.4 pro/max — high-risk decisions, hard-to-reproduce bugs, research adjudication. */
export const PRO_MAX_POLICY: ModelPolicy = { model: "deepseek-v4-pro", thinking: "enabled", effort: "max", maxOutputTokens: 8000, promptVersion: "pro-max-v1" };

export const DEFAULT_POLICIES: Record<PolicyStage, ModelPolicy> = {
  classify: CLASSIFY_POLICY,
  route: ROUTE_POLICY,
  plan: PRO_HIGH_POLICY,
  code: PRO_HIGH_POLICY,
  review: ROUTE_POLICY,
  research: PRO_HIGH_POLICY,
  synthesis: PRO_HIGH_POLICY,
  adjudicate: PRO_MAX_POLICY
};

/** Explains a policy selection (plan §36: model choice must be log-explainable). */
export function policyFor(stage: PolicyStage, override?: Partial<ModelPolicy>): { policy: ModelPolicy; reason: string } {
  const base = DEFAULT_POLICIES[stage];
  const policy = { ...base, ...override };
  if (policy.thinking === "enabled" && !policy.effort) throw new Error(`Thinking requires an explicit effort (stage ${stage})`);
  const reason = `${stage} → ${policy.model} thinking=${policy.thinking}${policy.effort ? ` effort=${policy.effort}` : ""} maxOutput=${policy.maxOutputTokens}`;
  return { policy, reason };
}

/** Builds a model-call record carrying the resolved policy (traceability). */
export interface V4ModelCall {
  policy: ModelPolicy;
  reason: string;
}

/** The one JSON output contract shape planners/coders must satisfy (plan §25). */
export function jsonOutputInstruction(policy: ModelPolicy): string {
  return policy.jsonOutput === false
    ? ""
    : "Output exactly one JSON object. Do not include markdown fences, prose outside the object, or trailing text.";
}

/**
 * Assembles a full cache-friendly V4 prompt envelope: stable static prefix
 * (policy + contracts + project manifest) first, dynamic task content after.
 * Static inputs unchanged → prefix unchanged → context cache hits (plan §20).
 */
export function buildV4Prompt(
  policy: ModelPolicy,
  statics: StaticPromptSections,
  dynamic: DynamicPromptSections,
  jsonOutput = policy.jsonOutput !== false
): string {
  const staticSections: StaticPromptSections = {
    systemPolicy: statics.systemPolicy,
    role: statics.role,
    toolContract: statics.toolContract,
    outputSchema: [statics.outputSchema, jsonOutput ? jsonOutputInstruction(policy) : undefined].filter(Boolean).join("\n"),
    projectManifest: statics.projectManifest
  };
  return assembleStablePrompt(staticSections, dynamic);
}
