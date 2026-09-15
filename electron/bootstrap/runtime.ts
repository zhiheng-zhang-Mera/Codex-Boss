import type { BootModule } from "./boot-module";

/**
 * The controller window's lifecycle (convergence book, Phase F).
 *
 * The composition root used to decide all of this inline, in a `createMainWindow`
 * plus two `app.on` handlers, which meant the window's *policy* — whether it renders
 * offscreen, where the renderer comes from, what happens when the platform asks for
 * a window again, and what a close tears down — had no test and no owner.
 *
 * Three deliberate limits, because each one is a place this module could have
 * become something worse than the code it replaces:
 *
 *  - **it does not import Electron.** The window is created by a factory the
 *    composition root supplies, and the module is generic in the window type, so
 *    the root still hands the REAL `BrowserWindow` to the dialog, the theme capture
 *    and the renderer-state view. Nothing is widened to `unknown` to make that work.
 *  - **it does not own the application.** `window-all-closed` stays in the root: it
 *    disposes services and decides whether to quit, which is application policy.
 *    This module owns one window and the two events that ask for one.
 *  - **it never creates a second window by accident.** `create()` is idempotent
 *    while a window exists, and `activate` only recreates when the platform reports
 *    none — the platform's count, not this module's belief about it.
 *
 * The process roots (`runtimeRoots`, `app.setPath`, the instance lock, the legacy
 * migrations) deliberately stay in the composition root: they are `app.*` calls
 * that must run before any module can exist, and injecting a ten-method
 * application surface to move them would be a service locator, which the book
 * forbids.
 */

/** The window options this module decides, structurally compatible with Electron's own. */
export interface BossWindowOptions {
  show: boolean;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  title: string;
  backgroundColor: string;
  titleBarStyle: "hiddenInset";
  autoHideMenuBar: boolean;
  webPreferences: {
    offscreen: boolean;
    backgroundThrottling: boolean;
    contextIsolation: boolean;
    nodeIntegration: boolean;
    sandbox: boolean;
    preload: string;
  };
}

/**
 * What this module itself does with a window. Deliberately small: everything else a
 * caller needs from the window is that caller's business, which is what lets the
 * module stay generic over the real Electron type.
 */
export interface RuntimeWindow {
  loadURL(url: string): unknown;
  loadFile(file: string): unknown;
  on(event: "closed", listener: () => void): unknown;
  webContents: {
    on(event: "did-fail-load", listener: (event: unknown, code: number, description: string, url: string) => void): unknown;
  };
}

interface RuntimeOptions<W extends RuntimeWindow> {
  /** Creates the window. The composition root owns the Electron constructor. */
  createWindow(options: BossWindowOptions): W;
  /** Absolute path of the preload script. */
  preloadPath: string;
  /** Absolute path of the built renderer entry (`dist/index.html`). */
  rendererFile: string;
  /** The dev server to load instead, when one is running. */
  devServerUrl?: string;
  /** Render offscreen and hidden: the smoke and WorkBook acceptance entries. */
  offscreen: boolean;
  /**
   * Whether the window should be shown at all. Separate from `offscreen`, because a
   * headless research run still needs a real (hidden) window for provider panes.
   */
  show: boolean;
  /** Registers an application-level event. The root passes Electron's `app.on`. */
  onAppEvent(event: "second-instance" | "activate", listener: () => void): void;
  /** How many windows the application currently has, asked of the platform. */
  openWindowCount(): number;
  /** A window was created and wired; the root mirrors it for its own consumers. */
  onCreated?(window: W): void;
  /** The window closed. The root tears down whatever hung off it. */
  onClosed?(): void;
  /** The platform asked for a window and none existed. */
  onActivated?(): void;
}

export interface RuntimeService<W> {
  /** The window, or null when there is none yet (or it has closed). */
  window(): W | null;
  /** Creates the window if there is none, wires it, and returns it. */
  create(): W;
  /** Brings the window forward, restoring it when minimised. */
  focus(): void;
  /** Creates a window only when the platform reports none. */
  ensureWindow(): W | null;
  /** How many windows this process has created, which is what the health line reports. */
  created(): number;
}

export function createRuntimeModule<W extends RuntimeWindow>(options: RuntimeOptions<W>): BootModule<RuntimeService<W>> {
  let window: W | null = null;
  let createdCount = 0;
  let disposed = false;
  const loadTarget = options.devServerUrl ?? options.rendererFile;

  const build = (): W => {
    const created = options.createWindow({
      show: options.show,
      width: 1440,
      height: 920,
      minWidth: 1080,
      minHeight: 700,
      title: "Codex Boss — Controller",
      backgroundColor: "#0b0d10",
      titleBarStyle: "hiddenInset",
      autoHideMenuBar: true,
      webPreferences: {
        // Offscreen and no background throttling are the same decision: a headless
        // run has no visible surface to be throttled for, and a throttled renderer
        // would stall the acceptance that is driving it.
        offscreen: options.offscreen,
        backgroundThrottling: !options.offscreen,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: options.preloadPath
      }
    });
    if (options.devServerUrl) void created.loadURL(options.devServerUrl);
    else void created.loadFile(options.rendererFile);
    created.webContents.on("did-fail-load", (_event, code, description, url) => {
      console.error(`Renderer failed to load: ${code} ${description} ${url}`);
    });
    created.on("closed", () => {
      window = null;
      options.onClosed?.();
    });
    window = created;
    createdCount += 1;
    options.onCreated?.(created);
    return created;
  };

  // The two platform events that ask for a window, registered once at construction:
  // an activate with none open recreates it, and a second launch brings the existing
  // one forward instead of starting a second copy of the application.
  options.onAppEvent("activate", () => { if (options.openWindowCount() === 0) { build(); options.onActivated?.(); } });
  options.onAppEvent("second-instance", () => {
    const current = window as (W & { isMinimized?(): boolean; restore?(): void; show?(): void; focus?(): void }) | null;
    if (!current) return;
    if (current.isMinimized?.()) current.restore?.();
    current.show?.();
    current.focus?.();
  });

  return {
    service: {
      window: () => window,
      // Idempotent while a window exists: a second boot step asking for "the window"
      // must never produce a second one.
      create: () => window ?? build(),
      focus: () => {
        const current = window as (W & { isMinimized?(): boolean; restore?(): void; show?(): void; focus?(): void }) | null;
        if (!current) return;
        if (current.isMinimized?.()) current.restore?.();
        current.show?.();
        current.focus?.();
      },
      ensureWindow: () => (options.openWindowCount() === 0 ? build() : window),
      created: () => createdCount
    },
    health: () => ({
      module: "runtime",
      // "No window" is a real state here — before boot creates it, and after the
      // Owner closes it — and it is the one an operator has to be able to see.
      status: window ? "READY" : "DEGRADED",
      detail: `${createdCount} window(s) created; loading ${options.devServerUrl ? `dev server ${options.devServerUrl}` : loadTarget}; ${options.offscreen ? "offscreen" : options.show ? "visible" : "hidden"}${disposed ? "; disposed" : ""}`
    }),
    // The window belongs to the application, not to this module: closing it here
    // would change shutdown behaviour behind the root's back. Disposal is therefore
    // a state change the composition root can rely on, and it is idempotent.
    dispose: () => { disposed = true; }
  };
}
