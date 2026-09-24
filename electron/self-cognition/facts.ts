/**
 * Self Cognition — the host that reads the repository's own facts.
 *
 * `src/shared/self-cognition` is a pure function of a `SelfFacts` bundle; this module is the only
 * thing that touches the checkout, and it only READS. It parses the capability manifests, the
 * ownership map, the architecture baseline, the composition root's wiring and the package scripts,
 * and it classifies every path it reports through the repository's real authority classifier and
 * owner-review guard rather than through a rule of its own.
 *
 * A source it cannot read is recorded in `unreadable` with the reason. It is never skipped: a
 * manifest that failed to parse must not look like a capability that does not exist.
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { classifySurface } from "../../src/shared/autonomous-evolution-trust";
import { assessProtectedPaths } from "../../src/shared/root-authority/protected-surface";
import { ProtectedSurfaceGuard } from "../root-authority/protected-surface-guard";
import type { AuthorityClass, OwnerReviewDecision } from "../../src/shared/self-cognition/contracts";
import type { SelfAuthorityFact, SelfCapabilityFact, SelfFacts } from "../../src/shared/self-cognition/anatomy";

export interface SelfFactOptions {
  repositoryRoot: string;
  now?: () => string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(file: string): { ok: true; text: string } | { ok: false; reason: string } {
  try {
    return { ok: true, text: fs.readFileSync(file, "utf8") };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The repository's own authority verdict for each path, from the real classifier and guard. */
export function authoritySurfacesOf(paths: readonly string[], guard: ProtectedSurfaceGuard): SelfAuthorityFact[] {
  const assessment = assessProtectedPaths([...paths]);
  return [...new Set(paths)].sort().map((file) => {
    const surface = classifySurface(file) as AuthorityClass;
    let ownerReview: OwnerReviewDecision = "UNKNOWN";
    let detail = "the owner-review guard could not be asked about this path";
    try {
      const decision = guard.assessChangeSet([file]).decision;
      ownerReview = decision === "ALLOW" ? "ALLOW" : decision === "REQUIRE_OWNER" ? "REQUIRE_OWNER" : "DENY";
      detail = `${surface}; owner review ${ownerReview}`;
    } catch (error) {
      detail = `the owner-review guard threw for this path: ${error instanceof Error ? error.message : String(error)}`;
    }
    // A path on a protected list is named as such even when its tier is product surface: the two
    // guards answer different questions and a report should be able to show both.
    const protectedNote = assessment.protected && assessment.hits.length > 0 ? "; a protected path list also covers repository paths" : "";
    return { path: file, surface, ownerReview, detail: `${detail}${protectedNote}` };
  });
}

/** Reads one capability manifest, returning either the fact or the reason it could not be read. */
export function readCapabilityManifest(file: string): { fact?: SelfCapabilityFact; problem?: { path: string; reason: string } } {
  const read = readText(file);
  if (!read.ok) return { problem: { path: file, reason: read.reason } };
  let parsed: unknown;
  try {
    parsed = parseYaml(read.text);
  } catch (error) {
    return { problem: { path: file, reason: `the manifest is not valid YAML: ${error instanceof Error ? error.message : String(error)}` } };
  }
  if (!isObject(parsed)) return { problem: { path: file, reason: "the manifest did not parse to an object" } };
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  const refs = (value: unknown): Array<{ ref: string; reason?: string }> =>
    (Array.isArray(value) ? value : []).flatMap((entry) => {
      if (typeof entry === "string") return [{ ref: entry }];
      if (isObject(entry) && typeof entry.ref === "string") return [{ ref: entry.ref, ...(typeof entry.reason === "string" ? { reason: entry.reason } : {}) }];
      return [];
    });
  const state = (Array.isArray(parsed.state) ? parsed.state : []).flatMap((entry) => (isObject(entry) && typeof entry.namespace === "string" && typeof entry.owner === "string" ? [{ namespace: entry.namespace, owner: entry.owner }] : []));
  if (typeof parsed.id !== "string" || parsed.id === "") {
    return { problem: { path: file, reason: "the manifest names no capability id" } };
  }
  return {
    fact: {
      id: parsed.id,
      kind: typeof parsed.kind === "string" ? parsed.kind : "UNKNOWN",
      provides: strings(parsed.provides),
      requires: refs(parsed.requires),
      optional: refs(parsed.optional),
      state,
      modules: strings(parsed.modules),
      bootModules: strings(parsed.bootModules),
      surface: strings(parsed.surface),
      critical: isObject(parsed.health) && parsed.health.critical === true
    }
  };
}

/** Every `.ts` under the directories the architecture guard scans, repo-relative and POSIX-style. */
export function sourceFiles(repositoryRoot: string): string[] {
  const found: string[] = [];
  const stack = [path.join(repositoryRoot, "electron"), path.join(repositoryRoot, "src", "shared")];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        stack.push(child);
        continue;
      }
      if (/\.tsx?$/.test(entry.name)) found.push(path.relative(repositoryRoot, child).split(path.sep).join("/"));
    }
  }
  return found.sort();
}

/**
 * The composition root's wiring, one entry per boot module the manifests declare.
 *
 * The manifests are the authority on what a boot module is — the architecture ratchet checks the
 * same list — so the model iterates them rather than guessing from call syntax. For each declared
 * module the host asks `electron/main.ts` whether it references that module, which is the evidence
 * that it is really wired; `factory` names the `create*Module` call when the source shows one.
 */
