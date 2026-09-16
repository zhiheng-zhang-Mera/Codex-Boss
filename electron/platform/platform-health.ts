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

export type CapabilityHealthState = "READY" | "DEGRADED";

export interface CapabilityHealthEntry {
  id: CapabilityId;
  version: string;
  kind: "kernel" | "feature";
  critical: boolean;
  state: CapabilityHealthState;
  /** Required dependencies that did not resolve. Non-empty forces `DEGRADED`. */
  missingRequired: MissingCapability[];
  /** Optional dependencies that did not resolve. Informational: absence is the point. */
  missingOptional: MissingCapability[];
  /** One line an operator can read. */
  detail: string;
}

export interface PlatformHealthReport {
  entries: CapabilityHealthEntry[];
  /** Capabilities that are not `READY`, whether critical or not. */
  degraded: CapabilityId[];
  /**
   * True when every critical capability is `READY`.
   *
   * NOT the inverse of "something is degraded": a platform with three degraded
   * optional features is `bootable`, and that is the entire distinction the book
   * asks for.
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
 * The graph is rebuilt from `present` rather than reusing a graph built from a
 * larger set, because "which dependencies resolve" is exactly the question, and a
 * stale provider index would answer it wrongly.
 */
export function evaluatePlatformHealth(present: readonly CapabilityManifest[], graph: DependencyGraph): PlatformHealthReport {
  const presentIds = new Set(present.map((manifest) => manifest.id));
  const byId = new Map(present.map((manifest) => [manifest.id, manifest]));
  const entries: CapabilityHealthEntry[] = [];

  for (const node of graph.nodes) {
    if (!presentIds.has(node.id)) continue;
    const manifest = byId.get(node.id) as CapabilityManifest;
    const missingRequired = node.missing.filter((entry) => entry.kind === "required");
    const missingOptional = node.missing.filter((entry) => entry.kind === "optional");
    const state: CapabilityHealthState = missingRequired.length > 0 ? "DEGRADED" : "READY";
    entries.push({
      id: node.id,
      version: node.version,
      kind: manifest.kind,
      critical: manifest.health.critical,
      state,
      missingRequired,
      missingOptional,
      detail: state === "READY"
        ? missingOptional.length === 0
          ? "all declared dependencies present"
          : `ready without ${missingOptional.length} optional dependenc${missingOptional.length === 1 ? "y" : "ies"}`
        : `degraded: ${missingRequired.map((entry) => entry.ref).join(", ")} unavailable`
    });
  }

  entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const fatal = entries.filter((entry) => entry.critical && entry.state !== "READY").map((entry) => entry.id);
  return {
    entries,
    degraded: entries.filter((entry) => entry.state !== "READY").map((entry) => entry.id),
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
 * Used by the acceptance test that removes a non-critical manifest: it answers
 * "which capabilities are now degraded, and is Boss still bootable", which is the
 * exact pair of facts gate 5 is written in terms of.
 */
export function healthAfterRemoval(present: readonly CapabilityManifest[], graph: DependencyGraph, removed: readonly CapabilityId[]): PlatformHealthReport {
  const removedSet = new Set(removed);
  return evaluatePlatformHealth(present.filter((manifest) => !removedSet.has(manifest.id)), graph);
}
