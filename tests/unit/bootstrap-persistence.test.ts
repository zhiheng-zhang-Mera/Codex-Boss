import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPersistenceModule, type PersistenceCrypto } from "../../electron/bootstrap/persistence";
import { DEFAULT_WORKSPACE_ID } from "../../src/shared/workspace";

/**
 * Phase F — the durable stores are one boot module.
 *
 * The value of the extraction is not that fewer lines sit in the composition
 * root; it is that the durable set can now be built, read and rebuilt WITHOUT
 * Electron, which is what these tests do. Three things are worth asserting and
 * each one is a real way the module could be wrong:
 *
 *  - it builds the whole declared set from one data root (a store silently
 *    dropped in the move would be invisible otherwise);
 *  - it writes under the root it was given, through the crypto callbacks it was
 *    given (a wrong path or a guessed crypto would lose or leak an API key);
 *  - state survives a rebuild, because that is the only reason the paths matter.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-persistence-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A crypto double that is unmistakably not the platform one, and reversible. */
const testCrypto: PersistenceCrypto = {
  encrypt: (plainText) => `enc:${Buffer.from(plainText, "utf8").toString("base64")}`,
  decrypt: (cipherText) => Buffer.from(cipherText.replace(/^enc:/, ""), "base64").toString("utf8")
};

/**
 * The store names the module declares, in the order it opens them.
 *
 * `attachments` is deliberately NOT here (ledger CC-065): the namespace is declared by
 * the `attachments` capability and its store is built on that capability's own boot
 * path, so this module no longer owns it. Its own test lives beside the module that
 * does, and this list is a projection of the real service -- a store that moved back
 * in here would still be visible below, it would just be counted twice.
 */
const DECLARED = [
  "history", "tasks", "state", "provider-capabilities", "github-cache",
  "api-settings", "session-lifecycle", "node-registry", "external-sessions",
  "runtime-budget", "interventions", "decision-ledger", "workspaces",
  "workspace-selection", "permission-manifest", "project-state", "experience",
  "runtime-resources", "task-contexts"
];

function build(root: string) {
  return createPersistenceModule({
    dataRoot: root,
    historyRoot: path.join(root, "history"),
    cacheRoot: path.join(root, "cache"),
    appPath: process.cwd(),
    crypto: testCrypto
  });
}

/**
 * The durable-store name the module reports against the value it exposes. Written
 * as a projection of the real service rather than a name→key map, so a renamed or
 * dropped store fails to compile here instead of silently matching a string.
 */
function exposedStores(service: ReturnType<typeof build>["service"]): Record<string, unknown> {
  return {
    history: service.history,
    tasks: service.tasks,
    state: service.store,
    "provider-capabilities": service.capabilities,
    "github-cache": service.github,
    "api-settings": service.apiSettings,
    "session-lifecycle": service.sessionLifecycle,
    "node-registry": service.nodeRegistry,
    "external-sessions": service.externalSessions,
    "runtime-budget": service.budget,
    interventions: service.guidance,
    "decision-ledger": service.decisions,
    workspaces: service.workspaces,
    "workspace-selection": service.workspaceSelection,
    "permission-manifest": service.permissionManifests,
    "project-state": service.projectStates,
    experience: service.experiences,
    "runtime-resources": service.resources,
    "task-contexts": service.contexts
  };
}

describe("Phase F — the persistence boot module", () => {
  it("builds the whole declared durable set from one data root", () => {
    const root = makeRoot();
    const module = build(root);
    expect(module.service.opened).toEqual(DECLARED);
    // The reported names are the exposed stores, and each one is a real object
    // rather than a label that happens to be in the list.
    const exposed = exposedStores(module.service);
    expect(Object.keys(exposed).sort()).toEqual([...DECLARED].sort());
    for (const name of DECLARED) {
      expect(exposed[name], `${name} is missing from the service`).toBeDefined();
    }
  });

  it("does not need Electron to build, which is the point of the extraction", () => {
    const root = makeRoot();
    // The instance is created in a plain Node process and its state is readable
    // with no window, no app path resolution and no platform keychain.
    const module = build(root);
    const snapshot = module.service.store.snapshot();
    expect(snapshot.tasks).toEqual([]);
    expect(Array.isArray(snapshot.providers)).toBe(true);
    expect(snapshot.providers.length).toBeGreaterThan(0);
  });

  it("says which workspace its workspace-scoped stores are rooted at", () => {
    // A fresh root has no selected workspace: the registry answers with the
    // default shim, and the stores rooted there are the ones an operator has to
    // know about.
    const fresh = build(makeRoot());
    expect(fresh.health().module).toBe("persistence");
    expect(fresh.health().status).toBe("DEGRADED");
    expect(fresh.health().detail).toContain("default shim");
    expect(fresh.health().detail).toContain("19 durable store(s)");
  });

  it("reports READY over a workspace that was selected before boot", async () => {
    const root = makeRoot();
    const repository = makeRoot();
    const first = build(root);
    expect(first.service.workspaces.activeWorkspaceId()).toBe(DEFAULT_WORKSPACE_ID);
    const created = first.service.workspaces.create({ name: "Boss Repo", repositories: [repository] });
    first.service.workspaces.setActive(created.id);
    // A second boot reads the registry, so this is the state production boots with.
    const second = build(root);
    expect(second.health().status).toBe("READY");
    expect(second.health().detail).toContain(created.id);
    expect(second.health().detail).not.toContain("default shim");
  });

  it("remembers a workspace across a rebuild, so the paths are the durable ones", async () => {
    const root = makeRoot();
    const workspace = makeRoot();
    const first = build(root);
    const remembered = await first.service.workspaceSelection.remember(workspace);
    expect(remembered.status).toBe("AVAILABLE");
    const second = build(root);
    const current = await second.service.workspaceSelection.current();
    expect(current.status).toBe("AVAILABLE");
    expect(current.path?.toLowerCase()).toBe(remembered.path?.toLowerCase());
  });

  it("uses the injected crypto and never stores an API key in the clear", () => {
    const root = makeRoot();
    const first = build(root);
    first.service.apiSettings.update({ providerId: "deepseek", enabled: true, protocol: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", apiKey: "sk-secret-value" });
    const onDisk = fs.readFileSync(path.join(root, "api-settings.json"), "utf8");
    expect(onDisk).toContain("enc:");
    expect(onDisk).not.toContain("sk-secret-value");
    // A rebuild decrypts it back through the same injected callback, which is what
    // proves the module wired the platform boundary rather than working around it.
    const second = build(root);
    expect(second.service.apiSettings.connection("deepseek").apiKey).toBe("sk-secret-value");
  });

  it("carries the settings it read into the state document it exposes", () => {
    // The inline version re-derived this on every publish; the module does it once
    // at boot, so the very first snapshot already reflects durable settings.
    const root = makeRoot();
    const first = build(root);
    first.service.apiSettings.update({ providerId: "deepseek", enabled: true, protocol: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", apiKey: "sk-secret-value" });
    const second = build(root);
    const entry = second.service.store.snapshot().apiSettings.find((item) => item.providerId === "deepseek");
    expect(entry?.hasApiKey).toBe(true);
    expect(JSON.stringify(second.service.store.snapshot().apiSettings)).not.toContain("sk-secret-value");
  });

  it("disposes idempotently and says so", () => {
    const module = build(makeRoot());
    expect(module.dispose()).toBeUndefined();
    module.dispose();
    expect(module.health().detail).toContain("disposed");
  });
});
