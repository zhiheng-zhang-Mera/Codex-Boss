/**
 * DSH development presets (plan 9-7 §35 Phase I / §16). Boss development in
 * the DeepSeek Harness should not run every task on the full agent. These
 * presets map work types to DSH runtime modes (Standard / PTC / Minimal /
 * Creator) and their tool profiles, with a deterministic default so repo
 * feature work → Standard, bounded multi-tool → PTC, small patch → Minimal,
 * plugin work → Creator.
 *
 * Pure + shareable: no fs/electron. The actual mountable Cordis compositions
 * live in the DeepSeek Harness preset root (standard/ptc/minimal/cordis);
 * this module is the Boss-side policy that names which to use and why.
 */

import type { TaskLevel } from "./task-ir";

export type DshPresetId = "boss-dev-standard" | "boss-dev-ptc" | "boss-dev-minimal" | "boss-plugin-creator";
export type DshRuntimeMode = "standard" | "ptc" | "minimal" | "creator";

export type BossWorkType = "repo-feature" | "bounded-multi-tool" | "small-patch" | "plugin-work" | "unclassified";

export interface DshPresetDefinition {
  id: DshPresetId;
  mode: DshRuntimeMode;
  /** Shipped DSH composition this preset maps onto. */
  basePreset: string;
  label: string;
  description: string;
  toolProfile: string[];
  /** Model policy expectation (plan §17 vocabulary). */
  expectedTier: "flash" | "pro";
}

export const DSH_PRESETS: Record<DshPresetId, DshPresetDefinition> = {
  "boss-dev-standard": {
    id: "boss-dev-standard",
    mode: "standard",
    basePreset: "standard",
    label: "Boss Dev · Standard",
    description: "Repo feature development: needs repo search, multiple tools, cross-module understanding, debugging.",
    toolProfile: ["bash", "fs", "fs-search", "skill", "planning", "subagents", "workflow"],
    expectedTier: "pro"
  },
  "boss-dev-ptc": {
    id: "boss-dev-ptc",
    mode: "ptc",
    basePreset: "ptc",
    label: "Boss Dev · PTC",
    description: "Bounded multi-tool work: search several files → read ranges → edit → test, composed as one TypeScript program to cut tool-call round trips.",
    toolProfile: ["ptc-sdk", "read", "search", "edit", "test"],
    expectedTier: "pro"
  },
  "boss-dev-minimal": {
    id: "boss-dev-minimal",
    mode: "minimal",
    basePreset: "minimal",
    label: "Boss Dev · Minimal",
    description: "Single patch with clear files and a known test command. Only bash + str_replace_editor are exposed.",
    toolProfile: ["bash", "str_replace_editor"],
    expectedTier: "flash"
  },
  "boss-plugin-creator": {
    id: "boss-plugin-creator",
    mode: "creator",
    basePreset: "cordis",
    label: "Boss Plugin · Creator",
    description: "Developing Boss-specific Harness plugins, inspecting plugin runtime, or tuning presets.",
    toolProfile: ["standard-full", "plugin-inspection", "preset-tuning"],
    expectedTier: "pro"
  }
};

export const WORK_TYPE_TO_PRESET: Record<BossWorkType, DshPresetId> = {
  "repo-feature": "boss-dev-standard",
  "bounded-multi-tool": "boss-dev-ptc",
  "small-patch": "boss-dev-minimal",
  "plugin-work": "boss-plugin-creator",
  unclassified: "boss-dev-standard"
};

export interface PresetChoice {
  preset: DshPresetDefinition;
  reason: string;
}

/**
 * Default mapping (plan §35 Phase I). Deterministic: the same work type +
 * optional level always yields the same preset.
 */
export function presetForWorkType(workType: BossWorkType, level?: TaskLevel): PresetChoice {
  // A bounded single-patch edit never needs the full agent.
  if (workType === "small-patch" || (level === "L0" && workType !== "plugin-work")) {
    return { preset: DSH_PRESETS["boss-dev-minimal"], reason: `${workType}${level ? ` (${level})` : ""} → minimal: single patch, known files and commands` };
  }
  const id = WORK_TYPE_TO_PRESET[workType];
  return { preset: DSH_PRESETS[id], reason: `${workType} → ${id} (${DSH_PRESETS[id].mode})` };
}

/** Inverse: which work types would be mis-served by each preset (guard rails). */
export function presetsServing(workType: BossWorkType): DshPresetId[] {
  if (workType === "small-patch") return ["boss-dev-minimal"];
  if (workType === "plugin-work") return ["boss-plugin-creator", "boss-dev-standard"];
  if (workType === "bounded-multi-tool") return ["boss-dev-ptc", "boss-dev-standard"];
  return ["boss-dev-standard", "boss-dev-ptc"];
}

/** Explains preset choice at the token level (plan §36: choices must be explainable). */
export function describePreset(choice: PresetChoice): string {
  const profile = choice.preset.toolProfile.join(", ");
  return `${choice.reason} · tools: ${profile}`;
}
