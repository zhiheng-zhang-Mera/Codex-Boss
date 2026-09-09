/**
 * R43 Phase B (R-201): web-AI action readiness gate (pure + shareable).
 *
 * Before any high-risk browser action (click / type / submit) a worker must
 * prove the page is ready along an ordered chain:
 *
 *   navigation accepted → DOM ready → target exists → visible → enabled →
 *   stable for a bounded interval → action allowed
 *
 * After the action the executor must verify the expected page/DOM/message
 * state changed; otherwise it falls into bounded retry → selector refresh →
 * alternate strategy (never an unbounded repeat of the same action). This
 * module is the deterministic decision core; the DOM executor triggers the
 * probe scripts and applies the verdicts (see backends/dom-page.ts).
 */

export type ReadinessGate =
  | "NAVIGATION_ACCEPTED"
  | "DOM_READY"
  | "TARGET_EXISTS"
  | "TARGET_VISIBLE"
  | "TARGET_ENABLED"
  | "TARGET_STABLE"
  | "ACTION_ALLOWED";

export const READINESS_GATES: readonly ReadinessGate[] = [
  "NAVIGATION_ACCEPTED",
  "DOM_READY",
  "TARGET_EXISTS",
  "TARGET_VISIBLE",
  "TARGET_ENABLED",
  "TARGET_STABLE",
  "ACTION_ALLOWED"
];

export interface ReadinessProbeFacts {
  /** document.readyState observed in the page. */
  readyState?: string;
  /** The target element exists in the DOM. */
  found?: boolean;
  /** The target occupies visible layout (not display:none / visibility:hidden / zero-size). */
  visible?: boolean;
  /** The target is not a disabled form control. */
  enabled?: boolean;
  /** Optional: navigation observation (only blocks on an explicit rejection). */
  navigationAccepted?: boolean;
  /** Count of consecutive stable samples observed (bounded interval). */
  stableSamples?: number;
}

export interface ReadinessVerdict {
  ready: boolean;
  /** Ordered list of gates that failed (empty when ready). */
  blockers: ReadinessGate[];
  observed: ReadinessProbeFacts;
}

function gateFailed(facts: ReadinessProbeFacts, gate: ReadinessGate): boolean {
  switch (gate) {
    case "NAVIGATION_ACCEPTED":
      return facts.navigationAccepted === false; // explicit rejection blocks; absent = unknown/pass
    case "DOM_READY":
      return facts.readyState !== undefined && facts.readyState !== "complete";
    case "TARGET_EXISTS":
      return facts.found === false;
    case "TARGET_VISIBLE":
      return facts.visible === false;
    case "TARGET_ENABLED":
      return facts.enabled === false;
    case "TARGET_STABLE":
      return facts.stableSamples !== undefined && facts.stableSamples < 1;
    case "ACTION_ALLOWED":
      return false; // permission decisions are the executor's gate; default allowed
  }
}

/**
 * Decides readiness from one probe sample. A gate only blocks when the probe
 * actually reports a failing fact for it (absence of the fact is treated as
 * "unknown ⇒ pass", which keeps deterministic fakes compatible while real page
 * probes carry full facts).
 */
export function readinessFromProbe(facts: ReadinessProbeFacts): ReadinessVerdict {
  const blockers = READINESS_GATES.filter((gate) => gateFailed(facts, gate));
  return { ready: blockers.length === 0, blockers, observed: facts };
}

/** Post-action verification: the observed state must confirm the expected change. */
export function postActionVerified(observed: { changed?: boolean; expected?: string; text?: string }): boolean {
  if (observed.changed !== undefined) return observed.changed === true;
  if (observed.expected !== undefined) return observed.text !== undefined && observed.text.includes(observed.expected);
  return false; // no evidence of change ⇒ NOT verified (never assume)
}

export type RetryVerdict = "BOUNDED_RETRY" | "SELECTOR_REFRESH" | "ALTERNATE_STRATEGY" | "FAILED";

/** Bounded escalation after a failed/unverified action. */
export function escalationAfterFailure(attempts: number, maxBoundedRetries: number): RetryVerdict {
  if (attempts < maxBoundedRetries) return "BOUNDED_RETRY";
  if (attempts < maxBoundedRetries + 1) return "SELECTOR_REFRESH";
  return "ALTERNATE_STRATEGY";
}
