import fs from "node:fs";
import path from "node:path";
import { scanRepo, type RepoSnapshot } from "./repo-inspector";

/**
 * Semantic code slice (plan AP04 / §13.3 incremental). Deterministic, bounded
 * import scanning over a repo snapshot: given changed files it returns the
 * tests that reference them (import/require edges) plus co-located tests, and
 * can compute the dependency closure needed to reason about a target.
 */

const IMPORT_LINE = /(?:import\s+[^'"]*?\s+from\s*|import\s*\(\s*|require\s*\(\s*|from\s*|(?:^|[;{]\s*)import\s+)['"]([^'"]+)['"]/g;
const CODE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|svelte|vue)$/;

function stripQueryAndExtension(specifier: string): string {
  const withoutQuery = specifier.split(/[?#]/)[0];
  if (!path.posix.extname(withoutQuery)) return withoutQuery;
  return withoutQuery.replace(/(\.d)?\.[cm]?[jt]sx?$/, "");
}

function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const normalized = specifier.replace(/\\/g, "/");
  if (!normalized.startsWith(".")) return undefined;
  const baseDir = path.posix.dirname(fromFile);
  const candidate = path.posix.normalize(path.posix.join(baseDir, normalized));
  return candidate;
}

/** Map each file to the list of relative files it imports (relative specifiers only). */
export function importEdges(snapshot: RepoSnapshot): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  const byStem = new Map<string, string>();
  for (const file of snapshot.files) {
    const parsed = path.posix.parse(file);
    byStem.set(path.posix.join(parsed.dir, parsed.name), file);
    byStem.set(file, file);
  }
  for (const file of snapshot.files) {
    if (!CODE_EXTENSIONS.test(file)) continue;
    const content = safeRead(path.join(snapshot.root, file));
    const targets = new Set<string>();
    for (const match of content.matchAll(IMPORT_LINE)) {
      const specifier = match[1] ?? "";
      const resolved = resolveRelative(file, specifier);
      if (!resolved) continue;
      const extensionless = stripQueryAndExtension(resolved);
      const candidate = byStem.get(extensionless) ?? byStem.get(extensionless + path.posix.extname(file));
      if (candidate) targets.add(candidate);
      else if (fs.existsSync(path.join(snapshot.root, resolved))) targets.add(resolved);
    }
    edges.set(file, [...targets]);
  }
  return edges;
}

/**
 * Tests affected by `changedFiles`: tests whose import/require graph reaches a
 * changed file (reverse dependency walk over the repo's import edges), plus the
 * changed file itself when it is a test. Deterministic subset of the full list.
 */
export function affectedTests(snapshot: RepoSnapshot, changedFiles: string[]): string[] {
  const edges = importEdges(snapshot);
  const importers = new Map<string, string[]>();
  for (const [file, targets] of edges) {
    for (const target of targets) {
      const list = importers.get(target) ?? [];
      if (!list.includes(file)) list.push(file);
      importers.set(target, list);
    }
  }
  const tests = new Set<string>();
  const isTest = (file: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
  const visitImporters = (file: string, seen: Set<string>) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const importer of importers.get(file) ?? []) {
      if (isTest(importer)) tests.add(importer);
      visitImporters(importer, seen);
    }
  };
  for (const file of changedFiles) {
    if (isTest(file)) tests.add(file);
    visitImporters(file, new Set());
  }
  return [...tests].sort((a, b) => a.localeCompare(b));
}

/**
 * Dependency closure of a file (its imports and their imports), capped so the
 * slice stays bounded for prompt construction.
 */
export function dependencyClosure(snapshot: RepoSnapshot, roots: string[], limit = 100): string[] {
  const edges = importEdges(snapshot);
  const closure = new Set<string>();
  const pending = [...roots];
  while (pending.length && closure.size < limit) {
    const current = pending.pop()!;
    if (closure.has(current)) continue;
    closure.add(current);
    for (const target of edges.get(current) ?? []) if (!closure.has(target)) pending.push(target);
  }
  return [...closure].sort((a, b) => a.localeCompare(b));
}

function safeRead(file: string): string {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 1000000) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Convenience: scan then compute the affected tests for changed relative files. */
export function targetedTestsForChanged(root: string, changedFiles: string[]): string[] {
  return affectedTests(scanRepo(root), changedFiles);
}
