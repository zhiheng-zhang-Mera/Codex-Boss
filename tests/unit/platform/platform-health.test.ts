import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCapabilityManifests } from "../../../electron/platform/capability-manifest";
import { buildCapabilityRegistry } from "../../../electron/platform/capability-registry";
import { buildDependencyGraph } from "../../../electron/platform/dependency-graph";
import { evaluatePlatformHealth, healthAfterRemoval } from "../../../electron/platform/platform-health";
import { CAPABILITIES_ROOT } from "../../../electron/platform/capability-registry";
import type { CapabilityManifest } from "../../../electron/platform/capability-contract";

/**
 * Phase 01 — acceptance gate 5.
 *
 * "Deleting any non-critical optional manifest must leave Boss bootable with the
 * affected capability reported as DEGRADED, and must not bring the whole platform
 * down."
 *
 * That sentence is checked here in the two ways it can be read, and both matter:
 *
 *  1. AS A DATA PROPERTY. Removing a manifest from the set is evaluated for every
 *     non-critical capability, one at a time, against the REAL manifest set. The
 *     platform must stay bootable each time. This catches a manifest that made itself
 *     load-bearing without saying so.
 *
 *  2. AS A FILE PROPERTY. A capability whose manifest is absent from
 *     `config/capabilities` must not break manifest loading for the others — which is
 *     the failure mode a shared registry would have, where one missing file makes the
 *     whole platform unreadable.
 */

const PROJECT = process.cwd();

function manifest(id: string, options: { critical?: boolean; requires?: string[]; provides?: string[] } = {}): CapabilityManifest {
  return {
    id,
    version: "1.0.0",
    kind: "feature",
    provides: options.provides ?? [`${id}.thing@1`],
    requires: (options.requires ?? []).map((ref) => ({ ref, capability: { id: ref.split("@")[0], major: 1 }, kind: "required" as const, reason: `${id} needs ${ref}` })),
    optional: [],
    state: [],
    health: { critical: options.critical ?? false },
    modules: [],
    bootModules: [],
    surface: [],
    permissions: [],
    source: `${id}.yaml`
  };
}

describe("Phase 01 — a missing optional capability degrades locally", () => {
  it("reports READY when everything a capability needs is present", () => {
    const manifests = [manifest("core"), manifest("leaf", { requires: ["core.thing@1"] })];
    const report = evaluatePlatformHealth(manifests, buildDependencyGraph(manifests));
    expect(report.entries.map((entry) => entry.state)).toEqual(["READY", "READY"]);
    expect(report.bootable).toBe(true);
    expect(report.degraded).toEqual([]);
  });

  it("degrades only the dependent when a non-critical provider is removed, and stays bootable", () => {
    const manifests = [manifest("core"), manifest("leaf", { requires: ["core.thing@1"] }), manifest("bystander")];
    const report = healthAfterRemoval(manifests, buildDependencyGraph(manifests), ["core"]);
    expect(report.bootable, "a non-critical capability's absence must not stop the platform").toBe(true);
    expect(report.fatal).toEqual([]);
    expect(report.degraded).toEqual(["leaf"]);
    expect(report.entries.find((entry) => entry.id === "leaf")?.detail).toContain("degraded");
    expect(report.entries.find((entry) => entry.id === "bystander")?.state).toBe("READY");
    // The absence is attributed, not silently tolerated: `leaf` names the provider it
    // lost. It is reported as `absentVia` rather than `missingRequired` because the
    // contract DID resolve against the full graph — the provider is simply not
    // installed, which is a different and more precise statement.
    expect(report.entries.find((entry) => entry.id === "leaf")?.absentVia).toEqual(["core"]);
    expect(report.entries.find((entry) => entry.id === "leaf")?.detail).toContain("core absent");
  });

  it("fails the whole platform when the missing capability declared itself critical", () => {
    const manifests = [manifest("core", { critical: true }), manifest("leaf", { requires: ["core.thing@1"] })];
    const report = healthAfterRemoval(manifests, buildDependencyGraph(manifests), ["core"]);
    expect(report.bootable).toBe(false);
    // `core` is the fatal one: it is ABSENT, not degraded, and losing a capability
    // that declared itself critical is the single condition that stops the platform.
    expect(report.fatal).toEqual(["core"]);
    expect(report.entries.find((entry) => entry.id === "core")?.state).toBe("ABSENT");
    expect(report.degraded, "an absent capability is not reported as degraded").toEqual(["leaf"]);
  });

  it("propagates degradation along required edges rather than only one hop", () => {
    // core <- middle <- leaf. Losing core must degrade BOTH, because `leaf` cannot
    // rely on a contract from a capability that is itself degraded.
    const manifests = [manifest("core"), manifest("middle", { requires: ["core.thing@1"] }), manifest("leaf", { requires: ["middle.thing@1"] })];
    const report = healthAfterRemoval(manifests, buildDependencyGraph(manifests), ["core"]);
    expect(report.bootable).toBe(true);
    expect(report.degraded).toEqual(["leaf", "middle"]);
    expect(report.entries.find((entry) => entry.id === "leaf")?.detail).toContain("middle degraded");
    expect(report.entries.find((entry) => entry.id === "middle")?.detail).toContain("core absent");
  });

  it("treats a missing OPTIONAL dependency as READY, because absence is the point", () => {
    const a = manifest("alpha");
    const b = manifest("beta");
    b.optional = [{ ref: "alpha.extra@1", capability: { id: "alpha.extra", major: 1 }, kind: "optional", reason: "widens beta" }];
    const report = healthAfterRemoval([a, b], buildDependencyGraph([a, b]), []);
    const beta = report.entries.find((entry) => entry.id === "beta");
    expect(beta?.state).toBe("READY");
    expect(beta?.detail).toContain("optional");
    expect(beta?.missingOptional.map((entry) => entry.ref)).toEqual(["alpha.extra@1"]);
  });
});

