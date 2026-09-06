/** Explainable config layering (plan §7). */

export type ConfigLayerName = "system" | "global" | "workspace" | "initiative" | "task" | "emergency";
export const CONFIG_LAYER_ORDER: readonly ConfigLayerName[] = ["system", "global", "workspace", "initiative", "task", "emergency"];

export type ConfigValue = number | boolean | string;

export type ConfigValues = Record<string, ConfigValue>;

export type LayerValues = Record<string, ConfigValue | undefined>;

export interface ConfigSourceEntry {
  key: string;
  value: ConfigValue;
  source: ConfigLayerName;
}

export interface ResolvedConfig {
  /** Final value per key, merged with fixed precedence. */
  values: ConfigValues;
  /** Per-key provenance: which layer contributed the winning value. */
  sources: Record<string, ConfigLayerName>;
}

/**
 * Merges layered overrides over system defaults. Precedence is the plan's fixed
 * order System < Global < Workspace < Initiative < Task < Emergency; each key is
 * explained by the highest-precedence layer that actually defined it.
 */
export function resolveConfig(systemDefaults: ConfigValues, layers: Partial<Record<ConfigLayerName, LayerValues>> = {}): ResolvedConfig {
  const merged: ConfigValues = { ...systemDefaults };
  const sources: Record<string, ConfigLayerName> = {};
  for (const key of Object.keys(systemDefaults)) sources[key] = "system";
  for (const layer of CONFIG_LAYER_ORDER) {
    const layerValues = layers[layer];
    if (!layerValues) continue;
    for (const [key, value] of Object.entries(layerValues)) {
      if (value === undefined) continue;
      merged[key] = value;
      sources[key] = layer;
    }
  }
  return { values: merged, sources };
}

/** Human-readable explanation for one resolved key, e.g. `max_workers = 3 (source: workspace)`. */
export function explainConfigKey(resolved: ResolvedConfig, key: string): string {
  if (!(key in resolved.values)) return `Unknown config key: ${key}`;
  return `${key} = ${JSON.stringify(resolved.values[key])} (source: ${resolved.sources[key] ?? "system"})`;
}

export function configEntries(resolved: ResolvedConfig): ConfigSourceEntry[] {
  return Object.entries(resolved.values).map(([key, value]) => ({ key, value, source: resolved.sources[key] ?? "system" }));
}

export type OperationalLimitKey = "modelCalls" | "retries" | "toolCalls";
export type OperationalLimits = Record<OperationalLimitKey, number>;

export interface OperationalLimitOverrides {
  modelCalls?: number;
  retries?: number;
  toolCalls?: number;
}

const SYSTEM_OPERATIONAL_LIMITS: OperationalLimits = { modelCalls: 12, retries: 3, toolCalls: 100 };

export interface ResolvedOperationalLimits {
  values: OperationalLimits;
  sources: Record<OperationalLimitKey, ConfigLayerName>;
}

/**
 * Resolves per-task operational limits with explainable provenance: system
 * defaults, then optional global/workspace layers, then the task layer. Every
 * final value carries its source so `modelCalls = 5 (source: task)` style
 * explanation (plan §7) is possible.
 */
export function resolveOperationalLimits(task: OperationalLimitOverrides = {}, global: OperationalLimitOverrides = {}, workspace: OperationalLimitOverrides = {}): ResolvedOperationalLimits {
  const resolved = resolveConfig(SYSTEM_OPERATIONAL_LIMITS, { global: { ...global }, workspace: { ...workspace }, task: { ...task } });
  const values: Partial<OperationalLimits> = {};
  const sources: Partial<Record<OperationalLimitKey, ConfigLayerName>> = {};
  for (const key of Object.keys(SYSTEM_OPERATIONAL_LIMITS) as OperationalLimitKey[]) {
    values[key] = Number(resolved.values[key]);
    sources[key] = resolved.sources[key];
  }
  return { values: values as OperationalLimits, sources: sources as Record<OperationalLimitKey, ConfigLayerName> };
}
