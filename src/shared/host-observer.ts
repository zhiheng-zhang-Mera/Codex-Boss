/**
 * Host-M P4 — Unified Observability (pure projection + contracts).
 *
 *   "Observer may observe; observer must not become controller."
 *
 * The observer is a read-only outer layer. It aggregates facts that already
 * exist in durable stores and in-memory registries, and it never writes,
 * mutates, reroutes, retries, pauses or repairs anything. Two properties are
 * enforced structurally rather than by convention:
 *
 * 1. This module is pure — no fs, no clock, no store imports (type-only). It can
 *    only shape what it is handed.
 * 2. Every dimension is collected independently. A source that throws degrades
 *    *its own* dimension and nothing else, and the degradation is reported in
 *    `degraded[]` rather than swallowed.
 *
 * Where a domain already has a dedicated aggregate (the 10.x/tenx fleet
 * aggregate), the raw aggregates are reported side by side instead of being
 * merged, because silently fusing two node/fleet stacks would invent a fact
 * neither store actually holds.
 */

export const HOST_OBSERVER_DIMENSIONS = [
  "nodes",
  "fleet",
  "tasks",
  "providers",
  "sessions",
  "routing",
  "learning",
  "failures"
] as const;
export type HostObserverDimension = (typeof HOST_OBSERVER_DIMENSIONS)[number];

/** Per-dimension collection outcome, so a partial snapshot is never silent. */
export type HostDimensionStatus = "OK" | "DEGRADED" | "UNAVAILABLE";

export interface HostDimensionReport {
  dimension: HostObserverDimension;
  status: HostDimensionStatus;
  /** Why the dimension is degraded/unavailable. Empty when status is OK. */
  reason?: string;
  /** How many raw records fed this dimension (0 is a fact, not a failure). */
  records: number;
}

export interface ObservedNode {
  nodeId: string;
  state: string;
  reason: string;
  updatedAt?: string;
}

export interface ObservedFleetNode {
  nodeId: string;
  state: string;
  /** Recomputed from the stored heartbeat, never trusted as a stored field. */
  derivedState: string;
  lastHeartbeatAt: number;
  heartbeatAgeMs: number;
  capabilities: string[];
}

export interface ObservedAssignment {
  taskId: string;
  state: string;
  nodeId?: string;
  attempts: number;
}

export interface ObservedTask {
  taskId: string;
  status: string;
  /** Whether a durable ledger record exists for this task. */
  hasLedger: boolean;
  ledgerMode?: string;
  degradationMode?: string;
  pendingSteps: number;
  completedSteps: number;
  failedJobs: number;
  waitingJobs: number;
  runningJobs: number;
  retries: number;
  modelCalls: number;
  activeProvider?: string | null;
}

export interface ObservedProvider {
  runtimeId: string;
  /** Circuit-breaker state as recorded. */
  circuit: string;
  consecutiveFailures: number;
  /** Runtime budget level as recorded. */
  budget: string;
  budgetSource?: string;
  eligible: boolean;
  availability?: string;
  healthMessage?: string;
  healthCheckedAt?: string;
}

export interface ObservedSession {
  providerId: string;
  account: string;
  state: string;
  lastSuccessAt?: string;
  lastFailureReason?: string;
  updatedAt: string;
  transitions: number;
}

export interface ObservedRoutingDecision {
  decisionId: string;
  taskId: string;
  policyVersion: string;
  selectedRuntimeId?: string;
  usedFallbackRouter: boolean;
  candidateCount: number;
  explorationEnabled?: boolean;
  recordedAt: string;
}

export interface ObservedLearningState {
  flags: Record<string, boolean>;
  episodes: number;
  revisions: number;
  profiles: number;
  concepts: number;
  epochs: number;
  snapshots: number;
  decisions: number;
  stablePolicyVersion: string;
  profileStale: boolean;
  /** Per-store self-reported corruption/uncertainty, kept verbatim. */
  degraded: string[];
}

export interface ObservedFailure {
  source:
    | "recovery-wakeup"
    | "telemetry"
    | "task-failure-history"
    | "intervention"
    | "store-degradation";
  taskId?: string;
  runtimeId?: string;
  kind: string;
  detail: string;
  at?: string;
}

/**
 * Raw reads, exactly as the stores returned them. `collect` fills this in; the
 * projection below never re-reads storage.
 */
