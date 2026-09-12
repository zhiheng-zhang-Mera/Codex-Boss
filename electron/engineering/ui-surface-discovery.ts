/**
 * Update-Plan/checkpoint-1.md §9 — UI surface discovery.
 *
 * The registry must describe the APPLICATION THAT EXISTS, not an idealised one:
 * §15 ("先看到 UI，再设计 Theme") and §9 ("不得让 AI 自己在代码里随意猜") both
 * mean a theme has to be handed stable, observed bindings. This module reads the
 * repository's real stylesheets and renderer sources and produces the §9.1
 * contract table filled with evidence:
 *
 *   - a binding is only recorded when its class/selector/token was OBSERVED in a
 *     real file, and the evidence string says which file matched what;
 *   - a surface with no observed binding is reported in `unbound` — never
 *     silently missing, never invented;
 *   - tokens that are not declared in any stylesheet are reported as
 *     `declared: false`, which is the honest state of this repository today (the
 *     `--boss-*` token layer arrives with the theme engine, CP4).
 */
import fs from "node:fs";
import path from "node:path";
import { writeJson, readJson } from "../commander/durable-json";
import {
  defaultSurfaceContracts,
  knownToken,
  summarizeUISurfaceRegistry,
  tokenGroupOf,
  UI_SURFACE_EXTRA_TOKENS,
  UI_TOKEN_GROUPS,
  UI_TOKEN_NAMES,
  UI_SURFACE_REGISTRY_VERSION,
  validateUISurfaceRegistry,
  type UISurfaceBinding,
  type UISurfaceContract,
  type UISurfaceId,
  type UISurfaceRegistry,
  type UISurfaceRegistryValidation,
  type UISurfaceTokenRecord
} from "../../src/shared/ui-surface";
import type { RepoWorldModel } from "../../src/shared/repo-world-model";

/** Observed-binding keywords per surface: real class names. */
const SURFACE_CLASS_CANDIDATES: Readonly<Record<UISurfaceId, readonly string[]>> = {
  APP_BACKGROUND: ["desktop-shell", "welcome-card"],
  SURFACE_PRIMARY: ["chat-half", "controller", "conversation", "welcome-card"],
  SURFACE_SECONDARY: ["runtime-overview", "task-technical-summary", "evidence-card", "runtime-status-grid"],
  SIDEBAR: ["history-sidebar", "history-content", "history-folder"],
  TOP_NAV: ["top-view-nav", "app-mode-switch", "chat-header", "header-status"],
  CARD: ["welcome-card", "evidence-card", "runtime-status-grid", "settings-panel"],
  MODAL: ["settings-backdrop", "settings-panel", "custom-provider-form"],
  INPUT: ["prompt-composer", "attachment-tray", "custom-provider-form", "history-conversation"],
  BUTTON_PRIMARY: ["composer-footer", "confirm-send", "attachment-add", "provider-toggle"],
  BUTTON_SECONDARY: ["history-actions", "history-toggle", "transport-toggle", "provider-remove", "settings-button"],
  TEXT_PRIMARY: ["user-message", "final-response", "boss-avatar", "welcome-card"],
  TEXT_SECONDARY: ["attachment-hint", "composer-footer", "picker-label", "workbook-status"],
  BORDER: ["history-sidebar", "top-view-nav", "composer-zone", "controller-resizer"],
  DIVIDER: ["history-toolbar", "chat-header", "browser-header", "avatar-divider"],
  ACCENT: ["app-brand", "workbook-status", "attachment-add"],
  SUCCESS: ["online", "runtime-available", "workspace-pill"],
  WARNING: ["runtime-busy", "runtime-rate_limited", "runtime-budget_exhausted", "drop-active"],
  DANGER: ["runtime-down", "workbook-blocked", "inline-error", "composer-block-reason"],
  SCROLLBAR: [],
  CODE_PANEL: ["final-response", "workbook-contract", "analysis-only-deliverable"],
  WORKSPACE_PANEL: ["browser-half", "browser-header", "view-detached"],
  AI_PANE: ["provider-choice", "provider-options", "provider-toggle"],
  STATUS_BADGE: ["workbook-status", "controller-pill", "workspace-pill", "picker-label", "attachment-kind"]
};

/**
 * Element/pseudo selectors a surface is bound to when the selector literally
 * appears in a stylesheet. Kept separate from class candidates because a
 * pseudo-element is not a class, and pretending otherwise would be false
 * evidence.
 */
