import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P2-A increment 2 — the cross-capability edge inventory, and the size of the work it measures.
 *
 * WHY THIS IS A TEST AND NOT A REPORT
 *
 *   The inventory's numbers are the work list for P2-B (kernel -> feature edges to zero) and P2-C (mutual pairs to
 *   zero). A report can go stale silently; a test that fails when the measurement stops being computable cannot.
 *   So these cases pin the PROPERTIES of the inventory rather than its exact counts: the counts are expected to
 *   FALL as the migration proceeds, and a case that asserted `154` would have to be edited on every increment --
 *   which is how a guard turns into a place where the honest number is quietly rewritten.
 *
 * WHAT IS PINNED
 *
 *   - the instrument agrees with the repository's own edge definition (import pattern and resolver copied from
 *     `scripts/architecture.cjs:256-266`), asserted by resolving a real import through it;
 *   - the inventory is non-trivial: it finds the owned files, the pairs, and specifically the two classes the
 *     programme must drive to zero;
 *   - the historical inversion `electron/bootstrap/persistence.ts -> electron/runtime-intelligence/live-capture`
 *     named in the workbook section 16 is STILL LIVE. If a future increment repairs it, THIS case is the one that
 *     must change -- deliberately, in the commit that repairs it -- rather than the number drifting.
 */

const PROJECT = process.cwd();
const SCRIPT = "scripts/phase2-edge-inventory.cjs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const inventory = require(path.join(PROJECT, SCRIPT)) as {
  report: {
    measured: { filesOwned: number; capabilitiesWithKinds: number; declaredModulePaths: number; declaredRequirementPairs: number };
    edges: {
      totalCrossCapabilityFileEdges: number;
      distinctCapabilityPairs: number;
      kernelToFeatureFileEdges: number;
      kernelToFeaturePairs: number;
      mutualCapabilityPairs: number;
      fullyDeclaredCrossCapabilityEdges: number;
      realPairsAlreadyDeclared: number;
      realPairsUndeclared: number;
    };
    topPairs: Array<{ pair: string; count: number }>;
    kernelToFeaturePairs: Array<{ pair: string; count: number }>;
    mutualPairs: Array<{ a: string; b: string; forward: number; backward: number }>;
    declaredRequirementPairs: string[];
    sampleKernelToFeatureEdges: string[];
  };
  ownsPath: (entries: string[], file: string) => boolean;
  resolveSpecifier: (specifier: string, fromFile: string) => string | undefined;
};

