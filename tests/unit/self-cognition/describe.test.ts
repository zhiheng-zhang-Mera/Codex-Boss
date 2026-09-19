import { describe, expect, it } from "vitest";
import { buildSelfModel, type SelfAuthorityFact, type SelfFacts } from "../../../src/shared/self-cognition/anatomy";
import {
  affectedBy,
  authorityOf,
  dependencyPath,
  describeCapability,
  describeComponent,
  describeSelf,
  type AffectedSet,
  type DependencyPath,
  type SelfDescription
} from "../../../src/shared/self-cognition/describe";
import type { AuthorityClass, BossComponentDescriptor, OwnerReviewDecision } from "../../../src/shared/self-cognition/contracts";

/**
 * The six questions, and the refusals.
 *
 * A question the model cannot answer is answered with a reason rather than with an empty result,
 * because "no dependency path exists" and "I did not look" must not read the same.
 */

function authority(entries: Array<[string, AuthorityClass, OwnerReviewDecision?]>): SelfAuthorityFact[] {
  return entries.map(([path, surface, ownerReview]) => ({ path, surface, ownerReview: ownerReview ?? "ALLOW", detail: surface }));
}

const FACTS: SelfFacts = {
  capturedAt: "2026-09-20T00:00:00.000Z",
  repositoryRoot: "C:/repo",
  capabilities: [
    { id: "alpha", kind: "feature", provides: ["alpha.thing@1"], requires: [], optional: [], state: [{ namespace: "alpha-store", owner: "alpha" }], modules: [], bootModules: [], surface: [], critical: true },
    { id: "beta", kind: "feature", provides: ["beta.thing@1"], requires: [{ ref: "alpha.thing@1" }], optional: [], state: [], modules: [], bootModules: [], surface: [], critical: false },
    { id: "delta", kind: "feature", provides: ["delta.thing@1"], requires: [{ ref: "beta.thing@1" }], optional: [], state: [], modules: [], bootModules: [], surface: [], critical: false }
  ],
  ownership: { capabilities: { alpha: ["src/shared/alpha.ts"], beta: ["src/shared/beta.ts"], delta: ["src/shared/delta.ts"] }, exempt: {} },
  bootWiring: [],
  scripts: [{ name: "test", command: "vitest run" }],
  authority: authority([
    ["src/shared/alpha.ts", "PRODUCT_SURFACE"],
    ["src/shared/beta.ts", "VERIFICATION_SURFACE"],
    ["src/shared/delta.ts", "PRODUCT_SURFACE", "REQUIRE_OWNER"]
  ]),
  architectureBaseline: { metrics: { capabilityCount: 3 }, updatedAt: "2026-09-16T02:25:17.163Z", reason: "a recorded bump" },
  unreadable: []
};

const MODEL = buildSelfModel(FACTS);

describe("describeSelf answers with counts it computed", () => {
  it("counts components by kind and names the capabilities it cannot vouch for", () => {
    const description: SelfDescription = describeSelf(MODEL);
    expect(description.kind).toBe("BOSS_SELF_DESCRIPTION");
    expect(description.componentCount).toBe(MODEL.components.length);
    expect(description.capabilities).toBe(3);
    expect(description.componentKinds.CAPABILITY).toBe(3);
    expect(description.componentKinds.SCRIPT).toBe(1);
    expect(description.dataFlows).toBe(1);
    expect(description.canDescribeSelf).toBe(true);
    expect(description.canDiagnose).toBe(false);
    expect(description.canMutateSelf).toBe(false);
    expect(description.architectureBaseline).toContain("capabilityCount");
    // Authority is reported as the classifier answered, component by component.
    expect(description.authority.rootTrustComponents).toEqual([]);
    expect(description.authority.verificationComponents).toEqual(["beta"]);
    expect(description.authority.ownerReviewRequired).toEqual(["delta"]);
  });

  it("names a capability whose availability is not established rather than counting it as fine", () => {
    const unresolved = buildSelfModel({ ...FACTS, capabilities: [{ ...FACTS.capabilities[0], requires: [{ ref: "nowhere.thing@1" }] }] });
    expect(describeSelf(unresolved).capabilitiesUnavailable).toEqual(["alpha"]);
  });
});

