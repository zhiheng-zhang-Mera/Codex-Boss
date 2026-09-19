import { describe, expect, it } from "vitest";
import { buildSelfModel, type SelfAuthorityFact, type SelfFacts } from "../../../src/shared/self-cognition/anatomy";
import { SELF_MODEL_VERSION, selfModelDrift, selfModelHash, type SelfModelDriftReport } from "../../../src/shared/self-cognition/drift";
import { describeSelf } from "../../../src/shared/self-cognition/describe";

/**
 * The model's identity, and the drift between two bodies.
 *
 * A hash is only worth storing if it moves when the anatomy moves and stays still when it does not.
 * Both directions are pinned here, and the drift report is checked to be a statement about the body
 * rather than about any case.
 */

function facts(overrides: Partial<SelfFacts> = {}): SelfFacts {
  return {
    capturedAt: "2026-09-20T00:00:00.000Z",
    repositoryRoot: "C:/repo",
    capabilities: [
      { id: "alpha", kind: "feature", provides: ["alpha.thing@1"], requires: [], optional: [], state: [{ namespace: "alpha-store", owner: "alpha" }], modules: [], bootModules: [], surface: [], critical: false },
      { id: "beta", kind: "feature", provides: ["beta.thing@1"], requires: [{ ref: "alpha.thing@1" }], optional: [], state: [], modules: [], bootModules: [], surface: [], critical: true }
    ],
    ownership: { capabilities: { alpha: ["src/shared/alpha.ts"], beta: ["src/shared/beta.ts"] }, exempt: {} },
    bootWiring: [{ file: "electron/boot/alpha.ts", factory: "createAlphaModule", wired: true }],
    scripts: [{ name: "test", command: "vitest run" }],
    authority: [
      { path: "src/shared/alpha.ts", surface: "PRODUCT_SURFACE", ownerReview: "ALLOW", detail: "PRODUCT_SURFACE" },
      { path: "src/shared/beta.ts", surface: "PRODUCT_SURFACE", ownerReview: "ALLOW", detail: "PRODUCT_SURFACE" },
      { path: "electron/boot/alpha.ts", surface: "PRODUCT_SURFACE", ownerReview: "ALLOW", detail: "PRODUCT_SURFACE" }
    ],
    unreadable: [],
    ...overrides
  };
}

function authority(path: string, surface: SelfAuthorityFact["surface"], ownerReview: SelfAuthorityFact["ownerReview"] = "ALLOW"): SelfAuthorityFact {
  return { path, surface, ownerReview, detail: surface };
}

describe("the model hash identifies a body, not a moment", () => {
  it("is stable across two observations of the same anatomy", () => {
    const first = buildSelfModel(facts());
    const later = buildSelfModel(facts({ capturedAt: "2027-01-01T00:00:00.000Z", repositoryRoot: "D:/elsewhere" }));
    // The moment and the checkout path are not part of the body.
    expect(selfModelHash(later)).toBe(selfModelHash(first));
    expect(selfModelDrift(first, later, "2027-01-01T00:00:00.000Z").identical).toBe(true);
    expect(SELF_MODEL_VERSION).toBe("self-model-v1");
  });

  it("moves when a component, a dependency or an authority verdict moves", () => {
    const base = buildSelfModel(facts());
    const added = buildSelfModel(facts({ capabilities: [...facts().capabilities, { id: "gamma", kind: "feature", provides: ["gamma.thing@1"], requires: [], optional: [], state: [], modules: [], bootModules: [], surface: [], critical: false }] }));
    expect(selfModelHash(added)).not.toBe(selfModelHash(base));
    const rewired = buildSelfModel(facts({ capabilities: facts().capabilities.map((capability) => (capability.id === "beta" ? { ...capability, requires: [] } : capability)) }));
    expect(selfModelHash(rewired)).not.toBe(selfModelHash(base));
    const boundary = buildSelfModel(facts({ authority: [authority("src/shared/alpha.ts", "ROOT_TRUST_SURFACE", "REQUIRE_OWNER"), authority("src/shared/beta.ts", "PRODUCT_SURFACE"), authority("electron/boot/alpha.ts", "PRODUCT_SURFACE")] }));
    expect(selfModelHash(boundary)).not.toBe(selfModelHash(base));
    // A different set of unreadable facts is a different body: a blind spot is part of the anatomy.
    const blind = buildSelfModel(facts({ unreadable: [{ path: "config/capabilities/broken.yaml", reason: "not valid YAML" }] }));
    expect(selfModelHash(blind)).not.toBe(selfModelHash(base));
  });

  it("is carried on the self description a caller stores", () => {
    const model = buildSelfModel(facts());
    const description = describeSelf(model);
    expect(description.selfModelVersion).toBe(SELF_MODEL_VERSION);
    expect(description.selfModelHash).toBe(selfModelHash(model));
    expect(description.selfModelHash).toHaveLength(64);
  });
});

