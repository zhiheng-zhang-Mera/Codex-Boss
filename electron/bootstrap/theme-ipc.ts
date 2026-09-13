import type { BootModule, IpcRegistrar } from "./boot-module";
import { generateThemeDraft } from "../../src/shared/theme-generation";
import { parseThemeIntent, requiresUiEngineering, type ThemeIntent } from "../../src/shared/theme-intent";
import { themePackageHash, type ThemeGenerationOutcome, type ThemePreviewView } from "../../src/shared/theme";
import { checkThemeVisuals, type VisualCheckInput } from "../../src/shared/theme-visual-check";
import type { ThemePreviewState, ThemeService } from "../theme/theme-service";

/**
 * Theme IPC (convergence book, Phase F/G).
 *
 * Thirteen channels: the theme list and its lifecycle, and the one prompt →
 * intent → draft → preview cycle. Nothing here installs or activates on its own —
 * the draft lives in the preview sandbox until the user accepts or cancels it.
 *
 * This is the first slice whose orchestration is genuinely long, so it is worth
 * stating what stayed behind and why:
 *
 *   - **The UI-surface registry** (`ensureUiSurfaces`) stays in the composition root
 *     because the `ThemeService` is constructed with it as well; the module asks for
 *     contracts rather than owning the cache.
 *   - **The capture machinery** stays because it needs a `BrowserWindow` and
 *     `WebContents`, and a boot module must never import Electron. The module asks
 *     for a capture and receives plain frame records.
 *   - **Where the capture directory lives** is likewise the composition root's
 *     business (`app.getPath`).
 *
 * What moved is the part that was only a closure over the composition root: the
 * §19 escalation branch, the §15 base-package requirement, the §24 knowledge
 * recording, the preview revision loop and its remembered intent.
 */

/** The domain events this module publishes, named so the surface stays narrow. */
export interface ThemeEvent {
  type: "THEME_ACTIVATED" | "THEME_FALLBACK" | "THEME_INSTALLED" | "THEME_VALIDATED" | "THEME_DRAFT_CREATED" | "THEME_PREVIEWED";
  message: string;
}

export type GenerateInput = Parameters<typeof generateThemeDraft>[0];

/**
 * The service methods these channels actually use, derived from the service's own
 * type rather than re-declared: a renamed or re-signatured method breaks the module
 * at compile time instead of drifting silently.
 */
export type ThemeSurface = Pick<
  ThemeService,
  "snapshot" | "activate" | "duplicate" | "delete" | "validate" | "packageOf" | "startPreview" | "preview" | "acceptPreview" | "cancelPreview"
>;

/** One capture run, flattened so the module never sees a WebContents. */
export interface ThemeCaptureResult {
  frames: Array<{ surface: string; file: string; bytes: number }>;
  skipped: unknown;
  directory: string;
  /** The sanitized one-line summary the draft records, if any. */
  summary: string;
}

export interface ThemeIpcDeps {
  handle: IpcRegistrar["handle"];
  themes: ThemeSurface;
  events: { publish(event: ThemeEvent): void };
  /** The locked/derived UI surface contracts the generator validates against. */
  uiContracts(): GenerateInput["contracts"];
  /** Captures the current interface; the Electron-facing half lives in the root. */
  capture(): Promise<ThemeCaptureResult>;
  /** §24: durability of the intent/decisions; a failure must not fail the draft. */
  recordKnowledge(input: {
    intent: ThemeIntent;
    packageId: string;
    packageHash: string;
    pkg: unknown;
    validation: unknown;
    observedAt: string;
    feedback?: string;
    captureSummary?: string;
  }): void;
  /** §26: where the numbers that decided are kept. */
  persistVisualReport(report: unknown): void;
}

export const THEME_IPC_CHANNELS = [
  "boss:theme-snapshot",
  "boss:theme-activate",
  "boss:theme-duplicate",
  "boss:theme-delete",
  "boss:theme-restore-default",
  "boss:theme-validate",
  "boss:theme-generate",
  "boss:theme-preview",
  "boss:theme-preview-revise",
  "boss:theme-preview-accept",
  "boss:theme-preview-cancel",
  "boss:theme-capture",
  "boss:theme-visual-check"
] as const;

/** The default a fresh installation falls back to. */
export const DEFAULT_THEME_ID = "builtin-dark";

