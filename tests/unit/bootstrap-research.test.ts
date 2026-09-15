import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createResearchModule } from "../../electron/bootstrap/research";
import { createPersistenceModule } from "../../electron/bootstrap/persistence";

/**
 * Phase F — the research composition root is a module.
 *
 * What is worth asserting here: the module builds WITHOUT the provider pool (the
 * automation arrives later, and its thunk is lazy), the durable roots land under the
 * data root it was given, and the health line tells the truth about the one state
 * that stops a live run — no provider page open, which the executor fails closed on
 * rather than inventing a stage result.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-research-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const crypto = { encrypt: (value: string) => `p:${value}`, decrypt: (value: string) => value.replace(/^p:/, "") };

function build(options: { automation?: () => undefined } = {}) {
  const dataRoot = makeRoot();
  const persistence = createPersistenceModule({ dataRoot, historyRoot: path.join(dataRoot, "history"), cacheRoot: path.join(dataRoot, "cache"), appPath: process.cwd(), crypto });
  const module = createResearchModule({
    dataRoot,
    store: persistence.service.store,
    automation: options.automation ?? (() => undefined)
  });
  return { module, persistence, dataRoot };
}

describe("Phase F — the research module", () => {
  it("builds the one research service without the provider pool", () => {
    // The pool is attached later than this module is built, and a semantic stage
    // that runs before it exists must fail closed — so the automation lookup is a
    // thunk, and building must not need it.
    const { module } = build();
    expect(module.service.research).toBeDefined();
    expect(module.health().module).toBe("research");
  });

  it("keeps its durable roots under the data root it was given", () => {
    const { module, dataRoot } = build();
    expect(module.health().detail).toContain(path.join(dataRoot, ".boss", "research"));
  });

  it("counts the provider pages a live stage could use", () => {
    const { module, persistence } = build();
    expect(module.service.openProviders()).toBe(0);
    const ids = persistence.service.store.snapshot().providers.map((item) => item.id);
    persistence.service.store.setWindow(ids[0], true);
    persistence.service.store.setWindow(ids[1], true);
    expect(module.service.openProviders()).toBe(2);
  });

  it("reports the state that stops a live run instead of looking healthy", () => {
    const { module, persistence } = build();
    expect(module.health().status).toBe("DEGRADED");
    expect(module.health().detail).toContain("cannot advance a semantic stage");
    const ids = persistence.service.store.snapshot().providers.map((item) => item.id);
    persistence.service.store.setWindow(ids[0], true);
    expect(module.health().status).toBe("READY");
    expect(module.health().detail).not.toContain("cannot advance a semantic stage");
  });

  it("disposes idempotently and says so", () => {
    const { module } = build();
    expect(module.dispose()).toBeUndefined();
    module.dispose();
    expect(module.health().detail).toContain("disposed");
    // The service it built is still the one it exposes.
    expect(module.service.research).toBeDefined();
  });
});
