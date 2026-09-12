/**
 * Update-Plan/checkpoint-1.md §6 — Repository World Model.
 *
 * §6 preamble: "任何工程执行之前，Boss 必须建立 Repository World Model +
 * UI Surface Model." This module owns the *contract* and the deterministic
 * analysis half; the host-side builder that reads the filesystem and git lives
 * in electron/engineering/world-model.ts.
 *
 * Why it exists (§6.2/§6.3): before touching a repository, Boss has to be able
 * to answer three questions with evidence rather than assumption —
 *
 *   §6.1 what IS this repository (layout, package managers, languages, entry
 *        points, tests, CI, build system, runtime, git state, generated and
 *        ignored surfaces, workspace boundaries)?
 *   §6.2 what depends on what (module → imports → downstream → tests → runtime
 *        entry), so impact/scope/repair planning is derived, not guessed?
 *   §6.3 does the capability already exist — exists / partial / reserved /
 *        missing — so "implement from scratch" is never the silent default?
 *
 * Everything here is pure: no fs, no clock (callers pass `now`), no model.
 */
import { structuralHashOf } from "./task-fingerprint";

export const REPO_WORLD_MODEL_VERSION = "repo-world-model-1" as const;

/* ------------------------------------------------------------------ *
 * §6.1 Repository World Model
 * ------------------------------------------------------------------ */

export type ModuleKind = "SOURCE" | "TEST" | "STYLE" | "MARKUP" | "MANIFEST" | "CONFIG" | "GENERATED" | "OTHER";

export interface ModuleImport {
  /** The literal specifier written in the source. */
  specifier: string;
  /** Repository-relative path when the specifier resolves inside the repo. */
  resolved?: string;
  external: boolean;
  /** True for a platform builtin (node:fs): visible, but not a dependency edge. */
  builtin?: boolean;
}

export interface ModuleNode {
  /** Repository-relative posix path. */
  path: string;
  kind: ModuleKind;
  language: string;
  bytes: number;
  /** Exported symbol names (functions, classes, consts, types, interfaces). */
  exports: string[];
  imports: ModuleImport[];
  /** Test files co-located with this module's directory (from the repo scan). */
  test_files: string[];
  /** True when this module is one of the repository's entry points. */
  is_entry: boolean;
}

export interface GeneratedSurface {
  path: string;
  present: boolean;
  /** Why it is treated as generated/ignored rather than authored source. */
  reason: string;
}

export interface RepoWorkspaceBoundary {
  kind: "SINGLE" | "MONOREPO";
  packages: { path: string; name?: string }[];
  evidence: string[];
}

export interface RepoGitState {
  is_repository: boolean;
  head?: string;
  branch?: string;
  /** Count of tracked files reported as modified/added/deleted. */
  dirty_files?: number;
  reason?: string;
}

export interface RepoWorldModel {
  schemaVersion: 1;
  version: typeof REPO_WORLD_MODEL_VERSION;
  /** Content-addressed identity of the model (never a local path, §49). */
  id: string;
  generated_at: string;
  /** Repository fingerprint the model was derived from. */
  fingerprint: string;
  root: string;
  package_managers: string[];
  build_system: { tool: string; evidence: string[] }[];
  runtimes: string[];
  ci: { provider: string; files: string[] }[];
  languages: { language: string; files: number }[];
  entry_points: string[];
  modules: ModuleNode[];
  tests: string[];
  /** Directory (posix, "." for the root) → test files in it. */
  tests_by_directory: Record<string, string[]>;
  git: RepoGitState;
  generated_surfaces: GeneratedSurface[];
  /** Ignore files that exist, so "ignored" is an observation, not a guess. */
  ignore_files: string[];
  workspace: RepoWorkspaceBoundary;
  /** True when a bounded list hit its cap, so the model is deliberately partial. */
  truncated: boolean;
}

/* ------------------------------------------------------------------ *
 * §6.2 Dependency graph
 * ------------------------------------------------------------------ */

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "relative" | "external";
}

export interface DependencyGraph {
  schemaVersion: 1;
  nodes: string[];
  edges: DependencyEdge[];
  /** module → modules that import it (the "downstream" direction). */
  reverse: Record<string, string[]>;
  /** module → test files that cover it (co-located or same-directory). */
  tests_by_module: Record<string, string[]>;
  /** External package → importing modules. */
  external: { specifier: string; importers: string[] }[];
  /** Runtime entry points that (transitively) reach each module. */
  entries_by_module: Record<string, string[]>;
}

