/**
 * Host-M P2 — Failure Injection Lab (pure contract).
 *
 *   "Test the system's failures, do not restructure the system."
 *
 * The lab injects a fault into a *throwaway copy* of a subsystem, observes what
 * the real code does, then asserts three things and records all three:
 *
 * 1. **Injected** — the fault really took hold (a DOM selector genuinely changed,
 *    a file genuinely became a directory). Without this an injector that silently
 *    did nothing would look like a pass.
 * 2. **Detected** — the real code noticed, in the documented way (a degraded
 *    reason, a failed health check, a thrown-and-caught error). A fault the
 *    system ignores is a finding, not a success.
 * 3. **Contained** — the system stayed usable and left nothing behind: the
 *    failure did not corrupt other state and the lab cleaned up after itself.
 *
 * A fault may legitimately end in `ACCEPTED_DEGRADATION` (the system correctly
 * reports it cannot proceed) or `CONTAINED` (the system recovered). What it may
 * never do is pass because nothing was checked: a fault whose injector or
 * observer never ran is `NOT_INJECTED`, and a fault the system did not notice at
 * all is `UNCONTAINED` and is reported as a failure of the lab run.
 *
 * This module is pure. The injectors themselves live in
 * `electron/host/fault-lab.ts` and are unit-tested against the real subsystems.
 */

export const FAULT_CLASSES = [
  "provider-unavailable",
  "dom-selector-changed",
  "login-expired",
  "network-timeout",
  "proxy-unavailable",
  "node-dropout",
  "disk-unavailable",
  "malformed-persistence",
  "corrupted-cache",
  "worker-crash",
  "partial-task-completion",
  "stale-heartbeat",
  "knowledge-sync-failure"
] as const;
export type FaultClass = (typeof FAULT_CLASSES)[number];

/** How the lab must treat the injected fault. */
export type FaultExpectation =
  /** The system must keep working (possibly in a reduced mode). */
  | "CONTINUE"
  /** The system must refuse to proceed and say why, without corrupting anything. */
  | "REFUSE_CLEANLY"
  /** Either is acceptable; the classification is recorded. */
  | "EITHER";

export type FaultVerdict =
  /** The fault took hold, was detected, and the system stayed usable. */
  | "CONTAINED"
  /** The fault took hold and the system correctly reported it could not proceed. */
  | "ACCEPTED_DEGRADATION"
  /** The injector or observer never ran — nothing was proven. */
  | "NOT_INJECTED"
  /** The fault took hold and the system did not notice it. */
  | "UNDETECTED"
  /** The fault took hold and damaged something beyond itself. */
  | "UNCONTAINED";

export interface FaultDefinition {
  id: string;
  fault: FaultClass;
  label: string;
  expectation: FaultExpectation;
  /** The subsystem the injector touches, for the report table. */
  target: string;
  /** What "detected" means for this fault, so evidence is self-describing. */
  detection: string;
  /** How the lab proves nothing was left behind. */
  containment: string;
  /** Faults whose effect cannot be observed without a live GUI are declared so. */
  requiresLive?: boolean;
  liveReason?: string;
}

export interface FaultStep {
  step: "inject" | "observe" | "contain";
  ok: boolean;
  detail: string;
}

export interface FaultResult {
  id: string;
  fault: FaultClass;
  label: string;
  verdict: FaultVerdict;
  injected: boolean;
  detected: boolean;
  contained: boolean;
  /** Non-empty for every verdict other than a clean CONTAINED / ACCEPTED_DEGRADATION. */
  detail: string;
  steps: FaultStep[];
  durationMs: number;
}

export interface FaultLabReport {
  schemaVersion: 1;
  kind: "HOST_FAULT_LAB";
  generatedAt: string;
  results: FaultResult[];
  summary: {
    contained: number;
    acceptedDegradation: number;
    notInjected: number;
    undetected: number;
    uncontained: number;
    total: number;
  };
  /** FAIL whenever anything was not injected, undetected or uncontained. */
  overall: "PASS" | "FAIL" | "BLOCKED_EXTERNAL";
  verdictReason: string;
}

