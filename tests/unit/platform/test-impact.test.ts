import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TEST_TIERS,
  auditSelectionAgainstFullRun,
  duplicateObligations,
  ownersOf,
  selectTests,
  summarizeSelection,
  type TestSuite
} from "../../../src/shared/test-impact";
import { buildDependencyGraph } from "../../../electron/platform/dependency-graph";
import { loadCapabilityManifests } from "../../../electron/platform/capability-manifest";
import { impactRadius } from "../../../electron/platform/dependency-graph";
import { loadImpactRepository, discoverTestFiles, unattributedSourceFiles, selectForChange, COMPOSITION_ROOT_OWNER_ID } from "../../../electron/platform/test-impact";

/**
 * Phase 05 Task A — the impact selector, and the reasons it can be trusted.
 *
 * The book's rule that shapes this whole file: **the selector may not certify itself.** A selector
 * that says "I chose enough" has proved nothing, because the failure mode is precisely that it
 * cannot see what it missed. So the tests here come in three kinds:
 *
 *   1. the decision rules are exercised directly on constructed graphs, where the expected answer is
 *      derivable by hand;
 *   2. the catalogue is checked against the REAL tree, so a suite that nothing can select is caught;
 *   3. a meta-test DELIBERATELY drops the suites for an affected capability and requires the
 *      comparison against the full run to report the omission — the selector failing its own audit
 *      is the property being tested, so a selector that always agreed would fail this file.
 */

const PROJECT = process.cwd();

function suite(file: string, tier: TestSuite["tier"], covers: string[], extra: Partial<TestSuite> = {}): TestSuite {
  return { file, tier, covers, ...extra };
}

/** A tiny graph: `app` requires `store`, `tools` optionally uses `store`. */
const MODULES = new Map<string, string[]>([
  ["store", ["electron/store.ts", "electron/state-core"]],
  ["app", ["electron/app"]],
  ["tools", ["electron/tools"]],
  ["other", ["electron/other"]]
]);

function radiusOf(edges: Array<[string, string]>, from: string): string[] {
  const graph = buildDependencyGraph(
    [...new Set([from, ...edges.flat()])].map((id, index) => ({
      id,
      version: "1.0.0",
      kind: index === 0 ? "kernel" : "feature",
      provides: [`${id}.iface@1`],
      requires: edges.filter(([source]) => source === id).map(([, target]) => ({ ref: `${target}.iface@1`, capability: { id: target, major: 1 }, kind: "required" as const, reason: "test edge" })),
      optional: [],
      state: [],
      health: { critical: false },
      modules: [],
      bootModules: [],
      surface: [],
      permissions: [],
      source: `${id}.yaml`
    }))
  );
  return impactRadius(graph, from);
}

describe("Phase 05 Task A — ownersOf maps a changed file to the capabilities that own it", () => {
  it("prefers an exact owner over a directory that merely contains the file", () => {
    // `electron/state-core` is a directory entry and `electron/store.ts` an exact one. A file inside
    // the directory belongs to it; the exact file belongs to the exact owner only, so a change to
    // `electron/store.ts` does not drag in every test that guards the directory.
    expect(ownersOf("electron/store.ts", MODULES)).toEqual(["store"]);
    expect(ownersOf("electron/state-core/database.ts", MODULES)).toEqual(["store"]);
    expect(ownersOf("electron/app/main.ts", MODULES)).toEqual(["app"]);
  });

  it("attributes nothing for a file no capability owns, rather than guessing", () => {
    expect(ownersOf("electron/unclaimed/file.ts", MODULES)).toEqual([]);
  });

  it("normalises separators and a leading ./ so a Windows-shaped path still matches", () => {
    expect(ownersOf(".\\electron\\store.ts", MODULES)).toEqual(["store"]);
    expect(ownersOf("./electron/store.ts", MODULES)).toEqual(["store"]);
  });

  it("does not match a sibling directory that shares a prefix", () => {
    // `electron/state-core-old/x.ts` must not be attributed to `electron/state-core`.
    expect(ownersOf("electron/state-core-old/x.ts", MODULES)).toEqual([]);
  });
});

