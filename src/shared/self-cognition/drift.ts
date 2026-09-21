/**
 * Self Cognition — the model's identity, and the drift between two of them.
 *
 * A self view is only comparable with another if both say which body they describe. `selfModelHash`
 * is a fingerprint over the model's ANATOMY — components, their kinds and paths, capabilities,
 * providers and consumers, dependencies, authority verdicts and data flows — and deliberately not
 * over `capturedAt` or `repositoryRoot`, so the same body observed twice hashes the same and a
 * hash that moves means the body moved.
 *
 * `selfModelDrift` then answers the only question a hash can only hint at: what changed. It reports
 * components added and removed, dependencies, authority and health signals that moved, and it
 * modifies nothing — least of all a case record, which keeps the self model version it was opened
 * against.
 */

import { sha256Hex } from "../hash";
import type { BossSelfModel } from "./contracts";

/** The name and version a case record stores, so a diagnosis can be read against the body it saw. */
export const SELF_MODEL_VERSION = "self-model-v1";

/**
 * A fingerprint of the anatomy.
 *
 * Sorted at every level, and built only from fields that describe structure rather than the moment
 * of observation, so it is stable across two runs over the same repository.
 */
export function selfModelHash(model: BossSelfModel): string {
  const lines: string[] = [`self-model:${SELF_MODEL_VERSION}`];
  for (const component of [...model.components].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    lines.push(
      [
        `component:${component.id}`,
        component.kind,
        component.responsibility,
        `paths:${[...component.sourcePaths].sort().join(",")}`,
        `deps:${[...component.dependencies].sort().join(",")}`,
        `state:${[...component.ownedState].sort().join(",")}`,
        `authority:${component.authority}`,
        `ownerReview:${component.ownerReview}`,
        `authorityPaths:${[...component.authorityPaths].sort().join(",")}`,
        `health:${[...component.healthSignals].sort().join(",")}`,
        `failureModes:${[...component.knownFailureModes].sort().join(",")}`,
        `recovery:${[...component.recoveryInterfaces].sort().join(",")}`
      ].join("|")
    );
  }
  for (const capability of [...model.capabilities].sort((left, right) => (left.capabilityId < right.capabilityId ? -1 : 1))) {
    lines.push(
      [
        `capability:${capability.capabilityId}`,
        `provides:${[...capability.providedContracts].sort().join(",")}`,
        `requires:${[...capability.requirements].sort().join(",")}`,
        `providers:${capability.providerComponents.status === "AVAILABLE" ? (capability.providerComponents.value ?? []).join(",") : capability.providerComponents.status}`,
        `consumers:${capability.consumerComponents.status === "AVAILABLE" ? (capability.consumerComponents.value ?? []).join(",") : capability.consumerComponents.status}`,
        `available:${capability.available.status === "AVAILABLE" ? String(capability.available.value) : capability.available.status}`,
        `authority:${capability.authority}`,
        `critical:${capability.critical}`,
        `namespaces:${[...capability.ownedNamespaces].sort().join(",")}`
      ].join("|")
    );
  }
  for (const flow of [...model.dataFlows].sort((left, right) => (left.namespace < right.namespace ? -1 : 1))) {
    lines.push(`flow:${flow.namespace}|owner:${flow.owner}|readers:${[...flow.readers].sort().join(",")}`);
  }
  for (const entry of [...model.unreadable].sort((left, right) => (left.path < right.path ? -1 : 1))) {
    lines.push(`unreadable:${entry.path}`);
  }
  return sha256Hex(lines.join("\n"));
}

export interface ComponentChange {
  id: string;
  before: string;
  after: string;
}

export interface SelfModelDriftReport {
  schemaVersion: number;
  kind: "SELF_MODEL_DRIFT_REPORT";
  at: string;
  previousHash: string;
  nextHash: string;
  identical: boolean;
  components: {
    added: string[];
    removed: string[];
    dependenciesChanged: Array<{ id: string; added: string[]; removed: string[] }>;
    authorityChanged: Array<{ id: string; before: string; after: string }>;
    ownerReviewChanged: Array<{ id: string; before: string; after: string }>;
    healthSignalsChanged: Array<{ id: string; added: string[]; removed: string[] }>;
    sourcePathsChanged: Array<{ id: string; added: string[]; removed: string[] }>;
  };
  capabilities: {
    added: string[];
    removed: string[];
    availabilityChanged: Array<{ id: string; before: string; after: string }>;
    authorityChanged: Array<{ id: string; before: string; after: string }>;
  };
  dataFlows: { added: string[]; removed: string[]; readersChanged: Array<{ namespace: string; added: string[]; removed: string[] }> };
  /** Facts a model could not read, which is itself a change worth reporting. */
  unreadableChanged: { added: string[]; removed: string[] };
  notes: string[];
}

function difference(before: readonly string[], after: readonly string[]): string[] {
  return after.filter((entry) => !before.includes(entry));
}

/**
 * Compares two self models.
 *
 * The report is a statement about the BODY, not about any case: it never rewrites a case record,
 * and a caller that wants to know what a past diagnosis saw reads the model hash that case stored.
 */
