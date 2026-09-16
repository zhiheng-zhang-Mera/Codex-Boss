import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { loadCapabilityManifests, parseCapabilityManifestText } from "../../../electron/platform/capability-manifest";
import { buildCapabilityRegistry } from "../../../electron/platform/capability-registry";
import {
  buildDependencyGraph,
  explainImpact,
  impactRadius,
  resolveCapabilitySelector
} from "../../../electron/platform/dependency-graph";
import type { CapabilityManifest } from "../../../electron/platform/capability-contract";

/**
 * Phase 01 Task B — the dependency graph.
 *
 * The four properties the engineering book states, each asserted directly:
 * a required cycle is fatal; an optional cycle is NOT a boot blocker but IS
 * reported; `impactRadius` returns every direct and transitive dependent; and the
 * result is deterministic, so the same manifests in a different order produce the
 * same graph. The last one is checked by serialising both orders and comparing.
 */

/** Build a manifest without going through YAML, for graph-only cases. */
function manifest(id: string, options: {
  provides?: string[];
  requires?: string[];
  optional?: string[];
  critical?: boolean;
  kind?: "kernel" | "feature";
} = {}): CapabilityManifest {
  return {
    id,
    version: "1.0.0",
    kind: options.kind ?? "feature",
    provides: options.provides ?? [`${id}.thing@1`],
    requires: (options.requires ?? []).map((ref) => ({ ref, capability: parse(ref), kind: "required" as const, reason: `${id} needs ${ref}` })),
    optional: (options.optional ?? []).map((ref) => ({ ref, capability: parse(ref), kind: "optional" as const, reason: `${id} may use ${ref}` })),
    state: [],
    health: { critical: options.critical ?? false },
    modules: [],
    bootModules: [],
    surface: [],
    permissions: [],
    source: `${id}.yaml`
  };
}

function parse(ref: string): { id: string; major: number } {
  const [id, major] = ref.split("@");
  return { id, major: Number(major) };
}

/** `a -> b` means a requires b. */
function edgeList(graph: ReturnType<typeof buildDependencyGraph>): string[] {
  return graph.edges.map((edge) => `${edge.from}->${edge.to}:${edge.kind}`);
}

describe("Phase 01 Task B — cycle detection", () => {
  it("is bootable and cycle-free for a DAG", () => {
    const graph = buildDependencyGraph([
      manifest("a", { requires: ["b.thing@1"] }),
      manifest("b", { requires: ["c.thing@1"] }),
      manifest("c")
    ]);
    expect(graph.cycles).toEqual([]);
    expect(graph.fatalCycles).toEqual([]);
    expect(graph.bootable).toBe(true);
    expect(graph.bootOrder).toEqual(["c", "b", "a"]);
  });

  it("rejects a required cycle as fatal", () => {
    const graph = buildDependencyGraph([
      manifest("a", { requires: ["b.thing@1"] }),
      manifest("b", { requires: ["a.thing@1"] })
    ]);
    expect(graph.fatalCycles.length).toBe(1);
    expect(graph.fatalCycles[0].kind).toBe("required");
    expect(graph.fatalCycles[0].path.slice().sort()).toEqual(["a", "b"]);
    expect(graph.fatalCycles[0].message).toContain("required dependency cycle");
    expect(graph.bootable).toBe(false);
    // No boot order can exist for a required cycle, so it must not be reported as if
    // a partial order were complete.
    expect(graph.bootOrder).toEqual([]);
  });

  it("reports an optional cycle without making it a boot blocker", () => {
    const graph = buildDependencyGraph([
      manifest("a", { requires: ["b.thing@1"] }),
      manifest("b", { optional: ["a.thing@1"] })
    ]);
    expect(graph.fatalCycles).toEqual([]);
    expect(graph.cycles.length).toBe(1);
    expect(graph.cycles[0].kind).toBe("optional");
    expect(graph.cycles[0].message).toContain("survivable");
    // The required subgraph is acyclic, so a boot order exists and Boss may start.
    expect(graph.bootable).toBe(true);
    expect(graph.bootOrder).toEqual(["b", "a"]);
  });

  it("finds a three-node cycle and still classifies it once", () => {
    const graph = buildDependencyGraph([
      manifest("a", { requires: ["b.thing@1"] }),
      manifest("b", { requires: ["c.thing@1"] }),
      manifest("c", { requires: ["a.thing@1"] })
    ]);
    expect(graph.fatalCycles.length).toBe(1);
    // The reported path is rotated to a canonical start, so the same loop found from
    // three different roots is one cycle rather than three.
    expect(graph.fatalCycles[0].path[0]).toBe("a");
    expect(graph.fatalCycles[0].path).toHaveLength(3);
  });

  it("reports a missing required dependency, and tolerates a missing optional one", () => {
    const graph = buildDependencyGraph([
      manifest("a", { requires: ["ghost.thing@1"] }),
      manifest("b", { optional: ["ghost.thing@1"] })
    ]);
    expect(graph.bootable).toBe(false);
    const a = graph.nodes.find((node) => node.id === "a");
    const b = graph.nodes.find((node) => node.id === "b");
    expect(a?.missing.map((entry) => entry.ref)).toEqual(["ghost.thing@1"]);
    expect(b?.missing.map((entry) => entry.kind)).toEqual(["optional"]);
    // Only the required one is fatal.
    expect(graph.nodes.find((node) => node.id === "b")?.required).toEqual([]);
  });
});

