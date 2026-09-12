/**
 * Update-Plan/checkpoint-1.md §9/§9.1/§10 — the UI Surface Registry.
 *
 * §9 forbids a theme from guessing selectors: "不得让 AI 自己在代码里随意猜
 * `.sidebar` / `.some-random-div` / `button:nth-child(3)`". A theme therefore
 * faces a *semantic surface* with a §9.1 `UISurfaceContract`
 * (`id, category, allowedProperties, defaultTokens, componentBindings,
 * fallback`) and §10 semantic tokens, never a raw DOM path.
 *
 * This module owns the contract vocabulary and the fail-closed validation. The
 * host-side discovery that fills `componentBindings` with real evidence from the
 * repository lives in electron/engineering/ui-surface-discovery.ts, because a
 * binding must be observed, not asserted.
 *
 * CP3 scope note: this is the *registry + discovery* half of Phase 2B. The theme
 * package format, generator, validator, preview and activation controller are
 * CP4/CP5 and are deliberately not implemented here.
 */
import type { UISurfaceId } from "./ui-surface-ids";
export type { UISurfaceId } from "./ui-surface-ids";

export const UI_SURFACE_REGISTRY_VERSION = "ui-surface-registry-1" as const;

/* ------------------------------------------------------------------ *
 * §9 surface vocabulary
 * ------------------------------------------------------------------ */

export const UI_SURFACE_CATEGORIES = [
  "CANVAS", "SURFACE", "NAVIGATION", "CONTROL", "TYPOGRAPHY", "LINE", "STATE", "SCROLL", "CONTENT", "LAYOUT", "FEEDBACK"
] as const;
export type UISurfaceCategory = (typeof UI_SURFACE_CATEGORIES)[number];

/* ------------------------------------------------------------------ *
 * §10 semantic tokens
 * ------------------------------------------------------------------ */

export const UI_TOKEN_GROUPS = {
  color: [
    "--boss-bg-root", "--boss-bg-surface", "--boss-bg-elevated", "--boss-bg-muted",
    "--boss-text-primary", "--boss-text-secondary", "--boss-text-muted",
    "--boss-accent", "--boss-border", "--boss-divider",
    "--boss-success", "--boss-warning", "--boss-danger"
  ],
  shape: ["--boss-radius", "--boss-radius-sm", "--boss-radius-lg", "--boss-border-width", "--boss-shadow"],
  effect: ["--boss-blur", "--boss-opacity", "--boss-transition"],
  typography: ["--boss-font-family", "--boss-font-mono", "--boss-font-size", "--boss-line-height", "--boss-letter-spacing"],
  density: ["--boss-spacing-density", "--boss-space-1", "--boss-space-2", "--boss-space-3", "--boss-space-4"]
} as const satisfies Record<string, readonly string[]>;

export type UITokenGroup = keyof typeof UI_TOKEN_GROUPS;
export const UI_TOKEN_NAMES: readonly string[] = Object.values(UI_TOKEN_GROUPS).flat();