export function selfModelDrift(previous: BossSelfModel, next: BossSelfModel, at: string): SelfModelDriftReport {
  const before = new Map(previous.components.map((component) => [component.id, component]));
  const after = new Map(next.components.map((component) => [component.id, component]));
  const previousCapabilities = new Map(previous.capabilities.map((capability) => [capability.capabilityId, capability]));
  const nextCapabilities = new Map(next.capabilities.map((capability) => [capability.capabilityId, capability]));
  const previousFlows = new Map(previous.dataFlows.map((flow) => [flow.namespace, flow]));
  const nextFlows = new Map(next.dataFlows.map((flow) => [flow.namespace, flow]));

  const dependenciesChanged: SelfModelDriftReport["components"]["dependenciesChanged"] = [];
  const authorityChanged: ComponentChange[] = [];
  const ownerReviewChanged: ComponentChange[] = [];
  const healthSignalsChanged: SelfModelDriftReport["components"]["healthSignalsChanged"] = [];
  const sourcePathsChanged: SelfModelDriftReport["components"]["sourcePathsChanged"] = [];
  for (const [id, component] of after) {
    const was = before.get(id);
    if (was === undefined) continue;
    const dependenciesAdded = difference(was.dependencies, component.dependencies);
    const dependenciesRemoved = difference(component.dependencies, was.dependencies);
    if (dependenciesAdded.length > 0 || dependenciesRemoved.length > 0) dependenciesChanged.push({ id, added: dependenciesAdded, removed: dependenciesRemoved });
    if (was.authority !== component.authority) authorityChanged.push({ id, before: was.authority, after: component.authority });
    if (was.ownerReview !== component.ownerReview) ownerReviewChanged.push({ id, before: was.ownerReview, after: component.ownerReview });
    const healthAdded = difference(was.healthSignals, component.healthSignals);
    const healthRemoved = difference(component.healthSignals, was.healthSignals);
    if (healthAdded.length > 0 || healthRemoved.length > 0) healthSignalsChanged.push({ id, added: healthAdded, removed: healthRemoved });
    const pathsAdded = difference(was.sourcePaths, component.sourcePaths);
    const pathsRemoved = difference(component.sourcePaths, was.sourcePaths);
    if (pathsAdded.length > 0 || pathsRemoved.length > 0) sourcePathsChanged.push({ id, added: pathsAdded, removed: pathsRemoved });
  }

  const availabilityChanged: SelfModelDriftReport["capabilities"]["availabilityChanged"] = [];
  const capabilityAuthorityChanged: ComponentChange[] = [];
  for (const [id, capability] of nextCapabilities) {
    const was = previousCapabilities.get(id);
    if (was === undefined) continue;
    const beforeAvailability = was.available.status === "AVAILABLE" ? String(was.available.value) : was.available.status;
    const afterAvailability = capability.available.status === "AVAILABLE" ? String(capability.available.value) : capability.available.status;
    if (beforeAvailability !== afterAvailability) availabilityChanged.push({ id, before: beforeAvailability, after: afterAvailability });
    if (was.authority !== capability.authority) capabilityAuthorityChanged.push({ id, before: was.authority, after: capability.authority });
  }

  const readersChanged: SelfModelDriftReport["dataFlows"]["readersChanged"] = [];
  for (const [namespace, flow] of nextFlows) {
    const was = previousFlows.get(namespace);
    if (was === undefined) continue;
    const added = difference(was.readers, flow.readers);
    const removed = difference(flow.readers, was.readers);
    if (added.length > 0 || removed.length > 0) readersChanged.push({ namespace, added, removed });
  }

  const previousHash = selfModelHash(previous);
  const nextHash = selfModelHash(next);
  const report: SelfModelDriftReport = {
    schemaVersion: 1,
    kind: "SELF_MODEL_DRIFT_REPORT",
    at,
    previousHash,
    nextHash,
    identical: previousHash === nextHash,
    components: {
      added: [...after.keys()].filter((id) => !before.has(id)).sort(),
      removed: [...before.keys()].filter((id) => !after.has(id)).sort(),
      dependenciesChanged: dependenciesChanged.sort((left, right) => (left.id < right.id ? -1 : 1)),
      authorityChanged: authorityChanged.sort((left, right) => (left.id < right.id ? -1 : 1)),
      ownerReviewChanged: ownerReviewChanged.sort((left, right) => (left.id < right.id ? -1 : 1)),
      healthSignalsChanged: healthSignalsChanged.sort((left, right) => (left.id < right.id ? -1 : 1)),
      sourcePathsChanged: sourcePathsChanged.sort((left, right) => (left.id < right.id ? -1 : 1))
    },
    capabilities: {
      added: [...nextCapabilities.keys()].filter((id) => !previousCapabilities.has(id)).sort(),
      removed: [...previousCapabilities.keys()].filter((id) => !nextCapabilities.has(id)).sort(),
      availabilityChanged: availabilityChanged.sort((left, right) => (left.id < right.id ? -1 : 1)),
      authorityChanged: capabilityAuthorityChanged.sort((left, right) => (left.id < right.id ? -1 : 1))
    },
    dataFlows: {
      added: [...nextFlows.keys()].filter((namespace) => !previousFlows.has(namespace)).sort(),
      removed: [...previousFlows.keys()].filter((namespace) => !nextFlows.has(namespace)).sort(),
      readersChanged: readersChanged.sort((left, right) => (left.namespace < right.namespace ? -1 : 1))
    },
    unreadableChanged: {
      added: difference(previous.unreadable.map((entry) => entry.path), next.unreadable.map((entry) => entry.path)).sort(),
      removed: difference(next.unreadable.map((entry) => entry.path), previous.unreadable.map((entry) => entry.path)).sort()
    },
    notes: []
  };
  report.notes.push(
    report.identical
      ? `the anatomy is unchanged: ${next.components.length} component(s) hash to the same value`
      : `the anatomy moved: ${report.components.added.length} component(s) added, ${report.components.removed.length} removed, ${authorityChanged.length} authority verdict(s) changed`
  );
  report.notes.push("this report describes the body; it does not modify a case record, and a past diagnosis is read against the model hash that case stored");
  return report;
}