export const DEPENDENCY_GRAPH_LIMIT = 20000;

/** Builds the graph from the model's module list. Deterministic and idempotent. */
export function buildDependencyGraph(model: Pick<RepoWorldModel, "modules" | "entry_points" | "tests_by_directory">): DependencyGraph {
  const nodes = model.modules.map((module) => module.path).sort((a, b) => a.localeCompare(b));
  const edges: DependencyEdge[] = [];
  const reverse: Record<string, string[]> = {};
  const externalImporters = new Map<string, Set<string>>();
  const testsByModule: Record<string, string[]> = {};

  for (const module of model.modules) {
    for (const imported of module.imports) {
      if (imported.resolved && nodes.includes(imported.resolved)) {
        edges.push({ from: module.path, to: imported.resolved, kind: "relative" });
        (reverse[imported.resolved] ??= []).push(module.path);
      } else if (imported.external && !imported.builtin) {
        const packageName = packageNameOf(imported.specifier);
        (externalImporters.get(packageName) ?? externalImporters.set(packageName, new Set()).get(packageName)!).add(module.path);
        edges.push({ from: module.path, to: `external:${packageName}`, kind: "external" });
      }
    }
    const directory = dirnameOf(module.path);
    const tests = (model.tests_by_directory[directory] ?? []).slice();
    if (module.kind === "TEST") tests.push(module.path);
    if (tests.length) testsByModule[module.path] = [...new Set(tests)].sort((a, b) => a.localeCompare(b));
  }
  for (const list of Object.values(reverse)) list.sort((a, b) => a.localeCompare(b));

  return {
    schemaVersion: 1,
    nodes,
    edges: edges.slice(0, DEPENDENCY_GRAPH_LIMIT),
    reverse,
    tests_by_module: testsByModule,
    external: [...externalImporters.entries()].map(([specifier, importers]) => ({ specifier, importers: [...importers].sort() })).sort((a, b) => a.specifier.localeCompare(b.specifier)),
    entries_by_module: reachableFromEntries(model)
  };
}

/** Bare package name for a specifier: `@scope/pkg/x` → `@scope/pkg`, `a/b` → `a`. */
export function packageNameOf(specifier: string): string {
  const trimmed = specifier.trim();
  if (trimmed.startsWith("@")) return trimmed.split("/").slice(0, 2).join("/");
  return trimmed.split("/")[0];
}

function dirnameOf(relative: string): string {
  const index = relative.lastIndexOf("/");
  return index < 0 ? "." : relative.slice(0, index);
}

/**
 * Which runtime entry points reach each module. §6.2 lists "runtime entry" as
 * one of the graph's products, so it is computed here by walking each entry's
 * imports forward — the entry itself always reports itself, and a module no
 * entry reaches (a test, or dead code) stays absent rather than guessed.
 */
