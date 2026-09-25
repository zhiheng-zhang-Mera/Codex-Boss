import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P2-E — the road class, and the falsification of every rule that stops it being a way to move a number.
 *
 * THE DESIGN POINT
 *
 *   A road declaration is the cheapest way in this programme to make a metric move without repairing anything:
 *   attribute an edge to `<road>` and a kernel stops "depending on a building" with no code change. Section 24 of
 *   docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md refuses count compensation, and ledger CC-030 already
 *   measured one attempt and refused it. So a declaration must pass a NECESSARY condition the machine checks -- the
 *   file is a LEAF -- and a SUFFICIENT one it cannot: the file carries no policy of its own. The machine enforces
 *   the EVIDENCE instead, and refuses a REFUTATION for a file that was never a candidate, because a refutation
 *   record is only worth anything if it records something.
 */

const PROJECT = process.cwd();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const validator = require(path.join(PROJECT, "scripts", "capability-roads-validator.cjs")) as {
  validate: (root?: string, options?: Record<string, unknown>) => Report;
  readRoads: (root?: string) => Roads;
  measure: (root?: string, options?: Record<string, unknown>) => unknown;
  PROOFS: string[];
};

type Roads = {
  classification: Record<string, string>;
  roads: Record<string, Record<string, string>>;
  refuted: Record<string, Record<string, string>>;
};
type Report = {
  ok: boolean;
  problems: string[];
  roads: Array<{ file: string; owner: string | null; leaf: boolean; consumers: string[]; kernelEdges: number }>;
  refutations: Array<{ file: string; consumers: string[]; leaf: boolean }>;
  effect: { roads: number; refutedCandidates: number; edgesToRoads: number; edgesFromRoads: number; kernelToFeatureNow: number; kernelToFeatureBefore: number };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const inspector = require(path.join(PROJECT, "scripts", "phase2-pair-edges.cjs")) as { scan: () => unknown };

const ROAD_FILE = "electron/commander/durable-json.ts";
const SECOND_ROAD = "src/shared/input-object.ts";
const REFUTED_FILE = "src/shared/execution.ts";

function goodProofs(): Record<string, string> {
  return {
    whyShared: "seventeen capabilities import it, and it depends on nothing but node builtins, so none of them owns it",
    whyNotBusiness: "it names no capability domain, holds no state between calls, and decides no outcome of its own",
    invariant: "the file is never observed half written because the new generation is flushed before the rename",
    contract: "three functions over a path and a JSON value, with no options object and no policy of its own",
    exitCondition: "extract it into a foundation location owned by no building, then delete this declaration entirely",
    ledgerEntry: "CC-038",
  };
}

function baseRoads(): Roads {
  const roads = validator.readRoads(PROJECT);
  return JSON.parse(JSON.stringify(roads)) as Roads;
}

const SCAN = inspector.scan();

function run(roads: Roads) {
  return validator.validate(PROJECT, { roads, scan: SCAN });
}

describe("P2-E the road class holds its own line", () => {
  it("accepts the committed declarations, so every rejection below is caused by the mutation under test", () => {
    const report = run(baseRoads());
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.effect.roads).toBe(2);
  });

  it("refuses a road that imports another capability -- CC-030's refutation as an executable rule", () => {
    const roads = baseRoads();
    // src/shared/contracts.ts reaches nine capabilities, so it can never be a road however popular it is.
    roads.roads["src/shared/contracts.ts"] = { owner: "status", ...goodProofs() };
    const report = run(roads);
    expect(report.ok).toBe(false);
    expect(report.problems.join("\n")).toContain("a road that reaches a capability is not a road");
  });

  it("refuses a road with fewer than two consuming capabilities, because section 19 says SEVERAL", () => {
    const roads = baseRoads();
    roads.roads["src/shared/coordination-economics.ts"] = { owner: "tenx", ...goodProofs() };
    const report = run(roads);
    expect(report.ok).toBe(false);
    expect(report.problems.join("\n")).toContain("needed by SEVERAL independent buildings");
  });

  it("refuses a file that is not trapped inside a building, and one whose declared owner is wrong", () => {
    // Owned by a KERNEL, so it is already foundation: a road declaration would move nothing and say nothing.
    const alreadyFoundation = baseRoads();
    alreadyFoundation.roads["electron/bootstrap/boot-module.ts"] = { owner: "runtime", ...goodProofs() };
    expect(run(alreadyFoundation).problems.join("\n")).toContain("it is not trapped inside a building");

    const notTrapped = baseRoads();
    notTrapped.roads["src/shared/nothing-here.ts"] = { owner: "tasks", ...goodProofs() };
    expect(run(notTrapped).problems.join("\n")).toContain("does not exist");

    const wrongOwner = baseRoads();
    wrongOwner.roads[ROAD_FILE] = { owner: "providers", ...goodProofs() };
    expect(run(wrongOwner).problems.join("\n")).toContain("the ownership map gives it to tenx");
  });

  it("refuses a road that is also a composition-root file, so two classes cannot both claim it", () => {
    const roads = baseRoads();
    // electron/main.ts is the composition root: the platform owns it, so it is not trapped in a building.
    roads.roads["electron/main.ts"] = { owner: "runtime", ...goodProofs() };
    const report = run(roads);
    const text = report.problems.join("\n");
    expect(text.includes("is also a composition-root file") || text.includes("owned by no capability in the ownership map")).toBe(true);
  });

  it("refuses a road that does not state each of the five proofs", () => {
    for (const proof of validator.PROOFS) {
      const roads = baseRoads();
      roads.roads[ROAD_FILE] = { owner: "tenx", ...goodProofs(), [proof]: "no" };
      const report = run(roads);
      expect(report.problems.join("\n"), `missing proof: ${proof}`).toContain(`does not state a substantive ${proof}`);
    }
    expect(validator.PROOFS).toHaveLength(5);
  });

  it("refuses a road whose ledger record is missing, and one whose classification is too thin to be a rule", () => {
    const noLedger = baseRoads();
    noLedger.roads[ROAD_FILE] = { owner: "tenx", ...goodProofs(), ledgerEntry: "CC-999" };
    expect(run(noLedger).problems.join("\n")).toContain("which the ledger does not contain");

    const thin = baseRoads();
    thin.classification.necessary_condition = "must be a leaf";
    expect(run(thin).problems.join("\n")).toContain("too thin to be a rule");
  });

  it("refuses a refutation for a file that was never a candidate", () => {
    const notALeaf = baseRoads();
    notALeaf.refuted["src/shared/contracts.ts"] = { reason: "x".repeat(140) };
    expect(run(notALeaf).problems.join("\n")).toContain("was never a candidate and the refutation records nothing");

    const singleConsumer = baseRoads();
    singleConsumer.refuted["src/shared/coordination-economics.ts"] = { reason: "x".repeat(140) };
    expect(run(singleConsumer).problems.join("\n")).toContain("was never a candidate under section 19");

    const thin = baseRoads();
    thin.refuted[REFUTED_FILE] = { reason: "not a road" };
    expect(run(thin).problems.join("\n")).toContain("does not state a substantive reason");
  });

  it("refuses a file that is declared a road and recorded as refuted at the same time", () => {
    const roads = baseRoads();
    roads.refuted[ROAD_FILE] = { reason: "x".repeat(140) };
    expect(run(roads).problems.join("\n")).toContain("both declared a road and recorded as refuted");
  });
});

