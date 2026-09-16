import {
  formatCapabilityRef,
  parseCapabilityRef,
  type CapabilityId,
  type CapabilityManifest,
  type CapabilityRef
} from "./capability-contract";

/**
 * Dependency graph (platform foundation, Phase 01 Task B).
 *
 * Builds the DAG the engineering book asks for from a set of manifests:
 *
 *  - a `required` cycle is FATAL. No boot order exists for it, so it is reported as
 *    an error and the graph refuses to claim it is bootable;
 *  - an `optional` cycle is NOT a boot blocker — an optional edge may be dropped, so
 *    a loop through optional edges has a resolution order — but it is reported,
 *    because a loop that only closes through optional edges is still a design smell
 *    worth seeing;
 *  - a requirement naming a capability that is not present is reported as a missing
 *    node. For a `required` edge that is fatal; for an `optional` edge it is exactly
 *    the "capability absent" state the platform must survive as a local `DEGRADED`.
 *
 * Everything here is a pure function of the manifest list, and the output is
 * sorted, so two runs over the same manifests produce byte-identical JSON no matter
 * what order the files were read in.
 */

/** An edge in the capability graph, in the resolved `id@major` vocabulary. */
interface CapabilityEdge {
  /** The depending capability. */
  from: CapabilityId;
  /** The provided contract being depended on. */
  to: CapabilityId;
  /** The exact interface reference, e.g. `persistence.store@1`. */
  ref: CapabilityRef;
  kind: "required" | "optional";
  reason: string;
}

/** A requirement that names an interface no manifest provides. */
export interface MissingCapability {
  from: CapabilityId;
  ref: CapabilityRef;
  kind: "required" | "optional";
  reason: string;
}

/** A dependency loop, with the exact path that closes it. */
interface CapabilityCycle {
  /**
   * `required` when every edge on the loop is required — fatal.
   * `optional` when at least one edge could be dropped — reported, not fatal.
   */
  kind: "required" | "optional";
  /** The cycle in order, first element repeated is omitted; e.g. [`a`, `b`]. */
  path: CapabilityId[];
  /** The `id@major` refs traversed, parallel to `path`. */
  refs: CapabilityRef[];
  message: string;
}

/** One capability's resolved position in the graph. */
interface CapabilityNode {
  id: CapabilityId;
  version: string;
  kind: "kernel" | "feature";
  critical: boolean;
  provides: CapabilityRef[];
  /** Resolved required dependencies, sorted by id. */
  required: CapabilityEdge[];
  /** Resolved optional dependencies, sorted by id. */
  optional: CapabilityEdge[];
  /** Requirements naming an interface nothing provides, sorted by ref. */
  missing: MissingCapability[];
}

export interface DependencyGraph {
  nodes: CapabilityNode[];
  edges: CapabilityEdge[];
  /** Provider index: `id@major` -> declaring capability id. */
  providers: Record<CapabilityRef, CapabilityId>;
  cycles: CapabilityCycle[];
  /** Required cycles only — the ones that make `bootable` false. */
  fatalCycles: CapabilityCycle[];
  /** True when the required subgraph is acyclic and every required edge resolves. */
  bootable: boolean;
  /**
   * A deterministic boot order over the required subgraph (dependencies first).
   * Kahn's algorithm with a sorted frontier, so ties break by capability id.
   */
  bootOrder: CapabilityId[];
}

function edgeSort(left: CapabilityEdge, right: CapabilityEdge): number {
  if (left.to !== right.to) return left.to < right.to ? -1 : 1;
  if (left.ref !== right.ref) return left.ref < right.ref ? -1 : 1;
  return left.from < right.from ? -1 : left.from > right.from ? 1 : 0;
}

/**
 * Find every elementary cycle, then classify each one by whether it survives
 * optional-edge removal.
 *
 * Implemented as an explicit-stack DFS with a path index rather than recursion, so
 * a pathological manifest set cannot blow the JS stack, and with neighbors visited
 * in sorted order so the *reported* cycle path is stable across runs.
 */