describe("Phase 05 Task A — the escalation rules", () => {
  const base = {
    catalogue: [
      suite("tests/unit/store.test.ts", "unit", ["store"]),
      suite("tests/unit/app.test.ts", "unit", ["app"]),
      suite("tests/unit/tools.test.ts", "unit", ["tools"]),
      suite("tests/acceptance/store-acceptance.test.ts", "acceptance", ["store"]),
      suite("tests/acceptance/app-acceptance.test.ts", "acceptance", ["app"]),
      suite("tests/unit/other.test.ts", "unit", ["other"])
    ],
    modulesByCapability: MODULES,
    impactRadius: (capabilityId: string) => radiusOf([["app", "store"], ["tools", "store"]], capabilityId),
    criticalCapabilities: new Set<string>()
  };

  it("selects a directly changed capability's suites and skips unrelated ones", () => {
    const selection = selectTests({ ...base, changedFiles: ["electron/store.ts"] });
    const chosen = selection.selected.map((entry) => entry.file);
    expect(chosen).toContain("tests/unit/store.test.ts");
    // `app` and `tools` depend on `store`, so they are in the blast radius; `other` is not.
    expect(chosen).toContain("tests/unit/app.test.ts");
    expect(chosen).toContain("tests/unit/tools.test.ts");
    expect(chosen).not.toContain("tests/unit/other.test.ts");
    expect(selection.skipped.map((entry) => entry.file)).toContain("tests/unit/other.test.ts");
  });

  it("names the reason and the file for every selection, and a reason for every skip", () => {
    const selection = selectTests({ ...base, changedFiles: ["electron/store.ts"] });
    for (const entry of selection.selected) {
      expect(entry.reason, `${entry.file} was selected without a reason`).toBeTruthy();
      expect(entry.because.length, `${entry.file} was selected without a capability`).toBeGreaterThan(0);
    }
    for (const entry of selection.skipped) {
      expect(entry.reason, `${entry.file} was skipped without a reason`).toBeTruthy();
    }
    // The reason for a directly changed suite is traceable to the file that caused it.
    const direct = selection.selected.find((entry) => entry.file === "tests/unit/store.test.ts");
    expect(direct?.reachedThrough).toBe("direct");
    expect(direct?.viaFiles).toContain("electron/store.ts");
  });

  it("runs acceptance for a DIRECT change and skips it for a capability reached only through the radius", () => {
    // This is the cost rule: reaching `app` because `store` moved runs its cheap suites, not its
    // acceptance scenario.
    const indirect = selectTests({ ...base, changedFiles: ["electron/store.ts"] });
    const acceptance = indirect.selected.filter((entry) => entry.tier === "acceptance").map((entry) => entry.file);
    expect(acceptance).toEqual(["tests/acceptance/store-acceptance.test.ts"]);
    const skippedAcceptance = indirect.skipped.find((entry) => entry.file === "tests/acceptance/app-acceptance.test.ts");
    expect(skippedAcceptance?.reason).toContain("impact radius");

    // But a change made directly to `app` DOES earn it.
    const direct = selectTests({ ...base, changedFiles: ["electron/app/main.ts"] });
    expect(direct.selected.map((entry) => entry.file)).toContain("tests/acceptance/app-acceptance.test.ts");
  });

  it("earns the acceptance tier for a critical capability even through the radius", () => {
    const selection = selectTests({
      ...base,
      changedFiles: ["electron/store.ts"],
      criticalCapabilities: new Set(["app"])
    });
    expect(selection.selected.map((entry) => entry.file)).toContain("tests/acceptance/app-acceptance.test.ts");
  });

  it("always runs an always-run suite, whatever changed", () => {
    const selection = selectTests({
      ...base,
      catalogue: [...base.catalogue, suite("tests/unit/platform.test.ts", "unit", ["nothing"], { alwaysRun: true })],
      changedFiles: ["electron/other/x.ts"]
    });
    expect(selection.selected.map((entry) => entry.file)).toContain("tests/unit/platform.test.ts");
  });
});

