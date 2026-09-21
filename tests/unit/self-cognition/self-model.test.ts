import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_STATUSES,
  AUTHORITY_CLASSES,
  COMPONENT_KINDS,
  OWNER_REVIEW_DECISIONS,
  absent,
  availabilityValue,
  available,
  describeAvailability,
  type Availability,
  type AvailabilityFact,
  type AvailabilityStatus,
  type AuthorityClass,
  type BossCapabilityDescriptor,
  type BossComponentDescriptor,
  type BossDataFlow,
  type BossSelfModel,
  type ComponentKind,
  type OwnerReviewDecision,
  type SelfGraph
} from "../../../src/shared/self-cognition/contracts";
import {
  SELF_MODEL_SCHEMA_VERSION,
  buildSelfModel,
  capabilityGraph,
  componentGraph,
  dataFlowGraph,
  dependencyGraph,
  type SelfAuthorityFact,
  type SelfCapabilityFact,
  type SelfFacts
} from "../../../src/shared/self-cognition/anatomy";

/**
 * The anatomy, on facts that are shaped like the repository's own.
 *
 * The derivations that matter are the two a hand-written document gets wrong: dependents must be
 * the inverse of dependencies, and a component with one Root Trust path must be a Root Trust
 * component however many product paths it also owns.
 */

function capability(overrides: Partial<SelfCapabilityFact> = {}): SelfCapabilityFact {
  return { id: "alpha", kind: "feature", provides: ["alpha.thing@1"], requires: [], optional: [], state: [], modules: [], bootModules: [], surface: [], critical: false, ...overrides };
}

function authority(paths: Array<[string, AuthorityClass, OwnerReviewDecision?]>): SelfAuthorityFact[] {
  return paths.map(([path, surface, ownerReview]) => ({ path, surface, ownerReview: ownerReview ?? "ALLOW", detail: `${surface}` }));
}

function facts(overrides: Partial<SelfFacts> = {}): SelfFacts {
  return {
    capturedAt: "2026-09-20T00:00:00.000Z",
    repositoryRoot: "C:/repo",
    capabilities: [
      capability({ id: "alpha", provides: ["alpha.thing@1"], state: [{ namespace: "alpha-store", owner: "alpha" }] }),
      capability({ id: "beta", provides: ["beta.thing@1"], requires: [{ ref: "alpha.thing@1", reason: "beta reads alpha's output" }] }),
      capability({ id: "gamma", provides: [], optional: [{ ref: "beta.thing@1" }] })
    ],
    ownership: { capabilities: { alpha: ["src/shared/alpha.ts"], beta: ["src/shared/beta.ts"], gamma: ["src/shared/gamma.ts"] }, exempt: {} },
    bootWiring: [{ file: "electron/boot/alpha.ts", factory: "createAlphaModule", wired: true }],
    scripts: [{ name: "test", command: "vitest run" }],
    authority: authority([
      ["src/shared/alpha.ts", "PRODUCT_SURFACE"],
      ["src/shared/beta.ts", "PRODUCT_SURFACE"],
      ["src/shared/gamma.ts", "PRODUCT_SURFACE"],
      ["electron/main.ts", "PRODUCT_SURFACE"]
    ]),
    architectureBaseline: { metrics: { capabilityCount: 3 }, updatedAt: "2026-09-16T02:25:17.163Z", reason: "a recorded bump" },
    unreadable: [],
    ...overrides
  };
}

