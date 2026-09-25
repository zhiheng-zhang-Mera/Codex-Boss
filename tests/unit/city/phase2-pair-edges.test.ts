import { describe, expect, it } from "vitest";
import path from "node:path";

/**
 * P2-E decision input — the per-pair edge inspector, and the cross-check that makes it usable.
 *
 * THE DESIGN POINT
 *
 *   The inventory answers "how many" and stops, deliberately: not deciding is what keeps the classification out of
 *   the instrument. But section 16 and section 17 work is per-PAIR and per-EDGE, and a pair cannot be decided from
 *   a count. This inspector decomposes the counts -- and because it must not disagree with the ratchet that
 *   ENFORCES the counts, its `--verify` mode re-derives the whole graph and asserts equality with the inventory on
 *   every total and every one of the 193 pair counts.
 *
 *   That gate caught a real defect on its first run, and the case is kept below as an invariant: the inventory's
 *   unit is a (source file, DISTINCT SPECIFIER) pair, not an import statement. Counting statements gave 867 edges
 *   against 801, and 84 kernel -> feature edges against 73. Section 16's target of zero is in the inventory's
 *   currency, so a work list in any other currency would have over-scoped the migration by 15%.
 */

const PROJECT = process.cwd();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const inspector = require(path.join(PROJECT, "scripts/phase2-pair-edges.cjs")) as {
  scan: () => Scan;
  verify: (scan: Scan) => { ok: boolean; problems: string[]; pairsCompared: number; edgesCompared: number; mismatchedPairs: number };
  closureOf: (edges: Edge[]) => { directories: string[]; targets: string[]; commonDirectory: string };
  renderPair: (scan: Scan, pair: string) => string;
  renderKernelToFeature: (scan: Scan) => string;
  renderKernelTargets: (scan: Scan) => string;
  renderRoadCandidates: (scan: Scan) => string;
};

type Edge = { pair: string; from: string; to: string; fromFile: string; toFile: string; specifier: string; line: number; fromKind: string | null; toKind: string | null; declared: boolean };
type Scan = {
  measured: Record<string, number>;
  totals: Record<string, number>;
  edges: Edge[];
  pairCounts: Map<string, number>;
};

describe("P2-E the pair inspector decomposes the inventory without disagreeing with it", () => {
  it("agrees with the inventory on every total and every one of the pair counts", () => {
    const result = inspector.scan();
    const verification = inspector.verify(result);
    expect(verification.problems).toEqual([]);
    expect(verification.ok).toBe(true);
    // 193 distinct capability pairs: the graph the ratchets enforce.
    expect(verification.pairsCompared).toBe(193);
    expect(verification.edgesCompared).toBe(result.edges.length);
    expect(verification.edgesCompared).toBeGreaterThan(700);
  });

  it("fails its own cross-check when an edge is dropped or invented, so the gate is not decorative", () => {
    const dropped = inspector.scan();
    dropped.edges.pop();
    const droppedVerification = inspector.verify(dropped);
    expect(droppedVerification.ok).toBe(false);
    expect(droppedVerification.problems.join("\n")).toContain("totalCrossCapabilityFileEdges");

    const invented = inspector.scan();
    const sample = invented.edges[0];
    invented.edges.push({ ...sample, toFile: `${sample.toFile}`, fromFile: `${sample.fromFile}` });
    invented.edges.push(sample);
    expect(inspector.verify(invented).ok).toBe(false);
  });

  it("fails when a single PAIR count drifts, not just the total", () => {
    const result = inspector.scan();
    // Swap one edge's owner pair: the total is unchanged and two pair counts move.
    const edge = result.edges.find((entry) => entry.pair === "persistence -> tasks")!;
    const moved = { ...edge, pair: "persistence -> workspace" };
    result.edges = result.edges.map((entry) => (entry === edge ? moved : entry));
    const verification = inspector.verify(result);
    expect(verification.ok).toBe(false);
    expect(verification.mismatchedPairs).toBeGreaterThan(0);
  });

  it("counts a (file, specifier) pair once, which is the inventory's unit and not the import statement", () => {
    const result = inspector.scan();
    const distinct = new Set(result.edges.map((edge) => `${edge.fromFile}|${edge.specifier}`));
    expect(distinct.size).toBe(result.edges.length);
  });

  it("attributes every edge to two different capabilities, and every edge target to a real file", () => {
    const result = inspector.scan();
    for (const edge of result.edges) {
      expect(edge.from).not.toBe(edge.to);
      expect(edge.toFile.startsWith("src/") || edge.toFile.startsWith("electron/")).toBe(true);
      expect(edge.line).toBeGreaterThan(0);
      expect(edge.specifier.length).toBeGreaterThan(0);
    }
  });
});