export interface HostObserverInput {
  now?: () => string;
  nodes?: ObservedNode[];
  tenxFleetAggregate?: Record<string, unknown>;
  fleetNodes?: ObservedFleetNode[];
  assignments?: ObservedAssignment[];
  tasks?: ObservedTask[];
  providers?: ObservedProvider[];
  sessions?: ObservedSession[];
  routing?: ObservedRoutingDecision[];
  learning?: ObservedLearningState;
  failures?: ObservedFailure[];
  dimensions?: HostDimensionReport[];
  degraded?: string[];
  historySize?: number;
}

export interface HostObserverCounts {
  nodes: { total: number; ready: number; degraded: number; offline: number; failed: number };
  fleet: { total: number; ready: number; degraded: number; offline: number; failed: number };
  tasks: {
    total: number;
    queued: number;
    running: number;
    waiting: number;
    paused: number;
    failed: number;
    completed: number;
    cancelled: number;
    withoutLedger: number;
    degraded: number;
  };
  providers: { total: number; eligible: number; circuitOpen: number; budgetLow: number; budgetExhausted: number };
  sessions: { total: number; loggedIn: number; expired: number; reauthRequired: number; failed: number; unknown: number };
  routing: { decisions: number; fallbackDecisions: number; explorationDecisions: number };
  learning: { flagsOn: number; degradedStores: number };
  failures: { total: number; bySource: Record<string, number> };
}

