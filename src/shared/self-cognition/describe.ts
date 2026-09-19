/**
 * Self Cognition — the questions Boss may ask about itself.
 *
 * Six answers, and every one of them is a reading of the self model rather than a judgement about
 * it: what am I, what is this component, what is this capability, how does A reach B, what does
 * this component's failure touch, and who may change it.
 *
 * The last one is the load-bearing one. `authorityOf` reports what the repository's own classifier
 * and owner-review guard said about a component's paths — it does not decide that a path is safe,
 * and it has no way to grant permission. `CAN_DESCRIBE_SELF != CAN_AUTHORIZE_SELF`: describing a
 * boundary is not the same as being allowed to cross it.
 */

import {
  absent,
  available,
  describeAvailability,
  type AuthorityClass,
  type Availability,
  type BossCapabilityDescriptor,
  type BossComponentDescriptor,
  type BossSelfModel,
  type OwnerReviewDecision
} from "./contracts";
import { SELF_MODEL_VERSION, selfModelHash } from "./drift";

/** What a component is, or an honest absence when no component carries that id. */
export function describeComponent(model: BossSelfModel, id: string): Availability<BossComponentDescriptor> {
  const component = model.components.find((entry) => entry.id === id || entry.name === id);
  if (component === undefined) {
    const known = model.components.slice(0, 8).map((entry) => entry.id);
    return absent("UNKNOWN", `${id} is not a component in this model, so no descriptor exists for it; the model holds ${model.components.length} component(s), for example ${known.join(", ")}`, "BossSelfModel.components");
  }
  return available(component, "BossSelfModel.components");
}

export function describeCapability(model: BossSelfModel, id: string): Availability<BossCapabilityDescriptor> {
  const capability = model.capabilities.find((entry) => entry.capabilityId === id);
  if (capability === undefined) {
    return absent("UNKNOWN", `${id} is not a capability in this model, which holds ${model.capabilities.length}: ${model.capabilities.map((entry) => entry.capabilityId).join(", ")}`, "BossSelfModel.capabilities");
  }
  return available(capability, "BossSelfModel.capabilities");
}

export interface SelfDescription {
  schemaVersion: number;
  kind: "BOSS_SELF_DESCRIPTION";
  capturedAt: string;
  repositoryRoot: string;
  /** The body's own identity: two descriptions with the same hash describe the same anatomy. */
  selfModelVersion: string;
  selfModelHash: string;
  componentCount: number;
  componentKinds: Record<string, number>;
  capabilities: number;
  /** Capabilities whose availability could not be established, named rather than counted away. */
  capabilitiesUnavailable: string[];
  dataFlows: number;
  authority: {
    rootTrustComponents: string[];
    evolutionEngineComponents: string[];
    verificationComponents: string[];
    ownerReviewRequired: string[];
  };
  unreadable: Array<{ path: string; reason: string }>;
  architectureBaseline: string;
  canDescribeSelf: true;
  canDiagnose: false;
  canMutateSelf: false;
  notes: string[];
}

/**
 * The whole self view.
 *
 * The counts here are computed from the model, never from a list written by hand: a repository
 * that gains a capability changes this answer without anyone editing it. The authority lists name
 * CAPABILITY components only — the answer to "which capabilities are behind a boundary" — while
 * `authorityOf` answers the same question for any single component, down to one file.
 */
export function describeSelf(model: BossSelfModel): SelfDescription {
  const kinds: Record<string, number> = {};
  for (const component of model.components) kinds[component.kind] = (kinds[component.kind] ?? 0) + 1;
  const capabilities = model.components.filter((component) => component.kind === "CAPABILITY");
  return {
    schemaVersion: model.schemaVersion,
    kind: "BOSS_SELF_DESCRIPTION",
    capturedAt: model.capturedAt,
    repositoryRoot: model.repositoryRoot,
    selfModelVersion: SELF_MODEL_VERSION,
    selfModelHash: selfModelHash(model),
    componentCount: model.components.length,
    componentKinds: kinds,
    capabilities: model.capabilities.length,
    capabilitiesUnavailable: model.capabilities.filter((capability) => capability.available.status !== "AVAILABLE" || capability.available.value === false).map((capability) => capability.capabilityId),
    dataFlows: model.dataFlows.length,
    authority: {
      rootTrustComponents: capabilities.filter((component) => component.authority === "ROOT_TRUST_SURFACE").map((component) => component.id),
      evolutionEngineComponents: capabilities.filter((component) => component.authority === "EVOLUTION_ENGINE").map((component) => component.id),
      verificationComponents: capabilities.filter((component) => component.authority === "VERIFICATION_SURFACE").map((component) => component.id),
      ownerReviewRequired: capabilities.filter((component) => component.ownerReview === "REQUIRE_OWNER").map((component) => component.id)
    },
    unreadable: model.unreadable,
    architectureBaseline: model.architectureBaseline.status === "AVAILABLE" && model.architectureBaseline.value !== undefined
      ? `${Object.entries(model.architectureBaseline.value.metrics).map(([key, value]) => `${key}=${value}`).join(", ")} (from ${model.architectureBaseline.source}, recorded ${model.architectureBaseline.value.updatedAt}: ${model.architectureBaseline.value.reason})`
      : describeAvailability(model.architectureBaseline),
    canDescribeSelf: true,
    canDiagnose: false,
    canMutateSelf: false,
    notes: model.notes
  };
}

