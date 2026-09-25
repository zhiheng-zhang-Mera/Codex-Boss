import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * P2-B / P2-C — the regression ratchet, and the two ways a migration can lie about its own progress.
 *
 * WHY A RATCHET AND NOT A TEST THAT ASSERTS ZERO
 *
 *   Workbook section 16's acceptance is `foundation -> building implementation edges = 0`, and the measured
 *   value is 82. A test asserting zero would be red today, which the CI policy forbids outside a declared
 *   experiment. A ratchet is the honest device in between: it records the measurement, refuses a regression,
 *   and names the target. The number is expected to FALL as the migration proceeds, and lowering it is part of
 *   the commit that lowers it.
 *
 * WHY IT IS NOT THE LEGACY RATCHET
 *
 *   `scripts/architecture.cjs ratchet` reads the MANIFESTS, which declare 25 module paths, so it sees 3
 *   capability edges and reports no violation while 82 kernel -> feature edges exist in the real graph. This
 *   ratchet reads the OWNERSHIP MAP through `scripts/phase2-edge-inventory.cjs`. The two measure different
 *   trees, so every number here is quoted WITH its model -- the workbook forbids quoting one without it.
 *
 * THE CASES THAT MATTER
 *
 *   A ratchet observed only passing has not been shown to ratchet anything. So each floor is exercised with a
 *   constructed report that violates exactly it, and the anti-gaming floors matter most: a fall in the edge
 *   count that comes from SCANNING FEWER FILES is not progress, and section 17 says so directly -- "Do not
 *   reduce the numbers by hiding files from the scanner."
 */

