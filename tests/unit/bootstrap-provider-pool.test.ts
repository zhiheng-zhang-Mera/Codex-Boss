import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProviderPoolModule } from "../../electron/bootstrap/provider-pool";
import { createPersistenceModule } from "../../electron/bootstrap/persistence";
import { SessionLifecycleLedger } from "../../electron/identity/session-lifecycle-ledger";
import { createProvidersModule } from "../../electron/bootstrap/providers";
import { AccountSessionManager } from "../../electron/account-sessions";

/**
 * Phase F — the provider pool's objects.
 *
 * Everything here is real except the window: the pool takes the live store, the
 * account sessions, the API client and the provider lookup, so those are the real
 * ones this tier can build. `attach()` builds a REAL `ProviderViews` on a REAL
 * `BrowserWindow`, which needs the Electron runtime — this tier runs in plain Node —
 * so the attach path is covered where it is real instead of being faked here:
 * `scripts/acceptance-restart.cjs` boots the application, and
 * `pnpm run acceptance:desktop-workbook` drives provider panes over CDP and asserts
 * 89 claims against the pane the pool opened.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-pool-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const crypto = { encrypt: (value: string) => `p:${value}`, decrypt: (value: string) => value.replace(/^p:/, "") };

/** A pool whose window never arrives — the state before boot creates one. */
function buildWithoutWindow() {
  const dataRoot = makeRoot();
  const persistence = createPersistenceModule({ dataRoot, historyRoot: path.join(dataRoot, "history"), cacheRoot: path.join(dataRoot, "cache"), appPath: process.cwd(), crypto });
  const store = persistence.service.store;
  const providers = createProvidersModule({ userData: dataRoot, store, apiSettings: persistence.service.apiSettings, crypto: { protect: crypto.encrypt, unprotect: crypto.decrypt }, views: () => undefined, maxActive: 3, navigateOnOpen: true });
  // The lifecycle ledger is built by the `identity` capability now, not handed back by
  // `persistence` (ledger CC-066): this test builds the identity module for the same reason it
  // builds the persistence one -- it needs a real ledger over a real temporary root.
  const accounts = new AccountSessionManager(store, () => undefined, new SessionLifecycleLedger(path.join(dataRoot, ".boss", "session-lifecycle.json")));
  const toggles: string[] = [];
  const module = createProviderPoolModule({
    window: () => undefined,
    store,
    provider: (id) => {
      const match = store.snapshot().providers.find((item) => item.id === id);
      if (!match) throw new Error(`Unknown provider: ${id}`);
      return match;
    },
    publish: () => undefined,
    accounts,
    api: providers.service.apiClient,
    onWindowToggle: (id, open) => { toggles.push(`${id}:${open}`); },
    downloadPathFor: () => ""
  });
  return { module, toggles };
}

describe("Phase F — the provider pool module", () => {
  it("reports no pool yet rather than a healthy one", () => {
    const { module } = buildWithoutWindow();
    expect(module.service.views()).toBeUndefined();
    expect(module.service.automation()).toBeUndefined();
    expect(module.service.attached()).toBe(0);
    expect(module.health().module).toBe("provider-pool");
    expect(module.health().status).toBe("DEGRADED");
    expect(module.health().detail).toContain("no controller window yet");
    expect(module.health().detail).toContain("0 attach(es)");
  });

  it("calls a missing window an error, with the message the root always threw", () => {
    const { module } = buildWithoutWindow();
    expect(() => module.service.attach()).toThrow(/Main window was not created/);
    // A refused attach is not an attach.
    expect(module.service.attached()).toBe(0);
    expect(module.health().status).toBe("DEGRADED");
  });

  it("never toggles a pane it did not build", () => {
    const { module, toggles } = buildWithoutWindow();
    expect(toggles).toEqual([]);
    expect(module.service.automation()).toBeUndefined();
  });

  it("disposes idempotently before anything was attached", () => {
    const { module } = buildWithoutWindow();
    expect(module.dispose()).toBeUndefined();
    module.dispose();
    expect(module.health().detail).toContain("disposed");
    expect(module.service.views()).toBeUndefined();
  });
});
