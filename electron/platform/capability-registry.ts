import fs from "node:fs";
import path from "node:path";
import { loadCapabilityManifests } from "./capability-manifest";
import { buildDependencyGraph, type DependencyGraph } from "./dependency-graph";
import { buildStateOwnershipRegistry, type StateOwnershipRegistry } from "./state-ownership";
import type { CapabilityId, CapabilityManifest, CapabilitySummary } from "./capability-contract";

/**
 * Capability registry (platform foundation, Phase 01 Tasks A–C integration).
 *
 * Loads the manifests, builds the graph and the ownership registry, and binds them
 * to the composition root's real boot factories.
 *
 * READ-ONLY BY DESIGN. Despite the name it is not a service locator and must never
 * become one: it resolves nothing, injects nothing and is constructed by nothing in
 * the boot path. `electron/main.ts` continues to build every module with an explicit
 * factory call and hand it its dependencies; this registry only *describes* that
 * wiring so a test or a diagnostic command can check it. The engineering book
 * forbids a DI container in this repository, and the cheapest way to honour that is
 * to keep resolution entirely out of this file.
 *
 * `process.cwd()` is the repository root, which is how the existing architecture
 * guards under `tests/unit/` already locate the sources.
 */

/** Where the manifests live, repo-relative. */
export const CAPABILITIES_ROOT = "config/capabilities";

/** Where the ratchet baseline lives, repo-relative. */
export const ARCHITECTURE_BASELINE_PATH = "config/architecture-baseline.json";

/** Where the phase artifact is written, repo-relative. */
export const ARCHITECTURE_SNAPSHOT_PATH = "artifacts/platform-foundation/phase-01/architecture-snapshot.json";

export interface CapabilityRegistry {
  /** Manifest set, sorted by id. */
  manifests: CapabilityManifest[];
  graph: DependencyGraph;
  ownership: StateOwnershipRegistry;
  /** `bootModules` path -> owning capability. Built once so the mapping is checkable. */
  bootModuleOwners: Record<string, CapabilityId>;
  /** Repo root the paths are relative to. */
  repoRoot: string;
}

/** Every `electron/bootstrap/*.ts` factory file, repo-relative POSIX, sorted. */
export function bootFactoryFiles(repoRoot: string): string[] {
  const dir = path.join(repoRoot, "electron", "bootstrap");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && name !== "boot-module.ts")
    .map((name) => `electron/bootstrap/${name}`)
    .sort();
}

/** Load the manifests and build the registry. Throws when a manifest is invalid. */
export function buildCapabilityRegistry(repoRoot: string = process.cwd()): CapabilityRegistry {
  const manifests = loadCapabilityManifests(path.join(repoRoot, CAPABILITIES_ROOT), repoRoot);
  const graph = buildDependencyGraph(manifests);
  const ownership = buildStateOwnershipRegistry(manifests);
  const bootModuleOwners: Record<string, CapabilityId> = {};
  for (const manifest of manifests) {
    for (const bootModule of manifest.bootModules) bootModuleOwners[bootModule] = manifest.id;
  }
  return { manifests, graph, ownership, bootModuleOwners, repoRoot };
}

/**
 * Boot factories the composition root actually calls, as `electron/bootstrap/*.ts`.
 *
 * Read out of `main.ts` rather than from the boot factory list on disk: the rule is
 * about what is *wired*, and a file that exists but is never constructed must not
 * count as a registered capability. The two sets are compared by the architecture
 * ratchet, which is what makes an unregistered module detectable.
 *
 * The call pattern must allow a type-argument list between the identifier and `(`:
 * `createRuntimeModule<BrowserWindow>({` is a real call in `main.ts`, and matching
 * only `name(` undercounts the wired set and would let a module go unregistered.
 */
export function wiredBootFactories(repoRoot: string): string[] {
  const main = path.join(repoRoot, "electron", "main.ts");
  if (!fs.existsSync(main)) return [];
  const text = fs.readFileSync(main, "utf8");
  const called = new Set([...text.matchAll(/\b(create[A-Za-z0-9]+)\s*(?:<[^>();]*>)?\s*\(/g)].map((match) => match[1]));

  const wired: string[] = [];
  for (const file of bootFactoryFiles(repoRoot)) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    const exported = [...source.matchAll(/export function (create[A-Za-z0-9]+)\s*(?:<[^>();]*>)?\s*\(/g)].map((match) => match[1]);
    if (exported.some((name) => called.has(name))) wired.push(file);
  }
  return wired;
}

/** A compact, serialisable view of a manifest for the snapshot artifact. */
export function summarizeCapability(manifest: CapabilityManifest): CapabilitySummary {
  return {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    critical: manifest.health.critical,
    provides: [...manifest.provides].sort(),
    requires: manifest.requires.map((entry) => entry.ref).sort(),
    optional: manifest.optional.map((entry) => entry.ref).sort(),
    state: manifest.state.map((entry) => entry.namespace).sort(),
    moduleCount: manifest.modules.length,
    bootModuleCount: manifest.bootModules.length
  };
}
