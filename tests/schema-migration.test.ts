import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MigrationRegistry, migrateJsonFile, readEnvelope, schemaMigrations, type Migration } from "../electron/commander/schema-migration";
import { ContextManager } from "../electron/commander/context-manager";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-migration-")); dirs.push(dir); return dir; }
const now = () => new Date(2026, 0, 1).getTime();

describe("MigrationRegistry", () => {
  it("rejects malformed, duplicate and non-contiguous steps", () => {
    const registry = new MigrationRegistry();
    expect(() => registry.register("demo", { from: -1, to: 0, migrate: (value) => value })).toThrow(/Invalid schema id|exactly one version/);
    expect(() => registry.register("demo", { from: 1, to: 1, migrate: (value) => value })).toThrow(/exactly one version/);
    registry.register("demo", { from: 0, to: 1, migrate: (value) => value });
    expect(() => registry.register("demo", { from: 0, to: 1, migrate: (value) => value })).toThrow(/Duplicate/);
    expect(() => registry.register("demo", { from: 2, to: 3, migrate: (value) => value })).toThrow(/gap/);
  });

  it("migrates a copy through the chain with an append-only history and never mutates input", () => {
    const registry = new MigrationRegistry();
    registry.register("person", { from: 0, to: 1, migrate: (value) => ({ ...(value as object), version: 1 }), validate: (value) => { if (!(value as Record<string, unknown>).name) throw new Error("missing name"); } });
    registry.register("person", { from: 1, to: 2, migrate: (value) => ({ ...(value as object), age: 30 }) });
    const input = { name: "Ada" };
    const outcome = registry.migrate("person", 0, input, "test", now);
    expect(outcome.to).toBe(2);
    expect(outcome.payload).toEqual({ name: "Ada", version: 1, age: 30 });
    expect(outcome.history.map((entry) => `${entry.from}->${entry.to}`)).toEqual(["0->1", "1->2"]);
    expect(input).toEqual({ name: "Ada" }); // input untouched (copy semantics)
  });

  it("fails closed on future or gapped versions", () => {
    const registry = new MigrationRegistry();
    registry.register("person", { from: 0, to: 1, migrate: (value) => value });
    expect(() => registry.migrate("person", 5, {}, "test", now)).toThrow(/future schema version/);
    expect(() => registry.migrate("person", 2, {}, "test", now)).toThrow(/future schema version/);
    // A schema with no registered steps stays at version 0 (legacy, no-op).
    const empty = new MigrationRegistry();
    expect(empty.migrate("unregistered", 0, {}, "test", now).to).toBe(0);
    expect(() => empty.migrate("unregistered", 1, {}, "test", now)).toThrow(/future schema version/);
  });

  it("propagates a step validation failure without committing anything", () => {
    const registry = new MigrationRegistry();
    registry.register("person", { from: 0, to: 1, migrate: (value) => ({ ...(value as object), broken: true }), validate: () => { throw new Error("validation rejected"); } });
    expect(() => registry.migrate("person", 0, { name: "Ada" }, "test", now)).toThrow(/validation rejected/);
  });
});

describe("migrateJsonFile read-old → migrate-copy → commit", () => {
  it("upgrades a legacy unversioned JSON file to the v1 envelope and is idempotent", () => {
    const file = path.join(root(), "data.json");
    fs.writeFileSync(file, JSON.stringify(["a", "b"]), "utf8");
    schemaMigrations.register("fixture", { from: 0, to: 1, migrate: (value) => ({ items: value as string[], total: (value as string[]).length }) });
    migrateJsonFile("fixture", file, "test");
    const first = JSON.parse(fs.readFileSync(file, "utf8")) as { schema_id: string; schema_version: number; migration_history: { from: number; to: number }[]; data: { items: string[]; total: number } };
    expect(first.schema_id).toBe("fixture");
    expect(first.schema_version).toBe(1);
    expect(first.data).toEqual({ items: ["a", "b"], total: 2 });
    expect(first.migration_history).toHaveLength(1);
    expect(first.migration_history[0]).toMatchObject({ from: 0, to: 1 });

    // Running again on the envelope is a no-op (version already latest).
    const before = fs.readFileSync(file, "utf8");
    migrateJsonFile("fixture", file, "test");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("leaves the original file intact when migration validation fails", () => {
    const file = path.join(root(), "bad.json");
    const original = JSON.stringify(["x"]);
    fs.writeFileSync(file, original, "utf8");
    schemaMigrations.register("bad-file", { from: 0, to: 1, migrate: () => { throw new Error("boom"); } });
    expect(() => migrateJsonFile("bad-file", file, "test")).toThrow(/boom/);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("fails closed on a file that declares a future schema version", () => {
    const file = path.join(root(), "future.json");
    fs.writeFileSync(file, JSON.stringify({ schema_id: "future-file", schema_version: 9, data: [] }), "utf8");
    schemaMigrations.register("future-file", { from: 0, to: 1, migrate: (value) => value });
    expect(() => migrateJsonFile("future-file", file, "test")).toThrow(/future schema version/);
  });
});

describe("readEnvelope", () => {
  it("reads versioned envelopes and reports legacy content as version 0", () => {
    expect(readEnvelope<number[]>(["a", "b"] as never)).toMatchObject({ schema_id: "", version: 0 });
    const envelope = { schema_id: "x", schema_version: 1, created_by: "test", migration_history: [], data: [1, 2] };
    expect(readEnvelope<number[]>(envelope)).toMatchObject({ schema_id: "x", version: 1, data: [1, 2] });
  });
});

describe("ContextManager schema adoption", () => {
  it("persists the v1 envelope and restores its contexts", () => {
    const file = path.join(root(), "task-contexts.json");
    const manager = new ContextManager(file);
    manager.save({ taskId: "task", objective: "objective", constraints: [], currentProtocol: "direct", currentRound: "1", resolvedClaims: [], openDisputes: [], artifactRefs: [], summaries: [], executionHistory: [] });
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { schema_id: string; schema_version: number; data: unknown[] };
    expect(parsed.schema_id).toBe("task-contexts");
    expect(parsed.schema_version).toBe(1);
    expect(new ContextManager(file).get("task")?.objective).toBe("objective");
  });

  it("upgrades a legacy unversioned context file on first load", () => {
    const file = path.join(root(), "task-contexts.json");
    const context = { taskId: "legacy", objective: "old", constraints: [], currentProtocol: "direct", currentRound: "1", resolvedClaims: [], openDisputes: [], artifactRefs: [], summaries: [], executionHistory: [] };
    fs.writeFileSync(file, JSON.stringify([context]), "utf8");
    const manager = new ContextManager(file);
    expect(manager.get("legacy")?.objective).toBe("old");
    const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as { schema_id: string; schema_version: number; migration_history: unknown[]; data: unknown[] };
    expect(envelope.schema_id).toBe("task-contexts");
    expect(envelope.schema_version).toBe(1);
    expect(envelope.migration_history).toHaveLength(1);
  });
});
