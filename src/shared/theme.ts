/**
 * Update-Plan/checkpoint-1.md §10–§13, §20–§22 — the Theme package contract.
 *
 * A Theme is a self-contained package (§11): its own tokens, its own surface
 * overrides and its own stylesheet. It never extends another theme, so deleting
 * one theme can never break another; and it can never touch business logic, only
 * the §9 surfaces the UI Surface Registry exposes.
 *
 * This module is pure: it owns the package shape, the §20 validator rules, the
 * §5-style lifecycle vocabulary, contrast/cycle analysis and the *plans* for
 * activation (§21 runtime safety) and deletion (§22 deletion safety). The host
 * applies those plans in electron/theme/*.
 */
import {
  knownToken,
  surfaceById,
  validateSurfaceOverride,
  type UISurfaceContract,
  type UISurfaceId
} from "./ui-surface";
import { contentHashOf } from "./workbook";

export const THEME_SCHEMA_VERSION = 1 as const;

/* ------------------------------------------------------------------ *
 * §13 lifecycle vocabulary (plus the §23 registry record)
 * ------------------------------------------------------------------ */

export const THEME_STATES = [
  "DRAFT", "PREVIEW", "VALIDATING", "INSTALLED", "ACTIVE", "DISABLED", "INVALID", "QUARANTINED"
] as const;
export type ThemeState = (typeof THEME_STATES)[number];

export type ThemeType = "BUILT_IN" | "CUSTOM";

/** §12: the two built-ins are permanent, locked and non-deletable. */
export const BUILT_IN_THEME_IDS = ["builtin-dark", "builtin-light"] as const;
export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];
export const DEFAULT_THEME_ID: BuiltInThemeId = "builtin-dark";

export interface ThemeManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  type: ThemeType;
  version: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** §12: built-ins are locked; `deletable` is false for them. */
  builtIn: boolean;
  deletable: boolean;
  /** Set when a custom theme was derived from another one (§11: derivation is a
   *  one-time materialization, never a runtime dependency). */
  derivedFrom?: string;
}

export interface ThemeMetadata {
  schemaVersion: 1;
  createdBy: "BUILT_IN" | "DUPLICATED" | "GENERATED" | "IMPORTED";
  notes: string[];
  /** Informational only: never resolved at runtime (§11 no dependency chain). */
  basedOn?: string;
}

export interface ThemeSurfaceOverride {
  surface: UISurfaceId;
  property: string;
  value: string;
}

/** §10: the semantic token layer a theme drives. */
export type ThemeTokens = Record<string, string>;

export interface ThemePackage {
  manifest: ThemeManifest;
  tokens: ThemeTokens;
  overrides: ThemeSurfaceOverride[];
  /** Optional free-form stylesheet; still validated (§20) and never executed. */
  css?: string;
  metadata: ThemeMetadata;
}

/** §23 ThemeRecord, plus the lifecycle state CP4 enforces. */
export interface ThemeRecord {
  id: string;
  name: string;
  type: ThemeType;
  version: string;
  builtIn: boolean;
  deletable: boolean;
  /** Package directory relative to the theme root. */
  path: string;
  /** Content hash of the materialized package (integrity + change detection). */
  hash: string;
  createdAt: string;
  updatedAt: string;
  state: ThemeState;
  validation?: ThemeValidationReport;
  preview: boolean;
}

/* ------------------------------------------------------------------ *
 * §20 validator
 * ------------------------------------------------------------------ */

export const THEME_RULES = [
  "SCHEMA",
  "REQUIRED_TOKENS",
  "UNKNOWN_TOKEN",
  "UNSUPPORTED_PROPERTY",
  "BROKEN_REFERENCE",
  "TOKEN_CYCLE",
  "INVALID_CSS",
  "UNSAFE_URL",
  "EXTERNAL_IMPORT",
  "FILESYSTEM_ESCAPE",
  "SCRIPT_INJECTION",
  "CRITICAL_CONTRAST",
  "LAYOUT_OVERFLOW",
  "STARTUP_STABILITY",
  "BUILT_IN_INTEGRITY"
] as const;
export type ThemeRuleId = (typeof THEME_RULES)[number];

