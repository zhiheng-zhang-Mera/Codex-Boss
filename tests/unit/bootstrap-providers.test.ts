import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProvidersModule, type ProviderPoolViews, type ProvidersCrypto } from "../../electron/bootstrap/providers";
import { createPersistenceModule } from "../../electron/bootstrap/persistence";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { MAX_ACTIVE_PROVIDERS } from "../../src/shared/provider-policy";
import type { Provider } from "../../src/shared/contracts";
import type { WorkspaceViewState } from "../../src/shared/workspace-layout";

/**
 * Phase F — the provider-side integration is a boot module.
 *
 * Two behaviours are worth asserting, and both are deliberate policies that were
 * previously only visible by reading the composition root:
 *
 *  - **a node with no GitHub machine identity degrades only GitHub.** The fallback
 *    is `{configured: false}`, and it has to be reported rather than swallowed, or
 *    "GitHub is not configured here" is indistinguishable from "GitHub is broken";
 *  - **one API runtime per configured provider**, registered from the state
 *    document rather than from a list the module keeps of its own.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-providers-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** The two crypto contracts this test spans differ on purpose: the durable stores take
 * `{encrypt, decrypt}` and `ProviderApiClient`'s settings store takes `{protect, unprotect}`. */
const prefix = (value: string) => `protected:${value}`;
const strip = (value: string) => value.replace(/^protected:/, "");
const workingCrypto: ProvidersCrypto = { protect: prefix, unprotect: strip };
const persistenceCrypto = { encrypt: prefix, decrypt: strip };

/** A recorder standing in for the real provider views, which need a window. */
function fakeViews(initial: WorkspaceViewState = "MERGED") {
  const calls: string[] = [];
  let current = initial;
  const views: ProviderPoolViews = {
    workspaceView: () => current,
    setWorkspaceView: (next) => { current = next; calls.push(`layout:${next}`); return next; },
    open: (provider: Provider, loadInitialPage?: boolean) => { calls.push(`open:${provider.id}:${loadInitialPage}`); return {}; }
  };
  return { views, calls, current: () => current };
}

function build(options: { crypto?: ProvidersCrypto; views?: ProviderPoolViews; maxActive?: number; navigateOnOpen?: boolean; layoutIntervalMs?: number } = {}) {
  const dataRoot = makeRoot();
  const persistence = createPersistenceModule({
    dataRoot,
    historyRoot: path.join(dataRoot, "history"),
    cacheRoot: path.join(dataRoot, "cache"),
    appPath: process.cwd(),
    crypto: persistenceCrypto
  });
  const module = createProvidersModule({
    userData: dataRoot,
    store: persistence.service.store,
    apiSettings: persistence.service.apiSettings,
    crypto: options.crypto ?? workingCrypto,
    views: () => options.views,
    maxActive: options.maxActive ?? MAX_ACTIVE_PROVIDERS,
    navigateOnOpen: options.navigateOnOpen ?? true,
    ...(options.layoutIntervalMs ? { layoutIntervalMs: options.layoutIntervalMs } : {})
  });
  return { module, persistence };
}

