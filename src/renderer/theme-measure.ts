/**
 * Update-Plan/checkpoint-1.md §26 — the renderer's half of visual regression.
 *
 * This module MEASURES: it walks the §9 surfaces and the required controls and
 * reports what the browser actually computed (boxes, colours, scroll metrics).
 * It makes no judgement — `src/shared/theme-visual-check.ts` decides — so the
 * acceptance evidence is a set of numbers, and the same numbers can be attached
 * to a report long after the run.
 */
import type { ControlMeasurement, SurfaceMeasurement, VisualCheckInput } from "../shared/theme-visual-check";
import type { UISurfaceId } from "../shared/ui-surface-ids";

/** The §9 surfaces the checker measures, bound to the stable selectors the
 *  registry promises (never an invented path). */
const SURFACE_SELECTORS: Array<{ surface: UISurfaceId; selector: string; showsText?: boolean }> = [
  { surface: "APP_BACKGROUND", selector: ".desktop-shell" },
  { surface: "SURFACE_PRIMARY", selector: ".chat-half", showsText: true },
  { surface: "SURFACE_SECONDARY", selector: ".runtime-overview" },
  { surface: "SIDEBAR", selector: ".history-sidebar" },
  { surface: "TOP_NAV", selector: ".top-view-nav" },
  { surface: "CARD", selector: ".welcome-card" },
  { surface: "MODAL", selector: ".settings-panel" },
  { surface: "INPUT", selector: ".prompt-composer textarea", showsText: true },
  { surface: "BUTTON_PRIMARY", selector: ".attachment-add" },
  { surface: "BUTTON_SECONDARY", selector: ".history-toggle" },
  { surface: "TEXT_PRIMARY", selector: ".user-message p", showsText: true },
  { surface: "TEXT_SECONDARY", selector: ".composer-footer span", showsText: true },
  { surface: "CODE_PANEL", selector: ".final-response pre" },
  { surface: "WORKSPACE_PANEL", selector: ".browser-half" },
  { surface: "AI_PANE", selector: ".provider-options" },
  { surface: "STATUS_BADGE", selector: ".controller-pill" }
];

const CONTROL_SELECTORS: Array<{ id: string; selector: string }> = [
  { id: "composer", selector: ".prompt-composer" },
  { id: "submit", selector: ".prompt-composer button[type=\"submit\"]" },
  { id: "attachment-tray", selector: ".attachment-tray" },
  { id: "view-nav", selector: ".top-view-nav" }
];

function alphaOf(colour: string): number {
  const rgba = /rgba?\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+\s*[,/]?\s*([\d.]+)?\s*\)/i.exec(colour);
  if (rgba) return rgba[1] === undefined ? 1 : Number(rgba[1]);
  return 1;
}

function isTransparent(colour: string): boolean {
  return colour === "transparent" || /rgba\([^)]*,\s*0\s*\)/.test(colour) || alphaOf(colour) === 0;
}

/** True when every ancestor up to <body> is also transparent (nothing behind). */
function transparentOverTransparent(element: Element): boolean {
  let node: Element | null = element;
  while (node && node !== document.documentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (!isTransparent(colour)) return false;
    node = node.parentElement;
  }
  return true;
}

/** Measures one surface; a missing element is reported as absent, not skipped. */
export function measureSurface(surface: UISurfaceId, selector: string, showsText = false): SurfaceMeasurement {
  const element = document.querySelector(selector);
  if (!element) return { surface, present: false, visible: false, width: 0, height: 0 };
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.01 && rect.width > 0 && rect.height > 0;
  const measurement: SurfaceMeasurement = {
    surface,
    present: true,
    visible,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    background: style.backgroundColor
  };
  if (showsText) {
    const textTarget = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement ? element : element;
    measurement.color = getComputedStyle(textTarget).color;
  }
  const overflowing = element.scrollHeight > element.clientHeight + 2;
  measurement.overflowY = overflowing;
  measurement.scrollable = !overflowing || ["auto", "scroll"].includes(style.overflowY) || style.overflowY === "overlay";
  if (isTransparent(style.backgroundColor) && element.textContent?.trim() && transparentOverTransparent(element)) {
    measurement.transparentOverTransparent = true;
  }
  return measurement;
}

function measureControl(id: string, selector: string): ControlMeasurement {
  const element = document.querySelector(selector);
  if (!element) return { id, present: false, visible: false, enabled: false, width: 0, height: 0 };
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return {
    id,
    present: true,
    visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.01 && rect.width > 0 && rect.height > 0,
    enabled: !(element as HTMLButtonElement).disabled,
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

/** Full measurement payload for the current document (§26). */
export function measureForVisualCheck(themeId: string): VisualCheckInput {
  return {
    themeId,
    surfaces: SURFACE_SELECTORS.map((entry) => measureSurface(entry.surface, entry.selector, entry.showsText)),
    controls: CONTROL_SELECTORS.map((entry) => measureControl(entry.id, entry.selector)),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    }
  };
}