export interface ThemeDiagnostic {
  rule: ThemeRuleId;
  severity: "ERROR" | "WARN" | "INFO";
  message: string;
  pointer?: string;
}

export interface ContrastFinding {
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  ok: boolean;
  severity: "ERROR" | "WARN";
}

export interface ThemeValidationReport {
  ok: boolean;
  state: ThemeState;
  diagnostics: ThemeDiagnostic[];
  contrast: ContrastFinding[];
  checkedAt: string;
  /** Content hash of the validated package, so a record can prove what passed. */
  hash: string;
}

/** Tokens a theme must define for the product to be readable at all. */
export const REQUIRED_THEME_TOKENS: readonly string[] = [
  "--boss-bg-root",
  "--boss-bg-surface",
  "--boss-bg-elevated",
  "--boss-text-primary",
  "--boss-text-muted",
  "--boss-accent",
  "--boss-border",
  "--boss-radius"
];

/** Reader-facing pairs the validator measures (§20 "critical contrast"). */
export const CONTRAST_PAIRS: ReadonlyArray<{ foreground: string; background: string; required: number; severity: "ERROR" | "WARN" }> = [
  { foreground: "--boss-text-primary", background: "--boss-bg-root", required: 3, severity: "ERROR" },
  { foreground: "--boss-text-primary", background: "--boss-bg-surface", required: 3, severity: "ERROR" },
  { foreground: "--boss-text-primary", background: "--boss-bg-elevated", required: 3, severity: "ERROR" },
  { foreground: "--boss-text-muted", background: "--boss-bg-root", required: 2.5, severity: "WARN" },
  { foreground: "--boss-on-accent", background: "--boss-accent", required: 3, severity: "WARN" }
];