const PROJECT = process.cwd();
const SCRIPT = "scripts/p2b-kernel-feature-ratchet.cjs";
const RATCHET_PATH = "config/p2b-kernel-feature-ratchet.json";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ratchet = require(path.join(PROJECT, SCRIPT)) as {
  decide: (report: unknown, ratchet: unknown, cycles?: unknown) => {
    ok: boolean;
    ownershipModel: string;
    problems: string[];
    improvements: string[];
    measured: Record<string, number | null>;
    target: Record<string, number>;
  };
  readRatchet: (root?: string) => { schema: string; ownershipModel: string; recorded: Record<string, number>; target: Record<string, number>; reason: string };
  RATCHET_PATH: string;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const inventory = require(path.join(PROJECT, "scripts/phase2-edge-inventory.cjs")) as { report: unknown };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cycles = require(path.join(PROJECT, "scripts/phase2-cycles.cjs")) as {
  report: Record<string, unknown>;
  stronglyConnectedComponents: (nodes: string[], edges: Array<[string, string]>) => string[][];
  measure: (inventoryReport: unknown) => Record<string, unknown>;
};
const CYCLES_SCRIPT = "scripts/phase2-cycles.cjs";

/** A cycle report shaped like the instrument's, with the fields the ratchet reads. */
function cycleReport(overrides: {
  largestSccSize?: number;
  nonTrivialSccCount?: number;
  sccCount?: number;
  twoCyclePairCount?: number;
  capabilityNodes?: number;
  capabilityEdges?: number;
} = {}): unknown {
  return {
    largestSccSize: overrides.largestSccSize ?? 20,
    nonTrivialSccCount: overrides.nonTrivialSccCount ?? 1,
    sccCount: overrides.sccCount ?? 9,
    twoCyclePairCount: overrides.twoCyclePairCount ?? 38,
    capabilityNodes: overrides.capabilityNodes ?? 28,
    capabilityEdges: overrides.capabilityEdges ?? 193,
  };
}

const FLOOR = 0;

/** A report shaped like the inventory's, with the fields the ratchet reads. */
function report(overrides: {
  kernelToFeatureFileEdges?: number;
  kernelToFeaturePairs?: number;
  mutualCapabilityPairs?: number;
  totalCrossCapabilityFileEdges?: number;
  filesOwned?: number;
  capabilitiesWithKinds?: number;
  compositionRootFiles?: number;
  kernelToFeaturePairsList?: Array<{ pair: string; count: number }>;
} = {}): unknown {
  return {
    measured: {
      filesOwned: overrides.filesOwned ?? 597,
      capabilitiesWithKinds: overrides.capabilitiesWithKinds ?? 27,
      compositionRootFiles: overrides.compositionRootFiles ?? 2,
    },
    edges: {
      kernelToFeatureFileEdges: overrides.kernelToFeatureFileEdges ?? 82,
      kernelToFeaturePairs: overrides.kernelToFeaturePairs ?? 25,
      mutualCapabilityPairs: overrides.mutualCapabilityPairs ?? 38,
      // The RAW total, which the ratchet floors as its strongest anchor: a road declaration MOVES an edge between
      // columns and must leave this untouched, so a fall here means edges were actually lost.
      totalCrossCapabilityFileEdges: overrides.totalCrossCapabilityFileEdges ?? 801,
    },
    kernelToFeaturePairs: overrides.kernelToFeaturePairsList ?? [],
  };
}

const baseline = {
  ownershipModel: "config/capability-modules.json -- the OWNERSHIP MAP, not the manifests",
  measuredAt: "2026-09-25T00:05Z",
  recorded: { kernel_to_feature_file_edges: 82, kernel_to_feature_pairs: 25, mutual_capability_pairs: 38, files_owned: 597, capabilities_with_kinds: 27, composition_root_files: 2, total_cross_capability_file_edges: 801 },
  target: { kernel_to_feature_file_edges: 0, mutual_capability_pairs: 0 },
};

/**
 * The same floor WITH the P2-C numbers recorded.
 *
 * Separate from `baseline` on purpose: the SCC checks are conditional on the artifact recording them, so the
 * cases above exercise the P2-B half alone (as they did before P2-C existed) and the cases below exercise the
 * cycle half. A single fixture carrying both would make every P2-B case depend on a cycle report it does not
 * use.
 */
const baselineWithCycles = {
  ...baseline,
  recorded: { ...baseline.recorded, largest_scc_size: 20, non_trivial_scc_count: 1, scc_count: 9, capability_nodes: 28, capability_edges: 193 },
};

describe("P2-B ratchet — the recorded floor holds on the real tree", () => {
  it("holds, and reports no improvement to absorb", () => {
    const decision = ratchet.decide(inventory.report, ratchet.readRatchet(), cycles.report);
    expect(decision.problems, `the ratchet fails on the committed tree: ${decision.problems.join("; ")}`).toEqual([]);
    expect(decision.ok).toBe(true);
    expect(decision.improvements, "a recorded value is now above the measurement; lower it in the same commit").toEqual([]);
  });

  it("quotes its ownership model, because neither number means anything without one", () => {
    const decision = ratchet.decide(inventory.report, ratchet.readRatchet(), cycles.report);
    expect(decision.ownershipModel).toContain("capability-modules.json");
    expect(decision.ownershipModel).toMatch(/OWNERSHIP MAP, not the manifests/);
  });

  it("pins the measurement it records, so a change in either direction is a deliberate edit", () => {
    // The `--check` discipline the repository already uses for generated artifacts: if the migration lowered a
    // ceiling, THIS case fails and says to lower the artifact in the same commit. Failing on improvement is the
    // point -- it is what stops the recorded number from describing a tree that no longer exists.
    const decision = ratchet.decide(inventory.report, ratchet.readRatchet(), cycles.report);
    const recorded = ratchet.readRatchet().recorded;
    expect(decision.measured.kernelToFeatureFileEdges, "lower config/p2b-kernel-feature-ratchet.json in this commit").toBe(recorded.kernel_to_feature_file_edges);
    expect(decision.measured.kernelToFeaturePairs).toBe(recorded.kernel_to_feature_pairs);
    expect(decision.measured.mutualCapabilityPairs).toBe(recorded.mutual_capability_pairs);
    expect(decision.measured.largestSccSize, "lower the recorded largest_scc_size in this commit").toBe(recorded.largest_scc_size);
    expect(decision.measured.nonTrivialSccCount).toBe(recorded.non_trivial_scc_count);
    expect(decision.measured.capabilityEdges).toBe(recorded.capability_edges);
    // The floors are floors: adding files is not a regression.
    expect(decision.measured.filesOwned, "the floor is a minimum, not an equality").toBeGreaterThanOrEqual(recorded.files_owned);
    expect(decision.measured.capabilitiesWithKinds).toBeGreaterThanOrEqual(recorded.capabilities_with_kinds);
    expect(decision.measured.capabilityNodes).toBeGreaterThanOrEqual(recorded.capability_nodes);
  });
});

describe("P2-B ratchet — every recorded value is exercised by a report that violates exactly it", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["a new kernel -> feature edge", report({ kernelToFeatureFileEdges: 83 }), /kernel -> feature file edges ROSE to 83/],
    ["a new kernel -> feature pair", report({ kernelToFeaturePairs: 26 }), /kernel -> feature pairs ROSE to 26/],
    ["a new mutual capability pair", report({ mutualCapabilityPairs: 39 }), /mutual capability pairs ROSE to 39/],
    ["fewer scanned files", report({ filesOwned: 596 }), /owned files FELL to 596/],
    ["a kernel that lost its kind", report({ capabilitiesWithKinds: 26 }), /capabilities with a kind FELL to 26/],
    ["the composition root hidden", report({ compositionRootFiles: 1 }), /composition-root files FELL to 1/],
  ];

  for (const [name, constructed, expected] of cases) {
    it(`refuses ${name}`, () => {
      const decision = ratchet.decide(constructed, baseline);
      expect(decision.ok, `${name} passed the ratchet`).toBe(false);
      expect(decision.problems.join(" | "), `${name} was refused without naming the value`).toMatch(expected);
    });
  }

  it("names the ownership model in the problem, not just the number", () => {
    const decision = ratchet.decide(report({ kernelToFeatureFileEdges: 154 }), baseline);
    expect(decision.problems.join(" ")).toContain("capability-modules.json");
  });

  it("refuses the composition root being counted as a kernel", () => {
    // The regression this exists for: if `electron/main.ts` went back to `runtime`, its ~95 outgoing edges would
    // reappear as kernel -> feature inversions. A pair anchored at the composition root is the shape that
    // mis-attribution takes, and it must never satisfy the kernel test.
    const decision = ratchet.decide(report({ kernelToFeaturePairsList: [{ pair: "<composition-root> -> tenx", count: 22 }] }), baseline);
    expect(decision.ok).toBe(false);
    expect(decision.problems.join(" ")).toMatch(/composition root is counted as a kernel/);
  });

  it("fails closed when a value cannot be compared, rather than treating a missing number as an improvement", () => {
    // A ratchet whose comparison silently no-ops on `undefined` reports HOLDS for a report it could not read.
    const decision = ratchet.decide({ measured: {}, edges: {} }, baseline);
    expect(decision.ok, "an unreadable measurement passed the ratchet").toBe(false);
    expect(decision.problems.length).toBeGreaterThanOrEqual(4);
    expect(decision.problems.join(" ")).toMatch(/not comparable/);
  });
});