export function tokenGroupOf(token: string): UITokenGroup | undefined {
  for (const [group, names] of Object.entries(UI_TOKEN_GROUPS)) {
    if ((names as readonly string[]).includes(token)) return group as UITokenGroup;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * §9.1 UI surface contract
 * ------------------------------------------------------------------ */

export interface UISurfaceBinding {
  /** What kind of evidence the binding is. Never a guessed DOM path. */
  kind: "css-class" | "css-selector" | "component-file" | "token" | "token-family" | "attribute";
  value: string;
  /** Repository-relative file the evidence was read from. */
  file: string;
  /** How the binding was observed (so a reviewer can re-check it). */
  evidence: string;
}

export interface UISurfaceFallback {
  strategy: "BUILT_IN_DARK" | "BUILT_IN_LIGHT" | "INHERIT_PARENT" | "UNCHANGED";
  note: string;
}

export interface UISurfaceContract {
  id: UISurfaceId;
  category: UISurfaceCategory;
  description: string;
  /** CSS properties a theme may set for this surface, and nothing else. */
  allowedProperties: string[];
  /** §10 semantic tokens this surface reads. */
  defaultTokens: string[];
  /** Observed bindings; empty means the surface is unbound TODAY (reported). */
  componentBindings: UISurfaceBinding[];
  fallback: UISurfaceFallback;
  /** True when the surface must never be themed (safety/business meaning). */
  locked?: boolean;
}

/* ------------------------------------------------------------------ *
 * Default contract table (locked until a theme package overrides it)
 * ------------------------------------------------------------------ */

interface SurfaceSeed {
  id: UISurfaceId;
  category: UISurfaceCategory;
  description: string;
  allowedProperties: string[];
  defaultTokens: string[];
  fallback: UISurfaceFallback;
  locked?: boolean;
}

const INHERIT: UISurfaceFallback = { strategy: "INHERIT_PARENT", note: "no value of its own: inherits the enclosing surface" };
const DARK: UISurfaceFallback = { strategy: "BUILT_IN_DARK", note: "falls back to the locked built-in Dark theme" };

const SEEDS: readonly SurfaceSeed[] = [
  { id: "APP_BACKGROUND", category: "CANVAS", description: "the application canvas behind every panel", allowedProperties: ["background", "background-color", "background-image", "color"], defaultTokens: ["--boss-bg-root", "--boss-text-primary"], fallback: DARK },
  { id: "SURFACE_PRIMARY", category: "SURFACE", description: "the main working surface (conversation/work area)", allowedProperties: ["background", "background-color", "background-image", "color", "border-color"], defaultTokens: ["--boss-bg-surface", "--boss-text-primary", "--boss-border"], fallback: DARK },
  { id: "SURFACE_SECONDARY", category: "SURFACE", description: "elevated or secondary blocks inside a surface", allowedProperties: ["background", "background-color", "color", "border-color", "box-shadow"], defaultTokens: ["--boss-bg-elevated", "--boss-text-secondary", "--boss-shadow"], fallback: DARK },
  { id: "SIDEBAR", category: "NAVIGATION", description: "the history/navigation sidebar", allowedProperties: ["background", "background-color", "color", "border-color", "width"], defaultTokens: ["--boss-bg-surface", "--boss-text-secondary", "--boss-border"], fallback: DARK },
  { id: "TOP_NAV", category: "NAVIGATION", description: "the top-level view switch (Chat/Work/Research/Goal)", allowedProperties: ["background", "background-color", "color", "border-color", "padding"], defaultTokens: ["--boss-bg-elevated", "--boss-text-primary", "--boss-border"], fallback: DARK },
  { id: "CARD", category: "SURFACE", description: "a discrete card such as a task, evidence or runtime block", allowedProperties: ["background", "background-color", "border-color", "border-radius", "box-shadow", "color"], defaultTokens: ["--boss-bg-elevated", "--boss-border", "--boss-radius", "--boss-shadow"], fallback: DARK },
  { id: "MODAL", category: "SURFACE", description: "a modal/backdrop overlay (settings, dialogs)", allowedProperties: ["background", "background-color", "backdrop-filter", "border-color", "box-shadow", "color"], defaultTokens: ["--boss-bg-elevated", "--boss-backdrop", "--boss-blur", "--boss-shadow"], fallback: DARK },
  { id: "INPUT", category: "CONTROL", description: "text inputs, textareas and select controls", allowedProperties: ["background", "background-color", "border-color", "border-radius", "color", "caret-color", "font-family"], defaultTokens: ["--boss-bg-surface", "--boss-border", "--boss-text-primary", "--boss-radius"], fallback: DARK },
  { id: "BUTTON_PRIMARY", category: "CONTROL", description: "the primary action control of a surface", allowedProperties: ["background", "background-color", "border-color", "border-radius", "color", "box-shadow", "font-weight"], defaultTokens: ["--boss-accent", "--boss-on-accent", "--boss-radius"], fallback: DARK },
  { id: "BUTTON_SECONDARY", category: "CONTROL", description: "secondary and toggle controls", allowedProperties: ["background", "background-color", "border-color", "border-radius", "color"], defaultTokens: ["--boss-bg-elevated", "--boss-border", "--boss-text-secondary", "--boss-radius"], fallback: DARK },
  { id: "TEXT_PRIMARY", category: "TYPOGRAPHY", description: "primary readable text", allowedProperties: ["color", "font-family", "font-size", "font-weight", "letter-spacing", "line-height"], defaultTokens: ["--boss-text-primary", "--boss-font-family", "--boss-line-height"], fallback: DARK },
  { id: "TEXT_SECONDARY", category: "TYPOGRAPHY", description: "supporting and muted text", allowedProperties: ["color", "font-size", "letter-spacing", "line-height"], defaultTokens: ["--boss-text-secondary", "--boss-text-muted"], fallback: DARK },
  { id: "BORDER", category: "LINE", description: "structural borders around surfaces and controls", allowedProperties: ["border-color", "border-width", "border-style", "border-radius"], defaultTokens: ["--boss-border", "--boss-border-width", "--boss-radius"], fallback: INHERIT },
  { id: "DIVIDER", category: "LINE", description: "separators inside a surface (toolbars, list rows)", allowedProperties: ["border-color", "background-color", "opacity"], defaultTokens: ["--boss-divider"], fallback: INHERIT },
  { id: "ACCENT", category: "STATE", description: "the product accent and focus affordance", allowedProperties: ["background-color", "color", "box-shadow", "outline-color"], defaultTokens: ["--boss-accent", "--boss-accent-muted"], fallback: DARK },
  { id: "SUCCESS", category: "STATE", description: "success/verified state", allowedProperties: ["background-color", "color", "border-color"], defaultTokens: ["--boss-success"], fallback: DARK },
  { id: "WARNING", category: "STATE", description: "warning/degraded state", allowedProperties: ["background-color", "color", "border-color"], defaultTokens: ["--boss-warning"], fallback: DARK },
  { id: "DANGER", category: "STATE", description: "danger/blocked state", allowedProperties: ["background-color", "color", "border-color"], defaultTokens: ["--boss-danger"], fallback: DARK },
  { id: "SCROLLBAR", category: "SCROLL", description: "scrollbar track and thumb", allowedProperties: ["background-color", "border-radius", "width", "opacity"], defaultTokens: ["--boss-scrollbar-thumb", "--boss-scrollbar-track"], fallback: INHERIT },
  { id: "CODE_PANEL", category: "CONTENT", description: "code/monospace content blocks (final response, diffs)", allowedProperties: ["background", "background-color", "border-color", "border-radius", "color", "font-family", "font-size", "white-space"], defaultTokens: ["--boss-code-bg", "--boss-font-mono", "--boss-text-primary"], fallback: DARK },
  { id: "WORKSPACE_PANEL", category: "LAYOUT", description: "the provider/web workspace area", allowedProperties: ["background", "background-color", "border-color", "gap", "padding"], defaultTokens: ["--boss-bg-root", "--boss-border"], fallback: DARK },
  { id: "AI_PANE", category: "LAYOUT", description: "one web-AI processor pane and its frame", allowedProperties: ["background", "background-color", "border-color", "color"], defaultTokens: ["--boss-bg-surface", "--boss-border", "--boss-text-secondary"], fallback: DARK },
  { id: "STATUS_BADGE", category: "FEEDBACK", description: "status pills and badges (stage, outcome, counts)", allowedProperties: ["background-color", "color", "border-color", "border-radius", "letter-spacing"], defaultTokens: ["--boss-bg-elevated", "--boss-text-secondary", "--boss-radius-sm"], fallback: DARK }
];

/** The locked contract table with empty bindings (discovery fills them in). */
export function defaultSurfaceContracts(): UISurfaceContract[] {
  return SEEDS.map((seed) => ({
    id: seed.id,
    category: seed.category,
    description: seed.description,
    allowedProperties: [...seed.allowedProperties],
    defaultTokens: [...seed.defaultTokens],
    componentBindings: [],
    ...(seed.locked ? { locked: seed.locked } : {}),
    fallback: { ...seed.fallback }
  }));
}

export function surfaceById(id: string, contracts: readonly UISurfaceContract[] = defaultSurfaceContracts()): UISurfaceContract | undefined {
  return contracts.find((contract) => contract.id === id);
}

/* ------------------------------------------------------------------ *
 * §9.1/§20 fail-closed validation
 * ------------------------------------------------------------------ */

export type SurfaceOverrideCode = "UNKNOWN_SURFACE" | "UNKNOWN_PROPERTY" | "UNKNOWN_TOKEN" | "UNSAFE_VALUE" | "LOCKED_SURFACE" | "EMPTY_VALUE";

export interface SurfaceOverrideRequest {
  surface: string;
  property: string;
  value: string;
}

export type SurfaceOverrideVerdict = { ok: true; surface: UISurfaceId; property: string } | { ok: false; code: SurfaceOverrideCode; detail: string };

const UNSAFE_VALUE = [
  /javascript:/i,
  /expression\s*\(/i,
  /@import/i,
  /url\(\s*['"]?\s*(?:https?:)?\/\//i,
  /<\/?\s*script/i,
  /behavior\s*:/i,
  /binding\s*:/i
];

/**
 * §9.1 + §20: a theme may only touch a declared surface, only through allowed
 * properties, only with inline values that reference known tokens or literals.
 * Everything else fails closed with a machine-readable code.
 */
export function validateSurfaceOverride(
  request: SurfaceOverrideRequest,
  contracts: readonly UISurfaceContract[] = defaultSurfaceContracts()
): SurfaceOverrideVerdict {
  const contract = surfaceById(request.surface, contracts);
  if (!contract) return { ok: false, code: "UNKNOWN_SURFACE", detail: `${request.surface} is not a registered UI surface` };
  if (contract.locked) return { ok: false, code: "LOCKED_SURFACE", detail: `${contract.id} is locked and cannot be themed` };
  const property = request.property.trim().toLocaleLowerCase();
  if (!contract.allowedProperties.map((item) => item.toLocaleLowerCase()).includes(property)) {
    return { ok: false, code: "UNKNOWN_PROPERTY", detail: `${contract.id} does not allow the property ${request.property}; allowed: ${contract.allowedProperties.join(", ")}` };
  }
  const value = request.value.trim();
  if (!value) return { ok: false, code: "EMPTY_VALUE", detail: "an override value cannot be empty" };
  for (const pattern of UNSAFE_VALUE) {
    if (pattern.test(value)) return { ok: false, code: "UNSAFE_VALUE", detail: `value rejected by §20 (${pattern}): ${value.slice(0, 80)}` };
  }
  for (const reference of value.match(/var\(\s*(--[a-z0-9-]+)/gi) ?? []) {
    const token = reference.replace(/var\(\s*/i, "").trim();
    if (token.startsWith("--boss-") && !knownToken(token)) {
      return { ok: false, code: "UNKNOWN_TOKEN", detail: `${token} is not a declared §10 token` };
    }
  }
  return { ok: true, surface: contract.id, property };
}

const EXTRA_TOKENS = [
  "--boss-on-accent", "--boss-accent-muted", "--boss-backdrop", "--boss-scrollbar-thumb", "--boss-scrollbar-track", "--boss-code-bg"
];

export function knownToken(token: string): boolean {
  return UI_TOKEN_NAMES.includes(token) || EXTRA_TOKENS.includes(token);
}

export const UI_SURFACE_EXTRA_TOKENS: readonly string[] = EXTRA_TOKENS;

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export interface UISurfaceTokenRecord {
  name: string;
  group: UITokenGroup | "extended";
  /** True when the token is actually declared in the repository's stylesheets. */
  declared: boolean;
  /** Files where the declaration was observed. */
  evidence: string[];
}

export interface UISurfaceRegistry {
  schemaVersion: 1;
  version: typeof UI_SURFACE_REGISTRY_VERSION;
  generated_at: string;
  root: string;
  contracts: UISurfaceContract[];
  /** Surfaces with no observed binding today — reported, never hidden. */
  unbound: UISurfaceId[];
  tokens: UISurfaceTokenRecord[];
  /** True when at least one declared `--boss-*` token exists in the stylesheets. */
  tokens_applied: boolean;
  style_files: string[];
  component_files: string[];
}

export interface UISurfaceRegistryValidation {
  ok: boolean;
  problems: string[];
}

/**
 * A registry is only usable if every §9 surface has a contract, every contract
 * reads declared tokens, and any surface without a binding is listed in
 * `unbound`. This is what stops a theme from quietly inventing a surface.
 */
export function validateUISurfaceRegistry(registry: UISurfaceRegistry): UISurfaceRegistryValidation {
  const problems: string[] = [];
  const ids = new Set(registry.contracts.map((contract) => contract.id));
  for (const seed of SEEDS) {
    if (!ids.has(seed.id)) problems.push(`surface ${seed.id} has no contract`);
  }
  if (ids.size !== registry.contracts.length) problems.push("duplicate surface ids in the registry");
  for (const contract of registry.contracts) {
    if (!contract.allowedProperties.length) problems.push(`${contract.id} allows no properties`);
    if (!contract.defaultTokens.length) problems.push(`${contract.id} declares no default tokens`);
    for (const token of contract.defaultTokens) {
      if (!knownToken(token)) problems.push(`${contract.id} references undeclared token ${token}`);
    }
  }
  const declaredUnbound = new Set(registry.unbound);
  for (const contract of registry.contracts) {
    const bound = contract.componentBindings.length > 0;
    if (!bound && !declaredUnbound.has(contract.id)) problems.push(`${contract.id} has no binding but is not listed in unbound`);
    if (bound && declaredUnbound.has(contract.id)) problems.push(`${contract.id} has a binding but is listed in unbound`);
    for (const binding of contract.componentBindings) {
      if (!binding.file || !binding.evidence) problems.push(`${contract.id} has an evidence-free binding ${binding.value}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Compact statement for a task record / report. */
export interface UISurfaceSummary {
  version: typeof UI_SURFACE_REGISTRY_VERSION;
  generated_at: string;
  surfaces: number;
  bound: number;
  unbound: UISurfaceId[];
  tokens_declared: number;
  tokens_total: number;
  tokens_applied: boolean;
  style_files: string[];
  component_files: string[];
}

export function summarizeUISurfaceRegistry(registry: UISurfaceRegistry): UISurfaceSummary {
  return {
    version: registry.version,
    generated_at: registry.generated_at,
    surfaces: registry.contracts.length,
    bound: registry.contracts.filter((contract) => contract.componentBindings.length > 0).length,
    unbound: [...registry.unbound],
    tokens_declared: registry.tokens.filter((token) => token.declared).length,
    tokens_total: registry.tokens.length,
    tokens_applied: registry.tokens_applied,
    style_files: [...registry.style_files],
    component_files: [...registry.component_files]
  };
}