const SCRIPT_INJECTION = [
  /<\s*\/?\s*script/i,
  /<\s*\/\s*style/i,
  /javascript\s*:/i,
  /expression\s*\(/i,
  /\bbehavior\s*:/i,
  /-moz-binding\s*:/i,
  /\bon[a-z]+\s*=/i,
  /@import\s+url\s*\(\s*['"]?\s*(?:https?:)?\/\//i,
  // A stylesheet has no legitimate use for these: they are only here to try to
  // smuggle behaviour past the CSS parser (§20/§59).
  /\bdocument\s*\./i,
  /\bwindow\s*\./i,
  /\beval\s*\(/i,
  /new\s+Function\s*\(/i,
  /\brequire\s*\(/i
];
const EXTERNAL_IMPORT = [/@import/i, /url\s*\(\s*['"]?\s*(?:https?:)?\/\//i];
const FILESYSTEM_ESCAPE = [/url\s*\(\s*['"]?\s*\.\.\//i, /url\s*\(\s*['"]?\s*[a-z]:[\\/]/i, /url\s*\(\s*['"]?\s*file:/i, /url\s*\(\s*['"]?\s*\//i];

/**
 * §20: every rule the plan lists, evaluated deterministically against the §9
 * contract table. Fail-closed: any ERROR makes `ok` false and the caller must
 * refuse to install or activate the package.
 */
export function validateThemePackage(
  pkg: ThemePackage,
  contracts: readonly UISurfaceContract[],
  options: { now?: string; expectedBuiltInHash?: string } = {}
): ThemeValidationReport {
  const diagnostics: ThemeDiagnostic[] = [];
  const contrast: ContrastFinding[] = [];
  const push = (rule: ThemeRuleId, severity: ThemeDiagnostic["severity"], message: string, pointer?: string): void => {
    diagnostics.push(pointer ? { rule, severity, message, pointer } : { rule, severity, message });
  };

  /* -- SCHEMA -- */
  const manifest = pkg.manifest;
  const schemaProblems: string[] = [];
  if (!manifest) schemaProblems.push("manifest is missing");
  else {
    if (manifest.schemaVersion !== THEME_SCHEMA_VERSION) schemaProblems.push(`unsupported schemaVersion ${String(manifest.schemaVersion)}`);
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(manifest.id ?? "")) schemaProblems.push(`invalid theme id "${manifest.id ?? ""}"`);
    if (!manifest.name?.trim()) schemaProblems.push("name is empty");
    if (manifest.type !== "BUILT_IN" && manifest.type !== "CUSTOM") schemaProblems.push(`invalid type "${String(manifest.type)}"`);
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) schemaProblems.push(`invalid version "${String(manifest.version)}"`);
    if (manifest.builtIn !== (manifest.type === "BUILT_IN")) schemaProblems.push("builtIn flag disagrees with type");
    if (manifest.builtIn && manifest.deletable) schemaProblems.push("a built-in theme cannot be deletable (§12)");
  }
  if (!pkg.tokens || typeof pkg.tokens !== "object" || Array.isArray(pkg.tokens)) schemaProblems.push("tokens must be an object");
  if (!Array.isArray(pkg.overrides)) schemaProblems.push("overrides must be an array");
  if (!pkg.metadata || pkg.metadata.schemaVersion !== THEME_SCHEMA_VERSION) schemaProblems.push("metadata is missing or unsupported");
  if (schemaProblems.length) push("SCHEMA", "ERROR", schemaProblems.join("; "));

  /* -- token vocabulary -- */
  const tokens = pkg.tokens && typeof pkg.tokens === "object" && !Array.isArray(pkg.tokens) ? pkg.tokens : {};
  for (const [name, value] of Object.entries(tokens)) {
    if (!name.startsWith("--boss-")) { push("UNKNOWN_TOKEN", "ERROR", `${name} is not a --boss-* semantic token`, name); continue; }
    if (!knownToken(name)) push("UNKNOWN_TOKEN", "ERROR", `${name} is not part of the §10 token vocabulary`, name);
    if (typeof value !== "string" || !value.trim()) push("SCHEMA", "ERROR", `${name} has an empty value`, name);
  }
  const missing = REQUIRED_THEME_TOKENS.filter((token) => !tokens[token]?.trim());
  if (missing.length) push("REQUIRED_TOKENS", "ERROR", `missing required token(s): ${missing.join(", ")}`, missing.join(","));

  /* -- §9.1 surface overrides, through the registry contract -- */
  for (const [index, override] of (Array.isArray(pkg.overrides) ? pkg.overrides : []).entries()) {
    const verdict = validateSurfaceOverride({ surface: override?.surface ?? "", property: override?.property ?? "", value: override?.value ?? "" }, contracts);
    if (verdict.ok) continue;
    const rule: ThemeRuleId = verdict.code === "UNKNOWN_SURFACE" || verdict.code === "LOCKED_SURFACE"
      ? "UNSUPPORTED_PROPERTY"
      : verdict.code === "UNKNOWN_PROPERTY"
        ? "UNSUPPORTED_PROPERTY"
        : verdict.code === "UNKNOWN_TOKEN"
          ? "BROKEN_REFERENCE"
          : "UNSAFE_URL";
    push(rule, "ERROR", verdict.detail, `overrides[${index}]`);
  }
  // LAYOUT/CANVAS surfaces may not move the shell: report it explicitly so a
  // rejected layout change is explainable rather than just "property not allowed".
  for (const [index, override] of (Array.isArray(pkg.overrides) ? pkg.overrides : []).entries()) {
    const contract = surfaceById(override?.surface ?? "", contracts);
    if (!contract || (contract.category !== "LAYOUT" && contract.category !== "CANVAS")) continue;
    if (/^(position|inset|top|left|right|bottom|width|height|overflow)$/i.test(override.property ?? "")) {
      push("LAYOUT_OVERFLOW", "ERROR", `${contract.id} cannot be repositioned or resized by a theme`, `overrides[${index}]`);
    }
  }

  /* -- BROKEN_REFERENCE + TOKEN_CYCLE -- */
  const definedTokens = new Set(Object.keys(tokens));
  const referencesOf = (value: string): string[] => [...value.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((match) => match[1]);
  for (const [name, value] of Object.entries(tokens)) {
    for (const reference of referencesOf(String(value))) {
      if (!knownToken(reference) && !definedTokens.has(reference)) { push("BROKEN_REFERENCE", "ERROR", `${name} references unknown token ${reference}`, name); continue; }
      if (reference === name) push("TOKEN_CYCLE", "ERROR", `${name} references itself`, name);
    }
  }
  const cycle = findTokenCycle(tokens);
  if (cycle.length) push("TOKEN_CYCLE", "ERROR", `token cycle: ${cycle.join(" → ")}`);

  /* -- stylesheet + override values -- */
  const cssText = typeof pkg.css === "string" ? pkg.css : "";
  const scan = (text: string, pointer: string): void => {
    if (!text) return;
    for (const pattern of SCRIPT_INJECTION) if (pattern.test(text)) push("SCRIPT_INJECTION", "ERROR", `theme content matches ${pattern}`, pointer);
    for (const pattern of EXTERNAL_IMPORT) if (pattern.test(text)) push("EXTERNAL_IMPORT", "ERROR", `theme content matches ${pattern}`, pointer);
    for (const pattern of FILESYSTEM_ESCAPE) if (pattern.test(text)) push("FILESYSTEM_ESCAPE", "ERROR", `theme content matches ${pattern}`, pointer);
    for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
      const token = match[1];
      if (token.startsWith("--boss-") && !knownToken(token) && !definedTokens.has(token)) push("BROKEN_REFERENCE", "ERROR", `${pointer} references unknown token ${token}`, pointer);
    }
    if (cssText.includes(text)) {
      const braces = (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length;
      const parentheses = (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length;
      if (braces !== 0) push("INVALID_CSS", "ERROR", `${pointer} has unbalanced braces`, pointer);
      if (parentheses !== 0) push("INVALID_CSS", "ERROR", `${pointer} has unbalanced parentheses`, pointer);
    }
  };
  scan(cssText, "css");
  for (const [index, override] of (Array.isArray(pkg.overrides) ? pkg.overrides : []).entries()) scan(String(override?.value ?? ""), `overrides[${index}]`);
  // Token values are rendered into the stylesheet too, so they get the same scan.
  for (const [name, value] of Object.entries(tokens)) scan(String(value), `tokens.${name}`);

  /* -- §20 critical contrast -- */
  for (const pair of CONTRAST_PAIRS) {
    const foreground = tokens[pair.foreground];
    const background = tokens[pair.background];
    if (!foreground?.trim() || !background?.trim()) continue;
    const ratio = contrastRatio(foreground, background);
    if (ratio === undefined) {
      push("CRITICAL_CONTRAST", "INFO", `${pair.foreground} on ${pair.background} could not be measured (unsupported colour form)`);
      continue;
    }
    const ok = ratio >= pair.required;
    contrast.push({ foreground: pair.foreground, background: pair.background, ratio, required: pair.required, ok, severity: pair.severity });
    if (!ok) push("CRITICAL_CONTRAST", pair.severity, `${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1, below ${pair.required}:1`, pair.foreground);
  }

  /* -- §20 startup stability (structural half) -- */
  if (!pkg.manifest || !pkg.metadata) push("STARTUP_STABILITY", "ERROR", "a package without manifest/metadata cannot be loaded safely");

  /* -- §20 built-in integrity -- */
  if (options.expectedBuiltInHash && pkg.manifest?.builtIn) {
    const hash = themePackageHash(pkg);
    if (hash !== options.expectedBuiltInHash) push("BUILT_IN_INTEGRITY", "ERROR", `built-in package hash ${hash} does not match the shipped hash`, pkg.manifest.id);
  }

  const ok = diagnostics.every((entry) => entry.severity !== "ERROR");
  return {
    ok,
    state: ok ? "VALIDATING" : "INVALID",
    diagnostics,
    contrast,
    checkedAt: options.now ?? new Date(0).toISOString(),
    hash: themePackageHash(pkg)
  };
}

/** Detects a `var()` cycle among the package's own tokens. */
export function findTokenCycle(tokens: ThemeTokens): string[] {
  const edges = new Map<string, string[]>();
  for (const [name, value] of Object.entries(tokens)) {
    edges.set(name, [...String(value).matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((match) => match[1]).filter((token) => token in tokens));
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): string[] => {
    if (visiting.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (done.has(node)) return [];
    visiting.add(node);
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle.length) return cycle;
    }
    path.pop();
    visiting.delete(node);
    done.add(node);
    return [];
  };
  for (const node of edges.keys()) {
    const cycle = visit(node);
    if (cycle.length) return cycle;
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * Colour math (WCAG relative luminance)
 * ------------------------------------------------------------------ */

export function parseColour(value: string): { r: number; g: number; b: number } | undefined {
  const text = value.trim().toLocaleLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    const expand = (part: string): number => parseInt(part.length === 1 ? part + part : part, 16);
    if (digits.length <= 4) return { r: expand(digits[0]), g: expand(digits[1]), b: expand(digits[2]) };
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16) };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/.exec(text);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return undefined;
}

/** WCAG contrast ratio; undefined when either colour cannot be parsed. */
export function contrastRatio(foreground: string, background: string): number | undefined {
  const front = parseColour(foreground);
  const back = parseColour(background);
  if (!front || !back) return undefined;
  const luminance = (colour: { r: number; g: number; b: number }): number => {
    const channel = (value: number): number => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
  };
  const first = luminance(front);
  const second = luminance(back);
  const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  return Number(ratio.toFixed(3));
}

/* ------------------------------------------------------------------ *
 * §21 activation safety
 * ------------------------------------------------------------------ */

export interface ActivationPlan {
  ok: boolean;
  themeId: string;
  /** Built-in to fall back to when the requested theme cannot be used. */
  fallbackThemeId?: BuiltInThemeId;
  reason: string;
  code?: "NOT_FOUND" | "INVALID" | "QUARANTINED" | "DISABLED" | "BUILT_IN_INTEGRITY";
}

/**
 * §21 runtime safety: a theme that cannot be proven valid never becomes the
 * active one — the built-in fallback does. This is the decision the host applies
 * on boot, on activation and after a load failure.
 */
export function planActivation(record: ThemeRecord | undefined, options: { requestedId: string; preferFallback?: BuiltInThemeId }): ActivationPlan {
  const fallback = options.preferFallback ?? DEFAULT_THEME_ID;
  if (!record) {
    return { ok: false, themeId: fallback, fallbackThemeId: fallback, code: "NOT_FOUND", reason: `theme ${options.requestedId} is not registered; using ${fallback}` };
  }
  if (record.hash && record.validation && record.validation.hash !== record.hash) {
    return { ok: false, themeId: fallback, fallbackThemeId: fallback, code: "INVALID", reason: `${record.id} changed on disk since it was validated; using ${fallback}` };
  }
  if (record.state === "QUARANTINED") return { ok: false, themeId: fallback, fallbackThemeId: fallback, code: "QUARANTINED", reason: `${record.id} is quarantined: ${firstError(record)}` };
  if (record.state === "INVALID" || record.validation?.ok === false) {
    return { ok: false, themeId: fallback, fallbackThemeId: fallback, code: "INVALID", reason: `${record.id} failed validation: ${firstError(record)}` };
  }
  if (record.state === "DISABLED" || record.state === "DRAFT") {
    return { ok: false, themeId: fallback, fallbackThemeId: fallback, code: "DISABLED", reason: `${record.id} is ${record.state.toLowerCase()}; using ${fallback}` };
  }
  if (record.builtIn && record.validation?.diagnostics.some((entry) => entry.rule === "BUILT_IN_INTEGRITY" && entry.severity === "ERROR")) {
    return { ok: false, themeId: fallback, fallbackThemeId: fallback, code: "BUILT_IN_INTEGRITY", reason: `${record.id} failed its integrity check` };
  }
  return { ok: true, themeId: record.id, reason: `${record.id} is ${record.state} and validated` };
}

function firstError(record: ThemeRecord): string {
  return record.validation?.diagnostics.find((entry) => entry.severity === "ERROR")?.message ?? "no validated report";
}

/* ------------------------------------------------------------------ *
 * §22 deletion safety
 * ------------------------------------------------------------------ */

export type ThemeDeletionStep = "VERIFY_NOT_BUILT_IN" | "SWITCH_FALLBACK" | "KEEP_ACTIVE" | "UNREGISTER" | "DELETE_PACKAGE" | "VALIDATE_REMAINING";

export interface DeletionPlan {
  ok: boolean;
  steps: ThemeDeletionStep[];
  fallbackThemeId?: BuiltInThemeId;
  reason: string;
  code?: "NOT_FOUND" | "BUILT_IN_LOCKED";
}

/**
 * §22: verify not built-in → if active, switch to the fallback → unregister →
 * delete the package → validate what remains. The plan is returned so the host
 * cannot reorder the steps by accident.
 */
export function planThemeDeletion(record: ThemeRecord | undefined, options: { activeThemeId: string; remaining: readonly ThemeRecord[]; preferFallback?: BuiltInThemeId }): DeletionPlan {
  if (!record) return { ok: false, steps: [], code: "NOT_FOUND", reason: "theme is not registered" };
  if (record.builtIn || !record.deletable) {
    return { ok: false, steps: [], code: "BUILT_IN_LOCKED", reason: `${record.id} is a locked built-in theme and can never be deleted (§12)` };
  }
  const fallback = options.preferFallback ?? (options.remaining.find((entry) => entry.builtIn && entry.id === DEFAULT_THEME_ID)?.id
    ?? options.remaining.find((entry) => entry.builtIn)?.id
    ?? DEFAULT_THEME_ID);
  const active = options.activeThemeId === record.id;
  const steps: ThemeDeletionStep[] = ["VERIFY_NOT_BUILT_IN"];
  if (active) steps.push("SWITCH_FALLBACK");
  else steps.push("KEEP_ACTIVE");
  steps.push("UNREGISTER", "DELETE_PACKAGE", "VALIDATE_REMAINING");
  return {
    ok: true,
    steps,
    ...(active ? { fallbackThemeId: fallback as BuiltInThemeId } : {}),
    reason: active ? `deleting the active theme: switching to ${fallback} first` : "theme is not active: package and record can be removed directly"
  };
}

/* ------------------------------------------------------------------ *
 * §10/§9.1 rendering: tokens + surface overrides → CSS text
 * ------------------------------------------------------------------ */

/**
 * Renders the stylesheet a theme contributes. Token declarations go to `:root`;
 * surface overrides are emitted against the *observed bindings* of the surface
 * (from the CP3 UI Surface Registry), which is what lets a theme act on the real
 * UI without ever guessing a selector.
 */
export function renderThemeCss(
  pkg: Pick<ThemePackage, "tokens" | "overrides" | "css">,
  contracts: readonly UISurfaceContract[]
): string {
  const lines: string[] = [":root {"];
  for (const [name, value] of Object.entries(pkg.tokens ?? {})) lines.push(`  ${name}: ${value};`);
  lines.push("}", "");
  for (const override of pkg.overrides ?? []) {
    const contract = surfaceById(override.surface, contracts);
    if (!contract) continue;
    const selectors = contract.componentBindings.map((binding) => binding.value);
    if (!selectors.length) continue;
    lines.push(`${selectors.join(", ")} { ${override.property}: ${override.value}; }`);
  }
  if (pkg.css?.trim()) lines.push("", "/* theme stylesheet */", pkg.css.trim());
  return `${lines.join("\n")}\n`;
}

/** Deterministic content hash of a package (integrity + change detection). */
export function themePackageHash(pkg: ThemePackage): string {
  const orderedTokens = Object.keys(pkg.tokens ?? {}).sort().map((name) => `${name}=${pkg.tokens[name]}`);
  const orderedOverrides = [...(pkg.overrides ?? [])].map((entry) => `${entry.surface}|${entry.property}|${entry.value}`).sort();
  return contentHashOf([pkg.manifest?.id ?? "", pkg.manifest?.version ?? "", orderedTokens.join(";"), orderedOverrides.join(";"), pkg.css ?? ""].join("\u0000"));
}

/** Compact, shareable summary for the renderer/IPC surface. */
export interface ThemeSnapshot {
  activeThemeId: string;
  /** True when the active id is NOT what the user asked for (fallback happened). */
  fallback: boolean;
  activeName: string;
  tokens: ThemeTokens;
  css: string;
  themes: ThemeRecord[];
  diagnostics: string[];
}

/** Renderer-side placeholder before the first snapshot arrives. */
export const EMPTY_THEME_SNAPSHOT: ThemeSnapshot = {
  activeThemeId: DEFAULT_THEME_ID,
  fallback: false,
  activeName: "Dark",
  tokens: {},
  css: "",
  themes: [],
  diagnostics: []
};
