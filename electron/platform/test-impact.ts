/**
 * Impact selection over the real repository (Phase 05, Task A, second half).
 *
 * `src/shared/test-impact.ts` is the pure decision. This module is what feeds it: the capability
 * registry, the dependency graph, the test catalogue and the changed-file list, all read from the
 * repository rather than restated.
 *
 * ## Where ownership comes from, and why not from the manifests
 *
 * A manifest's `modules` field names the files a capability is made of — but in this repository it
 * currently lists only each capability's BOOT module, so the manifest set covers 25 files out of the
 * whole tree. Deriving test ownership from it would have produced a selector that attributes almost
 * every change to no capability at all, which is indistinguishable from a selector that never runs
 * anything. So the catalogue is explicit (`config/test-catalogue.json`, Task B's deliverable) and
 * `config/capability-modules.json` widens ownership to the implementation surface.
 *
 * ## Fail-closed is the default, not a special case
 *
 * Any input that cannot be established — an unknown git range, a file owned by no capability, a
 * catalogue that does not account for a test file — makes the answer "run everything" or an error.
 * The book's rollback rule is explicit: one piece of missed-coverage evidence and the selector
 * degrades to the full suite rather than continuing to accelerate.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { CapabilityId, CapabilityManifest } from "./capability-contract";
import type { DependencyGraph } from "./dependency-graph";
import { impactRadius } from "./dependency-graph";
import { buildCapabilityRegistry } from "./capability-registry";
import {
  selectTests,
  type FullRunTrigger,
  type TestSelection,
  type TestSuite,
  type TestTier
} from "../../src/shared/test-impact";

export const TEST_CATALOGUE_PATH = "config/test-catalogue.json";
export const CAPABILITY_MODULES_PATH = "config/capability-modules.json";

/** The catalogue file's shape. Validated on load; an invalid one throws rather than degrading. */
interface CatalogueFile {
  $comment?: string;
  suites: Array<{
    file: string;
    tier: TestTier;
    covers: string[];
    obligation?: string;
    alwaysRun?: boolean;
    why?: string;
  }>;
}

/** Additional source paths each capability owns, beyond the boot module its manifest declares. */
interface CapabilityModulesFile {
  $comment?: string;
  capabilities: Record<string, string[]>;
  /** Paths deliberately owned by no capability, each with the reason it is exempt. */
  exempt?: Record<string, string>;
}