describe("a question the model cannot answer says so", () => {
  it("refuses an unknown component and names what the model does hold", () => {
    const answer = describeComponent(MODEL, "not-a-component");
    expect(answer.status).toBe("UNKNOWN");
    expect(answer.status === "UNKNOWN" ? answer.reason : "").toContain("is not a component in this model");
    expect(answer.status === "UNKNOWN" ? answer.reason : "").toContain("alpha");
    expect(answer.value).toBeUndefined();
  });

  it("answers with the descriptor when the component exists, by id or by name", () => {
    const byId = describeComponent(MODEL, "alpha");
    expect(byId.status).toBe("AVAILABLE");
    const descriptor: BossComponentDescriptor | undefined = byId.value;
    expect(descriptor?.id).toBe("alpha");
    expect(describeComponent(MODEL, "alpha").value?.id).toBe("alpha");
    expect(describeCapability(MODEL, "beta").value?.capabilityId).toBe("beta");
    expect(describeCapability(MODEL, "gamma").status).toBe("UNKNOWN");
    expect(describeCapability(MODEL, "gamma").reason).toContain("alpha, beta, delta");
  });
});

describe("dependency paths are searched, and the search is reported", () => {
  it("finds the shortest declared path", () => {
    const found: DependencyPath = dependencyPath(MODEL, "delta", "alpha");
    expect(found.found).toBe(true);
    expect(found.path).toEqual(["delta", "beta", "alpha"]);
    expect(found.hops).toBe(2);
    expect(dependencyPath(MODEL, "alpha", "alpha").found).toBe(true);
    expect(dependencyPath(MODEL, "alpha", "alpha").hops).toBe(0);
    // The contract refs are still inputs, so a requirement that resolves to no component is
    // visible as an input rather than lost.
    expect(MODEL.components.find((component) => component.id === "beta")?.inputs).toEqual(["alpha.thing@1"]);
  });

  it("reports how much it searched when there is no path", () => {
    const missing = dependencyPath(MODEL, "alpha", "delta");
    expect(missing.found).toBe(false);
    expect(missing.path).toEqual([]);
    expect(missing.reason).toContain("no declared dependency path from alpha to delta");
    expect(missing.reason).toContain("component(s) were searched");
  });
});

describe("what a component's failure touches is a description, not a diagnosis", () => {
  it("collects the transitive dependents as the blast radius", () => {
    const answer = affectedBy(MODEL, "alpha");
    expect(answer.status).toBe("AVAILABLE");
    const affected: AffectedSet | undefined = answer.value;
    // Transitive on purpose: delta depends on beta, and beta on alpha, so a failure in alpha
    // reaches delta through beta.
    expect(affected?.dependents).toEqual(["beta", "delta"]);
    expect(affected?.blastRadius).toEqual(["alpha", "beta", "delta"]);
    expect(affected?.ownedState).toEqual(["alpha-store"]);
    expect(affected?.reason).toContain("2 component(s) declare a dependency on alpha");
  });

  it("refuses to guess the blast radius of a component it does not hold", () => {
    expect(affectedBy(MODEL, "ghost").status).toBe("UNKNOWN");
    expect(affectedBy(MODEL, "ghost").reason).toContain("nothing can be said about what depends on it");
  });
});

describe("authority is reported from the classifier, never granted", () => {
  it("reports the tier and the owner-review verdict with the paths behind them", () => {
    const answer = authorityOf(MODEL, "beta");
    expect(answer.status).toBe("AVAILABLE");
    expect(answer.value).toEqual({ authority: "VERIFICATION_SURFACE", ownerReview: "ALLOW", paths: ["src/shared/beta.ts"] });
    expect(authorityOf(MODEL, "delta").value?.ownerReview).toBe("REQUIRE_OWNER");
    // Nothing in this answer is a permission: the shape has no grant, and there is no function
    // that turns a verdict into one.
    expect(Object.keys(answer.value ?? {})).toEqual(["authority", "ownerReview", "paths"]);
  });

  it("says UNKNOWN for a component with no classified paths, and for a script in particular", () => {
    const script = authorityOf(MODEL, "script:test");
    expect(script.status).toBe("UNKNOWN");
    expect(script.status === "UNKNOWN" ? script.reason : "").toContain("is a package script");
    const orphan = buildSelfModel({ ...FACTS, ownership: { capabilities: { alpha: ["src/shared/unlisted.ts"] }, exempt: {} }, authority: [] });
    expect(authorityOf(orphan, "alpha").status).toBe("UNKNOWN");
    expect(authorityOf(orphan, "alpha").reason).toContain("unknown rather than assumed to be product surface");
    expect(authorityOf(MODEL, "ghost").status).toBe("UNKNOWN");
  });
});