describe("P2-E the committed road set, as measured", () => {
  it("holds, publishes the moved edges, and lets no edge leave a road", () => {
    const report = validator.validate(PROJECT);
    expect(report.problems).toEqual([]);
    expect(report.effect.edgesFromRoads).toBe(0);
    expect(report.effect.edgesToRoads).toBeGreaterThan(0);
    expect(report.effect.kernelToFeatureBefore).toBeGreaterThan(report.effect.kernelToFeatureNow);
  });

  it("declares two leafless roads and records two real refutations", () => {
    const report = validator.validate(PROJECT);
    expect(report.roads.map((entry) => entry.file).sort()).toEqual([ROAD_FILE, SECOND_ROAD].sort());
    for (const entry of report.roads) {
      expect(entry.leaf).toBe(true);
      expect(entry.consumers.length).toBeGreaterThanOrEqual(2);
      expect(entry.owner).not.toBeNull();
    }
    // The refutations are the valuable half: both files PASS the leaf test and are refused for carrying a policy.
    expect(report.refutations.map((entry) => entry.file).sort()).toEqual([REFUTED_FILE, "src/shared/permission.ts"].sort());
    for (const entry of report.refutations) {
      expect(entry.leaf).toBe(true);
      expect(entry.consumers.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("has an exit condition for every road, so a declaration is recorded debt rather than a label", () => {
    const roads = validator.readRoads(PROJECT);
    for (const [file, entry] of Object.entries(roads.roads)) {
      expect(entry.exitCondition.length, file).toBeGreaterThan(60);
      // The exit condition must name the act that REMOVES the declaration, not merely describe the file.
      expect(/extract|move it/i.test(entry.exitCondition), file).toBe(true);
    }
    // And the ratchet floors the road count, so a declaration cannot be withdrawn to move the numbers back.
    const ratchet = JSON.parse(fs.readFileSync(path.join(PROJECT, "config", "p2b-kernel-feature-ratchet.json"), "utf8")) as {
      recorded: { road_files: number; edges_to_roads: number };
      anti_gaming: Record<string, string>;
    };
    expect(ratchet.recorded.road_files).toBe(Object.keys(roads.roads).length);
    expect(ratchet.recorded.edges_to_roads).toBeGreaterThan(0);
    expect(Object.keys(ratchet.anti_gaming).join(" ")).toContain("roads");
  });
});