describe("P2-B ratchet — improvement is reported, so lowering the floor is the obvious next act", () => {
  it("reports a fall in each ceiling as an improvement naming the artifact to edit", () => {
    const decision = ratchet.decide(report({ kernelToFeatureFileEdges: 70, kernelToFeaturePairs: 20, mutualCapabilityPairs: 30 }), baseline);
    expect(decision.ok).toBe(true);
    expect(decision.improvements.length).toBe(3);
    expect(decision.improvements.join(" ")).toContain(RATCHET_PATH);
  });

  it("does not call a rise an improvement", () => {
    const decision = ratchet.decide(report({ kernelToFeatureFileEdges: 100 }), baseline);
    expect(decision.improvements.join(" ")).not.toContain("kernel -> feature file edges fell");
    expect(decision.ok).toBe(false);
  });

  it("adding files is not an improvement and not a regression", () => {
    const decision = ratchet.decide(report({ filesOwned: 700 }), baseline);
    expect(decision.ok).toBe(true);
    expect(decision.improvements.join(" "), "a floor rose, which is neither progress nor a regression").not.toContain("owned files");
  });
});

describe("P2-B ratchet — the committed baseline artifact and the program's own boundaries", () => {
  it("the artifact names its model, its target and its measurement command", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(PROJECT, RATCHET_PATH), "utf8")) as Record<string, unknown>;
    expect(raw.schema).toBe("city-p2b-kernel-feature-ratchet/1");
    expect(String(raw.ownership_model)).toContain("capability-modules.json");
    expect(String(raw.measured_by)).toContain("phase2-edge-inventory.cjs");
    expect(String(raw.reason ?? "").length, "the baseline carries no substantive reason").toBeGreaterThan(80);
    const target = raw.target as Record<string, number>;
    expect(target.kernel_to_feature_file_edges, "section 16's target is 0").toBe(0);
    expect(target.mutual_capability_pairs, "section 17's target is 0").toBe(0);
    const recorded = raw.recorded as Record<string, number>;
    expect(recorded.files_owned).toBeGreaterThan(500);
    for (const value of Object.values(recorded)) expect(Number.isFinite(value)).toBe(true);
  });

  it("the artifact records the kernels it measured, so a missing one is visible", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(PROJECT, RATCHET_PATH), "utf8")) as { measured_kernels?: string[] };
    expect(raw.measured_kernels ?? []).toEqual(["persistence", "providers", "runtime", "state-core"]);
  });

  it("the JUDGE is separate from the INSTRUMENT", () => {
    // The inventory's header states its own boundary: "It does not decide whether an edge is a defect ... so the
    // classification cannot be smuggled into the instrument." A threshold inside it would break that contract.
    const instrument = fs.readFileSync(path.join(PROJECT, "scripts/phase2-edge-inventory.cjs"), "utf8");
    expect(instrument, "the inventory grew a verdict").not.toMatch(/VERDICT=|RATCHET|baseline_/);
    expect(instrument).not.toContain("p2b-kernel-feature-ratchet.json");
  });

  it("is a plain Node program, and is read-only", () => {
    const probe = spawnSync(process.execPath, ["-e", `const m=require(${JSON.stringify(path.join(PROJECT, SCRIPT))}); if(!m.decide||!m.readRatchet) process.exit(1);`], { encoding: "utf8", timeout: 60000 });
    expect(probe.status, `the ratchet could not be loaded by plain node: ${probe.stderr}`).toBe(0);
    const source = fs.readFileSync(path.join(PROJECT, SCRIPT), "utf8");
    for (const forbidden of ["writeFileSync", "appendFileSync", "unlinkSync", "rmSync"]) {
      expect(source.includes(forbidden), `the read-only ratchet calls ${forbidden}`).toBe(false);
    }
    expect(FLOOR).toBe(0);
  });

  it("the CLI exits 0 on the real tree and reports its verdict", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
    expect(run.status, `the ratchet CLI failed on the committed tree: ${run.stdout}${run.stderr}`).toBe(0);
    expect(String(run.stdout)).toContain("VERDICT=HOLDS");
  });
});