describe("Phase 05 Task A — it fails closed whenever it cannot justify a subset", () => {
  const catalogue = [suite("tests/unit/store.test.ts", "unit", ["store"])];
  const common = {
    catalogue,
    modulesByCapability: MODULES,
    impactRadius: (capabilityId: string) => radiusOf([["app", "store"]], capabilityId),
    criticalCapabilities: new Set<string>()
  };

  it("requires the full suite for every trigger the book names", () => {
    for (const trigger of ["merge-gate", "scheduled", "promotion"] as const) {
      const selection = selectTests({ ...common, changedFiles: ["electron/store.ts"], trigger });
      expect(selection.fullRunRequired, `${trigger} must require the full suite`).toBe(true);
      expect(selection.fullRunReasons.join(" ")).toContain(trigger);
    }
    // And a targeted run without a trigger does not pretend to be one.
    expect(selectTests({ ...common, changedFiles: ["electron/store.ts"] }).fullRunRequired).toBe(false);
  });

  it("requires the full suite when the changed set could not be computed", () => {
    const selection = selectTests({ ...common, changedFiles: [], changedSetUnknown: true });
    expect(selection.fullRunRequired).toBe(true);
    expect(selection.fullRunReasons.join(" ")).toContain("could not be computed");
    expect(selection.selected.map((entry) => entry.file)).not.toContain("tests/unit/store.test.ts");
  });

  it("requires the full suite when no changed file could be attributed to a capability", () => {
    const selection = selectTests({ ...common, changedFiles: ["electron/unclaimed/file.ts"] });
    expect(selection.fullRunRequired).toBe(true);
    expect(selection.unattributedFiles).toEqual(["electron/unclaimed/file.ts"]);
  });

  it("flags a blind selection rather than reporting an empty pass", () => {
    // Nothing in the catalogue covers what was attributed: choosing nothing is a red flag, not a
    // quiet success. The capability is affected, every suite is for something else, and the selector
    // has to say so rather than return an empty list that reads as "nothing needed running".
    const selection = selectTests({
      ...common,
      catalogue: [suite("tests/unit/other-only.test.ts", "unit", ["other"])],
      changedFiles: ["electron/store.ts"]
    });
    expect(selection.selected).toEqual([]);
    expect(selection.blind).toBe(true);
    expect(selection.shouldRecord).toBe(true);
    expect(summarizeSelection(selection)).toContain("FULL RUN REQUIRED");
  });
});

describe("Phase 05 Task A — the selection audit detects what the selector missed", () => {
  const catalogue = [
    suite("tests/unit/store.test.ts", "unit", ["store"]),
    suite("tests/unit/app.test.ts", "unit", ["app"])
  ];
  const selectionFor = (changedFiles: string[], files = catalogue.map((entry) => entry.file)) =>
    selectTests({
      changedFiles,
      catalogue,
      modulesByCapability: MODULES,
      impactRadius: (capabilityId: string) => radiusOf([["app", "store"]], capabilityId),
      criticalCapabilities: new Set<string>()
    });

  it("agrees when the selector chose exactly what the full run contains", () => {
    const audit = auditSelectionAgainstFullRun(selectionFor(["electron/store.ts"]), ["tests/unit/store.test.ts", "tests/unit/app.test.ts"], catalogue);
    expect(audit.agrees).toBe(true);
    expect(audit.missedSuites).toEqual([]);
  });

  it("META-TEST: reports the suites the selector dropped, which is the whole point of the audit", () => {
    // The selector is given a catalogue that has LOST the suites guarding `store`, which is exactly
    // how a real omission would look: the capability is affected, nothing covers it, and the
    // selector is perfectly happy. The audit has to be the thing that notices.
    const crippled = [suite("tests/unit/app.test.ts", "unit", ["app"])];
    const selection = selectTests({
      changedFiles: ["electron/store.ts"],
      catalogue: crippled,
      modulesByCapability: MODULES,
      impactRadius: (capabilityId: string) => radiusOf([["app", "store"]], capabilityId),
      criticalCapabilities: new Set<string>()
    });
    const audit = auditSelectionAgainstFullRun(selection, ["tests/unit/store.test.ts", "tests/unit/app.test.ts"], catalogue);
    expect(audit.missedSuites).toContain("tests/unit/store.test.ts");
    expect(audit.agrees).toBe(false);
  });

  it("reports a selected suite that the full run does not contain", () => {
    // A catalogue naming a file that never runs would "pass" by pointing at nothing.
    const selection = selectionFor(["electron/store.ts"]);
    const audit = auditSelectionAgainstFullRun(selection, ["tests/unit/app.test.ts"], catalogue);
    expect(audit.phantomSelections).toContain("tests/unit/store.test.ts");
    expect(audit.agrees).toBe(false);
  });

  it("reports catalogue files that the full run never contains, so 'full' can be checked", () => {
    const selection = selectionFor(["electron/store.ts"]);
    const audit = auditSelectionAgainstFullRun(selection, ["tests/unit/store.test.ts"], catalogue);
    expect(audit.absentFromFullRun).toEqual(["tests/unit/app.test.ts"]);
  });
});

