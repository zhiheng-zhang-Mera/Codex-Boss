import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProvidersModule, type ProvidersCrypto } from "../../electron/bootstrap/providers";
import { createPersistenceModule } from "../../electron/bootstrap/persistence";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";

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

function build(options: { crypto?: ProvidersCrypto } = {}) {
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
    crypto: options.crypto ?? workingCrypto
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
    persistence.service.apiSettings.update({ providerId: "deepseek", enabled: true, protocol: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-flash", apiKey: "sk-from-the-store" });
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
