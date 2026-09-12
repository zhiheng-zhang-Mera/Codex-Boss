/**
 * Update-Plan/checkpoint-1.md §10/§21 — renderer-side theme application.
 *
 * The main process owns the registry, the validator and the activation decision;
 * the renderer only APPLIES what it is handed: the active theme's semantic tokens
 * (as `:root` custom properties) plus the stylesheet the engine rendered from the
 * §9 surface bindings.
 *
 * §21 runtime safety: applying a theme must be reversible and must never be able
 * to break the界面. Everything here is pure DOM work on a single dedicated
 * `<style>` element, so removing it restores the shipped appearance exactly, and
 * a malformed payload is rejected before it touches the document.
 */
import type { ThemeSnapshot } from "../shared/theme";

export const THEME_STYLE_ELEMENT_ID = "boss-theme";

/** Owns the one `<style>` element the active theme is written into. */
function styleElement(doc: Document): HTMLStyleElement {
  const existing = doc.getElementById(THEME_STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  const element = doc.createElement("style");
  element.id = THEME_STYLE_ELEMENT_ID;
  element.setAttribute("data-boss-theme", "pending");
  doc.head.appendChild(element);
  return element;
}

/**
 * Applies a theme snapshot. Returns a small, checkable result instead of
 * throwing, so the caller can surface a failure without crashing the renderer.
 */
export function applyTheme(snapshot: Pick<ThemeSnapshot, "activeThemeId" | "css">, doc: Document = document): { applied: boolean; themeId: string; cssLength: number; reason?: string } {
  if (!snapshot || typeof snapshot.css !== "string") return { applied: false, themeId: "", cssLength: 0, reason: "theme snapshot has no stylesheet" };
  const css = snapshot.css;
  // A theme can never smuggle executable content in (§20/§59) — the main process
  // already validated it; this is the renderer's own last line of defence.
  if (/<\s*\/?\s*script|javascript\s*:|expression\s*\(/i.test(css)) {
    return { applied: false, themeId: snapshot.activeThemeId, cssLength: 0, reason: "theme stylesheet contains executable content" };
  }
  const element = styleElement(doc);
  element.textContent = css;
  element.setAttribute("data-boss-theme", snapshot.activeThemeId || "unknown");
  return { applied: true, themeId: snapshot.activeThemeId, cssLength: css.length };
}

/** Reads back the theme state of the document (used by the acceptance smoke). */
export function appliedTheme(doc: Document = document): { themeId: string | undefined; token: string } {
  const element = doc.getElementById(THEME_STYLE_ELEMENT_ID);
  const styles = doc.defaultView?.getComputedStyle(doc.documentElement);
  return {
    themeId: element?.getAttribute("data-boss-theme") ?? undefined,
    token: styles?.getPropertyValue("--boss-bg-root").trim() ?? ""
  };
}

/** Removes the theme layer entirely, restoring the shipped appearance. */
export function clearTheme(doc: Document = document): void {
  doc.getElementById(THEME_STYLE_ELEMENT_ID)?.remove();
}