export interface ImpactRepository {
  repoRoot: string;
  manifests: readonly CapabilityManifest[];
  graph: DependencyGraph;
  catalogue: TestSuite[];
  /** Every source path any capability owns, so an unattributed change is visible. */
  modulesByCapability: Map<string, string[]>;
  criticalCapabilities: Set<CapabilityId>;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) throw new Error(`${path.relative(process.cwd(), file)} is missing; the impact selector cannot run without it.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Load the catalogue and validate it against the tree.
 *
 * A catalogue entry naming a test file that does not exist would make the selector "pass" by
 * pointing at nothing, and a file that exists but is in no entry would be invisible to every
 * selection. Both are refused here rather than reported later.
 */
export function loadTestCatalogue(repoRoot: string, presentFiles: readonly string[]): TestSuite[] {
  const raw = readJson(path.join(repoRoot, TEST_CATALOGUE_PATH)) as CatalogueFile;
  if (!raw || !Array.isArray(raw.suites) || raw.suites.length === 0) {
    throw new Error(`${TEST_CATALOGUE_PATH} has no suites; an empty catalogue would select nothing for every change.`);
  }
  const present = new Set(presentFiles);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const suite of raw.suites) {
    if (!suite.file || typeof suite.file !== "string") { problems.push("a suite entry has no file"); continue; }
    if (seen.has(suite.file)) problems.push(`${suite.file} is listed twice`);
    seen.add(suite.file);
    if (!present.has(suite.file)) problems.push(`${suite.file} does not exist`);
    if (!Array.isArray(suite.covers) || suite.covers.length === 0) {
      problems.push(`${suite.file} covers no capability, so no change can ever select it`);
    }
    if (!suite.tier) problems.push(`${suite.file} declares no tier`);
  }
  for (const file of presentFiles) {
    if (!seen.has(file)) problems.push(`${file} is a test file that no catalogue entry accounts for, so a change to what it guards cannot select it`);
  }
  if (problems.length > 0) {
    throw new Error(`the test catalogue does not describe this tree:\n  ${problems.slice(0, 20).join("\n  ")}${problems.length > 20 ? `\n  ... and ${problems.length - 20} more` : ""}`);
  }
  return raw.suites.map((suite) => ({
    file: suite.file,
    tier: suite.tier,
    covers: [...suite.covers].sort(),
    ...(suite.obligation === undefined ? {} : { obligation: suite.obligation }),
    ...(suite.alwaysRun === undefined ? {} : { alwaysRun: suite.alwaysRun })
  }));
}

/** Build the ownership map: the manifest's own modules, widened by the explicit additions. */
export function buildModuleOwnership(repoRoot: string, manifests: readonly CapabilityManifest[]): Map<string, string[]> {
  const registry = manifests.map((manifest) => ({ id: manifest.id, modules: [...manifest.modules] }));
  const extra = readJson(path.join(repoRoot, CAPABILITY_MODULES_PATH)) as CapabilityModulesFile;
  const known = new Set(manifests.map((manifest) => manifest.id));
  for (const [capabilityId, modules] of Object.entries(extra.capabilities ?? {})) {
    if (!known.has(capabilityId)) throw new Error(`${CAPABILITY_MODULES_PATH} names capability ${capabilityId}, which no manifest declares.`);
    const entry = registry.find((candidate) => candidate.id === capabilityId);
    if (entry) entry.modules.push(...modules);
  }
  const byCapability = new Map<string, string[]>();
  for (const entry of registry) byCapability.set(entry.id, [...new Set(entry.modules)].sort());
  return byCapability;
}

/** Load everything the selector needs, and refuse to proceed on an inconsistent tree. */
export function loadImpactRepository(repoRoot: string = process.cwd(), presentTestFiles?: readonly string[]): ImpactRepository {
  const registry = buildCapabilityRegistry(repoRoot);
  const files = presentTestFiles ?? discoverTestFiles(repoRoot);
  const catalogue = loadTestCatalogue(repoRoot, files);
  const byCapability = buildModuleOwnership(repoRoot, registry.manifests);
  const critical = new Set(registry.graph.nodes.filter((node) => node.critical).map((node) => node.id));
  return {
    repoRoot,
    manifests: registry.manifests,
    graph: registry.graph,
    catalogue,
    modulesByCapability: byCapability,
    criticalCapabilities: critical
  };
}

/** Every `*.test.ts(x)` under `tests/`, repo-relative POSIX and sorted. */
export function discoverTestFiles(repoRoot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(child); continue; }
      if (/\.test\.tsx?$/.test(entry.name)) found.push(path.relative(repoRoot, child).split(path.sep).join("/"));
    }
  };
  walk(path.join(repoRoot, "tests"));
  return found.sort();
}

/** Select suites for a change set. The graph and catalogue come from the repository. */
export function selectForChange(
  repository: ImpactRepository,
  changedFiles: readonly string[],
  options: { trigger?: FullRunTrigger; changedSetUnknown?: boolean } = {}
): TestSelection {
  const radius = (capabilityId: string): string[] => impactRadius(repository.graph, capabilityId);
  return selectTests({
    changedFiles,
    catalogue: repository.catalogue,
    modulesByCapability: repository.modulesByCapability,
    impactRadius: radius,
    criticalCapabilities: repository.criticalCapabilities,
    ...(options.trigger === undefined ? {} : { trigger: options.trigger }),
    ...(options.changedSetUnknown === undefined ? {} : { changedSetUnknown: options.changedSetUnknown })
  });
}

/**
 * The change set between a base commit and the working tree.
 *
 * Returns `undefined` rather than an empty list when the range cannot be computed — a shallow
 * clone, an unrelated base, a missing commit. An empty list would read as "nothing changed" and
 * select nothing, which is the most dangerous possible answer.
 */
export function changedFilesSince(repoRoot: string, base: string, run: (args: string[]) => { status: number | null; output: string }): string[] | undefined {
  const merge = run(["-C", repoRoot, "merge-base", "--is-ancestor", base, "HEAD"]);
  if (merge.status !== 0) return undefined;
  const diff = run(["-C", repoRoot, "diff", "--name-only", `${base}...HEAD`]);
  if (diff.status !== 0) return undefined;
  const committed = diff.output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const status = run(["-C", repoRoot, "status", "--porcelain"]);
  if (status.status !== 0) return undefined;
  const working = status.output.split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0)
    // A rename is reported as `old -> new`; both sides matter, the new one more so.
    .flatMap((line) => line.includes(" -> ") ? line.split(" -> ").map((part) => part.trim()) : [line]);
  return [...new Set([...committed, ...working])].sort();
}

/** Files that exist on disk but that no capability owns, with the exemption list applied. */
export function unattributedSourceFiles(repoRoot: string, modulesByCapability: ReadonlyMap<string, readonly string[]>): string[] {
  const extra = readJson(path.join(repoRoot, CAPABILITY_MODULES_PATH)) as CapabilityModulesFile;
  const exempt = new Set(Object.keys(extra.exempt ?? {}));
  const owned = new Set<string>();
  for (const modules of modulesByCapability.values()) for (const module of modules) owned.add(module.replace(/\\/g, "/").replace(/\/+$/, ""));
  // An entry may name a DIRECTORY, in which case it owns everything beneath it. Testing bare
  // membership here would report every file under an owned directory as unowned — which would make
  // the gap list grow with coverage rather than shrink, and hide the files that are genuinely
  // unattributed among the ones that are not.
  const unowned: string[] = [];
  const isOwned = (file: string): boolean => {
    if (owned.has(file) || exempt.has(file)) return true;
    for (const entry of owned) if (file.startsWith(`${entry}/`)) return true;
    for (const entry of exempt) if (file.startsWith(`${entry}/`)) return true;
    return false;
  };
  for (const dir of ["electron", "src/shared"]) {
    const walk = (current: string): void => {
      const absolute = path.join(repoRoot, current);
      if (!existsSync(absolute)) return;
      for (const entry of require("node:fs").readdirSync(absolute, { withFileTypes: true })) {
        const child = `${current}/${entry.name}`;
        if (entry.isDirectory()) { walk(child); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (isOwned(child)) continue;
        unowned.push(child);
      }
    };
    walk(dir);
  }
  return unowned.sort();
}