describe("the model is derived from facts, not transcribed", () => {
  it("makes dependents the inverse of dependencies", () => {
    const model = buildSelfModel(facts());
    const alpha = model.components.find((component) => component.id === "alpha");
    const beta = model.components.find((component) => component.id === "beta");
    expect(alpha?.dependencies).toEqual([]);
    expect(alpha?.dependents).toEqual(["beta"]);
    // A declared requirement is a contract; the dependency is the component that provides it.
    expect(beta?.dependencies).toEqual(["alpha"]);
    expect(beta?.inputs).toEqual(["alpha.thing@1"]);
    expect(model.components.find((component) => component.id === "gamma")?.dependencies).toEqual(["beta"]);
    expect(beta?.dependents).toEqual(["gamma"]);
    expect(alpha?.ownedState).toEqual(["alpha-store"]);
  });

  it("resolves a capability's provider and consumers through the contract graph", () => {
    const model = buildSelfModel(facts());
    const alpha: BossCapabilityDescriptor | undefined = model.capabilities.find((entry) => entry.capabilityId === "alpha");
    expect(alpha?.providerComponents).toEqual({ status: "AVAILABLE", value: ["alpha"], source: "config/capabilities/alpha.yaml provides" });
    expect(alpha?.consumerComponents.status === "AVAILABLE" ? alpha.consumerComponents.value : undefined).toEqual(["beta"]);
    expect(alpha?.available).toEqual(expect.objectContaining({ status: "AVAILABLE", value: true }));
    // A manifest that provides nothing is UNKNOWN, not an empty list: the two are different answers.
    const gamma = model.capabilities.find((entry) => entry.capabilityId === "gamma");
    expect(gamma?.providerComponents.status).toBe("UNKNOWN");
    expect(gamma?.providerComponents.status === "UNKNOWN" ? gamma.providerComponents.reason : "").toContain("declares no provided contract");
  });

  it("reports a required contract with no provider as UNKNOWN availability", () => {
    const unresolved = buildSelfModel(facts({ capabilities: [capability({ id: "alpha", requires: [{ ref: "nowhere.thing@1" }] })] }));
    const alpha = unresolved.capabilities[0];
    expect(alpha.available.status).toBe("UNKNOWN");
    expect(alpha.available.status === "UNKNOWN" ? alpha.available.reason : "").toContain("no manifest provides nowhere.thing@1");
  });

  it("takes the strictest authority verdict over a component's own paths", () => {
    const model = buildSelfModel(facts({
      ownership: { capabilities: { alpha: ["src/shared/alpha.ts", "package.json"] }, exempt: {} },
      authority: authority([
        ["src/shared/alpha.ts", "PRODUCT_SURFACE"],
        ["package.json", "ROOT_TRUST_SURFACE", "REQUIRE_OWNER"],
        ["src/shared/beta.ts", "PRODUCT_SURFACE"],
        ["src/shared/gamma.ts", "PRODUCT_SURFACE"]
      ])
    }));
    const alpha = model.components.find((component) => component.id === "alpha");
    expect(alpha?.authority).toBe("ROOT_TRUST_SURFACE");
    expect(alpha?.ownerReview).toBe("REQUIRE_OWNER");
    expect(alpha?.authorityPaths).toEqual(["package.json", "src/shared/alpha.ts"]);
    // A component whose paths no authority fact covers is UNKNOWN, never assumed safe.
    const orphan = buildSelfModel(facts({ ownership: { capabilities: { alpha: ["src/shared/unclassified.ts"] }, exempt: {} }, authority: [] }));
    expect(orphan.components.find((component) => component.id === "alpha")?.authority).toBe("UNKNOWN");
  });

  it("keeps an unreadable fact source as a component instead of dropping it", () => {
    const model = buildSelfModel(facts({ unreadable: [{ path: "config/capabilities/broken.yaml", reason: "the manifest is not valid YAML" }] }));
    const kept = model.components.find((component) => component.id.startsWith("unreadable:"));
    expect(kept?.sourcePaths).toEqual(["config/capabilities/broken.yaml"]);
    expect(kept?.runtimeRegistration.status).toBe("UNKNOWN");
    expect(kept?.runtimeRegistration.status === "UNKNOWN" ? kept.runtimeRegistration.reason : "").toContain("not valid YAML");
    expect(model.notes.join(" ")).toContain("config/capabilities/broken.yaml could not be read");
    // "Nothing was unreadable" is said out loud rather than left to be inferred from an empty list.
    expect(buildSelfModel(facts()).notes.join(" ")).toContain("every fact source this model reads was read successfully");
  });

  it("carries the architecture baseline as an availability fact", () => {
    const model = buildSelfModel(facts());
    expect(availabilityValue(model.architectureBaseline)).toEqual(expect.objectContaining({ metrics: { capabilityCount: 3 } }));
    const without = buildSelfModel(facts({ architectureBaseline: undefined }));
    expect(without.architectureBaseline.status).toBe("NOT_MEASURED");
    expect(without.architectureBaseline.reason).toContain("no architecture baseline");
  });

  it("is deterministic: the same facts produce the same model", () => {
    const first = buildSelfModel(facts());
    const second = buildSelfModel(facts());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.schemaVersion).toBe(SELF_MODEL_SCHEMA_VERSION);
    expect(first.kind).toBe("BOSS_SELF_MODEL");
  });

  it("declares its own limits as literals", () => {
    const model: BossSelfModel = buildSelfModel(facts());
    expect(model.authority).toEqual({ canDescribeSelf: true, canDiagnose: false, canMutateSelf: false });
  });
});

