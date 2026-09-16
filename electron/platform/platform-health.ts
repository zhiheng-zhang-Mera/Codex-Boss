import type { DependencyGraph, MissingCapability } from "./dependency-graph";
import type { CapabilityId, CapabilityManifest } from "./capability-contract";

/**
 * Platform health (platform foundation, Phase 01 — acceptance gate 5).
 *
 * Models the one thing the engineering book is most specific about: **a missing
 * optional capability may only degrade locally**. It must never be upgraded into a
 * global boot failure.
 *
 * The rule is stated as a total function of what is present, so it can be evaluated
 * for a repository that is missing a manifest as easily as for a complete one:
 *
 *   - a capability is `READY` when every *required* dependency it declares resolves;
 *   - it is `DEGRADED` when a required dependency is absent — it cannot do its whole
 *     job, but nothing about that fact stops the rest of the platform;
 *   - it is `DEGRADED` (not failed) when only optional dependencies are absent, which
 *     is the normal, expected state for an optional refinement;
 *   - the platform boot fails ONLY when a capability declared `health.critical: true`
 *     is not `READY`. That is the single way absence becomes fatal, and it is a
 *     declaration the manifest has to make explicitly rather than a default.
 *
 * This module computes a report; it does not gate anything at runtime, and Phase 01
 * deliberately wires it into no boot path. Its consumer is the acceptance test that
 * deletes a manifest and requires the platform to survive.
 */

type CapabilityHealthState = "READY" | "DEGRADED" | "ABSENT";

interface CapabilityHealthEntry {
  id: CapabilityId;
  /** `undefined` when the capability is absent, so nothing invented a version for it. */
  version?: string;
  kind?: "kernel" | "feature";
  critical: boolean;
  state: CapabilityHealthState;
  /** Required dependencies that did not resolve. Non-empty forces `DEGRADED`. */
  missingRequired: MissingCapability[];
  /** Optional dependencies that did not resolve. Informational: absence is the point. */
  missingOptional: MissingCapability[];
  /**
   * Required providers that are themselves DEGRADED, so this capability cannot rely
   * on their contract. Empty when the capability's own requirements all resolved.
   */
  degradedVia: CapabilityId[];
  /**
   * Required providers that are ABSENT (no manifest installed). Distinct from
   * `missingRequired`, which is about the contract reference not resolving at all:
   * here the provider exists in the graph and is simply not installed.
   */
  absentVia: CapabilityId[];
  /** One line an operator can read. */
  detail: string;
}

interface PlatformHealthReport {
  entries: CapabilityHealthEntry[];
  /** Capabilities that are present but not `READY`. */
  degraded: CapabilityId[];
  /**
   * True when every critical capability is `READY`.
   *
   * NOT the inverse of "something is degraded": a platform with three degraded
   * optional features is `bootable`, and that is the entire distinction the book
   * asks for. The inverse also does not hold — an ABSENT critical capability is not
   * "degraded", it is gone, and it still makes the platform unbootable.
   */
  bootable: boolean;
  /** The critical capabilities that are not `READY` — the only fatal condition. */
  fatal: CapabilityId[];
  /** Absent dependencies grouped by the capability that wanted them. */
  missing: Array<{ capability: CapabilityId; ref: string; kind: "required" | "optional"; reason: string }>;
}

/**
 * Evaluate platform health for a manifest set.
 *
 * `knownCritical` is the set of capabilities declared critical by the FULL manifest
 * set. It has to be passed in, because the interesting question is asked when a
 * capability is missing — and a capability that is missing from `present` cannot
 * declare itself critical from inside the set being examined. Without it, deleting a
 * critical capability would read as "nothing critical is degraded, therefore
 * bootable", which is exactly backwards.
 *
 * The graph is expected to have been built from the FULL set, so "which dependencies
 * resolve" is asked about the complete picture rather than about the remainder
 * describing itself.
 *
 * DEGRADATION PROPAGATES. A capability whose required dependency is itself degraded
 * is degraded too, because it cannot rely on that contract being honoured — it does
 * not need its own missing edge to be affected. The evaluation walks the graph's boot
 * order (dependencies first) so each capability's state is known before anything that
 * depends on it is decided.
 */
