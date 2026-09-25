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
  decide: (report: unknown, ratchet: unknown) => {
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

const FLOOR = 0;

/** A report shaped like the inventory's, with the fields the ratchet reads. */
function report(overrides: {
  kernelToFeatureFileEdges?: number;
  kernelToFeaturePairs?: number;
  mutualCapabilityPairs?: number;
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
    },
    kernelToFeaturePairs: overrides.kernelToFeaturePairsList ?? [],
  };
}

const baseline = {
  ownershipModel: "config/capability-modules.json -- the OWNERSHIP MAP, not the manifests",
  measuredAt: "2026-09-25T00:05Z",
  recorded: { kernel_to_feature_file_edges: 82, kernel_to_feature_pairs: 25, mutual_capability_pairs: 38, files_owned: 597, capabilities_with_kinds: 27, composition_root_files: 2 },
  target: { kernel_to_feature_file_edges: 0, mutual_capability_pairs: 0 },
};

describe("P2-B ratchet — the recorded floor holds on the real tree", () => {
  it("holds, and reports no improvement to absorb", () => {
    const decision = ratchet.decide(inventory.report, ratchet.readRatchet());
    expect(decision.problems, `the ratchet fails on the committed tree: ${decision.problems.join("; ")}`).toEqual([]);
    expect(decision.ok).toBe(true);
    expect(decision.improvements, "a recorded value is now above the measurement; lower it in the same commit").toEqual([]);
  });

  it("quotes its ownership model, because neither number means anything without one", () => {
    const decision = ratchet.decide(inventory.report, ratchet.readRatchet());
    expect(decision.ownershipModel).toContain("capability-modules.json");
    expect(decision.ownershipModel).toMatch(/OWNERSHIP MAP, not the manifests/);
  });

  it("pins the measurement it records, so a change in either direction is a deliberate edit", () => {
    // The `--check` discipline the repository already uses for generated artifacts: if the migration lowered a
    // ceiling, THIS case fails and says to lower the artifact in the same commit. Failing on improvement is the
    // point -- it is what stops the recorded number from describing a tree that no longer exists.
    const decision = ratchet.decide(inventory.report, ratchet.readRatchet());
    const recorded = ratchet.readRatchet().recorded;
    expect(decision.measured.kernelToFeatureFileEdges, "lower config/p2b-kernel-feature-ratchet.json in this commit").toBe(recorded.kernel_to_feature_file_edges);
    expect(decision.measured.kernelToFeaturePairs).toBe(recorded.kernel_to_feature_pairs);
    expect(decision.measured.mutualCapabilityPairs).toBe(recorded.mutual_capability_pairs);
    // The floors are floors: adding files is not a regression.
    expect(decision.measured.filesOwned, "the floor is a minimum, not an equality").toBeGreaterThanOrEqual(recorded.files_owned);
    expect(decision.measured.capabilitiesWithKinds).toBeGreaterThanOrEqual(recorded.capabilities_with_kinds);
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