/** The authority verdict for a component: which tier it is, and whether an owner must review it. */
export function authorityOf(model: BossSelfModel, id: string): Availability<{ authority: AuthorityClass; ownerReview: OwnerReviewDecision; paths: string[] }> {
  const component = model.components.find((entry) => entry.id === id || entry.name === id);
  if (component === undefined) {
    return absent("UNKNOWN", `${id} is not in this model, so no authority verdict applies to it; a component that is not described cannot be classified`, "BossSelfModel.components");
  }
  if (component.authorityPaths.length === 0) {
    return absent("UNKNOWN",
      component.kind === "SCRIPT"
        ? `${component.id} is a package script: it is not a repository path, so the path classifier has nothing to classify and no tier is claimed for it`
        : `no authority fact covers ${component.id}, so its tier is unknown rather than assumed to be product surface`,
      "BossSelfModel.authorityPaths");
  }
  return available({ authority: component.authority, ownerReview: component.ownerReview, paths: component.authorityPaths }, "classifySurface + ProtectedSurfaceGuard");
}

export interface DependencyPath {
  from: string;
  to: string;
  /** The components along the path, including both ends. */
  path: string[];
  hops: number;
  found: boolean;
  reason: string;
}

/**
 * How one component reaches another through declared dependencies.
 *
 * Breadth-first, so the reported path is the shortest one. When there is no path the answer says
 * so and names how many components were searched — "no path" and "not searched" must not read the
 * same.
 */
export function dependencyPath(model: BossSelfModel, from: string, to: string): DependencyPath {
  if (from === to) return { from, to, path: [from], hops: 0, found: true, reason: "the two ids are the same component" };
  const edges = model.components.map((component) => ({ from: component.id, to: component.dependencies }));
  const queue: string[][] = [[from]];
  const visited = new Set<string>([from]);
  let searched = 0;
  while (queue.length > 0) {
    const current = queue.shift() as string[];
    const tail = current[current.length - 1];
    searched += 1;
    for (const edge of edges.filter((entry) => entry.from === tail)) {
      for (const next of edge.to) {
        if (next === to) return { from, to, path: [...current, next], hops: current.length, found: true, reason: `reached through ${current.length} declared dependency hop(s)` };
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push([...current, next]);
      }
    }
  }
  return { from, to, path: [], hops: 0, found: false, reason: `no declared dependency path from ${from} to ${to}; ${searched} component(s) were searched and ${visited.size} reached` };
}

export interface AffectedSet {
  component: string;
  /** Components that declare a dependency on this one, transitively. */
  dependents: string[];
  /** The blast radius: dependents plus the capabilities whose state this component owns. */
  blastRadius: string[];
  capabilitiesAffected: string[];
  ownedState: string[];
  reason: string;
}

/**
 * What a component's failure touches.
 *
 * This is the description, not the diagnosis: it says which components lie downstream, and it
 * makes no claim about whether they are currently healthy. Deciding that something is wrong is a
 * different module's job.
 */
export function affectedBy(model: BossSelfModel, id: string): Availability<AffectedSet> {
  const component = model.components.find((entry) => entry.id === id || entry.name === id);
  if (component === undefined) {
    return absent("UNKNOWN", `${id} is not in this model, so nothing can be said about what depends on it`, "BossSelfModel.components");
  }
  const reached = new Set<string>();
  const queue = [component.id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const entry of model.components) {
      if (entry.dependencies.includes(current) && !reached.has(entry.id)) {
        reached.add(entry.id);
        queue.push(entry.id);
      }
    }
  }
  const dependents = [...reached].sort();
  return available(
    {
      component: component.id,
      dependents,
      blastRadius: [...new Set([component.id, ...dependents])].sort(),
      capabilitiesAffected: dependents.filter((entry) => model.capabilities.some((capability) => capability.capabilityId === entry)),
      ownedState: component.ownedState,
      reason: `${dependents.length} component(s) declare a dependency on ${component.id}, directly or transitively`
    },
    "BossSelfModel dependency graph"
  );
}
