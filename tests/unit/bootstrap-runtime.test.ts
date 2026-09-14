import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeModule, type BossWindowOptions, type RuntimeWindow } from "../../electron/bootstrap/runtime";

/**
 * Phase F — the controller window's lifecycle is a module.
 *
 * None of this had a test before: the offscreen policy, the load target, what
 * `activate` and `second-instance` mean, and whether asking for "the window" twice
 * can produce two windows. They are driven here through an injected factory, which
 * is the same seam the composition root uses to hand in the real `BrowserWindow` —
 * so the module is exercised without Electron and the root keeps the real type.
 */

interface FakeWindow extends RuntimeWindow {
  options: BossWindowOptions;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  closed(): void;
  failLoad(code: number, description: string, url: string): void;
}

function harness(overrides: { offscreen?: boolean; show?: boolean; devServerUrl?: string; openWindows?: number } = {}) {
  const created: FakeWindow[] = [];
  const appEvents = new Map<string, () => void>();
  const calls: string[] = [];
  let openWindows = overrides.openWindows ?? 0;
  const module = createRuntimeModule<FakeWindow>({
    createWindow: (options) => {
      const listeners: { closed?: () => void; fail?: (event: unknown, code: number, description: string, url: string) => void } = {};
      const window: FakeWindow = {
        options,
        loadURL: (url) => { calls.push(`loadURL ${url}`); },
        loadFile: (file) => { calls.push(`loadFile ${file}`); },
        on: (event, listener) => { if (event === "closed") listeners.closed = listener; },
        webContents: {
          on: (event, listener) => { if (event === "did-fail-load") listeners.fail = listener; }
        },
        isMinimized: () => calls.includes("minimized") ? true : false,
        restore: () => { calls.push("restore"); },
        show: () => { calls.push("show"); },
        focus: () => { calls.push("focus"); },
        closed: () => listeners.closed?.(),
        failLoad: (code, description, url) => listeners.fail?.(undefined, code, description, url)
      };
      created.push(window);
      openWindows += 1;
      return window;
    },
    preloadPath: "/app/preload.js",
    rendererFile: "/app/dist/index.html",
    ...(overrides.devServerUrl ? { devServerUrl: overrides.devServerUrl } : {}),
    offscreen: overrides.offscreen ?? false,
    show: overrides.show ?? true,
    onAppEvent: (event, listener) => { appEvents.set(event, listener); },
    openWindowCount: () => openWindows,
    onCreated: (window) => { calls.push(`created offscreen=${window.options.webPreferences.offscreen}`); },
    onClosed: () => { calls.push("closed"); openWindows = 0; },
    onActivated: () => { calls.push("activated"); }
  });
  return { module, created, appEvents, calls, fire: (event: "activate" | "second-instance") => appEvents.get(event)?.() };
}