describe("Phase 05 Task B — the catalogue describes the real tree", () => {
  it("accounts for every test file, so none is invisible to the selector", () => {
    const present = discoverTestFiles(PROJECT);
    expect(present.length).toBeGreaterThan(150);
    const repository = loadImpactRepository(PROJECT, present);
    const catalogued = new Set(repository.catalogue.map((entry) => entry.file));
    const missing = present.filter((file) => !catalogued.has(file));
    expect(missing, "these test files are in no catalogue entry, so a change to what they guard cannot select them").toEqual([]);
  });

  it("names a capability for every suite, so no entry is dead weight", () => {
    const repository = loadImpactRepository(PROJECT);
    for (const entry of repository.catalogue) {
      expect(entry.covers.length, `${entry.file} covers no capability`).toBeGreaterThan(0);
      for (const capabilityId of entry.covers) {
        expect(repository.modulesByCapability.has(capabilityId), `${entry.file} names unknown capability ${capabilityId}`).toBe(true);
      }
      expect(TEST_TIERS).toContain(entry.tier);
    }
  });

  it("reports each obligation that two suites both claim instead of pretending it is unique", () => {
    const repository = loadImpactRepository(PROJECT);
    // The book asks to REDUCE duplicated maintenance, not to mechanically deduplicate, so the
    // deliverable is the report. It is asserted as a report rather than as an empty list: this
    // fails only if the structure stops being computable.
    const duplicates = duplicateObligations(repository.catalogue);
    expect(Array.isArray(duplicates)).toBe(true);
    for (const group of duplicates) expect(group.length).toBeGreaterThan(1);
  });

  it("owns every source file under electron/ and src/shared, or exempts it with a reason", () => {
    const repository = loadImpactRepository(PROJECT);
    const unowned = unattributedSourceFiles(PROJECT, repository.modulesByCapability);
    // An unowned file selects nothing, so its count is the size of the selector's blind spot. It is
    // zero today and this assertion is what keeps it from growing back.
    expect(unowned, "these source files are owned by no capability, so a change to them forces a full run").toEqual([]);
  });

  it("refuses to run when the catalogue names a test file that does not exist", async () => {
    // A stale catalogue is a selector pointing at nothing, which reads as a pass.
    const tmp = fs.mkdtempSync(path.join(PROJECT, "artifacts", "phase05-catalogue-"));
    try {
      const original = path.join(PROJECT, "config", "test-catalogue.json");
      const parsed = JSON.parse(fs.readFileSync(original, "utf8"));
      parsed.suites.push({ file: "tests/unit/does-not-exist.test.ts", tier: "unit", covers: ["store"] });
      const configDir = path.join(tmp, "config");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "test-catalogue.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      // Loaded through the real function against a repository rooted where the broken catalogue is.
      const { loadTestCatalogue } = await import("../../../electron/platform/test-impact");
      expect(() => loadTestCatalogue(tmp, discoverTestFiles(PROJECT))).toThrow(/does not exist/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("Phase 05 Task B — the real registry drives the selector", () => {
  it("selects the state-core suites for a state-core change and nothing unrelated", () => {
    const repository = loadImpactRepository(PROJECT);
    const selection = selectTests({
      changedFiles: ["electron/state-core/database.ts"],
      catalogue: repository.catalogue,
      modulesByCapability: repository.modulesByCapability,
      impactRadius: (capabilityId) => impactRadius(repository.graph, capabilityId),
      criticalCapabilities: repository.criticalCapabilities
    });
    const chosen = selection.selected.map((entry) => entry.file);
    expect(chosen).toContain("tests/unit/state-core/state-core.test.ts");
    expect(selection.seeds).toEqual(["state-core"]);
    expect(selection.affected).toEqual(["state-core"]);
    // The platform suites are always-run, so they appear for every change.
    expect(chosen).toContain("tests/unit/platform/dependency-graph.test.ts");
    // A suite for an unrelated capability is not selected.
    expect(chosen).not.toContain("tests/unit/theme-capability.test.ts");
    expect(selection.fullRunRequired).toBe(false);
  });

  it("produces the same selection twice, so a recorded decision can be re-derived", () => {
    const repository = loadImpactRepository(PROJECT);
    const options = {
      catalogue: repository.catalogue,
      modulesByCapability: repository.modulesByCapability,
      impactRadius: (capabilityId: string) => impactRadius(repository.graph, capabilityId),
      criticalCapabilities: repository.criticalCapabilities
    };
    const first = selectTests({ ...options, changedFiles: ["electron/state-core/database.ts"] });
    const second = selectTests({ ...options, changedFiles: ["electron/state-core/database.ts"] });
    expect(second.selected).toEqual(first.selected);
    expect(second.skipped).toEqual(first.skipped);
    expect(second.decisionReason).toBe(first.decisionReason);
  });

  it("reads the same manifests the architecture ratchet reads", () => {
    // The selector must not carry its own copy of the capability set: it consumes the registry.
    const repository = loadImpactRepository(PROJECT);
    const manifests = loadCapabilityManifests(path.join(PROJECT, "config", "capabilities"), PROJECT);
    expect(repository.manifests.map((entry) => entry.id)).toEqual(manifests.map((entry) => entry.id));
    expect(repository.criticalCapabilities.size).toBeGreaterThan(0);
    for (const capabilityId of repository.criticalCapabilities) {
      expect(manifests.find((entry) => entry.id === capabilityId)?.health.critical).toBe(true);
    }
  });
});

/**
 * P2-A increment 2 — the composition root's blast radius, measured rather than inferred.
 *
 * The dangerous half of giving the composition root its own class: if the selector stops reading it as a
 * capability and nothing replaces that reading, `electron/main.ts` becomes an UNATTRIBUTED change. The
 * selector still fails closed -- an unattributed change reaches the full run -- but it would do so while
 * reporting that the repository owns a file it does not, and a file the map names would be indistinguishable
 * from a hole in the map. These cases pin the difference between "we know who owns this and its radius is the
 * whole application" and "we cannot tell who owns this", because only the second is a defect.
 */
describe("P2-A increment 2 — the composition root is a named owner with an unbounded radius", () => {
  it("owns the composition-root files instead of leaving them unattributed", () => {
    const repository = loadImpactRepository(PROJECT);
    expect(repository.modulesByCapability.get(COMPOSITION_ROOT_OWNER_ID), "the composition root owns nothing, so the wiring is unattributed").toEqual(["electron/main.ts", "electron/preload.ts"]);
    expect(ownersOf("electron/main.ts", repository.modulesByCapability)).toEqual([COMPOSITION_ROOT_OWNER_ID]);
    expect(repository.unboundedCapabilities.has(COMPOSITION_ROOT_OWNER_ID), "the composition root is not declared unbounded, so a change to the wiring would be treated as bounded").toBe(true);
    // ...and it is NOT a capability: no manifest declares it, so the catalogue can never claim a suite covers it.
    expect(repository.manifests.some((manifest) => manifest.id === COMPOSITION_ROOT_OWNER_ID)).toBe(false);
    expect(repository.criticalCapabilities.has(COMPOSITION_ROOT_OWNER_ID)).toBe(false);
  });

  it("requires the FULL suite for a change to the composition root, and names a true reason", () => {
    const repository = loadImpactRepository(PROJECT);
    const selection = selectForChange(repository, ["electron/main.ts"]);
    expect(selection.seeds).toEqual([COMPOSITION_ROOT_OWNER_ID]);
    expect(selection.fullRunRequired, "a change to the wiring selected a subset of the suite").toBe(true);
    // The distinction that matters: attributed, not a hole. An unattributed file would also force a full
    // run, and would report the repository as owning a file that it does.
    expect(selection.unattributedFiles, "the composition root is owned by nothing, so the map has a hole").toEqual([]);
    expect(selection.blind).toBe(false);
    expect(selection.fullRunReasons.join(" "), "the full run does not say why").toContain(COMPOSITION_ROOT_OWNER_ID);
    // The catalogue is the whole suite, so "full run" is comparable with what a full run would do.
    expect(selection.selected.length + selection.skipped.length).toBe(repository.catalogue.length);
    expect(selection.shouldRecord).toBe(true);
  });

  it("holds for preload.ts too, so the class is not a single-file special case", () => {
    const repository = loadImpactRepository(PROJECT);
    const selection = selectForChange(repository, ["electron/preload.ts"]);
    expect(selection.seeds).toEqual([COMPOSITION_ROOT_OWNER_ID]);
    expect(selection.fullRunRequired).toBe(true);
    expect(selection.unattributedFiles).toEqual([]);
  });

  it("does not widen a bounded capability's change, so the class cannot become a full-run switch", () => {
    const repository = loadImpactRepository(PROJECT);
    const selection = selectForChange(repository, ["electron/state-core/database.ts"]);
    expect(selection.fullRunRequired, `a state-core change now requires a full run: ${selection.fullRunReasons.join("; ")}`).toBe(false);
    expect(selection.unattributedFiles).toEqual([]);
  });

  it("separates an unbounded seed from an unattributed change, on a constructed map", () => {
    // `always.test.ts` is always-run, so a selection is never EMPTY here. That matters: with an empty
    // selection the selector reaches the full run through `blind` instead, and this case would pass whatever
    // the unbounded rule did. The always-run suite keeps `blind` false, so the unbounded declaration is the
    // only thing that can force the full run -- which is the property being pinned.
    const options = {
      catalogue: [suite("tests/unit/store.test.ts", "unit", ["store"]), suite("tests/unit/always.test.ts", "unit", ["store"], { alwaysRun: true })],
      modulesByCapability: new Map<string, string[]>([["store", ["electron/store.ts"]], ["root", ["electron/main.ts"]]]),
      impactRadius: () => [],
      criticalCapabilities: new Set<string>()
    };
    expect(selectTests({ ...options, changedFiles: ["electron/store.ts"] }).fullRunRequired).toBe(false);
    // Declared unbounded: a full run, reached through the unbounded rule and not through `blind`.
    const unbounded = selectTests({ ...options, changedFiles: ["electron/main.ts"], unboundedCapabilities: new Set(["root"]) });
    expect(unbounded.seeds).toEqual(["root"]);
    expect(unbounded.blind, "the selection was empty, so this case cannot tell the unbounded rule from the blind rule").toBe(false);
    expect(unbounded.fullRunRequired, "an unbounded seed selected a subset").toBe(true);
    expect(unbounded.fullRunReasons.join(" ")).toContain("root");
    expect(unbounded.unattributedFiles).toEqual([]);
    // Declared bounded -- the same change, the same map, minus the declaration: no full run. This is the
    // narrowing the class exists to make explicit, asserted in the direction that catches its absence.
    const bounded = selectTests({ ...options, changedFiles: ["electron/main.ts"] });
    expect(bounded.seeds).toEqual(["root"]);
    expect(bounded.fullRunRequired, "the unbounded declaration makes no difference, so it is not read at all").toBe(false);
    // The same shape of change with NOBODY claiming the file: still a full run, but for the OTHER reason.
    const unowned = selectTests({ ...options, changedFiles: ["electron/unknown.ts"] });
    expect(unowned.fullRunRequired).toBe(true);
    expect(unowned.unattributedFiles).toEqual(["electron/unknown.ts"]);
    // A seeded but bounded capability is not affected by declaring an unrelated one unbounded.
    const unrelated = selectTests({ ...options, changedFiles: ["electron/store.ts"], unboundedCapabilities: new Set(["root"]) });
    expect(unrelated.fullRunRequired).toBe(false);
  });
});
