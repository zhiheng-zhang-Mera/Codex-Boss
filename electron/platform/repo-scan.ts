import fs from "node:fs";
import path from "node:path";
import { buildCapabilityRegistry, wiredBootFactories, type CapabilityRegistry } from "./capability-registry";
import type { ArchitectureEvidence } from "./architecture-ratchet";

/**
 * Repository scan (platform foundation, Phase 01 Task D evidence gathering).
 *
 * Turns the repository's real sources into the plain-data `ArchitectureEvidence`
 * the ratchet evaluates. Split from `architecture-ratchet.ts` so the ratchet's
 * decision logic stays a pure function that a test can drive with a hand-built
 * broken repository, while everything that touches the filesystem lives here.
 *
 * Imports are resolved by string, not by the TypeScript resolver, because the rule
 * being checked is "does this module reach into that one" — a path that fails to
 * resolve is not a dependency, and pretending otherwise would invent edges.
 */

const TS_EXTENSIONS = [".ts", ".tsx"] as const;

/** Import specifiers in a source file, supporting this repo's multi-line style. */
const IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:type\s+)?[^;\n]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

/** Every import specifier in a source text, in source order. */
export function importSpecifiers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(IMPORT_PATTERN)) found.push(match[1] ?? match[2] ?? match[3] ?? match[4] ?? "");
  return found.filter((entry) => entry !== "");
}

/**
 * Resolve a relative specifier to a repo-relative POSIX path, or undefined.
 *
 * Only relative specifiers can be capability edges; a bare package name (`yaml`,
 * `electron`) is an external dependency and is never a capability coupling.
 */
export function resolveSpecifier(specifier: string, fromFile: string, repoRoot: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(repoRoot, path.dirname(fromFile), specifier);
  const withoutJs = base.endsWith(".js") ? base.slice(0, -3) : base;
  const candidates = [
    ...TS_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...TS_EXTENSIONS.map((extension) => `${withoutJs}${extension}`),
    ...TS_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
    ...TS_EXTENSIONS.map((extension) => path.join(withoutJs, `index${extension}`))
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(repoRoot, candidate).split(path.sep).join("/");
    }
  }
  return undefined;
}

/** Count literal `ipcMain.handle("<channel>"` registrations in the composition root. */
export function countLiteralIpcRegistrations(mainSource: string): number {
  return [...mainSource.matchAll(/ipcMain\.handle\(\s*["'`]/g)].length;
}

interface ScanOptions {
  repoRoot?: string;
  /** Injected so a test can supply a registry without touching the disk. */
  registry?: CapabilityRegistry;
}

/**
 * Gather every fact the ratchet needs.
 *
 * Imports are collected from the union of every module a manifest claims, so the
 * scan costs one read per owned module rather than one per file in the repository.
 * A module claimed by two capabilities is reported by `moduleOwnershipConflicts`
 * rather than silently assigned to the last manifest read.
 */
export function gatherArchitectureEvidence(options: ScanOptions = {}): ArchitectureEvidence & { moduleOwnershipConflicts: Array<{ module: string; capabilities: string[] }> } {
  const repoRoot = options.repoRoot ?? process.cwd();
  const registry = options.registry ?? buildCapabilityRegistry(repoRoot);

  const moduleOwners: Record<string, string> = {};
  const ownershipConflicts = new Map<string, Set<string>>();
  const capabilityKinds: Record<string, "kernel" | "feature"> = {};
  const capabilitySurfaces: Record<string, string[]> = {};

  for (const manifest of registry.manifests) {
    capabilityKinds[manifest.id] = manifest.kind;
    capabilitySurfaces[manifest.id] = [...manifest.surface].sort();
    for (const module of manifest.modules) {
      const existing = moduleOwners[module];
      if (existing && existing !== manifest.id) {
        const set = ownershipConflicts.get(module) ?? new Set<string>([existing]);
        set.add(manifest.id);
        ownershipConflicts.set(module, set);
        continue;
      }
      moduleOwners[module] = manifest.id;
    }
  }

  const imports: ArchitectureEvidence["imports"] = [];
  for (const module of Object.keys(moduleOwners).sort()) {
    const absolute = path.join(repoRoot, ...module.split("/"));
    if (!fs.existsSync(absolute)) continue;
    const text = fs.readFileSync(absolute, "utf8");
    const fromCapability = moduleOwners[module];
    for (const specifier of new Set(importSpecifiers(text))) {
      const target = resolveSpecifier(specifier, module, repoRoot);
      if (!target) continue;
      const toCapability = moduleOwners[target];
      // An import of a shared (unclaimed) module is not a capability edge.
      if (!toCapability) continue;
      imports.push({ from: module, to: target, fromCapability, toCapability });
    }
  }

  const mainRelative = "electron/main.ts";
  const mainAbsolute = path.join(repoRoot, mainRelative);
  const mainSource = fs.existsSync(mainAbsolute) ? fs.readFileSync(mainAbsolute, "utf8") : "";

  const wired = wiredBootFactories(repoRoot);
  const registered = Object.keys(registry.bootModuleOwners).sort();

  return {
    graph: registry.graph,
    ownership: registry.ownership,
    moduleOwners,
    capabilityKinds,
    capabilitySurfaces,
    imports,
    wiredBootFactories: wired,
    registeredBootFactories: registered,
    literalIpcRegistrations: countLiteralIpcRegistrations(mainSource),
    mainEntry: mainRelative,
    moduleOwnershipConflicts: [...ownershipConflicts.entries()]
      .map(([module, capabilities]) => ({ module, capabilities: [...capabilities].sort() }))
      .sort((left, right) => (left.module < right.module ? -1 : 1))
  };
}