function findCycles(nodes: readonly CapabilityNode[]): CapabilityCycle[] {
  const adjacency = new Map<CapabilityId, CapabilityEdge[]>();
  for (const node of nodes) {
    adjacency.set(node.id, [...node.required, ...node.optional].sort(edgeSort));
  }

  const cycles: CapabilityCycle[] = [];
  const seenSignatures = new Set<string>();
  const color = new Map<CapabilityId, 0 | 1 | 2>();
  for (const node of nodes) color.set(node.id, 0);

  // Iterative DFS over the whole graph. `path` holds the current stack; `pathIndex`
  // maps a node to its position in `path` so a back edge can be sliced out in O(1).
  for (const root of [...nodes].sort((l, r) => (l.id < r.id ? -1 : 1))) {
    if (color.get(root.id) !== 0) continue;
    const path: CapabilityId[] = [];
    const refs: CapabilityRef[] = [];
    const pathIndex = new Map<CapabilityId, number>();
    const stack: Array<{ id: CapabilityId; next: number }> = [{ id: root.id, next: 0 }];
    color.set(root.id, 1);
    pathIndex.set(root.id, 0);
    path.push(root.id);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adjacency.get(frame.id) ?? [];
      if (frame.next >= neighbors.length) {
        color.set(frame.id, 2);
        pathIndex.delete(frame.id);
        path.pop();
        stack.pop();
        continue;
      }
      const edge = neighbors[frame.next++];
      const target = color.get(edge.to);
      if (target === undefined) continue; // missing provider; reported separately
      if (target === 1) {
        const start = pathIndex.get(edge.to);
        if (start === undefined) continue;
        const cyclePath = path.slice(start);
        // `refs[i]` is the edge `path[i] -> path[i+1]` for every i already walked;
        // `edge` is the back edge that closes the loop. `refs` holds one fewer
        // entry than `path` at all times, so appending the back edge makes the two
        // parallel without an off-by-one.
        const cycleRefs = [...refs.slice(start), edge.ref];
        // Canonical signature: rotate so the lexicographically smallest id leads,
        // which makes two traversals of the same loop deduplicate. The refs rotate
        // by the SAME offset, because `cycleEdges` pairs them positionally.
        const pivot = cyclePath.indexOf([...cyclePath].sort()[0]);
        const rotated = [...cyclePath.slice(pivot), ...cyclePath.slice(0, pivot)];
        const rotatedRefs = [...cycleRefs.slice(pivot), ...cycleRefs.slice(0, pivot)];
        const signature = rotated.join(" -> ");
        if (seenSignatures.has(signature)) continue;
        seenSignatures.add(signature);
        // A loop is fatal only if EVERY edge on it is required. An optional edge
        // anywhere means the loop can be broken by declining that refinement.
        const edgeKinds = cycleEdges(rotated, adjacency, rotatedRefs);
        const kind: "required" | "optional" = edgeKinds.every((entry) => entry === "required") ? "required" : "optional";
        cycles.push({
          kind,
          path: rotated,
          refs: rotatedRefs,
          message: kind === "required"
            ? `required dependency cycle: ${[...rotated, rotated[0]].join(" -> ")}`
            : `optional dependency cycle (survivable, but the refinement can never activate): ${[...rotated, rotated[0]].join(" -> ")}`
        });
        continue;
      }
      if (target === 0) {
        color.set(edge.to, 1);
        pathIndex.set(edge.to, path.length);
        refs.push(edge.ref);
        path.push(edge.to);
        stack.push({ id: edge.to, next: 0 });
      }
    }
  }

  return cycles.sort((left, right) => (left.path.join(">") < right.path.join(">") ? -1 : 1));
}

/**
 * The kind of each edge along a reported cycle.
 *
 * Re-derived from the adjacency rather than carried through the DFS, because the
 * DFS path and the reported (rotated) cycle are different sequences and keeping a
 * second parallel array in sync during backtracking is exactly the kind of bug
 * that would silently mis-classify a fatal cycle as survivable.
 */