describe("the four graphs are readings of the model", () => {
  it("names components and their kinds", () => {
    const model = buildSelfModel(facts());
    const graph: SelfGraph = componentGraph(model);
    expect(graph.nodes).toContain("alpha");
    expect(graph.nodes).toContain("boot:electron/boot/alpha.ts");
    expect(graph.edges).toContainEqual({ from: "alpha", to: "CAPABILITY", kind: "IS_A", source: "component descriptor" });
  });

  it("connects capabilities through their contracts", () => {
    const graph = capabilityGraph(buildSelfModel(facts()));
    expect(graph.edges).toContainEqual({ from: "beta", to: "alpha.thing@1", kind: "REQUIRES", source: "capability manifest" });
    expect(graph.edges).toContainEqual({ from: "alpha", to: "beta", kind: "PROVIDES", source: "capability manifest provides, read from the consumer" });
    expect(graph.nodes).toContain("alpha.thing@1");
  });

  it("draws one dependency edge per resolved dependency", () => {
    const graph = dependencyGraph(buildSelfModel(facts()));
    // The declared requirement is a contract; the edge names the component that provides it, so
    // dependency paths are walkable over components.
    expect(graph.edges).toContainEqual({ from: "beta", to: "alpha", kind: "DEPENDS_ON", source: "capability manifest requires/optional, resolved through provides" });
    expect(graph.edges).toContainEqual({ from: "gamma", to: "beta", kind: "DEPENDS_ON", source: "capability manifest requires/optional, resolved through provides" });
  });

  it("separates owning state from reading it", () => {
    const graph = dataFlowGraph(buildSelfModel(facts()));
    expect(graph.edges).toContainEqual({ from: "alpha", to: "alpha-store", kind: "OWNS_STATE", source: "config/capabilities/alpha.yaml state" });
    expect(graph.edges).toContainEqual({ from: "beta", to: "alpha-store", kind: "READS_STATE", source: "config/capabilities/alpha.yaml state" });
    expect(graph.nodes).toContain("alpha-store");
  });
});

describe("the availability vocabulary cannot say 'fine' by accident", () => {
  it("keeps the value out of an absence and requires a reason for one", () => {
    expect(AVAILABILITY_STATUSES).toEqual(["AVAILABLE", "UNAVAILABLE", "UNKNOWN", "NOT_MEASURED"]);
    const fact: Availability<number> = available(3, "a source");
    expect(availabilityValue(fact)).toBe(3);
    const missing: AvailabilityFact<number> = absent("NOT_MEASURED", "nothing observed it", "no source");
    expect(availabilityValue(missing)).toBeUndefined();
    expect(missing.reason).toBe("nothing observed it");
    const status: AvailabilityStatus = missing.status;
    expect(status).toBe("NOT_MEASURED");
    expect(describeAvailability(fact)).toContain("3 (from a source)");
    expect(describeAvailability(missing)).toContain("NOT_MEASURED: nothing observed it");
  });

  it("publishes the authority and component vocabularies it uses", () => {
    expect(AUTHORITY_CLASSES).toEqual(["ROOT_TRUST_SURFACE", "EVOLUTION_ENGINE", "VERIFICATION_SURFACE", "PRODUCT_SURFACE", "UNKNOWN"]);
    expect(OWNER_REVIEW_DECISIONS).toEqual(["ALLOW", "REQUIRE_OWNER", "DENY", "UNKNOWN"]);
    expect(COMPONENT_KINDS).toEqual(["CAPABILITY", "BOOT_MODULE", "MODULE", "SCRIPT", "CONFIGURATION"]);
  });

  it("describes a component with every field a caller reads", () => {
    const model = buildSelfModel(facts());
    const component: BossComponentDescriptor | undefined = model.components.find((entry) => entry.id === "alpha");
    expect(component?.name).toBe("alpha");
    expect(component?.responsibility).toContain("provides alpha.thing@1");
    expect(component?.runtimeRegistration.status).toBe("NOT_MEASURED");
    expect(component?.inputs).toEqual([]);
    expect(component?.outputs).toEqual(["alpha.thing@1"]);
    expect(component?.capabilitiesProvided).toEqual(["alpha.thing@1"]);
    expect(component?.healthSignals).toEqual([]);
    expect(component?.knownFailureModes).toEqual([]);
    expect(component?.recoveryInterfaces).toEqual([]);
    const kinds: ComponentKind[] = model.components.map((entry) => entry.kind);
    expect(kinds).toContain("SCRIPT");
    const flow: BossDataFlow | undefined = model.dataFlows[0];
    expect(flow?.namespace).toBe("alpha-store");
    expect(flow?.readers).toEqual(["beta"]);
  });
});
