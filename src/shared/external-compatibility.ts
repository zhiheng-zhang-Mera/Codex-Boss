/**
 * External compatibility registry (Phase 05, Task C).
 *
 * The book asks for one record per external dependency carrying `contractVersion`,
 * `lastKnownGood`, `healthProbe`, `failureClass`, `degradedFallback` and `observedAt`, and for one
 * property to be PROVEN rather than asserted: when any single provider, adapter or runtime degrades,
 * the registry, the scheduler and the UI show a LOCAL degradation, and work reroutes when a legitimate
 * alternative exists.
 *
 * ## What this module is, and what it is not
 *
 * `src/shared/compatibility.ts` already exists and answers a different question: whether an adapter's
 * DECLARED version window contains the current core version, checked once at registration and refused
 * if it does not. This module is about what is OBSERVED over time — an external service changing its
 * page, its API or its auth under a Boss that is already running.
 *
 * ## The one thing it must never do
 *
 * It must never let an external failure become a core verdict. `coreVerdict` is therefore computed
 * from the entries rather than passed in, it is derived from `criticalToCore` alone, and a test
 * asserts that no external failure class can move it. Task C's requirement is that a provider/API/UI
 * change must not judge the Boss core FAILED.
 *
 * Pure: no clock, no network, no filesystem. `observedAt` and `lastKnownGood` are injected, so a
 * registry state can be recorded in an artifact and replayed.
 */

/** The kinds of external thing this registry tracks. */
const COMPATIBILITY_AXES = ["provider", "runtime", "tool", "backend", "identity"] as const;
export type CompatibilityAxis = (typeof COMPATIBILITY_AXES)[number];

/**
 * How an external dependency can fail.
 *
 * Deliberately a closed vocabulary rather than a free-text reason: the failure class is what selects
 * the fallback, so an unclassifiable failure has to be expressed as `UNKNOWN` and routed to a refusal
 * rather than to a guess.
 */