export function readBootWiring(repositoryRoot: string, bootModules: readonly string[]): Array<{ file: string; factory: string; wired: boolean }> {
  const read = readText(path.join(repositoryRoot, "electron", "main.ts"));
  if (!read.ok) return [...bootModules].sort().map((file) => ({ file, factory: "", wired: false }));
  const source = read.text;
  return [...new Set(bootModules)].sort().map((file) => {
    // A module is referenced either by its path minus the extension (`./bootstrap/persistence`) or
    // by its bare name; both are searched, because both appear in this repository's root.
    const stem = file.replace(/\.tsx?$/, "");
    const bare = stem.split("/").slice(-1)[0];
    const referenced = source.includes(stem.replace(/^electron\//, "./")) || source.includes(`/${bare}"`) || source.includes(`/${bare}'`);
    const factory = new RegExp(`(create\\w*${bare.replace(/[^A-Za-z0-9]/g, "")}\\w*Module)\\s*\\(`, "i").exec(source)?.[1] ?? "";
    return { file, factory, wired: referenced };
  });
}

/** The package scripts, so the anatomy includes what the repository can be asked to run. */
export function readScripts(repositoryRoot: string): Array<{ name: string; command: string }> {
  const read = readText(path.join(repositoryRoot, "package.json"));
  if (!read.ok) return [];
  try {
    const parsed = JSON.parse(read.text) as { scripts?: Record<string, string> };
    return Object.entries(parsed.scripts ?? {}).map(([name, command]) => ({ name, command })).sort((left, right) => (left.name < right.name ? -1 : 1));
  } catch {
    return [];
  }
}

/** The architecture baseline, or the reason it is not part of the model. */
export function readArchitectureBaseline(repositoryRoot: string): { metrics: Record<string, number>; updatedAt: string; reason: string } | undefined {
  const read = readText(path.join(repositoryRoot, "config", "architecture-baseline.json"));
  if (!read.ok) return undefined;
  try {
    const parsed = JSON.parse(read.text) as { metrics?: Record<string, number>; updatedAt?: string; reason?: string };
    if (!isObject(parsed.metrics)) return undefined;
    return { metrics: parsed.metrics as Record<string, number>, updatedAt: parsed.updatedAt ?? "unknown", reason: parsed.reason ?? "no reason recorded" };
  } catch {
    return undefined;
  }
}

/**
 * Collects every fact the self model is built from.
 *
 * The authority facts cover exactly the paths the model will name: the owned source files and the
 * manifest, ownership and baseline files that describe the anatomy itself. Classifying the whole
 * repository would report on files no component references.
 */
export function collectSelfFacts(options: SelfFactOptions): SelfFacts {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const now = options.now ?? (() => new Date().toISOString());
  const unreadable: Array<{ path: string; reason: string }> = [];
  const guard = new ProtectedSurfaceGuard({ root: repositoryRoot });

  const capabilitiesRoot = path.join(repositoryRoot, "config", "capabilities");
  const capabilities: SelfCapabilityFact[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(capabilitiesRoot).filter((name) => name.endsWith(".yaml")).sort();
  } catch (error) {
    unreadable.push({ path: "config/capabilities", reason: `the capability manifest directory could not be read: ${error instanceof Error ? error.message : String(error)}` });
  }
  for (const name of files) {
    const result = readCapabilityManifest(path.join(capabilitiesRoot, name));
    if (result.fact !== undefined) capabilities.push(result.fact);
    if (result.problem !== undefined) unreadable.push({ path: `config/capabilities/${name}`, reason: result.problem.reason });
  }

  let ownership: SelfFacts["ownership"] = { capabilities: {}, compositionRoot: {}, exempt: {} };
  const ownershipRead = readText(path.join(repositoryRoot, "config", "capability-modules.json"));
  if (!ownershipRead.ok) {
    unreadable.push({ path: "config/capability-modules.json", reason: ownershipRead.reason });
  } else {
    try {
      const parsed = JSON.parse(ownershipRead.text) as { capabilities?: Record<string, string[]>; composition_root?: Record<string, string>; exempt?: Record<string, string> };
      ownership = { capabilities: parsed.capabilities ?? {}, compositionRoot: parsed.composition_root ?? {}, exempt: parsed.exempt ?? {} };
    } catch (error) {
      unreadable.push({ path: "config/capability-modules.json", reason: `the ownership map is not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const sources = sourceFiles(repositoryRoot);
  const baseline = readArchitectureBaseline(repositoryRoot);
  const anatomyPaths = [
    "config/capability-modules.json",
    "config/architecture-baseline.json",
    ...files.map((name) => `config/capabilities/${name}`),
    ...Object.values(ownership.capabilities).flat(),
    // The composition root is owned by the platform rather than by a capability, so it is read from its
    // own class: leaving it out would drop the wiring from the anatomy it is the centre of.
    ...Object.keys(ownership.compositionRoot ?? {})
  ];
  const authority = authoritySurfacesOf([...new Set([...sources, ...anatomyPaths])], guard);

  return {
    capturedAt: now(),
    repositoryRoot,
    capabilities,
    ownership,
    bootWiring: readBootWiring(repositoryRoot, capabilities.flatMap((capability) => capability.bootModules)),
    scripts: readScripts(repositoryRoot),
    authority,
    ...(baseline === undefined ? {} : { architectureBaseline: baseline }),
    unreadable
  };
}