/** The preview as the renderer reads it: diagnostics split by severity, as text. */
export function toPreviewView(preview: ThemePreviewState): ThemePreviewView {
  return {
    id: preview.id,
    name: preview.name,
    prompt: preview.prompt,
    intent: preview.intent,
    decisions: preview.decisions,
    revisions: preview.revisions,
    valid: preview.valid,
    css: preview.css,
    tokens: preview.tokens,
    errors: preview.validation.diagnostics.filter((entry) => entry.severity === "ERROR").map((entry) => `${entry.rule}: ${entry.message}`),
    warnings: preview.validation.diagnostics.filter((entry) => entry.severity === "WARN").map((entry) => `${entry.rule}: ${entry.message}`),
    createdAt: preview.createdAt
  };
}

export function createThemeIpcModule(deps: ThemeIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:theme-snapshot", () => deps.themes.snapshot());

  on("boss:theme-activate", (_event, themeId: string) => {
    const result = deps.themes.activate(themeId);
    deps.events.publish({ type: result.ok ? "THEME_ACTIVATED" : "THEME_FALLBACK", message: `theme ${themeId}: ${result.reason}` });
    return deps.themes.snapshot();
  });

  on("boss:theme-duplicate", (_event, sourceId: string, input: { id: string; name: string }) => {
    const safeId = `custom-${String(input?.id ?? "").replace(/^custom-/, "").replace(/[^a-z0-9._-]/gi, "").toLowerCase().slice(0, 48)}`;
    const result = deps.themes.duplicate(sourceId, { id: safeId, name: String(input?.name ?? safeId).slice(0, 60) });
    if (!result.ok) throw new Error(result.reason);
    deps.events.publish({ type: "THEME_INSTALLED", message: `theme ${result.themeId} installed from ${sourceId}` });
    return deps.themes.snapshot();
  });

  on("boss:theme-delete", (_event, themeId: string) => {
    const result = deps.themes.delete(themeId);
    if (!result.ok) throw new Error(result.reason);
    return deps.themes.snapshot();
  });

  on("boss:theme-restore-default", () => {
    deps.themes.activate(DEFAULT_THEME_ID);
    return deps.themes.snapshot();
  });

  on("boss:theme-validate", (_event, themeId: string) => deps.themes.validate(themeId));

  /** §14/§15/§17/§19/§24 — one prompt → intent → draft → preview cycle. */
  let lastIntent: ThemeIntent | undefined;
  const draft = async (input: { prompt: string; name?: string; capture?: boolean; previous?: ThemeIntent; feedback?: string }): Promise<ThemeGenerationOutcome> => {
    // §19: a layout/behaviour request is not a theme task.
    const intent = parseThemeIntent(input.prompt, input.previous ? { previous: input.previous } : {});
    if (requiresUiEngineering(intent)) {
      const reason = `该请求属于界面工程（布局/行为）而非主题：${intent.escalations.map((entry) => `${entry.phrase} — ${entry.reason}`).join("；")}`;
      deps.events.publish({ type: "THEME_VALIDATED", message: `theme request escalated to UI engineering: ${intent.escalations[0]?.phrase ?? ""}` });
      return {
        ok: false, escalated: true, reason, prompt: intent.prompt,
        references: intent.references.map((entry) => entry.value), decisions: [], repairs: [], snapshot: deps.themes.snapshot()
      } as ThemeGenerationOutcome;
    }
    // §16: capture the current interface (sanitized) before designing.
    let captureSummary: string | undefined;
    if (input.capture !== false) {
      captureSummary = (await deps.capture()).summary;
    }
    // §15: the generator always starts from the theme the user is looking at.
    const basePackage = deps.themes.packageOf(deps.themes.snapshot().activeThemeId);
    if (!basePackage) {
      return { ok: false, escalated: false, reason: "当前主题包不可读，无法生成（§15 要求先看到当前 UI 与 token）", prompt: intent.prompt, references: [], decisions: [], repairs: [], snapshot: deps.themes.snapshot() } as ThemeGenerationOutcome;
    }
    const draftId = input.name
      ? `custom-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)}-${Date.now().toString(36).slice(-4)}`
      : `custom-${Date.now().toString(36)}`;
    const generated = generateThemeDraft({
      intent,
      base: { tokens: basePackage.tokens, overrides: basePackage.overrides },
      contracts: deps.uiContracts(),
      id: draftId,
      name: input.name?.trim() || `主题 ${new Date().toISOString().slice(5, 16)}`,
      now: new Date().toISOString(),
      ...(captureSummary ? { captureSummary } : {})
    });
    const preview = deps.themes.startPreview(generated.pkg, {
      intent: generated.interpretation,
      decisions: generated.decisions.length,
      prompt: intent.prompt,
      ...(captureSummary ? { captureSummary } : {})
    });
    lastIntent = intent;
    // §24: record the intent, the decisions and the validation outcome durably — the
    // sanitized frames themselves stay in the capture directory, never in knowledge.
    try {
      deps.recordKnowledge({
        intent,
        packageId: generated.pkg.manifest.id,
        packageHash: themePackageHash(generated.pkg),
        pkg: generated.pkg,
        validation: preview.validation,
        observedAt: new Date().toISOString(),
        ...(input.feedback ? { feedback: input.feedback } : {}),
        ...(captureSummary ? { captureSummary } : {})
      });
    } catch (error) {
      // Knowledge is the durable record, not the draft: losing it must not lose the
      // preview the user is about to look at.
      console.warn("[theme] knowledge recording degraded", error);
    }
    deps.events.publish({ type: "THEME_DRAFT_CREATED", message: `theme draft ${generated.pkg.manifest.id} from ${generated.decisions.length} decision(s)` });
    deps.events.publish({ type: "THEME_PREVIEWED", message: `theme preview ${generated.pkg.manifest.id} valid=${preview.valid}` });
    return {
      ok: preview.valid,
      escalated: false,
      reason: preview.valid ? `预览已生成：${generated.interpretation}` : `草稿未通过校验：${preview.validation.diagnostics.filter((entry) => entry.severity === "ERROR").map((entry) => entry.message).slice(0, 3).join("; ")}`,
      prompt: intent.prompt,
      references: intent.references.map((entry) => entry.value),
      decisions: generated.decisions.map((entry) => `${entry.token} = ${entry.value} (${entry.rule})`),
      repairs: generated.repairs,
      ...(captureSummary ? { captureSummary } : {}),
      preview: toPreviewView(preview),
      snapshot: deps.themes.snapshot()
    };
  };

  on("boss:theme-generate", (_event, input: { prompt: string; name?: string; capture?: boolean }) => draft(input));

  on("boss:theme-preview", () => {
    const preview = deps.themes.preview();
    return preview ? toPreviewView(preview) : undefined;
  });

  on("boss:theme-preview-revise", (_event, input: { feedback: string }) => {
    const pending = deps.themes.preview();
    if (!pending) throw new Error("当前没有待预览的主题草稿");
    return draft({
      prompt: `${pending.prompt}\n${input.feedback}`,
      name: pending.name,
      capture: false,
      ...(lastIntent ? { previous: lastIntent } : {}),
      feedback: input.feedback
    });
  });

  on("boss:theme-preview-accept", (_event, input: { activate?: boolean }) => {
    const result = deps.themes.acceptPreview({ activate: input?.activate !== false });
    if (!result.ok) throw new Error(result.reason);
    deps.events.publish({ type: "THEME_INSTALLED", message: `theme ${result.themeId} installed from a preview` });
    return deps.themes.snapshot();
  });

  on("boss:theme-preview-cancel", () => {
    const result = deps.themes.cancelPreview();
    // Cancelling with nothing pending is the state the caller asked for, not a failure.
    if (!result.ok && result.reason !== "no preview is pending") throw new Error(result.reason);
    return deps.themes.snapshot();
  });

  on("boss:theme-capture", async () => {
    const result = await deps.capture();
    return { frames: result.frames, skipped: result.skipped, directory: result.directory };
  });

  on("boss:theme-visual-check", (_event, input: VisualCheckInput) => {
    const report = checkThemeVisuals(input, { now: new Date().toISOString() });
    deps.persistVisualReport(report);
    return report;
  });

  return {
    service: { channels: THEME_IPC_CHANNELS },
    health: () => ({
      module: "theme-ipc",
      status: registered.length === THEME_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${THEME_IPC_CHANNELS.length} theme channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