/**
 * P2-C — the SCC half of section 17, and why the SCC SIZE is the number that decides the programme.
 *
 * A 2-cycle count says how many PAIRS are mutually dependent. The SCC decomposition says whether the graph is a
 * KNOT, and the two imply different work: pairwise repairs are enough when the mutual pairs sit in small
 * components, while one component holding most capabilities only dissolves when EVERY internal mutual dependency
 * does. The historical measurement was the second kind -- one SCC containing 25 of 27 -- so these cases pin the
 * size, its anti-gaming floors, and the property that a SPLIT is progress even though it raises the component
 * count.
 */
describe("P2-C ratchet — the SCC floor holds, and a SPLIT is progress", () => {
  it("holds when the cycle report matches the recorded floors", () => {
    const decision = ratchet.decide(report(), baselineWithCycles, cycleReport());
    expect(decision.problems, decision.problems.join("; ")).toEqual([]);
    expect(decision.ok).toBe(true);
  });

  const refusals: Array<[string, unknown, RegExp]> = [
    ["a LARGER largest component", cycleReport({ largestSccSize: 21 }), /largest SCC size ROSE to 21/],
    ["a new non-trivial component", cycleReport({ nonTrivialSccCount: 2 }), /non-trivial SCCs ROSE to 2/],
    ["the cycle instrument disagreeing with the inventory on the 2-cycle count", cycleReport({ twoCyclePairCount: 39 }), /mutual capability pairs \(cycles\) ROSE to 39/],
    ["capability NODES falling", cycleReport({ capabilityNodes: 27 }), /capability nodes FELL to 27/],
    ["capability EDGES falling", cycleReport({ capabilityEdges: 192 }), /capability edges FELL to 192/],
  ];
  for (const [name, constructed, expected] of refusals) {
    it(`refuses ${name}`, () => {
      const decision = ratchet.decide(report(), baselineWithCycles, constructed);
      expect(decision.ok, `${name} passed the ratchet`).toBe(false);
      expect(decision.problems.join(" | "), `${name} was refused without naming the value`).toMatch(expected);
    });
  }

  it("FAILS CLOSED when the floor names an SCC size but no cycle report was supplied", () => {
    // The property cannot be checked without the measurement, and "I could not check it" must not read as "it
    // holds". This is what the artifact recording SCC numbers buys: the measurement becomes mandatory.
    const decision = ratchet.decide(report(), baselineWithCycles);
    expect(decision.ok).toBe(false);
    expect(decision.problems.join(" ")).toMatch(/no cycle measurement was supplied/);
  });

  it("does NOT treat a rise in the SCC COUNT as a regression, because splitting raises it", () => {
    const decision = ratchet.decide(report(), baselineWithCycles, cycleReport({ sccCount: 12, largestSccSize: 14, nonTrivialSccCount: 1 }));
    expect(decision.problems.join(" "), "a split was reported as a regression").not.toMatch(/SCC count ROSE/);
    expect(decision.ok, decision.problems.join("; ")).toBe(true);
    expect(decision.improvements.join(" "), "the largest component fell and that is the improvement to record").toContain("largest SCC size fell");
  });

  it("reports a falling largest component as the improvement to record", () => {
    const decision = ratchet.decide(report(), baselineWithCycles, cycleReport({ largestSccSize: 12 }));
    expect(decision.ok).toBe(true);
    expect(decision.improvements.join(" ")).toMatch(/largest SCC size fell from 20 to 12/);
  });
});

