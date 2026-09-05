import type { ContentCache } from "../cache/content-cache";
import type { RepoSnapshot } from "./repo-inspector";
import { repoScanSignature } from "./cached-repo-scan";
import { importEdges } from "./semantic-slice";

/**
 * Code Knowledge Graph (plan AP25 seed). An incremental graph over the cached
 * repo index: nodes are files, edges are relative imports; each module carries
 * its own tests, dependency counts and a lightweight change-risk score. Built
 * once per repo signature and reused until the tree changes.
 */

export interface CodeGraphModule {
  file: string;
  tests: string[];
  outbound: number;   // files this module imports
  inbound: number;    // importers of this module
  /** crude change risk = inbound + outbound (broad surface = more risk). */
  changeRisk: number;
}

export interface CodeGraph {
  modules: CodeGraphModule[];
  edges: Record<string, string[]>;
  builtForSignature: string;
}

export function buildCodeGraph(snapshot: RepoSnapshot): CodeGraph {
  const edges = importEdges(snapshot);
  const inbound = new Map<string, number>();
  for (const targets of edges.values()) {
    for (const target of targets) inbound.set(target, (inbound.get(target) ?? 0) + 1);
  }
  const isTest = (file: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
  const testOwners = new Map<string, string[]>();
  for (const [file, targets] of edges) {
    if (!isTest(file)) continue;
    for (const target of targets) {
      const owners = testOwners.get(target) ?? [];
      owners.push(file);
      testOwners.set(target, owners);
    }
  }

  const modules: CodeGraphModule[] = snapshot.files
    .filter((file) => !isTest(file) && /\.(?:[cm]?[jt]sx?|svelte|vue)$/.test(file))
    .map((file) => {
      const outbound = edges.get(file)?.length ?? 0;
      const incoming = inbound.get(file) ?? 0;
      return { file, tests: [...(testOwners.get(file) ?? [])].sort(), outbound, inbound: incoming, changeRisk: outbound + incoming };
    })
    .sort((a, b) => b.changeRisk - a.changeRisk || a.file.localeCompare(b.file));
  const edgeList: Record<string, string[]> = {};
  for (const [file, targets] of edges) edgeList[file] = targets;
  return { modules, edges: edgeList, builtForSignature: repoScanSignature(snapshot) };
}

/** Incremental: reuses the cached graph when the repo signature is unchanged. */
export function cachedCodeGraph(root: string, cache: ContentCache<CodeGraph>, snapshot: RepoSnapshot): { graph: CodeGraph; fromCache: boolean } {
  const signature = repoScanSignature(snapshot);
  const key = cache.key(`graph:${root}`, { kind: "code-graph", version: 1 }, signature);
  const cached = cache.get(key);
  if (cached) return { graph: cached, fromCache: true };
  const graph = buildCodeGraph(snapshot);
  cache.put(key, graph, { kind: "code-graph", version: 1 }, [`repo:${root}`]);
  return { graph, fromCache: false };
}

export function moduleRisk(graph: CodeGraph, file: string): CodeGraphModule | undefined {
  return graph.modules.find((module) => module.file === file);
}
