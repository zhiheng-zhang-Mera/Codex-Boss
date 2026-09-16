/**
 * The external compatibility registry, observed from the real runtime plane (Phase 05, Task C).
 *
 * `src/shared/external-compatibility.ts` holds the model and the decisions. This module is what fills
 * it in from what the application actually has: the registered runtimes, their probes, and the circuit
 * breaker's view of what has been failing.
 *
 * The point of doing it here rather than in the renderer or a report script is that the guarantee Task
 * C asks for is about the RUNNING system — one provider degraded, the core still operational, the
 * scheduler still able to route. A registry computed for a report could say anything; this one is
 * derived from the same registry the scheduler dispatches through.
 */

import { CircuitBreaker } from "../commander/circuit-breaker";
import type { RuntimeRegistry } from "../commander/runtime-registry";
import { isRuntimeAvailable, type RuntimeAdapter, type RuntimeAvailability } from "../runtimes/runtime";
import {
  observeCompatibility,
  type CompatibilityAxis,
  type CompatibilityEntry,
  type FailureClass
} from "../../src/shared/external-compatibility";

/** Runtimes are the external dependency the application drives; this is their axis. */
const RUNTIME_AXIS: CompatibilityAxis = "runtime";

/**
 * Map a runtime's availability onto a failure class.
 *
 * The mapping is the honest reading of each state rather than a default:
 *
 *  - `AVAILABLE`/`BUSY` are working states, so they carry no failure;
 *  - `AUTH_REQUIRED`/`USER_ACTION_REQUIRED` need the Owner, which is what `AUTH_EXPIRED` means here;
 *  - `PAGE_CHANGED` is the provider's UI moving under us;
 *  - `RATE_LIMITED`/`BUDGET_EXHAUSTED` are the other side, or our budget, saying not now;
 *  - `DOWN`/`UNSUPPORTED`/`UNKNOWN` have no more specific reading available, and `UNKNOWN` maps to the
 *    `UNKNOWN` class deliberately: an unclassified failure routes to a refusal rather than to a guess.
 */
export function failureClassOf(availability: RuntimeAvailability): FailureClass | null {
  switch (availability) {
    case "AVAILABLE":
    case "BUSY":
      return null;
    case "AUTH_REQUIRED":
    case "USER_ACTION_REQUIRED":
      return "AUTH_EXPIRED";
    case "RATE_LIMITED":
    case "BUDGET_EXHAUSTED":
      return "RATE_LIMITED";
    case "PAGE_CHANGED":
      return "PAGE_STRUCTURE_CHANGED";
    case "DOWN":
      return "NETWORK_UNREACHABLE";
    case "UNSUPPORTED":
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

/** The contract version an adapter declares, when it declares one. */
function contractVersionOf(runtime: RuntimeAdapter): string | null {
  const declaration = runtime.compatibility;
  if (!declaration) return null;
  const windows = Object.values(declaration.windows ?? {}).filter((window): window is { min: string; max: string } => Boolean(window));
  return windows.length > 0 ? windows.map((window) => `${window.min}..${window.max}`).join(",") : null;
}

interface RuntimeCompatibilityInput {
  registry: RuntimeRegistry;
  /** Optional: a runtime with an OPEN circuit is degraded whatever its last probe said. */
  breaker?: CircuitBreaker;
  at: string;
  /** Entries from a previous observation, so `lastKnownGood` accumulates rather than resetting. */
  previous?: ReadonlyMap<string, CompatibilityEntry>;
}

/**
 * Observe every registered runtime and return one compatibility entry per runtime.
 *
 * The registry is NOT probed here: `RuntimeRegistry.refreshHealth` is the only thing that talks to an
 * adapter, and calling it twice per observation would double the cost of every health sweep. Callers
 * refresh first and observe after, which is also what makes the observation reproducible from a
 * recorded health set.
 */
export function observeRuntimeCompatibility(input: RuntimeCompatibilityInput): CompatibilityEntry[] {
  const entries: CompatibilityEntry[] = [];
  for (const runtime of input.registry.list().sort((left, right) => (left.id < right.id ? -1 : 1))) {
    const health = input.registry.getHealth(runtime.id);
    const availability: RuntimeAvailability = health?.availability ?? "DOWN";
    const circuit = input.breaker?.state(runtime.id);
    const circuitOpen = circuit === "OPEN";
    const healthy = isRuntimeAvailable(availability) && !circuitOpen;
    // An OPEN circuit means the provider failed the provider-technical threshold repeatedly, which is a
    // transport-level problem rather than an unreadable state. Attributing `UNKNOWN` here would refuse
    // the work — the right answer for a state we cannot classify, and the WRONG answer for a provider
    // that keeps timing out while a healthy alternative exists.
    const failureClass: FailureClass | null = healthy
      ? null
      : (circuitOpen && isRuntimeAvailable(availability) ? "TOOL_TIMEOUT" : failureClassOf(availability) ?? "UNKNOWN");
    const previous = input.previous?.get(runtime.id);
    const version = contractVersionOf(runtime);

    const base = observeCompatibility(previous, {
      id: runtime.id,
      axis: RUNTIME_AXIS,
      healthProbe: `runtime:${runtime.kind} healthCheck`,
      at: health?.checkedAt ?? input.at,
      contractVersion: version,
      healthy,
      ...(failureClass === null
        ? {}
        : {
            failure: {
              class: failureClass,
              detail: circuitOpen
                ? `${runtime.id} answered ${availability} but its circuit is open after repeated provider-technical failures`
                : `${runtime.id} answered ${availability}: ${health?.message ?? "no health reading yet"}`
            }
          }),
      previousVersion: previous?.lastKnownGood ?? null,
      // No runtime is something the core cannot run without: Boss is alive with every provider down,
      // which is exactly the property the book asks this phase to prove.
      criticalToCore: false
    });
    entries.push(base);
  }
  return entries;
}

/** Runtime ids that cannot currently carry work, for a caller deciding where to send it. */
export function unavailableRuntimes(input: { registry: RuntimeRegistry; breaker?: CircuitBreaker }): string[] {
  return input.registry.list()
    .filter((runtime) => {
      const availability = input.registry.getHealth(runtime.id)?.availability ?? "DOWN";
      return !isRuntimeAvailable(availability) || input.breaker?.isOpen(runtime.id) === true;
    })
    .map((runtime) => runtime.id)
    .sort();
}