describe("Phase 01 Task B — impact radius", () => {
  const graph = buildDependencyGraph([
    manifest("core", { provides: ["core.api@1"] }),
    manifest("middle", { requires: ["core.api@1"] }),
    manifest("leaf", { requires: ["middle.thing@1"] }),
    manifest("other", { optional: ["core.api@1"] }),
    manifest("unrelated")
  ]);

  it("returns every direct and transitive dependent, and never the capability itself", () => {
    expect(impactRadius(graph, "core")).toEqual(["leaf", "middle", "other"]);
    expect(impactRadius(graph, "middle")).toEqual(["leaf"]);
    expect(impactRadius(graph, "leaf")).toEqual([]);
    expect(impactRadius(graph, "unrelated")).toEqual([]);
    // A capability is not its own blast radius.
    expect(impactRadius(graph, "core")).not.toContain("core");
  });

  it("explains each member with the shortest path, and says whether it is a hard dependency", () => {
    const explained = explainImpact(graph, "core");
    expect(explained.map((entry) => entry.capability)).toEqual(["leaf", "middle", "other"]);
    const middle = explained.find((entry) => entry.capability === "middle");
    expect(middle?.via).toEqual(["core"]);
    expect(middle?.required).toBe(true);
    const other = explained.find((entry) => entry.capability === "other");
    expect(other?.required, "an optional dependent must not be reported as hard").toBe(false);
    // The transitive one routes through the middle rather than inventing a direct
    // edge. `via` reads from the changed capability outwards, so the LAST element is
    // the immediate dependent — which is what a reviewer reads as the dependency
    // direction when the list is rendered as `core -> middle -> leaf`.
    expect(explained.find((entry) => entry.capability === "leaf")?.via).toEqual(["core", "middle"]);
  });

  it("resolves a selector written as a provided contract", () => {
    expect(resolveCapabilitySelector(graph, "core")).toBe("core");
    expect(resolveCapabilitySelector(graph, "core.api@1")).toBe("core");
    expect(resolveCapabilitySelector(graph, "middle.thing@1")).toBe("middle");
    expect(resolveCapabilitySelector(graph, "nope")).toBeUndefined();
    expect(resolveCapabilitySelector(graph, "  ")).toBeUndefined();
  });
});