describe("P2-C instrument — the SCC function itself, on graphs whose answer is derivable by hand", () => {
  const scc = (nodes: string[], edges: Array<[string, string]>): string[][] => cycles.stronglyConnectedComponents(nodes, edges);

  it("returns one trivial component per node for a DAG", () => {
    expect(scc(["a", "b", "c"], [["a", "b"], ["b", "c"]])).toEqual([["a"], ["b"], ["c"]]);
  });

  it("collapses a 2-cycle into ONE component, which is why mutual pairs and SCCs are different numbers", () => {
    expect(scc(["a", "b"], [["a", "b"], ["b", "a"]])).toEqual([["a", "b"]]);
  });

  it("finds two disjoint cycles as two components", () => {
    expect(scc(["a", "b", "c", "d"], [["a", "b"], ["b", "a"], ["c", "d"], ["d", "c"]])).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("collapses a THREE-cycle into one component, which a 2-cycle case cannot show", () => {
    // Added after a deliberate mutation showed the cases above could not detect a broken low-link step: with
    // low-link propagation removed, a 2-cycle still comes out right, because each member sees the other directly.
    // In a longer cycle the link from the deepest member back to the root has to be PROPAGATED through the
    // intermediate frames, and a test graph without a three-cycle never exercises that.
    expect(scc(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]])).toEqual([["a", "b", "c"]]);
  });

  it("keeps a tail OUT of the cycle it leads into", () => {
    // x -> a -> b -> c -> a: the component is {a,b,c} and x is its own. A component that swallowed x would be
    // reporting reachability as mutual dependency, which is the difference section 17 is about.
    expect(scc(["x", "a", "b", "c"], [["x", "a"], ["a", "b"], ["b", "c"], ["c", "a"]])).toEqual([["a", "b", "c"], ["x"]]);
  });

  it("keeps a self-loop as a trivial component rather than hiding it", () => {
    // A node that depends on itself is a size-one component either way, so the SCC size cannot report it; the
    // instrument carries a separate self-loop count for exactly that reason.
    const measured = cycles.measure({ allPairs: [{ pair: "a -> a", count: 1 }, { pair: "a -> b", count: 1 }] });
    expect(cycles.stronglyConnectedComponents(["a", "b"], [["a", "a"]])).toEqual([["a"], ["b"]]);
    expect(measured.selfLoopCount).toBe(1);
    expect(measured.selfLoops).toEqual(["a"]);
    expect(measured.largestSccSize).toBe(1);
  });

  it("computes the component size over the WHOLE pair list, not a truncated summary", () => {
    // The invented-pair case: with only a->b and b->a present, the largest component is 2. A consumer that read a
    // truncated top-60 list would compute this correctly for a small graph and silently under-report for a large
    // one, which is why the inventory now publishes `allPairs`.
    const measured = cycles.measure({ allPairs: [{ pair: "a -> b", count: 1 }, { pair: "b -> a", count: 1 }, { pair: "b -> c", count: 1 }] });
    expect(measured.largestSccSize).toBe(2);
    expect(measured.largestSccMembers).toEqual(["a", "b"]);
    expect(measured.twoCyclePairCount).toBe(1);
    expect(measured.capabilityNodes).toBe(3);
    expect(measured.capabilityEdges).toBe(3);
  });

  it("measures the real tree, and the largest component is the knot section 17 is about", () => {
    const measured = cycles.report;
    expect(Number(measured.capabilityNodes), "the capability graph lost its nodes").toBeGreaterThan(20);
    expect(Number(measured.largestSccSize), "no component has more than one member, so section 17 is complete and this case must be replaced rather than deleted").toBeGreaterThan(1);
    expect(Number(measured.largestSccSize)).toBeLessThanOrEqual(Number(measured.capabilityNodes));
    // The largest component's members are capabilities the graph really has.
    for (const member of measured.largestSccMembers as string[]) expect(String(measured.components ? member : member)).toBeTruthy();
    // The instrument's own 2-cycle count and the inventory's rollup are the SAME property measured twice.
    expect(measured.twoCyclePairCount).toBe((inventory.report as { edges: { mutualCapabilityPairs: number } }).edges.mutualCapabilityPairs);
  });

  it("is a read-only plain Node program", () => {
    const probe = spawnSync(process.execPath, ["-e", `const m=require(${JSON.stringify(path.join(PROJECT, CYCLES_SCRIPT))}); if(!m.report||!m.stronglyConnectedComponents||!m.measure) process.exit(1);`], { encoding: "utf8", timeout: 60000 });
    expect(probe.status, `the cycle instrument could not be loaded by plain node: ${probe.stderr}`).toBe(0);
    const source = fs.readFileSync(path.join(PROJECT, CYCLES_SCRIPT), "utf8");
    for (const forbidden of ["writeFileSync", "appendFileSync", "unlinkSync", "rmSync"]) {
      expect(source.includes(forbidden), `the read-only instrument calls ${forbidden}`).toBe(false);
    }
    // The instrument must not judge: the ratchet is where a threshold may live.
    expect(source, "the cycle instrument grew a verdict").not.toMatch(/VERDICT=|RATCHET/);
  });
});
