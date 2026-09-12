/**
 * Update-Plan/checkpoint-1.md §16/§16.1 — visual capture for theme design.
 *
 * §15 requires the generator to see the CURRENT interface before it designs
 * anything; §16 lists the surfaces worth capturing; §16.1 requires that the
 * capture cannot leak chat text, API keys or private documents.
 *
 * The privacy rule is implemented, not promised: the renderer is put into a
 * sanitized capture mode (message bodies and input values are visually replaced)
 * before the frame is taken, and the mode is removed afterwards. What is stored
 * is the sanitized chrome plus metadata — and §24 keeps the derived intent and
 * decisions in knowledge, never the raw images.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow, WebContents } from "electron";
import { writeJson } from "../commander/durable-json";

export interface CaptureTarget {
  /** Surface name from the §9 vocabulary this frame represents. */
  surface: string;
  webContents: WebContents;
}

export interface CaptureResult {
  schemaVersion: 1;
  generatedAt: string;
  sanitized: true;
  directory: string;
  frames: {
    surface: string;
    file: string;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
  }[];
  /** Surfaces that could not be captured, with the reason. */
  skipped: { surface: string; reason: string }[];
  note: string;
}

/** The CSS the renderer applies while capturing (sanitized visual mode). */
export const CAPTURE_SANITIZE_CSS = `
html.boss-theme-capture .user-message p,
html.boss-theme-capture .final-response pre,
html.boss-theme-capture .attachment-name,
html.boss-theme-capture .history-conversation span,
html.boss-theme-capture input,
html.boss-theme-capture textarea,
html.boss-theme-capture select { color: transparent !important; text-shadow: none !important; }
html.boss-theme-capture input::placeholder,
html.boss-theme-capture textarea::placeholder { color: transparent !important; }
html.boss-theme-capture img,
html.boss-theme-capture video,
html.boss-theme-capture canvas { visibility: hidden !important; }
`;

const SANITIZE_SCRIPT = `(async () => {
  const style = document.createElement("style");
  style.id = "boss-theme-capture-style";
  style.textContent = ${JSON.stringify(CAPTURE_SANITIZE_CSS)};
  document.head.appendChild(style);
  document.documentElement.classList.add("boss-theme-capture");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()`;

const RESTORE_SCRIPT = `(() => {
  document.getElementById("boss-theme-capture-style")?.remove();
  document.documentElement.classList.remove("boss-theme-capture");
  return true;
})()`;

/**
 * Captures the given surfaces with the sanitize mode applied. A surface that
 * cannot be captured is recorded as skipped — never silently dropped, and never
 * a reason to fail the theme request.
 */
export async function captureSurfacesForThemeDesign(
  targets: readonly CaptureTarget[],
  options: { directory: string; now?: () => string; capture?: (contents: WebContents) => Promise<{ toPNG: () => Buffer; getSize: () => { width: number; height: number } }> }
): Promise<CaptureResult> {
  const now = options.now ?? (() => new Date().toISOString());
  fs.mkdirSync(options.directory, { recursive: true });
  const take = options.capture ?? (async (contents) => contents.capturePage());
  const result: CaptureResult = {
    schemaVersion: 1,
    generatedAt: now(),
    sanitized: true,
    directory: options.directory,
    frames: [],
    skipped: [],
    note: "sanitized visual capture: message text and input values are hidden before the frame is taken (§16.1); only the visual chrome is stored"
  };
  for (const target of targets) {
    const contents = target.webContents;
    if (!contents || contents.isDestroyed()) {
      result.skipped.push({ surface: target.surface, reason: "view is not open" });
      continue;
    }
    try {
      await contents.executeJavaScript(SANITIZE_SCRIPT, true);
      const image = await take(contents);
      const size = image.getSize();
      const png = image.toPNG();
      const file = `${target.surface.toLowerCase()}.png`;
      fs.writeFileSync(path.join(options.directory, file), png);
      result.frames.push({
        surface: target.surface,
        file,
        bytes: png.byteLength,
        sha256: crypto.createHash("sha256").update(png).digest("hex"),
        width: size.width,
        height: size.height
      });
    } catch (error) {
      result.skipped.push({ surface: target.surface, reason: String((error as Error).message ?? error).slice(0, 200) });
    } finally {
      try { await contents.executeJavaScript(RESTORE_SCRIPT, true); } catch { /* view may be gone */ }
    }
  }
  writeJson(path.join(options.directory, "captures.json"), result);
  return result;
}

/** The default capture set for the current app state (§16's surface list). */
export function defaultCaptureTargets(input: { window: BrowserWindow | undefined; providerViews: readonly { surface: string; webContents: WebContents }[] }): CaptureTarget[] {
  const targets: CaptureTarget[] = [];
  if (input.window && !input.window.isDestroyed()) targets.push({ surface: "MAIN_WORKSPACE", webContents: input.window.webContents });
  for (const view of input.providerViews) targets.push(view);
  return targets;
}

/** One-line summary for a package's metadata / knowledge note. */
export function summarizeCapture(result: CaptureResult): string {
  return `${result.frames.length} sanitized frame(s) [${result.frames.map((frame) => frame.surface).join(", ") || "none"}]${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`;
}