function cycleEdges(path: readonly CapabilityId[], adjacency: ReadonlyMap<CapabilityId, CapabilityEdge[]>, refs: readonly CapabilityRef[]): Array<"required" | "optional"> {
  const kinds: Array<"required" | "optional"> = [];
  for (let index = 0; index < path.length; index++) {
    const from = path[index];
    const to = path[(index + 1) % path.length];
    const wanted = refs[index];
    const match = (adjacency.get(from) ?? []).find((edge) => edge.to === to && edge.ref === wanted);
    kinds.push(match?.kind ?? "optional");
  }
  return kinds;
}

/**
 * Build the capability graph from a manifest set.
 *
 * Node and edge order are normalised here, so the returned object serialises
 * identically regardless of the order the manifests were supplied in — which is
 * the deterministic-graph requirement stated as an implementation property rather
 * than as a promise in a comment.
 */
export function buildDependencyGraph(manifests: readonly CapabilityManifest[]): DependencyGraph {
  const providers = new Map<CapabilityRef, CapabilityId>();
  const nodes: CapabilityNode[] = [];

  // Pass 1: index providers. Sorted first so a duplicate-provide error (already
  // rejected by the parser, but defended here too) would report a stable winner.
  for (const manifest of [...manifests].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))) {
    for (const provided of manifest.provides) {
      if (!providers.has(provided)) providers.set(provided, manifest.id);
    }
  }

  // Pass 2: resolve each manifest's requirements against the provider index.
  for (const manifest of [...manifests].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))) {
    const required: CapabilityEdge[] = [];
    const optional: CapabilityEdge[] = [];
    const missing: MissingCapability[] = [];
    for (const requirement of [...manifest.requires, ...manifest.optional]) {
      const provider = providers.get(requirement.ref);
      if (!provider) {
        missing.push({ from: manifest.id, ref: requirement.ref, kind: requirement.kind, reason: requirement.reason });
        continue;
      }
      const edge: CapabilityEdge = { from: manifest.id, to: provider, ref: requirement.ref, kind: requirement.kind, reason: requirement.reason };
      (requirement.kind === "required" ? required : optional).push(edge);
    }
    nodes.push({
      id: manifest.id,
      version: manifest.version,
      kind: manifest.kind,
      critical: manifest.health.critical,
      provides: [...manifest.provides].sort(),
      required: required.sort(edgeSort),
      optional: optional.sort(edgeSort),
      missing: missing.sort((left, right) => (left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0))
    });
  }

  const edges = nodes.flatMap((node) => [...node.required, ...node.optional]).sort(edgeSort);
  const cycles = findCycles(nodes);
  const fatalCycles = cycles.filter((cycle) => cycle.kind === "required");
  const unresolvedRequired = nodes.some((node) => node.missing.some((entry) => entry.kind === "required"));

  // Kahn over required edges only, with a sorted frontier: the boot order must be
  // reproducible, and a set is not.
  const indegree = new Map<CapabilityId, number>();
  const dependents = new Map<CapabilityId, CapabilityId[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    dependents.set(node.id, []);
  }
  for (const node of nodes) {
    for (const edge of node.required) {
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      dependents.get(edge.to)?.push(node.id);
    }
  }
  const bootOrder: CapabilityId[] = [];
  const frontier = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id).sort();
  while (frontier.length > 0) {
    const id = frontier.shift() as CapabilityId;
    bootOrder.push(id);
    for (const dependent of [...(dependents.get(id) ?? [])].sort()) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        // Insert in sorted position so the frontier stays ordered without a re-sort.
        let at = 0;
        while (at < frontier.length && frontier[at] < dependent) at++;
        frontier.splice(at, 0, dependent);
      }
    }
  }

  return {
    nodes,
    edges,
    providers: Object.fromEntries([...providers.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1))),
    cycles,
    fatalCycles,
    bootable: fatalCycles.length === 0 && !unresolvedRequired,
    bootOrder
  };
}

