import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DecisionLedgerEntry } from "../../../src/shared/decision-ledger";
import { DecisionLedgerStore } from "../../../electron/commander/decision-ledger-store";
import { createStateCoreModule } from "../../../electron/bootstrap/state-core";
import { writeJson } from "../../../electron/commander/durable-json";
import { openDatabase } from "../../../electron/state-core/database";

/**
 * Phase 02 Task C integration — the state core is now in the composition root.
 *
 * `electron/main.ts` builds this module and routes the decision ledger through it, so these
 * tests cover the piece the migration report previously admitted was missing: a production
 * boot path that actually performs the migration.
 *
 * The two properties that matter for shipping it:
 *
 *   1. **The routed ledger behaves like the store it replaces.** `list`/`append`/`appendAll`
 *      return the same values, so the call sites in `main.ts` and `dispatch-ipc.ts` did not
 *      have to change shape — the only difference is that a write now feeds the comparison
 *      window.
 *   2. **A broken state core degrades to the JSON store.** A corrupt database, or a schema
 *      from a newer build, must leave the application with a working durable ledger rather
 *      than a failed boot. That is the book's rule about not turning one capability's
 *      failure into a global one, and it is the reason this integration is safe to ship
 *      before the battery has passed in production.
 */

const dirs: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-boot-statecore-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

let counter = 0;
function decision(overrides: Partial<DecisionLedgerEntry> = {}): DecisionLedgerEntry {
  counter++;
  return {
    id: overrides.id ?? `d-${counter}`,
    taskId: overrides.taskId ?? "task-1",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    question: overrides.question ?? "question",
    candidates: overrides.candidates ?? ["a", "b"],
    chosen: overrides.chosen ?? "a",
    evidence: overrides.evidence ?? ["e"],
    outcome: overrides.outcome ?? "APPLIED",
    source: overrides.source ?? "question-interceptor"
  };
}