describe("Phase F — the providers boot module", () => {
  it("registers one API runtime per configured provider", () => {
    const { module, persistence } = build();
    const providers = persistence.service.store.snapshot().providers;
    expect(providers.length).toBeGreaterThan(0);
    const registry = new RuntimeRegistry();
    const count = module.service.registerRuntimes(registry);
    expect(count).toBe(providers.length);
    for (const provider of providers) {
      expect(registry.get("api:" + provider.id), `${provider.id} has no runtime`).toBeDefined();
    }
    expect(module.health().detail).toContain(`${providers.length} API runtime(s) registered`);
  });

  it("keeps the API client on the durable settings it was given", () => {
    const { module, persistence } = build();
    // Before the Owner configures it, the client refuses to dispatch at all.
    expect(() => module.service.apiClient.validate("deepseek")).toThrow();
    persistence.service.apiSettings.update({ providerId: "deepseek", enabled: true, protocol: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", apiKey: "sk-from-the-store" });
    // The client reads the settings store it was CONSTRUCTED with, so a key saved
    // after construction is the key the next dispatch uses — which is the whole
    // point of handing the module the durable store rather than a snapshot.
    expect(() => module.service.apiClient.validate("deepseek")).not.toThrow();
  });

  it("reports a node whose GitHub identity could not be built, without failing", () => {
    // The real degrade path: the platform crypto refuses (unavailable keychain, or
    // an unreadable node-local config), and ONLY GitHub is affected.
    const refusing: ProvidersCrypto = {
      protect: () => { throw new Error("platform secure storage unavailable"); },
      unprotect: () => { throw new Error("platform secure storage unavailable"); }
    };
    const { module } = build({ crypto: refusing });
    expect(module.service.githubMachine.configured).toBe(false);
    expect(module.health().status).toBe("DEGRADED");
    expect(module.health().detail).toContain("unavailable on this node");
    // Everything that is not GitHub still works.
    expect(module.service.apiClient).toBeDefined();
    expect(module.service.registerRuntimes(new RuntimeRegistry())).toBeGreaterThan(0);
  });

  it("reports a configured machine as ready", () => {
    const { module } = build();
    // A node with no GitHub configuration file at all is the ordinary developer
    // state, and it is reported as such rather than as a failure.
    const detail = module.health().detail;
    expect(detail).toMatch(/GitHub machine (configured|unavailable on this node)/);
    expect(module.health().module).toBe("providers");
  });

  it("disposes idempotently and says so", () => {
    const { module } = build();
    expect(module.dispose()).toBeUndefined();
    module.dispose();
    expect(module.health().detail).toContain("disposed");
  });
});

describe("Phase F — the provider pool's policies", () => {
  it("names the provider an id refers to, and refuses an unknown one", () => {
    const { module, persistence } = build();
    const first = persistence.service.store.snapshot().providers[0];
    expect(module.service.provider(first.id).id).toBe(first.id);
    expect(() => module.service.provider("not-a-provider" as typeof first.id)).toThrow(/Unknown provider/);
  });

  it("opens a pane, and does not navigate it under bounded acceptance", () => {
    const live = fakeViews();
    build({ views: live.views, navigateOnOpen: true }).module.service.openWithinLimit("deepseek");
    expect(live.calls).toEqual(["open:deepseek:true"]);

    const bounded = fakeViews();
    build({ views: bounded.views, navigateOnOpen: false }).module.service.openWithinLimit("deepseek");
    expect(bounded.calls).toEqual(["open:deepseek:false"]);
  });

  it("refuses a new pane past the limit, and never counts an open one", () => {
    const live = fakeViews();
    const { module, persistence } = build({ views: live.views, maxActive: 2 });
    const ids = persistence.service.store.snapshot().providers.map((item) => item.id);
    persistence.service.store.setWindow(ids[0], true);
    persistence.service.store.setWindow(ids[1], true);
    // At the limit: a third provider is refused with the message the renderer shows.
    expect(() => module.service.openWithinLimit(ids[2])).toThrow(/最多同时打开 2 个网页 AI/);
    expect(live.calls).toEqual([]);
    // Already open: the limit is about opening, so this is not a refusal.
    expect(() => module.service.openWithinLimit(ids[0])).not.toThrow();
    expect(live.calls).toEqual([`open:${ids[0]}:true`]);
  });

  it("says so when no window has been attached yet, rather than failing obscurely", () => {
    const { module } = build();
    expect(() => module.service.openWithinLimit("deepseek")).toThrow(/no controller window yet/);
  });

  it("switches to the detached layout only above three open web providers", () => {
    const live = fakeViews();
    const { module, persistence } = build({ views: live.views });
    const ids = persistence.service.store.snapshot().providers.map((item) => item.id);
    // Three open is still merged, and nothing is set because nothing changed.
    for (const id of ids.slice(0, 3)) persistence.service.store.setWindow(id, true);
    module.service.autoLayout("test");
    expect(live.calls).toEqual([]);
    expect(live.current()).toBe("MERGED");
    // A fourth switches it, once.
    persistence.service.store.setWindow(ids[3], true);
    module.service.autoLayout("test");
    module.service.autoLayout("test");
    expect(live.calls).toEqual(["layout:DETACHED"]);
    // Closing back down returns it.
    persistence.service.store.setWindow(ids[3], false);
    module.service.autoLayout("test");
    expect(live.calls).toEqual(["layout:DETACHED", "layout:MERGED"]);
  });

  it("does nothing when no views exist, instead of throwing into the caller", () => {
    const { module } = build();
    expect(() => module.service.autoLayout("test")).not.toThrow();
  });

  it("runs the layout monitor on its interval and stops it on disposal", async () => {
    const live = fakeViews();
    const { module, persistence } = build({ views: live.views, layoutIntervalMs: 20 });
    const ids = persistence.service.store.snapshot().providers.map((item) => item.id);
    module.service.startLayoutMonitor();
    expect(module.service.monitorRunning()).toBe(true);
    for (const id of ids.slice(0, 4)) persistence.service.store.setWindow(id, true);
    // The monitor tick is what applies the change, not a direct call.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(live.calls).toEqual(["layout:DETACHED"]);

    module.dispose();
    expect(module.service.monitorRunning()).toBe(false);
    for (const id of ids) persistence.service.store.setWindow(id, false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(live.calls).toEqual(["layout:DETACHED"]);
  });
});
