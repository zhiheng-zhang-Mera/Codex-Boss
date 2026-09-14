import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createKnowledgeModule } from "../../electron/bootstrap/knowledge";
import { createPersistenceModule } from "../../electron/bootstrap/persistence";
import { defaultSurfaceContracts } from "../../src/shared/ui-surface";

/**
 * Phase F — knowledge, self-model and theme are one boot module.
 *
 * What is worth asserting here is the pair of fail-safe behaviours the module
 * inherited and the fact that the plan context is a real observation rather than
 * a placeholder: a caller that cannot model a repository must not lose the
 * previous observation, and a theme engine that cannot discover the UI surface
 * registry must validate against the locked contract table instead of throwing
 * into boot.
 */

const dirs: string[] = [];
function makeTree(prefix = "boss-knowledge-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** A miniature repository that the world model can actually observe. */
function makeRepository(): string {
  const root = makeTree("boss-knowledge-repo-");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", devDependencies: { typescript: "^5.0.0", vite: "^5.0.0" } }), "utf8");
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }), "utf8");
  fs.writeFileSync(path.join(root, "vite.config.ts"), "export default {};\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const answer = 42;\n", "utf8");
  return root;
}

function build(dataRoot: string, appPath: string) {
  const persistence = createPersistenceModule({
    dataRoot,
    historyRoot: path.join(dataRoot, "history"),
    cacheRoot: path.join(dataRoot, "cache"),
    appPath: process.cwd(),
    crypto: { encrypt: (value) => `enc:${value}`, decrypt: (value) => value.replace(/^enc:/, "") }
  });
  return createKnowledgeModule({
    dataRoot,
    appPath,
    canonicalize: (root) => fs.realpathSync(root),
    store: persistence.service.store
  });
}

/** The durable-store names against the values the module exposes. */
function exposedStores(service: ReturnType<typeof build>["service"]): Record<string, unknown> {
  return {
    "knowledge-base": service.foundation,
    "world-model": service.worldModels,
    "ui-surfaces": service.uiSurfaces,
    themes: service.themes
  };
}

const DECLARED = ["knowledge-base", "world-model", "ui-surfaces", "themes"];

describe("Phase F — the knowledge boot module", () => {
  it("opens the declared set and exposes exactly those stores", () => {
    const module = build(makeTree(), makeRepository());
    expect(module.service.opened).toEqual(DECLARED);
    const exposed = exposedStores(module.service);
    expect(Object.keys(exposed).sort()).toEqual([...DECLARED].sort());
    for (const name of DECLARED) expect(exposed[name], `${name} is missing`).toBeDefined();
  });

  it("falls back to the locked contract table instead of throwing into boot", () => {
    // An application path that cannot be modelled is the real failure this guards:
    // the theme engine asks for contracts during bootstrap, so a throw here would
    // take the whole boot down.
    const module = build(makeTree(), path.join(makeTree(), "no-such-app"));
    const contracts = module.service.uiContracts();
    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts.map((contract) => contract.id).sort()).toEqual(defaultSurfaceContracts().map((contract) => contract.id).sort());
    // …and the theme engine still came up, on the built-in theme.
    expect(module.health().status).toBe("READY");
    expect(module.health().detail).toContain("locked table");
  });

  it("materializes the built-in themes and reports which one is active", () => {
    const dataRoot = makeTree();
    const module = build(dataRoot, makeRepository());
    expect(module.service.themeBootstrap.fallback).toBe(false);
    expect(module.service.themeBootstrap.activeThemeId.length).toBeGreaterThan(0);
    // The built-ins really were written, which is what makes the theme usable on a
    // first boot rather than only after a manual install.
    const themes = fs.readdirSync(path.join(dataRoot, ".boss", "themes"));
    expect(themes.length).toBeGreaterThan(0);
    expect(module.health().detail).toContain(module.service.themeBootstrap.activeThemeId);
  });

  it("reports DEGRADED when the persisted theme had to fall back", () => {
    // A reachable state, not a decorative branch: the Owner's chosen theme can be
    // gone or invalid, and the health line is where that becomes visible.
    const dataRoot = makeTree();
    fs.mkdirSync(path.join(dataRoot, ".boss"), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, ".boss", "theme-registry.json"), JSON.stringify({
      schemaVersion: 1, records: [], activeThemeId: "custom-vanished", requestedThemeId: "custom-vanished", diagnostics: [], updatedAt: new Date().toISOString()
    }), "utf8");
    const module = build(dataRoot, makeRepository());
    expect(module.service.themeBootstrap.fallback).toBe(true);
    expect(module.health().status).toBe("DEGRADED");
    expect(module.health().detail).toContain("fell back");
  });

  it("observes a repository and records what the planner scopes nodes against", () => {
    const dataRoot = makeTree();
    const repository = makeRepository();
    const module = build(dataRoot, repository);
    expect(module.service.planContext()).toBeUndefined();
    const result = module.service.establishWorldModel(repository);
    expect(result.summary).toBeDefined();
    const context = module.service.planContext();
    // A missing observation is the failure this test exists to catch, so it is
    // stated as one rather than reached through a non-null assertion.
    if (!context?.resources) throw new Error("establishWorldModel recorded no plan context with a resource observation");
    // The files are the real ones the model found, not a placeholder list.
    expect(context.files.some((file) => file.replace(/\\/g, "/").endsWith("src/index.ts"))).toBe(true);
    expect(context.build_tools).toContain("tsc");
    expect(context.commands.typecheck).toBe("pnpm run typecheck");
    expect(context.commands.build).toBe("pnpm run build");
    // §29.3 resources are this host's, so the numbers have to be real.
    expect(context.resources.cpu_cores).toBeGreaterThan(0);
    expect(context.resources.free_memory_mb).toBeGreaterThan(0);
    expect(context.resources.gpu_available).toBe(false);
    expect(context.resources.active_tasks).toBe(0);
  });

  it("persists the model under the data root it was given", () => {
    const dataRoot = makeTree();
    const repository = makeRepository();
    const module = build(dataRoot, repository);
    module.service.establishWorldModel(repository);
    const latest = JSON.parse(fs.readFileSync(path.join(dataRoot, ".boss", "world-model", "latest.json"), "utf8")) as { root?: string; fingerprint?: string };
    // The canonicalised root, which is what the injected canonicaliser produced.
    expect(latest.root?.toLowerCase()).toBe(fs.realpathSync(repository).toLowerCase());
    expect(latest.fingerprint).toBeTruthy();
    expect(module.health().detail).toContain("world model established");
  });

  it("disposes idempotently and says so", () => {
    const module = build(makeTree(), makeRepository());
    expect(module.dispose()).toBeUndefined();
    module.dispose();
    expect(module.health().detail).toContain("disposed");
  });
});