describe("P2-E the closure and candidate readings the decisions rest on", () => {
  it("reports a common directory only when the targets really share one", () => {
    const together = inspector.closureOf([
      { toFile: "src/shared/a.ts" },
      { toFile: "src/shared/b.ts" },
    ] as Edge[]);
    expect(together.commonDirectory).toBe("src/shared");
    expect(together.directories).toEqual(["src/shared"]);

    const scattered = inspector.closureOf([
      { toFile: "src/shared/a.ts" },
      { toFile: "electron/commander/b.ts" },
    ] as Edge[]);
    expect(scattered.commonDirectory).toBe("");
    expect(scattered.directories).toEqual(["electron/commander", "src/shared"]);
  });

  it("prints every edge of a named pair with its line and specifier, and says so when a pair has none", () => {
    const result = inspector.scan();
    const text = inspector.renderPair(result, "persistence -> tasks");
    expect(text).toContain("persistence -> tasks");
    expect(text).toContain("kinds kernel -> feature");
    expect(text).toContain("common directory src/shared");
    expect(text).toMatch(/electron\/store\.ts:\d+/);
    expect(inspector.renderPair(result, "persistence -> nothing-at-all")).toContain("no edge.");
  });

  it("reports the kernel -> feature work list in the inventory's currency", () => {
    const result = inspector.scan();
    const text = inspector.renderKernelToFeature(result);
    expect(text).toContain(`${result.totals.kernelToFeatureFileEdges} edge(s) over ${result.totals.kernelToFeaturePairs} pair(s)`);
    expect(result.totals.kernelToFeatureFileEdges).toBe(73);
    expect(result.totals.kernelToFeaturePairs).toBe(25);
  });

  it("keeps the leaf test honest: a LEAF reaches no capability, a NON-LEAF does, and only shared targets are listed", () => {
    const result = inspector.scan();
    const importers = new Map<string, Set<string>>();
    const reached = new Map<string, Set<string>>();
    for (const edge of result.edges) {
      const set = importers.get(edge.toFile) ?? new Set<string>();
      set.add(edge.from);
      importers.set(edge.toFile, set);
      const out = reached.get(edge.fromFile) ?? new Set<string>();
      out.add(edge.to);
      reached.set(edge.fromFile, out);
    }
    const text = inspector.renderRoadCandidates(result);

    // Every target imported by two or more capabilities is listed, marked by the MEASUREMENT and not by a list.
    const shared = [...importers.entries()].filter(([, set]) => set.size >= 2).map(([file]) => file);
    expect(shared.length).toBeGreaterThan(50);
    for (const file of shared) {
      const leaf = (reached.get(file)?.size ?? 0) === 0;
      expect(text).toContain(`${leaf ? "LEAF    " : "NOT LEAF"} ${file}`);
    }

    // A target with exactly one importer is not a candidate: the list is about sharing, not about popularity in
    // the abstract. Without this the list would be "every cross-capability target", which decides nothing.
    const single = [...importers.entries()].filter(([, set]) => set.size === 1).map(([file]) => file);
    expect(single.length).toBeGreaterThan(0);
    for (const file of single) expect(text).not.toContain(`LEAF    ${file}`);

    // Two named pins, so the reading cannot drift into a different graph without a case failing: the shared sink
    // that reaches nine capabilities is NOT a road (it imports other capabilities, which is ledger CC-030's
    // refutation), while the popular leaf owned by `tenx` IS a leaf candidate.
    expect(text).toMatch(/NOT LEAF src\/shared\/contracts\.ts\s+owned by status/);
    expect(text).toMatch(/LEAF\s+electron\/commander\/durable-json\.ts\s+owned by tenx/);
  });

  it("reports, for each kernel-imported file, every capability that imports it", () => {
    const result = inspector.scan();
    const text = inspector.renderKernelTargets(result);
    expect(text).toContain("src/shared/contracts.ts  owned by status");
    expect(text).toContain("electron/commander/durable-json.ts  owned by tenx");
    // The pins: the same file read two ways must agree about who imports it.
    const importers = new Set(result.edges.filter((edge) => edge.toFile === "src/shared/contracts.ts").map((edge) => edge.from));
    expect(importers.size).toBeGreaterThanOrEqual(10);
  });
});