describe("Phase 02 integration — the boot module routes the real ledger", () => {
  it("starts READY, imports the legacy baseline, and routes appends through the migration", () => {
    const root = tempRoot();
    const legacyFile = path.join(root, ".boss", "decision-ledger.json");
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    writeJson(legacyFile, { schemaVersion: 1, entries: [decision({ id: "pre-existing" })] });
    const legacy = new DecisionLedgerStore(legacyFile);

    const module = createStateCoreModule({ dataRoot: root, legacy, requiredClean: 2 });
    const service = module.service;
    expect(service.active).toBe(true);
    expect(module.health()).toMatchObject({ module: "state-core", status: "READY" });

    // 1. read-old baseline
    expect(service.summary()).toContain("imported 1 legacy entry");
    // 5. shadow read/compare is already live
    expect(service.migration?.state()?.phase).toBe("shadow-comparing");
    expect(service.migration?.authority(), "JSON stays authoritative until the battery passes").toBe("json");

    // A production-style append goes through the routing and is compared.
    const appended = service.ledger.append(decision({ id: "routed-1" }));
    expect(appended.id).toBe("routed-1");
    expect(service.migration?.state()?.consecutiveClean).toBe(1);
    // Both durable representations hold it.
    expect(legacy.list().map((entry) => entry.id)).toContain("routed-1");
    expect(service.repository?.get("decision-ledger", "routed-1")).toBeTruthy();
    module.dispose();
  });

  it("exposes the same list/append contract the store did, so call sites are unchanged", () => {
    const root = tempRoot();
    const legacy = new DecisionLedgerStore(path.join(root, ".boss", "decision-ledger.json"));
    const module = createStateCoreModule({ dataRoot: root, legacy });
    const service = module.service;

    expect(service.ledger.list()).toEqual([]);
    const first = decision({ id: "a", taskId: "task-1", createdAt: "2026-01-01T00:00:00.000Z" });
    const second = decision({ id: "b", taskId: "task-2", createdAt: "2026-01-02T00:00:00.000Z" });
    expect(service.ledger.append(first)).toEqual(first);
    expect(service.ledger.appendAll([second])).toEqual([second]);
    // Newest first, and filtering by task, exactly as DecisionLedgerStore documented.
    expect(service.ledger.list().map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(service.ledger.list("task-1").map((entry) => entry.id)).toEqual(["a"]);
    module.dispose();
  });

  it("does not promote itself: authority stays on JSON until something asks", () => {
    const root = tempRoot();
    const legacy = new DecisionLedgerStore(path.join(root, ".boss", "decision-ledger.json"));
    const module = createStateCoreModule({ dataRoot: root, legacy, requiredClean: 1 });
    const service = module.service;

    service.ledger.append(decision({ id: "one" }));
    expect(service.migration?.state()?.phase, "the battery has passed").toBe("ready-to-promote");
    // Reaching readiness is not promoting. Silent promotion is what the book forbids.
    expect(service.migration?.authority()).toBe("json");

    const promoted = service.promote();
    expect(promoted.ok).toBe(true);
    expect(promoted.detail).toContain("authority=database");
    expect(service.migration?.authority()).toBe("database");
    module.dispose();
  });

  it("records the promotion, so a later boot reads from the database", () => {
    const root = tempRoot();
    const legacyFile = path.join(root, ".boss", "decision-ledger.json");
    const first = createStateCoreModule({ dataRoot: root, legacy: new DecisionLedgerStore(legacyFile), requiredClean: 1 });
    first.service.ledger.append(decision({ id: "before-restart" }));
    expect(first.service.promote().ok).toBe(true);
    first.dispose();

    // A new process over the same data root: authority must have survived.
    const second = createStateCoreModule({ dataRoot: root, legacy: new DecisionLedgerStore(legacyFile), requiredClean: 1 });
    expect(second.service.migration?.authority()).toBe("database");
    expect(second.service.migration?.state()?.phase).toBe("migrated");
    expect(second.service.ledger.list().map((entry) => entry.id)).toContain("before-restart");
    second.dispose();
  });
});

describe("Phase 02 integration — a broken state core degrades, it does not break the boot", () => {
  it("falls back to the JSON store when the database file is not a database", () => {
    const root = tempRoot();
    const legacyFile = path.join(root, ".boss", "decision-ledger.json");
    const legacy = new DecisionLedgerStore(legacyFile);
    legacy.append(decision({ id: "json-only" }));
    // Corrupt the database path BEFORE the module opens it.
    fs.mkdirSync(path.dirname(path.join(root, ".boss", "state", "state.db")), { recursive: true });
    fs.writeFileSync(path.join(root, ".boss", "state", "state.db"), "this is not a sqlite database, padded out to be unhelpful");

    const module = createStateCoreModule({ dataRoot: root, legacy });
    const health = module.health();
    expect(health.status, "a corrupt database must DEGRADE, not fail the boot").toBe("DEGRADED");
    expect(health.detail).toContain("state core DEGRADED");
    expect(module.service.active).toBe(false);
    // The application still has a working durable ledger, through the legacy store.
    expect(module.service.ledger.list().map((entry) => entry.id)).toEqual(["json-only"]);
    const appended = module.service.ledger.append(decision({ id: "still-works" }));
    expect(appended.id).toBe("still-works");
    expect(legacy.list().map((entry) => entry.id).sort()).toEqual(["json-only", "still-works"]);
    module.dispose();
  });

  it("refuses a schema from a newer build and keeps the JSON ledger authoritative", () => {
    const root = tempRoot();
    const legacyFile = path.join(root, ".boss", "decision-ledger.json");
    const legacy = new DecisionLedgerStore(legacyFile);
    legacy.append(decision({ id: "survivor" }));

    // First boot creates the database, then a later build's schema is simulated.
    const setup = createStateCoreModule({ dataRoot: root, legacy });
    setup.dispose();
    const dbFile = path.join(root, ".boss", "state", "state.db");
    const handle = openDatabase(dbFile);
    handle.raw.exec("PRAGMA user_version = 99");
    handle.close();

    const module = createStateCoreModule({ dataRoot: root, legacy });
    expect(module.health().status).toBe("DEGRADED");
    expect(module.health().detail).toMatch(/newer than this build supports/);
    expect(module.service.ledger.list().map((entry) => entry.id)).toEqual(["survivor"]);
    module.dispose();
  });

  it("reports a promotion attempt as a failure rather than throwing when degraded", () => {
    const root = tempRoot();
    const legacyFile = path.join(root, ".boss", "decision-ledger.json");
    fs.mkdirSync(path.dirname(path.join(root, ".boss", "state", "state.db")), { recursive: true });
    fs.writeFileSync(path.join(root, ".boss", "state", "state.db"), "not a database either, just bytes to trip the opener");
    const module = createStateCoreModule({ dataRoot: root, legacy: new DecisionLedgerStore(legacyFile) });
    const result = module.service.promote();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not active");
    module.dispose();
  });

  it("disposes idempotently, so the reverse-order shutdown cannot throw", () => {
    const root = tempRoot();
    const module = createStateCoreModule({ dataRoot: root, legacy: new DecisionLedgerStore(path.join(root, ".boss", "decision-ledger.json")) });
    module.dispose();
    expect(() => module.dispose()).not.toThrow();
    expect(module.health().detail).toContain("disposed");
  });
});