export const FAILURE_CLASSES = [
  "CONTRACT_VERSION_CHANGED",
  "AUTH_EXPIRED",
  "RATE_LIMITED",
  "PAGE_STRUCTURE_CHANGED",
  "NETWORK_UNREACHABLE",
  "RESOURCE_EXHAUSTED",
  "TOOL_TIMEOUT",
  "UNKNOWN"
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** What to do about a failure. `REFUSE` is a first-class outcome, not a last resort. */
const FALLBACK_ACTIONS = ["REROUTE", "RETRY_BOUNDED", "DEGRADE", "REFUSE"] as const;
type FallbackAction = (typeof FALLBACK_ACTIONS)[number];

type CompatibilityStatus = "READY" | "DEGRADED" | "ABSENT";

/** One observation of an external dependency. */
export interface CompatibilityEntry {
  id: string;
  axis: CompatibilityAxis;
  /** The contract version observed in the wild, or `null` when it could not be read. */
  contractVersion: string | null;
  /** The version last seen working, or `null` if it has never worked. */
  lastKnownGood: string | null;
  /** What the probe that produced this observation did. */
  healthProbe: string;
  status: CompatibilityStatus;
  /** Why it is not READY, as a class rather than a sentence. `null` while READY. */
  failureClass: FailureClass | null;
  /** What a caller should do instead. */
  degradedFallback: FallbackAction;
  observedAt: string;
  /**
   * Whether a failure of this dependency can make the CORE unusable.
   *
   * True only for something the core cannot run at all without. Every provider, adapter and UI
   * binding is false, which is what makes "one provider broken never fails Boss" a property of the
   * data rather than of a code path someone has to remember.
   */
  criticalToCore: boolean;
  detail: string;
}

/** What a probe and an outcome told us about one dependency. */
export interface CompatibilityObservation {
  id: string;
  axis: CompatibilityAxis;
  /** The probe's own words, e.g. a route or a version endpoint. */
  healthProbe: string;
  at: string;
  /** The version read by the probe, when the probe could read one. */
  contractVersion?: string | null;
  /** `true` when the probe or the last dispatch succeeded. */
  healthy: boolean;
  /** Why it did not, when it did not. */
  failure?: { class: FailureClass; detail: string };
  /** Whether the core cannot run without this dependency. Defaults to false. */
  criticalToCore?: boolean;
  /** The version the caller already knew to be good, carried forward when the probe cannot read one. */
  previousVersion?: string | null;
  /** An explicit action for this failure, overriding the class default. */
  fallback?: FallbackAction;
}

/**
 * The action a failure class implies when the caller does not state one.
 *
 * The mapping is the honest one per class rather than a uniform retry:
 *
 *  - a changed contract or page cannot be retried into working, so it reroutes or degrades;
 *  - auth needs the Owner, so it degrades and surfaces rather than burning attempts;
 *  - rate limiting and network trouble are transient, so they retry within bounds;
 *  - a timeout is transient but usually means the request was too big, so it reroutes;
 *  - a resource-exhaustion or unclassifiable failure has no safe automatic answer, so it refuses.
 */
export const FAILURE_FALLBACKS: Record<FailureClass, FallbackAction> = {
  CONTRACT_VERSION_CHANGED: "REROUTE",
  AUTH_EXPIRED: "DEGRADE",
  RATE_LIMITED: "RETRY_BOUNDED",
  PAGE_STRUCTURE_CHANGED: "REROUTE",
  NETWORK_UNREACHABLE: "RETRY_BOUNDED",
  RESOURCE_EXHAUSTED: "REFUSE",
  TOOL_TIMEOUT: "REROUTE",
  UNKNOWN: "REFUSE"
};

/** Why each class maps where it does, so the table is reviewable rather than memorised. */
export const FAILURE_CLASS_REASONS: Record<FailureClass, string> = {
  CONTRACT_VERSION_CHANGED: "the other side moved to a version we do not speak; no number of retries makes us speak it",
  AUTH_EXPIRED: "only the Owner can re-authenticate, so this surfaces rather than burns attempts",
  RATE_LIMITED: "transient by definition, and the other side told us when to come back",
  PAGE_STRUCTURE_CHANGED: "the page we drove is gone; the same work may still be possible elsewhere",
  NETWORK_UNREACHABLE: "usually transient, so it retries within bounds before anything is rerouted",
  RESOURCE_EXHAUSTED: "local exhaustion with no safe automatic answer, so it refuses rather than thrashing",
  TOOL_TIMEOUT: "often the request rather than the tool, so the same work is attempted elsewhere",
  UNKNOWN: "an unclassified failure has no defensible automatic answer, so it refuses"
};

/**
 * The core verdict, derived rather than supplied.
 *
 * A caller cannot set this. It is `FAILED` only when a dependency the core itself cannot run without
 * is unusable, which no provider, adapter or UI binding is.
 */
type CoreVerdict = "OPERATIONAL" | "DEGRADED" | "FAILED";

export interface CompatibilityVerdict {
  verdict: CoreVerdict;
  /** The entries that are not READY, so a report can show the surface without recomputing it. */
  degraded: string[];
  absent: string[];
  /** `criticalToCore` entries that are not READY. Only these can move the verdict past DEGRADED. */
  fatal: string[];
  reasons: string[];
}

/**
 * Decide the core verdict from the registry.
 *
 * `DEGRADED` is the expected state of a healthy system with something external broken; `FAILED` is
 * reserved for a dependency the core genuinely cannot run without. The distinction is the whole point
 * of Task C, so it lives here rather than in each caller's judgement.
 */
export function evaluateCompatibility(entries: readonly CompatibilityEntry[]): CompatibilityVerdict {
  const degraded = entries.filter((entry) => entry.status === "DEGRADED").map((entry) => entry.id).sort();
  const absent = entries.filter((entry) => entry.status === "ABSENT").map((entry) => entry.id).sort();
  const fatal = entries.filter((entry) => entry.status !== "READY" && entry.criticalToCore).map((entry) => entry.id).sort();
  const verdict: CoreVerdict = fatal.length > 0 ? "FAILED" : degraded.length + absent.length > 0 ? "DEGRADED" : "OPERATIONAL";
  const reasons: string[] = [];
  if (fatal.length > 0) reasons.push(`${fatal.length} dependency(ies) the core cannot run without are unusable: ${fatal.join(", ")}`);
  if (degraded.length > 0) reasons.push(`${degraded.length} external dependency(ies) degraded, which does not fail the core: ${degraded.join(", ")}`);
  if (absent.length > 0) reasons.push(`${absent.length} external dependency(ies) absent: ${absent.join(", ")}`);
  if (reasons.length === 0) reasons.push("every observed external dependency is ready");
  return { verdict, degraded, absent, fatal, reasons };
}

/**
 * Build or update one entry from an observation.
 *
 * `lastKnownGood` only ever moves to a version that was OBSERVED working, so a version read from a
 * broken page cannot become the baseline — a registry that trusted the failing side's own claim would
 * record the breakage as the good state.
 */
export function observeCompatibility(previous: CompatibilityEntry | undefined, observation: CompatibilityObservation): CompatibilityEntry {
  const criticalToCore = observation.criticalToCore ?? previous?.criticalToCore ?? false;
  const observedVersion = observation.contractVersion ?? previous?.contractVersion ?? null;
  const carriedLastGood = observation.previousVersion !== undefined ? observation.previousVersion : previous?.lastKnownGood ?? null;

  if (observation.healthy) {
    return {
      id: observation.id,
      axis: observation.axis,
      contractVersion: observedVersion,
      // A healthy observation is the only thing that may advance the baseline.
      lastKnownGood: observedVersion ?? carriedLastGood,
      healthProbe: observation.healthProbe,
      status: "READY",
      failureClass: null,
      degradedFallback: "DEGRADE",
      observedAt: observation.at,
      criticalToCore,
      detail: `probe reported ready${observedVersion ? ` at contract ${observedVersion}` : ""}`
    };
  }

  const failureClass = observation.failure?.class ?? "UNKNOWN";
  const fallback = observation.fallback ?? FAILURE_FALLBACKS[failureClass];
  // A failure with no observation at all is ABSENT; one that answered but badly is DEGRADED. The
  // scheduler treats those differently, so collapsing them would lose the distinction it needs.
  const status: CompatibilityStatus = failureClass === "NETWORK_UNREACHABLE" ? "ABSENT" : "DEGRADED";
  const detail = observation.failure?.detail ?? `probe failed with ${failureClass}`;
  return {
    id: observation.id,
    axis: observation.axis,
    contractVersion: observedVersion,
    lastKnownGood: carriedLastGood,
    healthProbe: observation.healthProbe,
    status,
    failureClass,
    degradedFallback: fallback,
    observedAt: observation.at,
    criticalToCore,
    detail: `${detail} (${FAILURE_CLASS_REASONS[failureClass]})`
  };
}

/** Reflect an installed version against what was last seen working. */
export function contractDrift(entry: CompatibilityEntry): { drifted: boolean; from: string | null; to: string | null; reason: string } {
  if (entry.contractVersion === null || entry.lastKnownGood === null) {
    return { drifted: false, from: entry.lastKnownGood, to: entry.contractVersion, reason: "no version pair to compare" };
  }
  const drifted = entry.contractVersion !== entry.lastKnownGood;
  return {
    drifted,
    from: entry.lastKnownGood,
    to: entry.contractVersion,
    reason: drifted
      ? `${entry.id} is at contract ${entry.contractVersion}, last known good was ${entry.lastKnownGood}`
      : `${entry.id} is at its last known good contract ${entry.contractVersion}`
  };
}

/** Where a caller should send work for an entry, given what else is available. */
export function rerouteTarget(entry: CompatibilityEntry, candidates: readonly string[], unavailable: readonly string[]): { target: string | null; reason: string } {
  if (entry.status === "READY") return { target: entry.id, reason: `${entry.id} is ready` };
  // REFUSE is honoured before any candidate is considered: a fallback that ignores a refusal is not a
  // refusal, and Task C's rollback rule is that an unclear route fails closed rather than sending work
  // to something whose permissions or capabilities may not match.
  if (entry.degradedFallback === "REFUSE") {
    return { target: null, reason: `${entry.id} failed with ${entry.failureClass}, which has no safe automatic fallback; the work is refused rather than misrouted` };
  }
  const blocked = new Set([...unavailable, entry.id]);
  const eligible = candidates.filter((candidate) => !blocked.has(candidate)).sort();
  if (eligible.length === 0) {
    return { target: null, reason: `${entry.id} is ${entry.status} and no alternative outside ${[...blocked].sort().join(", ")} exists` };
  }
  return { target: eligible[0], reason: `${entry.id} is ${entry.status} (${entry.failureClass}), so work moves to ${eligible[0]}` };
}

/** Assemble the registry, refusing a duplicate id rather than silently keeping the last write. */
export function buildCompatibilityRegistry(entries: readonly CompatibilityEntry[]): Map<string, CompatibilityEntry> {
  const registry = new Map<string, CompatibilityEntry>();
  for (const entry of entries) {
    if (registry.has(entry.id)) throw new Error(`duplicate compatibility entry for ${entry.id}; one external dependency has one record`);
    registry.set(entry.id, entry);
  }
  return registry;
}

/** A one-screen summary, so a report can show the surface without dumping every entry. */
export function summarizeCompatibility(entries: readonly CompatibilityEntry[]): string {
  const verdict = evaluateCompatibility(entries);
  const byAxis = new Map<CompatibilityAxis, number>();
  for (const entry of entries) byAxis.set(entry.axis, (byAxis.get(entry.axis) ?? 0) + 1);
  const axes = COMPATIBILITY_AXES.filter((axis) => byAxis.has(axis)).map((axis) => `${axis}=${byAxis.get(axis)}`).join(" ");
  return [
    `core ${verdict.verdict} over ${entries.length} external dependency(ies)${axes ? ` (${axes})` : ""}`,
    verdict.degraded.length > 0 ? `degraded: ${verdict.degraded.join(", ")}` : "nothing degraded",
    verdict.absent.length > 0 ? `absent: ${verdict.absent.join(", ")}` : "nothing absent",
    verdict.reasons.join("; ")
  ].join("\n");
}
