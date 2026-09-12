/**
 * Update-Plan/checkpoint-1.md §26 — Theme visual regression.
 *
 * The plan is explicit that "CSS compiled" is not acceptance: a theme must be
 * checked on what a person actually sees — major surfaces visible, text
 * readable, controls visible, modal usable, sidebar usable, input usable,
 * scrolling usable, no catastrophic overflow, no transparent-on-transparent
 * failure.
 *
 * The split is deliberate: the RENDERER measures (computed styles, boxes,
 * scroll metrics) and this module DECIDES, so the judgement is deterministic,
 * testable and the evidence is a set of numbers rather than an opinion. Nothing
 * here observes pixels; it observes the browser's own layout and colour results.
 */
import { contrastRatio } from "./theme";
import type { UISurfaceId } from "./ui-surface-ids";

export const VISUAL_CHECK_VERSION = "theme-visual-check-1" as const;

export const VISUAL_RULES = [
  "MAJOR_SURFACE_VISIBLE",
  "TEXT_READABLE",
  "CONTROLS_VISIBLE",
  "MODAL_USABLE",
  "SIDEBAR_USABLE",
  "INPUT_USABLE",
  "SCROLLING_USABLE",
  "NO_CATASTROPHIC_OVERFLOW",
  "NO_TRANSPARENT_ON_TRANSPARENT"
] as const;
export type VisualRuleId = (typeof VISUAL_RULES)[number];

export interface SurfaceMeasurement {
  surface: UISurfaceId;
  /** The element exists in the DOM. */
  present: boolean;
  /** It has a non-zero box and is not display:none/visibility:hidden/opacity:0. */
  visible: boolean;
  width: number;
  height: number;
  /** Computed text colour of the first text node, when the surface shows text. */
  color?: string;
  /** Computed background colour of the surface itself. */
  background?: string;
  /** True when the surface carries a non-opaque background over nothing opaque. */
  transparentOverTransparent?: boolean;
  /** Vertical scrolling is available where the content overflows. */
  scrollable?: boolean;
  overflowY?: boolean;
}

export interface ControlMeasurement {
  id: string;
  present: boolean;
  visible: boolean;
  enabled: boolean;
  width: number;
  height: number;
}

export interface VisualCheckInput {
  themeId: string;
  surfaces: SurfaceMeasurement[];
  controls: ControlMeasurement[];
  viewport: { width: number; height: number; scrollWidth: number; scrollHeight: number };
  /** Surfaces the check treats as major (defaulted per rule below). */
  majorSurfaces?: UISurfaceId[];
}

export interface VisualFinding {
  rule: VisualRuleId;
  severity: "ERROR" | "WARN" | "INFO";
  message: string;
  surface?: string;
}

export interface VisualCheckReport {
  version: typeof VISUAL_CHECK_VERSION;
  themeId: string;
  ok: boolean;
  findings: VisualFinding[];
  contrast: { surface: string; color: string; background: string; ratio: number; required: number; ok: boolean }[];
  checkedAt: string;
}

/** Surfaces that must be visible for the product to be usable at all. */
export const DEFAULT_MAJOR_SURFACES: readonly UISurfaceId[] = ["APP_BACKGROUND", "SURFACE_PRIMARY", "WORKSPACE_PANEL", "TOP_NAV"];

/** Controls whose presence is part of §26's "controls visible / input usable". */
export const REQUIRED_CONTROL_IDS = ["composer", "submit", "attachment-tray", "view-nav"] as const;