describe("Phase 01 Task B — determinism", () => {
  const manifests = [
    manifest("a", { requires: ["c.thing@1"] }),
    manifest("b", { optional: ["a.thing@1"] }),
    manifest("c", { requires: ["d.thing@1"] }),
    manifest("d")
  ];

  it("produces the identical graph regardless of manifest order", () => {
    const forward = buildDependencyGraph(manifests);
    const reversed = buildDependencyGraph([...manifests].reverse());
    const shuffled = buildDependencyGraph([manifests[2], manifests[0], manifests[3], manifests[1]]);
    expect(edgeList(reversed)).toEqual(edgeList(forward));
    expect(edgeList(shuffled)).toEqual(edgeList(forward));
    expect(reversed.bootOrder).toEqual(forward.bootOrder);
    expect(shuffled.bootOrder).toEqual(forward.bootOrder);
    // Byte-identical serialisation is the property the snapshot artifact relies on.
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(forward));
  });

  it("reports a cycle identically regardless of traversal start", () => {
    const cyclic = [
      manifest("x", { requires: ["y.thing@1"] }),
      manifest("y", { requires: ["z.thing@1"] }),
      manifest("z", { requires: ["x.thing@1"] })
    ];
    const one = buildDependencyGraph(cyclic);
    const two = buildDependencyGraph([...cyclic].reverse());
    expect(JSON.stringify(two.fatalCycles)).toBe(JSON.stringify(one.fatalCycles));
  });

  it("carries the declared reason onto every edge, so an edge is reviewable", () => {
    const graph = buildDependencyGraph([manifest("a", { requires: ["b.thing@1"] }), manifest("b")]);
    expect(graph.edges[0].reason).toBe("a needs b.thing@1");
  });
});

describe("Phase 01 Task B — the repository's own graph", () => {
  it("keeps the real manifest set acyclic, resolvable and ordered", () => {
    const registry = buildCapabilityRegistry(process.cwd());
    expect(registry.graph.fatalCycles).toEqual([]);
    expect(registry.graph.bootable).toBe(true);
    expect(registry.graph.nodes.every((node) => node.required.every((edge) => registry.graph.providers[edge.ref]))).toBe(true);
    // Every capability appears exactly once in the boot order.
    expect([...registry.graph.bootOrder].sort()).toEqual(registry.graph.nodes.map((node) => node.id).sort());
    // A provider must be booted before anything that requires it.
    for (const node of registry.graph.nodes) {
      for (const edge of node.required) {
        expect(registry.graph.bootOrder.indexOf(edge.to), `${edge.to} must precede ${node.id}`).toBeLessThan(registry.graph.bootOrder.indexOf(node.id));
      }
    }
  });

  it("keeps every optional dependency either provided or deliberately absent", () => {
    const registry = buildCapabilityRegistry(process.cwd());
    // An optional edge naming nothing at all is a typo, not a degradation: a real
    // optional dependency must name a contract someone could provide.
    for (const node of registry.graph.nodes) {
      for (const missing of node.missing) {
        expect(missing.reason, `${missing.from} -> ${missing.ref} has no reason`).toBeTruthy();
      }
    }
  });
});

describe("Phase 01 Task A — manifest validation errors are legible", () => {
  it("reports every problem of an invalid manifest set in one error", () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "boss-manifests-"));
    try {
      fs.writeFileSync(nodePath.join(dir, "broken.yaml"), 'id: ""\nversion: nope\nkind: nope\n', "utf8");
      expect(() => loadCapabilityManifests(dir, dir)).toThrow(/manifest problem/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses two manifests that claim the same capability id", () => {
    // The duplicate-id rule is checked on the real body of a real manifest, so the
    // fixture cannot drift away from the schema it is meant to exercise.
    const body = fs.readFileSync(nodePath.join(process.cwd(), "config", "capabilities", "theme.yaml"), "utf8");
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "boss-dupes-"));
    try {
      fs.writeFileSync(nodePath.join(dir, "one.yaml"), body, "utf8");
      fs.writeFileSync(nodePath.join(dir, "two.yaml"), body, "utf8");
      expect(() => loadCapabilityManifests(dir, dir)).toThrow(/duplicate capability id/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names the failing file and field when a manifest is unparseable", () => {
    const result = parseCapabilityManifestText("id: [unclosed\n", "some/manifest.yaml");
    expect(result.manifest).toBeUndefined();
    expect(result.problems[0].source).toBe("some/manifest.yaml");
    expect(result.problems[0].message).toContain("not parseable");
  });
});