/**
 * Every capability that directly or transitively depends on `capabilityId`.
 *
 * This is the impact radius the engineering book asks for, and Task E's
 * `architecture:impact` surface. The starting capability is never included: the
 * question is "what else moves", and a capability is not its own blast radius.
 *
 * Returned sorted and deduplicated, and computed over BOTH required and optional
 * edges — a capability that optionally uses another is still affected when the
 * other changes, it just degrades rather than fails.
 */
export function impactRadius(graph: DependencyGraph, capabilityId: CapabilityId): CapabilityId[] {
  const reverse = new Map<CapabilityId, Set<CapabilityId>>();
  for (const node of graph.nodes) reverse.set(node.id, new Set());
  for (const edge of graph.edges) reverse.get(edge.to)?.add(edge.from);

  const found = new Set<CapabilityId>();
  const queue: CapabilityId[] = [...(reverse.get(capabilityId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift() as CapabilityId;
    if (found.has(id) || id === capabilityId) continue;
    found.add(id);
    for (const dependent of reverse.get(id) ?? []) if (!found.has(dependent)) queue.push(dependent);
  }
  return [...found].sort();
}

/** The impact radius with the path that caused each capability to be included. */
interface ImpactEntry {
  capability: CapabilityId;
  /** Shortest reverse path from the changed capability, e.g. [`a`, `b`] for a -> b. */
  via: CapabilityId[];
  /** True when every edge on `via` is required, i.e. this is a hard dependency. */
  required: boolean;
}

/**
 * Explain the impact radius, edge by edge.
 *
 * `impactRadius` answers "which capabilities"; this answers "why", which is what
 * makes the diagnostic output usable when the radius is large. BFS gives the
 * shortest explanation, and ties break by sorted neighbour order so the
 * explanation is reproducible.
 */
export function explainImpact(graph: DependencyGraph, capabilityId: CapabilityId): ImpactEntry[] {
  const reverse = new Map<CapabilityId, CapabilityEdge[]>();
  for (const node of graph.nodes) reverse.set(node.id, []);
  for (const edge of graph.edges) reverse.get(edge.to)?.push(edge);
  for (const list of reverse.values()) list.sort(edgeSort);

  const best = new Map<CapabilityId, { via: CapabilityId[]; required: boolean }>();
  const queue: Array<{ id: CapabilityId; via: CapabilityId[]; required: boolean }> = [{ id: capabilityId, via: [], required: true }];
  while (queue.length > 0) {
    const current = queue.shift() as { id: CapabilityId; via: CapabilityId[]; required: boolean };
    for (const edge of reverse.get(current.id) ?? []) {
      if (edge.from === capabilityId) continue;
      const candidate = { via: [...current.via, edge.to], required: current.required && edge.kind === "required" };
      const existing = best.get(edge.from);
      // Prefer the shorter path; break ties deterministically by the rendered path.
      if (existing && (existing.via.length < candidate.via.length
        || (existing.via.length === candidate.via.length && existing.via.join(">") <= candidate.via.join(">")))) continue;
      best.set(edge.from, candidate);
      queue.push({ id: edge.from, via: candidate.via, required: candidate.required });
    }
  }
  return [...best.entries()]
    .map(([capability, entry]) => ({ capability, via: entry.via, required: entry.required }))
    .sort((left, right) => (left.capability < right.capability ? -1 : 1));
}

/** Resolve a user-supplied capability selector, tolerating the trailing `@major`. */
export function resolveCapabilitySelector(graph: DependencyGraph, selector: string): CapabilityId | undefined {
  const trimmed = selector.trim();
  if (trimmed === "") return undefined;
  const byId = graph.nodes.find((node) => node.id === trimmed);
  if (byId) return byId.id;
  const parsed = parseCapabilityRef(trimmed);
  if (!parsed) return undefined;
  const provided = graph.providers[formatCapabilityRef(parsed)];
  return provided;
}