const SURFACE_SELECTOR_CANDIDATES: Partial<Record<UISurfaceId, readonly string[]>> = {
  APP_BACKGROUND: ["body", "html"],
  TEXT_PRIMARY: [":root"],
  SCROLLBAR: ["::-webkit-scrollbar"],
  DIVIDER: ["hr"]
};

export type SourceKind = "STYLE" | "CODE" | "MARKUP";

/**
 * Class names genuinely observed in a file.
 *
 * The per-kind rules matter for honesty: a stylesheet's classes are selectors,
 * while a code file only declares classes through `className`, so scanning a
 * `.tsx` with a CSS-style dot pattern would turn `document.body` or `model.root`
 * into a fake "class". That is exactly the kind of invented binding §9 forbids.
 */
export function observedClassNames(content: string, kind: SourceKind): Set<string> {
  const names = new Set<string>();
  const add = (value: string): void => {
    for (const name of value.split(/\s+/)) {
      const cleaned = name.replace(/\$\{[^}]*\}/g, "").trim();
      if (/^-?[A-Za-z_][\w-]*$/.test(cleaned)) names.add(cleaned);
    }
  };
  if (kind === "STYLE") {
    // A selector-position dot: start of input, or after selector punctuation.
    for (const match of content.matchAll(/(?:^|[\s,{}>+~()])\.(-?[A-Za-z_][\w-]*)/g)) names.add(match[1]);
  }
  for (const match of content.matchAll(/class(?:Name)?\s*=\s*(?:\{\s*)?["'`]([^"'`]*)["'`]/g)) add(match[1]);
  for (const match of content.matchAll(/class(?:Name)?\s*=\s*\{\s*`([^`]*)`/g)) add(match[1]);
  return names;
}

export interface UISurfaceDiscoveryLimits {
  styleFiles: number;
  componentFiles: number;
  bytesPerFile: number;
}

export const DEFAULT_UI_DISCOVERY_LIMITS: UISurfaceDiscoveryLimits = { styleFiles: 40, componentFiles: 120, bytesPerFile: 512 * 1024 };

export interface UISurfaceDiscoveryResult {
  registry: UISurfaceRegistry;
  validation: UISurfaceRegistryValidation;
  /** Files actually read (evidence pointers). */
  read: string[];
  truncated: boolean;
}

/**
 * Discovers the app's UI surfaces from the repository model. Only files the
 * model already knows about are read, so discovery cannot wander outside the
 * workspace (§6 workspace boundaries, §20 filesystem escapes).
 */
export function discoverUISurfaces(
  model: Pick<RepoWorldModel, "root" | "modules" | "fingerprint">,
  options: { now?: () => string; limits?: Partial<UISurfaceDiscoveryLimits> } = {}
): UISurfaceDiscoveryResult {
  const limits = { ...DEFAULT_UI_DISCOVERY_LIMITS, ...(options.limits ?? {}) };
  const now = options.now ?? (() => new Date().toISOString());
  const styleFiles: string[] = [];
  const componentFiles: string[] = [];
  for (const module of model.modules) {
    if (module.kind === "STYLE") styleFiles.push(module.path);
    else if (module.kind === "MARKUP" || (module.kind === "SOURCE" && /\.(?:tsx|jsx|vue|svelte)$/.test(module.path))) componentFiles.push(module.path);
  }
  const read: string[] = [];
  let truncated = false;
  const classEvidence = new Map<string, UISurfaceBinding>();
  const selectorEvidence = new Map<string, UISurfaceBinding>();
  const tokenDeclarations = new Map<string, Set<string>>();

  const readFile = (relative: string): string | undefined => {
    try {
      const absolute = path.join(model.root, relative);
      const stat = fs.statSync(absolute);
      if (stat.size > limits.bytesPerFile) truncated = true;
      const handle = fs.openSync(absolute, "r");
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, limits.bytesPerFile));
        const readBytes = fs.readSync(handle, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, readBytes).toString("utf8");
      } finally { fs.closeSync(handle); }
    } catch {
      return undefined;
    }
  };

  const styleSelection = styleFiles.slice(0, limits.styleFiles);
  const componentSelection = componentFiles.slice(0, limits.componentFiles);
  if (styleSelection.length < styleFiles.length || componentSelection.length < componentFiles.length) truncated = true;

  for (const relative of [...styleSelection, ...componentSelection]) {
    const content = readFile(relative);
    if (content === undefined) continue;
    read.push(relative);
    const kind: SourceKind = styleSelection.includes(relative) ? "STYLE" : /\.(?:html?|vue|svelte)$/.test(relative) ? "MARKUP" : "CODE";
    for (const name of observedClassNames(content, kind)) {
      if (!classEvidence.has(name)) {
        classEvidence.set(name, {
          kind: "css-class",
          value: `.${name}`,
          file: relative,
          evidence: `class .${name} observed in ${relative}`
        });
      }
    }
    if (kind === "STYLE") {
      for (const [id, candidates] of Object.entries(SURFACE_SELECTOR_CANDIDATES) as Array<[UISurfaceId, readonly string[]]>) {
        for (const selector of candidates) {
          if (selectorEvidence.has(`${id}:${selector}`)) continue;
          if (!new RegExp(`(?:^|[\\s,{}>+~(])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "m").test(content)) continue;
          selectorEvidence.set(`${id}:${selector}`, {
            kind: "css-selector",
            value: selector,
            file: relative,
            evidence: `selector ${selector} observed in ${relative}`
          });
        }
      }
    }
    for (const match of content.matchAll(/(--boss-[a-z0-9-]+)\s*:/g)) {
      (tokenDeclarations.get(match[1]) ?? tokenDeclarations.set(match[1], new Set()).get(match[1])!).add(relative);
    }
  }

  const contracts: UISurfaceContract[] = defaultSurfaceContracts().map((contract) => {
    const bindings: UISurfaceBinding[] = [];
    for (const candidate of SURFACE_CLASS_CANDIDATES[contract.id]) {
      const evidence = classEvidence.get(candidate);
      if (evidence) bindings.push(evidence);
    }
    for (const selector of SURFACE_SELECTOR_CANDIDATES[contract.id] ?? []) {
      const evidence = selectorEvidence.get(`${contract.id}:${selector}`);
      if (evidence) bindings.push(evidence);
    }
    return { ...contract, componentBindings: bindings };
  });

  const tokens: UISurfaceTokenRecord[] = [...UI_TOKEN_NAMES, ...UI_SURFACE_EXTRA_TOKENS].map((name) => {
    const evidence = [...(tokenDeclarations.get(name) ?? new Set<string>())].sort();
    const group = tokenGroupOf(name) ?? (UI_SURFACE_EXTRA_TOKENS.includes(name) ? "extended" : "extended");
    return { name, group, declared: evidence.length > 0, evidence };
  });
  for (const name of tokenDeclarations.keys()) {
    if (tokens.some((token) => token.name === name)) continue;
    // A declared token the contract table does not know is surfaced, not hidden:
    // it means the stylesheet and the §10 vocabulary have diverged.
    tokens.push({ name, group: "extended", declared: true, evidence: [...tokenDeclarations.get(name)!].sort() });
  }

  const registry: UISurfaceRegistry = {
    schemaVersion: 1,
    version: UI_SURFACE_REGISTRY_VERSION,
    generated_at: now(),
    root: model.root,
    contracts,
    unbound: contracts.filter((contract) => contract.componentBindings.length === 0).map((contract) => contract.id),
    tokens: tokens.sort((a, b) => a.name.localeCompare(b.name)),
    tokens_applied: tokens.some((token) => token.declared && token.name.startsWith("--boss-")),
    style_files: styleSelection.slice().sort(),
    component_files: componentSelection.slice().sort()
  };
  return { registry, validation: validateUISurfaceRegistry(registry), read: read.slice().sort(), truncated };
}

/** Durable store for the discovered registry (one file, last write wins). */
export class UISurfaceRegistryStore {
  constructor(private readonly file: string) {}

  put(registry: UISurfaceRegistry): void {
    const validation = validateUISurfaceRegistry(registry);
    if (!validation.ok) {
      // Fail closed: an invalid registry must never be persisted as truth.
      throw new Error(`refusing to persist an invalid UI surface registry: ${validation.problems.join("; ")}`);
    }
    writeJson(this.file, registry);
    writeJson(this.file.replace(/\.json$/, ".summary.json"), summarizeUISurfaceRegistry(registry));
  }

  get(): UISurfaceRegistry | undefined {
    const registry = readJson<UISurfaceRegistry>(this.file);
    if (!registry || registry.schemaVersion !== 1) return undefined;
    return registry;
  }

  summary(): ReturnType<typeof summarizeUISurfaceRegistry> | undefined {
    const registry = this.get();
    return registry ? summarizeUISurfaceRegistry(registry) : undefined;
  }
}

/** True when this token name belongs to the §10 vocabulary (declared or not). */
export function isContractToken(token: string): boolean {
  return knownToken(token);
}