export function evaluatePlatformHealth(
  present: readonly CapabilityManifest[],
  graph: DependencyGraph,
  knownCritical?: readonly CapabilityId[]
): PlatformHealthReport {
  const byId = new Map(present.map((manifest) => [manifest.id, manifest]));
  const criticalIds = new Set<CapabilityId>(knownCritical ?? present.filter((manifest) => manifest.health.critical).map((manifest) => manifest.id));

  const stateOf = new Map<CapabilityId, CapabilityHealthState>();
  const entries: CapabilityHealthEntry[] = [];
  const byNode = new Map(graph.nodes.map((node) => [node.id, node]));

  // Boot order puts every provider before its dependents, so a single forward pass is
  // enough and no fixpoint iteration is needed. Any node the order missed (it is
  // derived from the required subgraph, so an optional-cycle-only node could in
  // principle be absent) is appended and evaluated last.
  const order = [...graph.bootOrder, ...graph.nodes.map((node) => node.id).filter((id) => !graph.bootOrder.includes(id))];

  for (const id of order) {
    const node = byNode.get(id);
    if (!node) continue;
    const manifest = byId.get(id);
    const critical = manifest ? manifest.health.critical : criticalIds.has(id);
    if (!manifest) {
      stateOf.set(id, "ABSENT");
      entries.push({
        id,
        critical,
        state: "ABSENT",
        missingRequired: [],
        missingOptional: [],
        degradedVia: [],
        absentVia: [],
        detail: "absent: no manifest is installed for this capability"
      });
      continue;
    }

    const missingRequired = node.missing.filter((entry) => entry.kind === "required");
    const missingOptional = node.missing.filter((entry) => entry.kind === "optional");
    // Degradation propagates along required edges. A provider that is DEGRADED
    // poisons its dependents; a provider that is ABSENT shows up as a missing
    // requirement instead, so the two are reported under separate headings rather
    // than one being described as the other.
    const degradedVia = node.required
      .filter((edge) => stateOf.get(edge.to) === "DEGRADED")
      .map((edge) => edge.to);
    const absentVia = node.required
      .filter((edge) => stateOf.get(edge.to) === "ABSENT" && !missingRequired.some((entry) => entry.ref === edge.ref))
      .map((edge) => edge.to);
    const state: CapabilityHealthState = missingRequired.length > 0 || degradedVia.length > 0 || absentVia.length > 0 ? "DEGRADED" : "READY";
    stateOf.set(id, state);

    const reasons = [
      ...missingRequired.map((entry) => `${entry.ref} unavailable`),
      ...degradedVia.map((provider) => `${provider} degraded`),
      ...absentVia.map((provider) => `${provider} absent`)
    ];
    entries.push({
      id,
      version: node.version,
      kind: manifest.kind,
      critical,
      state,
      missingRequired,
      missingOptional,
      degradedVia,
      absentVia,
      detail: state === "READY"
        ? missingOptional.length === 0
          ? "all declared dependencies present"
          : `ready without ${missingOptional.length} optional dependenc${missingOptional.length === 1 ? "y" : "ies"}`
        : `degraded: ${reasons.join("; ")}`
    });
  }

  entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const fatal = entries.filter((entry) => entry.critical && entry.state !== "READY").map((entry) => entry.id);
  return {
    entries,
    degraded: entries.filter((entry) => entry.state === "DEGRADED").map((entry) => entry.id),
    bootable: fatal.length === 0,
    fatal,
    missing: entries.flatMap((entry) => [
      ...entry.missingRequired.map((missing) => ({ capability: entry.id, ref: missing.ref, kind: "required" as const, reason: missing.reason })),
      ...entry.missingOptional.map((missing) => ({ capability: entry.id, ref: missing.ref, kind: "optional" as const, reason: missing.reason }))
    ])
  };
}

/**
 * The capabilities a set of manifests would lose if `removed` were deleted.
 *
 * The graph and the critical set are taken from the FULL manifest set, so the report
 * answers "what does the platform look like now that this is gone" rather than
 * "what does the remainder say about itself".
 */
export function healthAfterRemoval(present: readonly CapabilityManifest[], graph: DependencyGraph, removed: readonly CapabilityId[]): PlatformHealthReport {
  const removedSet = new Set(removed);
  return evaluatePlatformHealth(present.filter((manifest) => !removedSet.has(manifest.id)), graph, present.filter((manifest) => manifest.health.critical).map((manifest) => manifest.id));
}