describe("P2-A increment 2 — the cross-capability edge inventory", () => {
  it("agrees with the repository's own edge definition, so the work list and the ratchet measure one graph", () => {
    // A REAL import resolved through the instrument: this is the historical inversion, and the resolver must
    // return the file the ratchet would attribute the edge to.
    expect(inventory.resolveSpecifier("../runtime-intelligence/live-capture", "electron/bootstrap/persistence.ts"))
      .toBe("electron/runtime-intelligence/live-capture.ts");
    // A bare package specifier is not an internal edge, and must stay unresolved rather than becoming one.
    expect(inventory.resolveSpecifier("node:fs", "electron/main.ts")).toBeUndefined();
    expect(inventory.resolveSpecifier("yaml", "scripts/architecture.cjs")).toBeUndefined();
    // The ownership map's directory-prefix rule, mirrored so the two cannot disagree:
    expect(inventory.ownsPath(["electron/platform"], "electron/platform/test-impact.ts")).toBe(true);
    expect(inventory.ownsPath(["electron/platform"], "electron/platform-extra.ts")).toBe(false);
  });

  it("measures the real tree rather than a subset of it", () => {
    const { measured, edges } = inventory.report;
    expect(measured.filesOwned, "the inventory found almost no owned files").toBeGreaterThan(500);
    expect(measured.capabilitiesWithKinds, "the manifests no longer name every capability").toBe(27);
    // The divergence P2-A exists to close: the manifests declare 25 module paths against ~600 owned files.
    expect(measured.declaredModulePaths, "the manifests now declare their full surface -- P2-A increment 2 has landed, and this expectation must be raised deliberately").toBeLessThan(measured.filesOwned);
    expect(edges.totalCrossCapabilityFileEdges, "no cross-capability edge was found at all, which would mean the scanner is broken").toBeGreaterThan(100);
    expect(edges.distinctCapabilityPairs).toBeGreaterThan(50);
    // Essentially nothing is declared: this is why the ratchet reads 3 edges while the tree has hundreds.
    expect(edges.fullyDeclaredCrossCapabilityEdges, "an edge was found with both endpoints declared, which contradicts the manifests' 25 declared paths").toBe(0);
    expect(edges.realPairsUndeclared, "the pairs are now declared -- P2-A has landed").toBeGreaterThan(100);
    expect(inventory.report.declaredRequirementPairs.length, "no requirement is declared at all, so the manifests are empty").toBeGreaterThan(0);
  });

  it("names the two classes the programme must drive to zero, and neither is zero yet", () => {
    const { edges } = inventory.report;
    expect(edges.kernelToFeatureFileEdges, "P2-B is complete: there are no kernel -> feature edges left").toBeGreaterThan(0);
    expect(edges.kernelToFeaturePairs).toBeGreaterThan(0);
    expect(edges.mutualCapabilityPairs, "P2-C is complete: there are no mutual capability pairs left").toBeGreaterThan(0);
    // The largest kernel -> feature pair is a real one, named so the work list has an obvious starting point.
    const largest = inventory.report.kernelToFeaturePairs[0];
    expect(largest.count, "the largest kernel -> feature pair is not the biggest").toBe(Math.max(...inventory.report.kernelToFeaturePairs.map((entry) => entry.count)));
    // Every kernel -> feature pair starts with a kernel capability.
    const KERNELS = ["persistence", "providers", "runtime", "state-core"];
    for (const entry of inventory.report.kernelToFeaturePairs) {
      expect(KERNELS, `the pair ${entry.pair} is not kernel -> feature`).toContain(entry.pair.split(" -> ")[0]);
    }
  });

  it("THE HISTORICAL INVERSION IS STILL LIVE — and this case must be changed by the commit that repairs it", () => {
    // The workbook section 16 names this edge as the historical example and instructs the executor not to assume
    // it still exists. It does: measured, not assumed, and it is the single most-cited justification for P2-B.
    const persistenceToRuntimeIntelligence = inventory.report.sampleKernelToFeatureEdges
      .some((line) => line.includes("electron/bootstrap/persistence.ts -> electron/runtime-intelligence"));
    expect(persistenceToRuntimeIntelligence, "the historical inversion is gone: if that is a real repair, replace this expectation with the test that proves it").toBe(true);
    // ...and it is a kernel -> feature edge by the manifests' own kinds, not by directory guesswork.
    const pair = inventory.report.kernelToFeaturePairs.find((entry) => entry.pair === "persistence -> tenx");
    expect(pair, "persistence no longer reaches tenx, so the largest persistence kernel->feature pair changed").toBeTruthy();
  });

  it("the mutual-pair list is a work list, not a verdict: it distinguishes an asymmetric pair from a cycle", () => {
    // `tenx <-> tasks` is the largest mutual pair and is strongly ASYMMETRIC (27 against 2). Reporting it as a
    // design cycle would send the repair after a two-way dependency that the measurement does not show; the honest
    // reading is that tenx mostly READS tasks, which is a missing contract rather than a cycle.
    const tenxTasks = inventory.report.mutualPairs.find((entry) => (entry.a === "tenx" && entry.b === "tasks") || (entry.a === "tasks" && entry.b === "tenx"));
    expect(tenxTasks, "the largest mutual pair is no longer in the list").toBeTruthy();
    if (tenxTasks) {
      const high = Math.max(tenxTasks.forward, tenxTasks.backward);
      const low = Math.min(tenxTasks.forward, tenxTasks.backward);
      expect(high, "the pair is no longer asymmetric, so the note in the inventory document is stale").toBeGreaterThan(low);
    }
    // Every mutual pair really has both directions present, or the list would be an overcount.
    for (const entry of inventory.report.mutualPairs) {
      expect(entry.forward, `${entry.a} <-> ${entry.b} has no forward edge`).toBeGreaterThan(0);
      expect(entry.backward, `${entry.a} <-> ${entry.b} has no backward edge`).toBeGreaterThan(0);
    }
  });
});