describe("Phase F — the runtime boot module", () => {
  it("states the offscreen policy the root gave it", () => {
    const headless = harness({ offscreen: true, show: false });
    const headlessWindow = headless.module.service.create();
    expect(headlessWindow.options.webPreferences.offscreen).toBe(true);
    // A headless run has no visible surface to throttle for, and a throttled
    // renderer would stall the acceptance that is driving it.
    expect(headlessWindow.options.webPreferences.backgroundThrottling).toBe(false);
    expect(headlessWindow.options.show).toBe(false);

    const visible = harness({ offscreen: false, show: true });
    const visibleWindow = visible.module.service.create();
    expect(visibleWindow.options.webPreferences.offscreen).toBe(false);
    expect(visibleWindow.options.webPreferences.backgroundThrottling).toBe(true);
    expect(visibleWindow.options.show).toBe(true);
  });

  it("keeps the isolation settings and the injected preload path", () => {
    const { module } = harness();
    const options = module.service.create().options;
    expect(options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, preload: "/app/preload.js" });
    expect(options.title).toBe("Codex Boss — Controller");
    expect(options).toMatchObject({ width: 1440, height: 920, minWidth: 1080, minHeight: 700 });
  });

  it("loads the dev server when there is one and the built file otherwise", () => {
    const dev = harness({ devServerUrl: "http://localhost:5173" });
    dev.module.service.create();
    expect(dev.calls).toContain("loadURL http://localhost:5173");

    const built = harness();
    built.module.service.create();
    expect(built.calls).toContain("loadFile /app/dist/index.html");
  });

  it("reports a renderer that failed to load instead of ignoring it", () => {
    const { module, created } = harness();
    module.service.create();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      created[0].failLoad(-6, "ERR_FILE_NOT_FOUND", "file:///app/dist/index.html");
      expect(error).toHaveBeenCalledWith(expect.stringContaining("ERR_FILE_NOT_FOUND"));
    } finally {
      error.mockRestore();
    }
  });

  it("never creates a second window for a second request", () => {
    const { module, created } = harness();
    const first = module.service.create();
    const second = module.service.create();
    expect(created.length).toBe(1);
    expect(second).toBe(first);
    expect(module.service.created()).toBe(1);
  });

  it("recreates on activate only when the platform reports no window", () => {
    const { module, created, calls, fire } = harness();
    module.service.create();
    expect(created.length).toBe(1);
    // A window exists: the platform's count is what decides, not a belief.
    fire("activate");
    expect(created.length).toBe(1);
    expect(calls).not.toContain("activated");

    created[0].closed();
    expect(module.service.window()).toBeNull();
    fire("activate");
    expect(created.length).toBe(2);
    expect(calls).toContain("activated");
    expect(module.service.created()).toBe(2);
  });

  it("brings the existing window forward on a second launch", () => {
    const { module, created, calls, fire } = harness();
    const window = module.service.create();
    // Minimised: the platform's answer, and the one that must be restored.
    Object.defineProperty(window, "isMinimized", { value: () => true });
    fire("second-instance");
    expect(calls.filter((call) => ["restore", "show", "focus"].includes(call))).toEqual(["restore", "show", "focus"]);
    expect(created.length).toBe(1);
  });

  it("clears the window and tells the root when it closes", () => {
    const { module, created, calls } = harness();
    module.service.create();
    created[0].closed();
    expect(module.service.window()).toBeNull();
    expect(calls).toContain("closed");
    // And the module can create again afterwards, which is what activate relies on.
    expect(module.service.create()).toBeDefined();
  });

  it("reports 'no window' as a real state rather than a healthy one", () => {
    const { module, created } = harness();
    expect(module.health().module).toBe("runtime");
    expect(module.health().status).toBe("DEGRADED");
    expect(module.health().detail).toContain("0 window(s) created");
    module.service.create();
    expect(module.health().status).toBe("READY");
    expect(module.health().detail).toContain("visible");
    created[0].closed();
    expect(module.health().status).toBe("DEGRADED");
    module.dispose();
    expect(module.health().detail).toContain("disposed");
  });
});

describe("Phase F — the window has one constructor", () => {
  const main = fs.readFileSync(path.join(process.cwd(), "electron", "main.ts"), "utf8");

  it("constructs a BrowserWindow exactly once, as the injected factory", () => {
    // The mirror in the composition root is only safe while the module is the one
    // thing that creates a window: a second construction site would leave the
    // mirror stale and the module's lifecycle decisions bypassed.
    expect([...main.matchAll(/new BrowserWindow\(/g)].length).toBe(1);
    expect(main).toContain("createWindow: (options) => new BrowserWindow(options)");
  });

  it("no longer registers the window's own platform events itself", () => {
    // Both names appear exactly once, in the adapter that narrows the module's union
    // for Electron's per-event overloads — not as the root's own handlers. The old
    // inline focus logic is what proves the handlers themselves moved.
    expect([...main.matchAll(/app\.on\("activate"/g)].length).toBe(1);
    expect([...main.matchAll(/app\.on\("second-instance"/g)].length).toBe(1);
    expect(main).not.toContain("if (mainWindow?.isMinimized())");
    // …while the application-level one, which disposes services and decides whether
    // to quit, is still the root's.
    expect(main).toContain('app.on("window-all-closed"');
  });
});
