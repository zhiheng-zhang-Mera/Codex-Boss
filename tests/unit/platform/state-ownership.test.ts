import { describe, expect, it } from "vitest";
import { buildCapabilityRegistry } from "../../../electron/platform/capability-registry";
import {
  authoritativeOwnerOf,
  buildStateOwnershipRegistry,
  unregisteredNamespaces
} from "../../../electron/platform/state-ownership";
import type { CapabilityManifest } from "../../../electron/platform/capability-contract";

/**
 * Phase 01 Task C — the state ownership registry.
 *
 * The invariant is "exactly one authoritative owner per durable namespace", and the
 * engineering book requires the multi-owner case to FAIL A TEST rather than be
 * tolerated. The negative cases below construct the conflict directly, so the rule
 * is proven by breaking it here rather than by asserting that today's inventory
 * happens to be clean.
 */

function manifest(id: string, namespaces: string[], kind: "kernel" | "feature" = "feature"): CapabilityManifest {
  return {
    id,
    version: "1.0.0",
    kind,
    provides: [`${id}.thing@1`],
    requires: [],
    optional: [],
    state: namespaces.map((namespace) => ({ namespace, owner: id })),
    health: { critical: false },
    modules: [],
    bootModules: [],
    surface: [],
    permissions: [],
    source: `${id}.yaml`
  };
}

describe("Phase 01 Task C — one authoritative owner", () => {
  it("records a single owner per namespace", () => {
    const registry = buildStateOwnershipRegistry([manifest("alpha", ["alpha.one", "alpha.two"]), manifest("beta", ["beta.one"])]);
    expect(registry.conflicts).toEqual([]);
    expect(registry.namespaces.map((entry) => entry.namespace)).toEqual(["alpha.one", "alpha.two", "beta.one"]);
    expect(registry.ownerOf["alpha.one"]).toBe("alpha");
    expect(registry.ownedBy["alpha"]).toEqual(["alpha.one", "alpha.two"]);
    expect(authoritativeOwnerOf(registry, "beta.one")).toBe("beta");
    expect(registry.declarationProblems).toEqual([]);
  });

  it("FAILS on a namespace with two owners, and refuses to answer who owns it", () => {
    const registry = buildStateOwnershipRegistry([manifest("alpha", ["shared.state"]), manifest("beta", ["shared.state"])]);
    expect(registry.conflicts.length).toBe(1);
    expect(registry.conflicts[0].namespace).toBe("shared.state");
    expect(registry.conflicts[0].owners).toEqual(["alpha", "beta"]);
    expect(registry.conflicts[0].message).toContain("2 authoritative owners");
    // A contested namespace is excluded rather than resolved by a coin flip: answering
    // "alpha" would read as a healthy registry.
    expect(authoritativeOwnerOf(registry, "shared.state")).toBeUndefined();
    expect(registry.namespaces.map((entry) => entry.namespace)).not.toContain("shared.state");
  });

  it("treats the same capability claiming a namespace twice as a single owner", () => {
    // The parser rejects a duplicate claim inside one manifest, so this is the
    // registry defending itself against a hand-built array — and the answer must be
    // "one owner", not "a conflict between alpha and alpha".
    const duplicated = manifest("alpha", ["alpha.one"]);
    duplicated.state.push({ namespace: "alpha.one", owner: "alpha" });
    const registry = buildStateOwnershipRegistry([duplicated]);
    expect(registry.conflicts).toEqual([]);
    expect(registry.ownerOf["alpha.one"]).toBe("alpha");
  });

  it("refuses a declaration whose owner is not the declaring capability", () => {
    const forged = manifest("alpha", []);
    forged.state.push({ namespace: "beta.one", owner: "beta" });
    const registry = buildStateOwnershipRegistry([forged]);
    expect(registry.declarationProblems.join("\n")).toContain("is not the declaring capability");
    expect(registry.ownerOf["beta.one"]).toBeUndefined();
  });

  it("reports a namespace observed at runtime that nothing declares", () => {
    const registry = buildStateOwnershipRegistry([manifest("alpha", ["alpha.one"])]);
    expect(unregisteredNamespaces(registry, ["alpha.one", "mystery.store", "alpha.one"])).toEqual(["mystery.store"]);
  });
});

describe("Phase 01 Task C — the repository's real ownership inventory", () => {
  const registry = buildCapabilityRegistry(process.cwd());

  it("has no duplicate owner across the real manifest set", () => {
    expect(registry.ownership.conflicts).toEqual([]);
    expect(registry.ownership.declarationProblems).toEqual([]);
  });

  it("inventories the durable namespaces Phase 01 is required to cover", () => {
    // The namespaces the engineering book names explicitly. Each must be inventoried
    // with an owner, so a later phase migrating one knows who to talk to.
    const names = registry.ownership.namespaces.map((entry) => entry.namespace);
    for (const required of ["tasks", "history", "app-state", "research-runs", "session-lifecycle", "node-registry", "decision-ledger", "permission-manifest", "telemetry", "knowledge-base"]) {
      expect(names, `${required} is not in the inventory`).toContain(required);
    }
    expect(names.length).toBeGreaterThanOrEqual(25);
  });

  it("gives every namespace exactly one declaration, and every owner a real capability", () => {
    for (const entry of registry.ownership.namespaces) {
      expect(entry.declaredBy.length, `${entry.namespace} has ${entry.declaredBy.length} declarations`).toBe(1);
      expect(registry.manifests.some((manifest) => manifest.id === entry.owner), `${entry.namespace} is owned by an unknown capability ${entry.owner}`).toBe(true);
    }
  });

  it("maps every owned namespace back through the owner index", () => {
    const flattened = Object.values(registry.ownership.ownedBy).flat().sort();
    expect(flattened).toEqual(registry.ownership.namespaces.map((entry) => entry.namespace).sort());
  });
});