function reachableFromEntries(model: Pick<RepoWorldModel, "modules" | "entry_points">): Record<string, string[]> {
  const importsByModule = new Map<string, string[]>();
  for (const module of model.modules) {
    importsByModule.set(module.path, module.imports.map((entry) => entry.resolved).filter((value): value is string => Boolean(value)));
  }
  const out: Record<string, string[]> = {};
  for (const entry of model.entry_points) {
    if (!importsByModule.has(entry)) continue;
    const seen = new Set<string>([entry]);
    const queue = [entry];
    while (queue.length) {
      const current = queue.pop()!;
      (out[current] ??= []).push(entry);
      for (const imported of importsByModule.get(current) ?? []) {
        if (seen.has(imported)) continue;
        seen.add(imported);
        queue.push(imported);
      }
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.localeCompare(b));
  return out;
}

/* ------------------------------------------------------------------ *
 * §6.2 Impact analysis / scope inference
 * ------------------------------------------------------------------ */

export interface ImpactReport {
  changed: string[];
  /** Changed modules plus everything that imports them (transitively). */
  affected_modules: string[];
  /** Tests that cover the changed set or its affected neighbourhood. */
  tests: string[];
  /** Runtime entry points whose behaviour can change. */
  runtime_entries: string[];
  /** External packages the changed set depends on. */
  external_dependencies: string[];
  /** True when the change reaches a module no test covers. */
  untested: string[];
  reasons: string[];
}

/**
 * §6.2 impact analysis: given changed files, which modules, tests and runtime
 * entries are in scope. Used for scope inference and repair planning, so it
 * reports its reasons and never silently widens to "the whole repository".
 */
export function impactOf(graph: DependencyGraph, changed: readonly string[]): ImpactReport {
  const known = new Set(graph.nodes);
  const seeds = changed.map(normalizePath).filter((path) => known.has(path));
  const affected = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const current = queue.pop()!;
    for (const importer of graph.reverse[current] ?? []) {
      if (affected.has(importer)) continue;
      affected.add(importer);
      queue.push(importer);
    }
  }
  const tests = new Set<string>();
  for (const module of affected) for (const test of graph.tests_by_module[module] ?? []) tests.add(test);
  const runtimeEntries = new Set<string>();
  for (const module of affected) for (const entry of graph.entries_by_module[module] ?? []) runtimeEntries.add(entry);
  const external = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "external" && affected.has(edge.from)) external.add(edge.to.replace(/^external:/, ""));
  }
  const untested = [...affected].filter((module) => (graph.tests_by_module[module] ?? []).length === 0).sort();
  const reasons = [
    `${seeds.length} changed module(s) recognised in the graph`,
    `${affected.size - seeds.length} additional module(s) reach the change through imports`,
    `${tests.size} test file(s), ${runtimeEntries.size} runtime entry point(s) affected`,
    external.size ? `${external.size} external package(s) in scope` : "no external package in scope"
  ];
  if (changed.length !== seeds.length) reasons.push(`${changed.length - seeds.length} changed path(s) are not modules of this repository (ignored)`);
  return {
    changed: seeds,
    affected_modules: [...affected].sort(),
    tests: [...tests].sort(),
    runtime_entries: [...runtimeEntries].sort(),
    external_dependencies: [...external].sort(),
    untested,
    reasons
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

/* ------------------------------------------------------------------ *
 * §6.3 Existing capability discovery
 * ------------------------------------------------------------------ */

export type CapabilityVerdict = "EXISTS" | "PARTIAL" | "RESERVED" | "MISSING";

export interface CapabilityEvidence {
  kind: "module" | "export" | "type" | "test" | "wiring" | "absent";
  pointer: string;
  detail: string;
}

export interface CapabilityProbeResult {
  capability: string;
  verdict: CapabilityVerdict;
  confidence: number;
  evidence: CapabilityEvidence[];
  /** What the planner should do with this verdict (§6.3: never assume "from zero"). */
  recommendation: string;
  /** True when the capability is implemented but nothing imports it (dead code). */
  unwired: boolean;
}

export interface CapabilityProbeRequest {
  capability: string;
  /** Human wording, e.g. "UI theme registry with locked built-in themes". */
  description?: string;
  /** Extra literal terms to look for (module names, symbols, paths). */
  terms?: string[];
  /** Path prefixes that must exist for the capability to count. */
  requiresPaths?: string[];
}

const STOP_WORDS = new Set(["the", "and", "with", "for", "from", "that", "this", "into", "over", "then", "must", "can", "not", "any", "all", "one", "per", "its"]);

/** Deterministic keyword set for a capability description. */
export function capabilityTerms(request: CapabilityProbeRequest): string[] {
  const words = `${request.capability} ${request.description ?? ""}`
    .toLocaleLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
  const terms = new Set<string>();
  for (const word of words) {
    if (word.length < 4 || STOP_WORDS.has(word)) continue;
    terms.add(word);
    // A crude but deterministic stem so "registry" matches "registries".
    if (word.endsWith("ies")) terms.add(`${word.slice(0, -3)}y`);
    else if (word.endsWith("s")) terms.add(word.slice(0, -1));
  }
  for (const term of request.terms ?? []) if (term.trim()) terms.add(term.trim().toLocaleLowerCase());
  return [...terms].sort();
}

/**
 * §6.3: decide whether the capability already exists before planning work.
 *
 * Matching is deliberately strict: a module only counts as a candidate when it
 * matches a MAJORITY of the capability's significant terms (or carries the whole
 * term string). A single shared word is not evidence — otherwise "sandbox broker
 * daemon" would "exist" because the repository has a sandbox, and a planner
 * would extend the wrong thing instead of building the missing one.
 *
 * The verdicts are then conservative:
 *   EXISTS    an implementation module is matched AND something imports it or
 *             it is an entry point (i.e. it is reachable, not orphaned);
 *   PARTIAL   matched, but incomplete (only types/exports, or nothing imports
 *             it — the orphan case that a grep-only check would call "done");
 *   RESERVED  only a type/interface declaration matches, no runtime symbol;
 *   MISSING   no evidence at all.
 */
export function probeCapability(model: RepoWorldModel, graph: DependencyGraph, request: CapabilityProbeRequest): CapabilityProbeResult {
  const terms = capabilityTerms(request);
  const requiredHits = Math.max(1, Math.ceil(terms.length * 0.5));
  const evidence: CapabilityEvidence[] = [];
  const matched: ModuleNode[] = [];

  for (const module of model.modules) {
    // A module matches when ONE identifier (a path segment, the file stem, or a
    // single exported symbol) carries the required terms. Scattering the terms
    // across unrelated symbols is not evidence: `WorkDispatchKnowledge` +
    // `WorkDispatchStore` must not make a module "a knowledge store".
    const best = bestIdentifierMatch(module, terms);
    if (best.hits < requiredHits) continue;
    matched.push(module);
    for (const symbol of module.exports) {
      const symbolHits = terms.filter((term) => symbol.toLocaleLowerCase().includes(term));
      if (symbolHits.length < requiredHits) continue;
      evidence.push({ kind: "export", pointer: `${module.path}#${symbol}`, detail: `exported symbol carries ${symbolHits.join(", ")} (${symbolHits.length}/${terms.length} terms)` });
    }
    evidence.push({
      kind: module.kind === "TEST" ? "test" : module.exports.length ? "module" : "type",
      pointer: module.path,
      detail: `identifier "${best.identifier}" carries ${best.terms.join(", ")} (${best.hits}/${terms.length} terms); ${module.exports.length} export(s)`
    });
  }

  const requiredMissing = (request.requiresPaths ?? []).filter((required) => !model.modules.some((module) => module.path === normalizePath(required)));
  for (const required of requiredMissing) evidence.push({ kind: "absent", pointer: required, detail: "required path is absent from the repository model" });

  const implementation = matched.filter((module) => module.kind !== "TEST" && module.exports.length > 0);
  const production = implementation.filter((module) => isProductionWired(module, model, graph));
  const testOnly = implementation.filter((module) => !isProductionWired(module, model, graph) && isTestWired(module, graph));
  const unwired = implementation.length > 0 && production.length === 0;

  if (!matched.length) {
    return {
      capability: request.capability,
      verdict: "MISSING",
      confidence: 0.9,
      evidence: [{ kind: "absent", pointer: "repository", detail: `no module matches ${requiredHits}+ of ${terms.join(", ") || "(no usable terms)"}` }],
      recommendation: "no evidence of this capability: plan it as new work (never as an extension)",
      unwired: false
    };
  }
  if (requiredMissing.length || unwired) {
    const orphan = testOnly[0] ?? implementation[0];
    const reason = orphan === undefined
      ? "no implementation module matched"
      : testOnly.includes(orphan)
        ? "only test code imports it; the product never reaches it"
        : "nothing imports it and it is not an entry point (dead code)";
    return {
      capability: request.capability,
      verdict: "PARTIAL",
      confidence: 0.7,
      evidence: orphan === undefined
        ? evidence
        : [{ kind: "wiring", pointer: orphan.path, detail: reason }, ...evidence],
      recommendation: orphan === undefined
        ? `extend the existing modules and add the ${requiredMissing.join(", ")} surface`
        : `extend ${orphan.path} AND wire it into a real caller — ${reason}; do not implement a second copy`,
      unwired: true
    };
  }
  if (!implementation.length) {
    return {
      capability: request.capability,
      verdict: "RESERVED",
      confidence: 0.6,
      evidence,
      recommendation: `only declarations/tests match; treat ${matched[0].path} as an interface to implement behind, not as a working capability`,
      unwired: false
    };
  }
  return {
    capability: request.capability,
    verdict: "EXISTS",
    confidence: 0.85,
    evidence,
    recommendation: `reuse/extend ${production[0].path} (already reachable from ${(graph.entries_by_module[production[0].path] ?? ["production code"]).join(", ")})`,
    unwired: false
  };
}

/**
 * Best single-identifier term overlap for a module: the file path, each path
 * segment and stem, and every exported symbol. Returns the winning identifier so
 * the verdict can quote exactly what it matched on.
 */
export function bestIdentifierMatch(module: ModuleNode, terms: readonly string[]): { identifier: string; hits: number; terms: string[] } {
  const identifiers = new Set<string>([module.path.toLocaleLowerCase()]);
  for (const segment of module.path.toLocaleLowerCase().split("/")) {
    if (!segment) continue;
    identifiers.add(segment);
    identifiers.add(segment.replace(/\.[a-z0-9]+$/, ""));
  }
  for (const symbol of module.exports) identifiers.add(symbol.toLocaleLowerCase());
  let best = { identifier: "", hits: 0, terms: [] as string[] };
  for (const identifier of identifiers) {
    const hits = terms.filter((term) => identifier.includes(term));
    if (hits.length > best.hits) best = { identifier, hits: hits.length, terms: hits };
  }
  return best;
}

/**
 * Production wiring: some non-test module imports it, or it is an entry point.
 * A module that only its own tests import is NOT a capability the product can
 * use, which is exactly the difference §6.3 has to preserve.
 */
function isProductionWired(module: ModuleNode, model: RepoWorldModel, graph: DependencyGraph): boolean {
  if (module.is_entry || model.entry_points.includes(module.path)) return true;
  const importers = graph.reverse[module.path] ?? [];
  return importers.some((importer) => !isTestPath(importer, model));
}

/** Test wiring: exercises the module, but does not make it reachable. */
function isTestWired(module: ModuleNode, graph: DependencyGraph): boolean {
  return (graph.reverse[module.path] ?? []).length > 0 || (graph.tests_by_module[module.path] ?? []).length > 0;
}

function isTestPath(relative: string, model: RepoWorldModel): boolean {
  if (model.modules.find((module) => module.path === relative)?.kind === "TEST") return true;
  return /(?:^|\/)(?:tests?|__tests__)\//.test(relative) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative);
}

/* ------------------------------------------------------------------ *
 * Model identity
 * ------------------------------------------------------------------ */

export function worldModelIdFor(input: { fingerprint: string; modules: number; generatedAt: string }): string {
  return `wm-${structuralHashOf([REPO_WORLD_MODEL_VERSION, input.fingerprint, input.modules, input.generatedAt])}`;
}

/** Compact summary recorded on a WorkBook record (the full model stays on disk). */
export interface WorldModelSummary {
  version: typeof REPO_WORLD_MODEL_VERSION;
  id: string;
  fingerprint: string;
  built_at: string;
  package_managers: string[];
  build_system: string[];
  runtimes: string[];
  ci_files: string[];
  languages: string[];
  entry_points: string[];
  modules: number;
  tests: number;
  workspace: RepoWorkspaceBoundary["kind"];
  git: { is_repository: boolean; head?: string; branch?: string; dirty_files?: number };
  generated_surfaces: string[];
}

export function summarizeWorldModel(model: RepoWorldModel): WorldModelSummary {
  const summary: WorldModelSummary = {
    version: model.version,
    id: model.id,
    fingerprint: model.fingerprint,
    built_at: model.generated_at,
    package_managers: [...model.package_managers],
    build_system: model.build_system.map((entry) => entry.tool),
    runtimes: [...model.runtimes],
    ci_files: model.ci.flatMap((entry) => entry.files),
    languages: model.languages.map((entry) => entry.language),
    entry_points: [...model.entry_points],
    modules: model.modules.length,
    tests: model.tests.length,
    workspace: model.workspace.kind,
    git: {
      is_repository: model.git.is_repository,
      ...(model.git.head ? { head: model.git.head } : {}),
      ...(model.git.branch ? { branch: model.git.branch } : {}),
      ...(model.git.dirty_files !== undefined ? { dirty_files: model.git.dirty_files } : {})
    },
    generated_surfaces: model.generated_surfaces.filter((entry) => entry.present).map((entry) => entry.path)
  };
  return summary;
}