export function checkThemeVisuals(input: VisualCheckInput, options: { now?: string } = {}): VisualCheckReport {
  const findings: VisualFinding[] = [];
  const contrast: VisualCheckReport["contrast"] = [];
  const byId = new Map(input.surfaces.map((entry) => [entry.surface, entry]));
  const push = (rule: VisualRuleId, severity: VisualFinding["severity"], message: string, surface?: string): void => {
    findings.push(surface ? { rule, severity, message, surface } : { rule, severity, message });
  };

  /* §26 major surface visible */
  for (const surface of input.majorSurfaces ?? DEFAULT_MAJOR_SURFACES) {
    const measured = byId.get(surface);
    if (!measured || !measured.present) { push("MAJOR_SURFACE_VISIBLE", "ERROR", `${surface} is not present after applying the theme`, surface); continue; }
    if (!measured.visible || measured.width < 24 || measured.height < 16) {
      push("MAJOR_SURFACE_VISIBLE", "ERROR", `${surface} is not visible (${measured.width}×${measured.height}, visible=${measured.visible})`, surface);
    }
  }

  /* §26 text readable — measured contrast, not a claim */
  for (const measured of input.surfaces) {
    if (!measured.color || !measured.background) continue;
    const ratio = contrastRatio(measured.color, measured.background);
    if (ratio === undefined) {
      push("TEXT_READABLE", "WARN", `${measured.surface} contrast could not be measured (${measured.color} on ${measured.background})`, measured.surface);
      continue;
    }
    const required = measured.surface === "TEXT_SECONDARY" || measured.surface === "STATUS_BADGE" ? 3 : 4.5;
    const ok = ratio >= required;
    contrast.push({ surface: measured.surface, color: measured.color, background: measured.background, ratio, required, ok });
    if (!ok) push("TEXT_READABLE", ratio < 3 ? "ERROR" : "WARN", `${measured.surface} text is ${ratio.toFixed(2)}:1, below ${required}:1`, measured.surface);
  }

  /* §26 controls visible / input usable */
  const controlIds = new Set(input.controls.map((entry) => entry.id));
  for (const required of REQUIRED_CONTROL_IDS) {
    const measured = input.controls.find((entry) => entry.id === required);
    if (!measured || !measured.present) { push("CONTROLS_VISIBLE", "ERROR", `${required} is missing after applying the theme`); continue; }
    if (!measured.visible || measured.width < 8 || measured.height < 8) {
      push("CONTROLS_VISIBLE", "ERROR", `${required} is not usable (${measured.width}×${measured.height}, visible=${measured.visible})`);
    }
    if (!measured.enabled) push("CONTROLS_VISIBLE", "WARN", `${required} is present but disabled`);
  }
  if (controlIds.has("composer") && !controlIds.has("submit")) push("INPUT_USABLE", "WARN", "the composer is present without a submit control");

  /* §26 sidebar / modal usability */
  const sidebar = byId.get("SIDEBAR");
  if (sidebar?.present && (sidebar.width < 120 || sidebar.height < 80)) {
    push("SIDEBAR_USABLE", "ERROR", `the sidebar collapsed to ${sidebar.width}×${sidebar.height}`, "SIDEBAR");
  }
  const modal = byId.get("MODAL");
  if (modal?.present && (modal.width < 200 || modal.height < 120)) {
    push("MODAL_USABLE", "ERROR", `the modal collapsed to ${modal.width}×${modal.height}`, "MODAL");
  }

  /* §26 scrolling usable */
  for (const measured of input.surfaces) {
    if (!measured.present || !measured.overflowY) continue;
    if (!measured.scrollable) push("SCROLLING_USABLE", "WARN", `${measured.surface} overflows but cannot scroll`, measured.surface);
  }

  /* §26 no catastrophic overflow */
  const growth = input.viewport.scrollWidth - input.viewport.width;
  if (input.viewport.scrollWidth > input.viewport.width + 24) {
    push("NO_CATASTROPHIC_OVERFLOW", growth > 200 ? "ERROR" : "WARN", `the page is ${growth}px wider than the viewport after applying the theme`);
  }

  /* §26 no transparent-on-transparent failure */
  for (const measured of input.surfaces) {
    if (measured.transparentOverTransparent) {
      push("NO_TRANSPARENT_ON_TRANSPARENT", "ERROR", `${measured.surface} renders transparent text background over a transparent parent`, measured.surface);
    }
  }

  return {
    version: VISUAL_CHECK_VERSION,
    themeId: input.themeId,
    ok: findings.every((entry) => entry.severity !== "ERROR"),
    findings,
    contrast,
    checkedAt: options.now ?? new Date(0).toISOString()
  };
}