export interface HostObserverSnapshot {
  schemaVersion: 1;
  kind: "HOST_OBSERVER_SNAPSHOT";
  /** Always read-only — declared so a consumer cannot mistake this for control. */
  mode: "READ_ONLY";
  generatedAt: string;
  counts: HostObserverCounts;
  dimensions: HostDimensionReport[];
  nodes: ObservedNode[];
  fleetNodes: ObservedFleetNode[];
  assignments: ObservedAssignment[];
  tasks: ObservedTask[];
  providers: ObservedProvider[];
  sessions: ObservedSession[];
  recentRouting: ObservedRoutingDecision[];
  recentFailures: ObservedFailure[];
  learning?: ObservedLearningState;
  /** Raw 10.x aggregate, reported as-is rather than merged into the counts. */
  tenxFleetAggregate?: Record<string, unknown>;
  degraded: string[];
  historySize: number;
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function limited<T>(values: readonly T[] | undefined, limit: number): T[] {
  if (!values?.length) return [];
  return values.slice(0, limit);
}

/** Most recent N by an ISO timestamp field, newest first; stable on ties. */
export function mostRecent<T>(values: readonly T[] | undefined, timestampOf: (value: T) => string | undefined, limit: number): T[] {
  if (!values?.length) return [];
  return [...values]
    .map((value, index) => ({ value, index, at: timestampOf(value) ?? "" }))
    .sort((left, right) => right.at.localeCompare(left.at) || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.value);
}

export interface HostObserverProjectionOptions {
  /** How many recent routing decisions / failures to carry. */
  recentLimit?: number;
}

export function projectHostObserver(
  input: HostObserverInput,
  options: HostObserverProjectionOptions = {}
): HostObserverSnapshot {
  const recentLimit = options.recentLimit ?? 20;
  const now = input.now?.() ?? new Date(0).toISOString();

  const nodes = input.nodes ?? [];
  const fleetNodes = input.fleetNodes ?? [];
  const tasks = input.tasks ?? [];
  const providers = input.providers ?? [];
  const sessions = input.sessions ?? [];
  const routing = input.routing ?? [];
  const failures = input.failures ?? [];

  const nodeStates = countBy(nodes.map((node) => node.state));
  const fleetStates = countBy(fleetNodes.map((node) => node.derivedState));
  const taskStates = countBy(tasks.map((task) => task.status));
  const sessionStates = countBy(sessions.map((session) => session.state));

  const recentRouting = mostRecent(routing, (decision) => decision.recordedAt, recentLimit);
  const recentFailures = mostRecent(failures, (failure) => failure.at, recentLimit);

  return {
    schemaVersion: 1,
    kind: "HOST_OBSERVER_SNAPSHOT",
    mode: "READ_ONLY",
    generatedAt: now,
    counts: {
      nodes: {
        total: nodes.length,
        ready: nodeStates.READY ?? 0,
        degraded: nodeStates.DEGRADED ?? 0,
        offline: nodeStates.OFFLINE ?? 0,
        failed: nodeStates.FAILED ?? 0
      },
      fleet: {
        total: fleetNodes.length,
        ready: fleetStates.READY ?? 0,
        degraded: fleetStates.DEGRADED ?? 0,
        offline: fleetStates.OFFLINE ?? 0,
        failed: fleetStates.FAILED ?? 0
      },
      tasks: {
        total: tasks.length,
        queued: taskStates.queued ?? 0,
        running: taskStates.running ?? 0,
        waiting: taskStates.waiting ?? 0,
        paused: taskStates.paused ?? 0,
        failed: taskStates.failed ?? 0,
        completed: taskStates.completed ?? 0,
        cancelled: taskStates.cancelled ?? 0,
        withoutLedger: tasks.filter((task) => !task.hasLedger).length,
        degraded: tasks.filter((task) => task.degradationMode && task.degradationMode !== "FULL" && task.degradationMode !== "NORMAL").length
      },
      providers: {
        total: providers.length,
        eligible: providers.filter((provider) => provider.eligible).length,
        circuitOpen: providers.filter((provider) => provider.circuit === "OPEN").length,
        budgetLow: providers.filter((provider) => provider.budget === "LOW").length,
        budgetExhausted: providers.filter((provider) => provider.budget === "EXHAUSTED").length
      },
      sessions: {
        total: sessions.length,
        loggedIn: sessionStates.LOGGED_IN ?? 0,
        expired: sessionStates.EXPIRED ?? 0,
        reauthRequired: sessionStates.REAUTH_REQUIRED ?? 0,
        failed: sessionStates.FAILED ?? 0,
        unknown: sessionStates.UNKNOWN ?? 0
      },
      routing: {
        decisions: routing.length,
        fallbackDecisions: routing.filter((decision) => decision.usedFallbackRouter).length,
        explorationDecisions: routing.filter((decision) => decision.explorationEnabled === true).length
      },
      learning: {
        flagsOn: Object.values(input.learning?.flags ?? {}).filter((value) => value === true).length,
        degradedStores: input.learning?.degraded.length ?? 0
      },
      failures: {
        total: failures.length,
        bySource: countBy(failures.map((failure) => failure.source))
      }
    },
    dimensions: input.dimensions ?? [],
    nodes,
    fleetNodes,
    assignments: input.assignments ?? [],
    tasks,
    providers,
    sessions,
    recentRouting,
    recentFailures,
    learning: input.learning,
    tenxFleetAggregate: input.tenxFleetAggregate,
    degraded: input.degraded ?? [],
    historySize: input.historySize ?? 0
  };
}

/**
 * A dimension is OK only when it was collected AND the source reported no
 * uncertainty. Missing dimensions are UNAVAILABLE, so an absent store can never
 * look like a healthy empty one.
 */
export function dimensionReport(
  dimension: HostObserverDimension,
  status: HostDimensionStatus,
  records: number,
  reason?: string
): HostDimensionReport {
  return { dimension, status, records, reason: status === "OK" ? undefined : reason };
}

export function summarizeHostSnapshot(snapshot: HostObserverSnapshot): string {
  const unavailable = snapshot.dimensions.filter((entry) => entry.status === "UNAVAILABLE").map((entry) => entry.dimension);
  const degraded = snapshot.dimensions.filter((entry) => entry.status === "DEGRADED").map((entry) => entry.dimension);
  const parts = [
    `tasks ${snapshot.counts.tasks.running} running / ${snapshot.counts.tasks.total} total`,
    `providers ${snapshot.counts.providers.eligible}/${snapshot.counts.providers.total} eligible`,
    `fleet ${snapshot.counts.fleet.ready}/${snapshot.counts.fleet.total} ready`,
    `sessions ${snapshot.counts.sessions.loggedIn}/${snapshot.counts.sessions.total} logged in`,
    `failures ${snapshot.counts.failures.total}`
  ];
  if (degraded.length) parts.push(`degraded dimensions: ${degraded.join(",")}`);
  if (unavailable.length) parts.push(`unavailable dimensions: ${unavailable.join(",")}`);
  return parts.join("; ");
}