describe("the drift report says what changed", () => {
  it("names added and removed components, and the edges that moved", () => {
    const before = buildSelfModel(facts());
    const afterFacts: SelfFacts = {
      ...facts(),
      capabilities: [
        facts().capabilities[0],
        { ...facts().capabilities[1], requires: [], critical: false },
        { id: "gamma", kind: "feature", provides: ["gamma.thing@1"], requires: [{ ref: "alpha.thing@1" }], optional: [], state: [], modules: [], bootModules: [], surface: [], critical: false }
      ],
      ownership: { capabilities: { alpha: ["src/shared/alpha.ts"], gamma: ["src/shared/gamma.ts"] }, exempt: {} },
      authority: [authority("src/shared/alpha.ts", "PRODUCT_SURFACE"), authority("src/shared/gamma.ts", "PRODUCT_SURFACE"), authority("electron/boot/alpha.ts", "PRODUCT_SURFACE")]
    };
    const report: SelfModelDriftReport = selfModelDrift(before, buildSelfModel(afterFacts), "2026-10-01T00:00:00.000Z");
    expect(report.kind).toBe("SELF_MODEL_DRIFT_REPORT");
    expect(report.identical).toBe(false);
    expect(report.previousHash).toBe(selfModelHash(before));
    expect(report.components.added).toContain("gamma");
    expect(report.components.added).toContain("module:src/shared/gamma.ts");
    expect(report.components.removed).toContain("module:src/shared/beta.ts");
    expect(report.components.dependenciesChanged).toContainEqual({ id: "beta", added: [], removed: ["alpha"] });
    expect(report.capabilities.added).toEqual(["gamma"]);
    expect(report.capabilities.removed).toEqual([]);
    expect(report.notes.join(" ")).toContain("the anatomy moved");
    expect(report.notes.join(" ")).toContain("does not modify a case record");
  });

  it("reports an authority change and a health signal change on the component that moved", () => {
    const before = buildSelfModel(facts());
    const after = buildSelfModel(facts({
      capabilities: facts().capabilities.map((capability) => (capability.id === "beta" ? { ...capability, critical: false } : capability)),
      authority: [authority("src/shared/alpha.ts", "ROOT_TRUST_SURFACE", "REQUIRE_OWNER"), authority("src/shared/beta.ts", "PRODUCT_SURFACE"), authority("electron/boot/alpha.ts", "PRODUCT_SURFACE")]
    }));
    const report = selfModelDrift(before, after, "2026-10-01T00:00:00.000Z");
    expect(report.components.authorityChanged).toContainEqual({ id: "alpha", before: "PRODUCT_SURFACE", after: "ROOT_TRUST_SURFACE" });
    expect(report.components.ownerReviewChanged).toContainEqual({ id: "alpha", before: "ALLOW", after: "REQUIRE_OWNER" });
    expect(report.capabilities.authorityChanged).toContainEqual({ id: "alpha", before: "PRODUCT_SURFACE", after: "ROOT_TRUST_SURFACE" });
    expect(report.components.healthSignalsChanged).toContainEqual({ id: "beta", added: [], removed: ["beta.critical"] });
  });

  it("reports a data flow whose readers changed, and a fact source that appeared", () => {
    const before = buildSelfModel(facts());
    const after = buildSelfModel(facts({
      capabilities: facts().capabilities.map((capability) => (capability.id === "beta" ? { ...capability, requires: [] } : capability)),
      unreadable: [{ path: "config/capabilities/gone.yaml", reason: "the file disappeared between two runs" }]
    }));
    const report = selfModelDrift(before, after, "2026-10-01T00:00:00.000Z");
    expect(report.dataFlows.readersChanged).toContainEqual({ namespace: "alpha-store", added: [], removed: ["beta"] });
    expect(report.dataFlows.added).toEqual([]);
    expect(report.unreadableChanged.added).toEqual(["config/capabilities/gone.yaml"]);
    expect(report.unreadableChanged.removed).toEqual([]);
  });

  it("says plainly when nothing moved", () => {
    const model = buildSelfModel(facts());
    const report = selfModelDrift(model, buildSelfModel(facts()), "2026-10-01T00:00:00.000Z");
    expect(report.identical).toBe(true);
    expect(report.components).toEqual({ added: [], removed: [], dependenciesChanged: [], authorityChanged: [], ownerReviewChanged: [], healthSignalsChanged: [], sourcePathsChanged: [] });
    expect(report.notes.join(" ")).toContain("the anatomy is unchanged");
  });
});