export function faultDefinition(id: string, definitions: readonly FaultDefinition[] = FAULT_DEFINITIONS): FaultDefinition {
  const found = definitions.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown fault: ${id}`);
  return found;
}

/**
 * The declared coverage set: exactly the thirteen classes the plan names.
 *
 * `detection` and `containment` are requirements, not documentation — the
 * injector has to satisfy them or the fault is reported as a failure.
 */
export const FAULT_DEFINITIONS: readonly FaultDefinition[] = [
  {
    id: "provider-unavailable",
    fault: "provider-unavailable",
    label: "provider unavailable",
    expectation: "CONTINUE",
    target: "BudgetManager + CircuitBreaker + RoleRouter",
    detection: "the runtime is no longer eligible and the circuit opens for it",
    containment: "a healthy runtime is still selectable and nothing is persisted for it"
  },
  {
    id: "dom-selector-changed",
    fault: "dom-selector-changed",
    label: "DOM selector changed",
    expectation: "REFUSE_CLEANLY",
    target: "provider DOM surface",
    detection: "the change is reported as a page/selector change rather than as a silent success",
    containment: "the reader fails instead of inventing content, and the probe stays read-only"
  },
  {
    id: "login-expired",
    fault: "login-expired",
    label: "login expired",
    expectation: "REFUSE_CLEANLY",
    target: "SessionLifecycleLedger + login scan",
    detection: "the session reads as EXPIRED and the login scan requires login",
    containment: "the transition is legal per the lifecycle table and the ledger stays readable"
  },
  {
    id: "network-timeout",
    fault: "network-timeout",
    label: "network timeout",
    expectation: "CONTINUE",
    target: "network policy probe",
    detection: "the probe reports offline/degraded rather than reachable",
    containment: "the probe result is a value, not a throw, and no state is written"
  },
  {
    id: "proxy-unavailable",
    fault: "proxy-unavailable",
    label: "proxy unavailable",
    expectation: "CONTINUE",
    target: "network policy routing",
    detection: "the route degrades instead of claiming a proxy path",
    containment: "routing still returns a decision and the matrix is untouched"
  },
  {
    id: "node-dropout",
    fault: "node-dropout",
    label: "node dropout",
    expectation: "CONTINUE",
    target: "FederationCoordinator",
    detection: "the node is re-derived as OFFLINE and its assignment is moved",
    containment: "the coordinator stays readable and recovery restores the node"
  },
  {
    id: "disk-unavailable",
    fault: "disk-unavailable",
    label: "disk unavailable",
    expectation: "REFUSE_CLEANLY",
    target: "durable ledger write path",
    detection: "the write fails loudly instead of silently dropping the checkpoint",
    containment: "the previous generation is still readable after the failure"
  },
  {
    id: "malformed-persistence",
    fault: "malformed-persistence",
    label: "malformed persistence",
    expectation: "REFUSE_CLEANLY",
    target: "durable store readers",
    detection: "the store reports the file as unreadable rather than reading it as empty",
    containment: "the corrupt file is left byte-identical (readers never repair in place)"
  },
  {
    id: "corrupted-cache",
    fault: "corrupted-cache",
    label: "corrupted cache",
    expectation: "CONTINUE",
    target: "learning episode store",
    detection: "the degraded reason names the unreadable row",
    containment: "valid rows before and after the corrupt one are still returned"
  },
  {
    id: "worker-crash",
    fault: "worker-crash",
    label: "worker crash",
    expectation: "CONTINUE",
    target: "CircuitBreaker + runtime health",
    detection: "the crash is classified as a technical interruption",
    containment: "a half-open probe is still admitted once the cooldown passes"
  },
  {
    id: "partial-task-completion",
    fault: "partial-task-completion",
    label: "partial task completion",
    expectation: "CONTINUE",
    target: "TaskLedger checkpointing",
    detection: "the unfinished job is readable as WAITING rather than COMPLETED",
    containment: "a reload reproduces the same partial record exactly"
  },
  {
    id: "stale-heartbeat",
    fault: "stale-heartbeat",
    label: "stale heartbeat",
    expectation: "CONTINUE",
    target: "fleet node state derivation",
    detection: "the node re-derives to DEGRADED then OFFLINE purely from heartbeat age",
    containment: "the stored record is not mutated by the read"
  },
  {
    id: "knowledge-sync-failure",
    fault: "knowledge-sync-failure",
    label: "knowledge sync failure",
    expectation: "CONTINUE",
    target: "knowledge governance",
    detection: "the failed sync lowers trust / marks the record rather than promoting it",
    containment: "the record stays readable and local work is not blocked"
  }
] as const;

export function emptyFaultSummary(): FaultLabReport["summary"] {
  return { contained: 0, acceptedDegradation: 0, notInjected: 0, undetected: 0, uncontained: 0, total: 0 };
}

export function summarizeFaults(results: readonly FaultResult[]): FaultLabReport["summary"] {
  const summary = emptyFaultSummary();
  for (const result of results) {
    summary.total += 1;
    if (result.verdict === "CONTAINED") summary.contained += 1;
    else if (result.verdict === "ACCEPTED_DEGRADATION") summary.acceptedDegradation += 1;
    else if (result.verdict === "NOT_INJECTED") summary.notInjected += 1;
    else if (result.verdict === "UNDETECTED") summary.undetected += 1;
    else summary.uncontained += 1;
  }
  return summary;
}

/**
 * Classifies a fault run. Deliberately ordered so the most serious condition
 * wins: nothing proven beats a missed fault beats a contained one.
 */
export function classifyFault(input: {
  definition: FaultDefinition;
  injected: boolean;
  detected: boolean;
  contained: boolean;
  /** True when the system reported it could not proceed. */
  refused: boolean;
  /** A fault that damaged something beyond itself. */
  damaged: boolean;
}): FaultVerdict {
  if (!input.injected) return "NOT_INJECTED";
  if (input.damaged || !input.contained) return "UNCONTAINED";
  if (!input.detected) return "UNDETECTED";
  if (input.refused) {
    // Refusing is only acceptable when the plan says it may refuse, or when the
    // fault legitimately makes work impossible.
    return input.definition.expectation === "CONTINUE" ? "UNCONTAINED" : "ACCEPTED_DEGRADATION";
  }
  return "CONTAINED";
}

export function buildFaultLabReport(input: { results: FaultResult[]; generatedAt: string }): FaultLabReport {
  const summary = summarizeFaults(input.results);
  const failing = summary.notInjected + summary.undetected + summary.uncontained;
  const overall: FaultLabReport["overall"] = failing === 0 ? "PASS" : "FAIL";
  const parts = [
    `${summary.contained} CONTAINED`,
    `${summary.acceptedDegradation} ACCEPTED_DEGRADATION`
  ];
  if (summary.notInjected) parts.push(`${summary.notInjected} NOT_INJECTED`);
  if (summary.undetected) parts.push(`${summary.undetected} UNDETECTED`);
  if (summary.uncontained) parts.push(`${summary.uncontained} UNCONTAINED`);
  return {
    schemaVersion: 1,
    kind: "HOST_FAULT_LAB",
    generatedAt: input.generatedAt,
    results: input.results,
    summary,
    overall,
    verdictReason: `${overall}: ${parts.join(", ")} of ${summary.total}`
  };
}

export function renderFaultLabReport(report: FaultLabReport): string {
  const width = Math.max(...report.results.map((result) => result.id.length), 6);
  const lines = report.results.map((result) => {
    const detail = result.detail ? `  ${result.detail}` : "";
    return `${result.verdict.padEnd(21)} ${result.id.padEnd(width)} ${Math.round(result.durationMs)}ms${detail}`;
  });
  return [
    `Host-M failure injection lab — ${report.overall}`,
    `verdict: ${report.verdictReason}`,
    "",
    ...lines
  ].join("\n");
}