describe("Phase 01 acceptance gate 5 — every non-critical capability is removable", () => {
  const registry = buildCapabilityRegistry(PROJECT);

  it("stays bootable when ANY non-critical manifest is deleted", () => {
    const removable = registry.manifests.filter((entry) => !entry.health.critical);
    expect(removable.length, "nothing is removable, so this gate would be vacuous").toBeGreaterThan(15);
    const survivors: string[] = [];
    for (const entry of removable) {
      const report = healthAfterRemoval(registry.manifests, registry.graph, [entry.id]);
      if (!report.bootable) survivors.push(`${entry.id} -> fatal: ${report.fatal.join(", ")}`);
    }
    expect(survivors, "these capabilities cannot be removed without stopping the platform").toEqual([]);
  });

  it("degrades rather than crashes the capabilities that depended on the removed one", () => {
    // `persistence` is the one capability most of the graph needs, so removing it is
    // the strongest available test of local degradation. It is declared critical, so
    // its absence IS fatal by declaration — asserting both halves keeps the rule from
    // being satisfied by making everything non-critical.
    const persistence = registry.manifests.find((entry) => entry.id === "persistence");
    expect(persistence?.health.critical, "the durable-state kernel must be critical").toBe(true);
    const report = healthAfterRemoval(registry.manifests, registry.graph, ["persistence"]);
    expect(report.bootable).toBe(false);
    expect(report.fatal).toEqual(["persistence"]);
    // Everything that required it reports DEGRADED with the reason, not a crash —
    // including `research`, which requires `knowledge` and only reaches persistence
    // transitively.
    const degraded = report.entries.filter((entry) => entry.state === "DEGRADED").map((entry) => entry.id);
    expect(degraded).toContain("knowledge");
    expect(degraded).toContain("research");
    expect(report.entries.find((entry) => entry.id === "knowledge")?.detail).toContain("persistence absent");
    expect(report.entries.find((entry) => entry.id === "research")?.detail).toContain("knowledge degraded");
  });

  it("is unaffected in the manifest loader by ONE file being absent", () => {
    // Copy the real manifest set minus one file: the rest must load exactly as before.
    const root = path.join(PROJECT, ...CAPABILITIES_ROOT.split("/"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-removal-"));
    try {
      const files = fs.readdirSync(root).filter((name) => /\.(ya?ml|json)$/i.test(name));
      const removed = "theme.yaml";
      for (const name of files) {
        if (name === removed) continue;
        fs.copyFileSync(path.join(root, name), path.join(dir, name));
      }
      const loaded = loadCapabilityManifests(dir, dir);
      expect(loaded.map((entry) => entry.id)).not.toContain("theme");
      expect(loaded.length).toBe(files.length - 1);
      // The remaining graph is still acyclic and still resolves its own edges.
      const partial = buildDependencyGraph(loaded);
      expect(partial.fatalCycles).toEqual([]);
      expect(partial.nodes.find((node) => node.id === "knowledge")?.missing).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
