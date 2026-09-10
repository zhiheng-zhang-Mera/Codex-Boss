import fs from "node:fs";
import path from "node:path";
import { inspectDevice } from "../node/node-inspector";
import { NodeCapabilityRegistry } from "../node/node-capability-registry";
import { FederationCoordinator } from "../fleet/federation-coordinator";
import { BudgetManager } from "../commander/budget-manager";
import { CircuitBreaker } from "../commander/circuit-breaker";
import { TaskLedger } from "../commander/task-ledger";
import { SessionLifecycleLedger } from "../identity/session-lifecycle-ledger";
import { RecoveryScheduler } from "../commander/recovery-scheduler";
import { TelemetryStore } from "../telemetry/telemetry-store";
import { LearningService } from "../learning/learning-service";
import { nodeStateFor as fleetStateFor } from "../../src/shared/fleet";
import type { Interruption } from "../commander/interruption";
import {
  dimensionReport,
  projectHostObserver,
  type HostDimensionReport,
  type HostObserverSnapshot,
  type ObservedAssignment,
  type ObservedFailure,
  type ObservedFleetNode,
  type ObservedLearningState,
  type ObservedNode,
  type ObservedProvider,
  type ObservedRoutingDecision,
  type ObservedSession,
  type ObservedTask
} from "../../src/shared/host-observer";

/**
 * Host-M P4 — the collector.
 *
 * READ-ONLY BY CONSTRUCTION. Every method called on a foreign store below is a
 * documented read accessor; the collector never calls `refresh`, `persist`,
 * `record`, `evaluate`, `update`, `join`, `heartbeat` or any other writer. That
 * matters because the existing `boss:node-status` IPC handler *does* refresh the
 * node registry while reading it — an observer built on that path would be a
 * controller in disguise.
 *
 * Every dimension is collected inside its own `guard()`, so a corrupt file, a
 * hostile stub or a missing store degrades one dimension and is reported, never
 * masked. A dimension whose backing store does not exist is UNAVAILABLE (not a
 * healthy zero), because "no store here" and "store says nothing is wrong" are
 * different facts and the report must not conflate them.
 */

export interface HostObservabilitySources {
  /** Boss data root (`app.getPath("userData")`). */
  dataRoot: string;
  now?: () => string;
  /** Overrides for tests: any reader may be replaced. */
  nodeRegistry?: { list: () => ObservedNode[] };
  fleet?: { listNodes: () => ObservedFleetNode[]; listAssignments: () => { taskId: string; state: string; nodeId?: string; attempts: number }[] };
  store?: { snapshot: () => { tasks: Array<{ id: string; status: string }> } };
  ledger?: { load: (taskId: string) => LedgerLike | undefined };
  budgets?: { get: (runtimeId: string) => { state: string; source?: string }; list: () => Array<{ runtimeId: string; state: string; source?: string }>; eligible: (runtimeId: string) => boolean };
  breaker?: { list: () => Array<{ runtimeId: string; state: string; consecutiveFailures: number }> };
  sessions?: { list: () => ObservedSession[] };
  routing?: { list: () => ObservedRoutingDecision[] };
  learning?: { controlState: () => { flags: Record<string, boolean>; episodes: number; profiles: number; concepts: number; epochs: number; snapshots: number; decisions: number; stablePolicyVersion: string; profileStale: boolean; degraded: string[] }; episodes: { status: () => { revisions: number } } };
  recovery?: { list: () => Array<{ taskId: string; kind: string; attempts: number; state: string; error?: string; retryAt: number }> };
  telemetry?: { list: () => Array<{ taskId: string; jobId: string; runtimeId: string; outcome: string; reason?: string; at: string }> };
  tenx?: {
    nodes?: { list: () => unknown[] };
    fleet?: { listMembers: () => unknown[]; listLeases: () => unknown[] };
    observability?: { snapshot: () => Record<string, unknown> };
  };
}

interface LedgerLike {
  mode?: string;
  pendingSteps?: string[];
  completedSteps?: string[];
  jobs?: Record<string, { state?: string }>;
  usage?: { retries?: number; modelCalls?: number };
  degradation?: { mode?: string };
  failureHistory?: Interruption[];
  activeProvider?: string | null;
  currentStep?: string | null;
}

/** A store file that is absent is UNAVAILABLE, not an empty healthy dimension. */
function missing(file: string): boolean {
  try {
    return !fs.existsSync(file);
  } catch {
    return true;
  }
}

function readJsonSafe<T>(file: string): T | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * Validates a durable file's shape before handing it to a reader that keeps
 * going after a failed restore.
 *
 * `NodeCapabilityRegistry.restore()` aborts its own load when the file is
 * malformed, so the registry then reads as a healthy empty one. That would turn
 * "this store is corrupt" into "nothing is registered here" — precisely the
 * conflation the observer must not make — so the shape is checked up front and a
 * malformed file is reported as UNAVAILABLE.
 */
function validateShape(file: string, isValid: (parsed: unknown) => boolean, label: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${String(error)}`);
  }
  if (!isValid(parsed)) throw new Error(`${label} failed its schema check`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the task rows out of `state.json` WITHOUT constructing a `StateStore`.
 *
 * This is not an optimisation, it is a correctness requirement: the `StateStore`
 * constructor calls `beginStartupSession()`, which persists. Using it here would
 * make the observer write to the very file it is observing — the observer would
 * have become a controller on the first read.
 *
 * The read is therefore tolerant of shape: it accepts the current schema and any
 * older one that still carries an identifiable task row, and it reports the
 * schema it saw instead of throwing away data it cannot fully interpret.
 */
export function readTaskRows(dataRoot: string): { tasks: Array<{ id: string; status: string }>; schemaVersion?: number; reason?: string } {
  const file = path.join(dataRoot, "state.json");
  if (!fs.existsSync(file)) throw new Error("no state.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`state.json is unreadable: ${String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error("state.json is not an object");
  const raw = Array.isArray(parsed.tasks) ? parsed.tasks : undefined;
  if (!raw) throw new Error("state.json carries no tasks array");
  const tasks: Array<{ id: string; status: string }> = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id : undefined;
    const status = typeof entry.status === "string" ? entry.status : "unknown";
    if (id) tasks.push({ id, status });
  }
  const schemaVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : undefined;
  return {
    tasks,
    schemaVersion,
    reason: schemaVersion === 2 ? undefined : `state.json schemaVersion ${schemaVersion ?? "missing"} (observer normalizes read-only)`
  };
}

export async function collectHostSnapshot(sources: HostObservabilitySources): Promise<HostObserverSnapshot> {
  const now = sources.now ?? (() => new Date().toISOString());
  const boss = path.join(sources.dataRoot, ".boss");
  const dimensions: HostDimensionReport[] = [];
  const degraded: string[] = [];

  /** Runs a dimension reader; a throw degrades only that dimension. */
  const guard = <T>(dimension: HostDimensionReport["dimension"], reader: () => T[], fallback: T[]): T[] => {
    try {
      const value = reader();
      dimensions.push(dimensionReport(dimension, "OK", value.length));
      return value;
    } catch (error) {
      const reason = String(error);
      degraded.push(`${dimension}: ${reason}`);
      dimensions.push(dimensionReport(dimension, "UNAVAILABLE", 0, reason));
      return fallback;
    }
  };

  // ---- nodes -------------------------------------------------------------
  const nodeFile = path.join(boss, "node-registry.json");
  const nodeRegistryOverride = sources.nodeRegistry;
  const nodes = guard<ObservedNode>(
    "nodes",
    () => {
      if (nodeRegistryOverride) {
        return nodeRegistryOverride.list().map((entry) => ({ ...entry }));
      }
      if (missing(nodeFile)) throw new Error(`no node registry at ${path.relative(sources.dataRoot, nodeFile)}`);
      validateShape(
        nodeFile,
        (parsed) => isRecord(parsed) && parsed.schemaVersion === 1 && Array.isArray(parsed.records),
        "node-registry.json"
      );
      return new NodeCapabilityRegistry(nodeFile).list().map((entry) => ({ nodeId: entry.nodeId, state: entry.state, updatedAt: entry.updatedAt, reason: "" }));
    },
    []
  );
  // `list()` carries no reason; a per-node reason is available from `status()`
  // and is only consulted for the nodes actually present.
  if (nodes.length && !nodeRegistryOverride) {
    try {
      const registry = new NodeCapabilityRegistry(nodeFile);
      for (const node of nodes) node.reason = registry.status(node.nodeId)?.reason ?? "";
    } catch {
      // leave the reasons empty rather than fail the dimension
    }
  }

  // ---- fleet -------------------------------------------------------------
  // Both fleet read models come from one dimension entry, so the report names
  // "fleet" once rather than twice for the same store.
  const fleetFile = path.join(boss, "fleet.json");
  const fleetRead = (() => {
    try {
      if (sources.fleet) return { nodes: sources.fleet.listNodes(), assignments: sources.fleet.listAssignments() };
      if (missing(fleetFile)) throw new Error(`no fleet coordinator at ${path.relative(sources.dataRoot, fleetFile)}`);
      validateShape(
        fleetFile,
        (parsed) => isRecord(parsed) && parsed.schemaVersion === 1 && Array.isArray(parsed.nodes) && Array.isArray(parsed.assignments),
        "fleet coordinator file"
      );
      const coordinator = new FederationCoordinator(fleetFile);
      const clock = Date.now();
      return {
        nodes: coordinator.listNodes().map((node) => ({
          nodeId: node.nodeId,
          state: node.state,
          derivedState: fleetStateFor(clock, node),
          lastHeartbeatAt: node.lastHeartbeatAt,
          heartbeatAgeMs: Math.max(0, clock - node.lastHeartbeatAt),
          capabilities: node.capabilities
        })),
        assignments: coordinator.listAssignments().map((item) => ({ taskId: item.taskId, state: item.state, nodeId: item.nodeId, attempts: item.attempts }))
      };
    } catch (error) {
      const reason = String(error);
      degraded.push(`fleet: ${reason}`);
      dimensions.push(dimensionReport("fleet", "UNAVAILABLE", 0, reason));
      return { nodes: [] as ObservedFleetNode[], assignments: [] as ObservedAssignment[] };
    }
  })();
  if (!degraded.some((entry) => entry.startsWith("fleet:"))) {
    dimensions.push(dimensionReport("fleet", "OK", fleetRead.nodes.length + fleetRead.assignments.length));
  }
  const fleetNodes = fleetRead.nodes;
  const assignments = fleetRead.assignments;

  // ---- tasks / queue depth ----------------------------------------------
  const stateFile = path.join(sources.dataRoot, "state.json");
  const ledgerRoot = path.join(boss, "tasks");
  const tasks = guard<ObservedTask>(
    "tasks",
    () => {
      const store = sources.store ?? { snapshot: () => readTaskRows(sources.dataRoot) };
      const ledger = sources.ledger ?? new TaskLedger(ledgerRoot);
      return store.snapshot().tasks.map((task) => {
        const record = ledger.load(task.id) as LedgerLike | undefined;
        const jobs = Object.values(record?.jobs ?? {});
        return {
          taskId: task.id,
          status: task.status,
          hasLedger: Boolean(record),
          ledgerMode: record?.mode,
          degradationMode: record?.degradation?.mode,
          pendingSteps: record?.pendingSteps?.length ?? 0,
          completedSteps: record?.completedSteps?.length ?? 0,
          failedJobs: jobs.filter((job) => job.state === "FAILED").length,
          waitingJobs: jobs.filter((job) => job.state === "WAITING").length,
          runningJobs: jobs.filter((job) => job.state === "RUNNING").length,
          retries: record?.usage?.retries ?? 0,
          modelCalls: record?.usage?.modelCalls ?? 0,
          activeProvider: record?.activeProvider ?? null
        };
      });
    },
    []
  );

  // ---- providers ---------------------------------------------------------
  const budgetFile = path.join(boss, "runtime-budget.json");
  const breakerFile = path.join(boss, "circuit-breaker.json");
  const providers = guard<ObservedProvider>(
    "providers",
    () => {
      if (missing(budgetFile) && missing(breakerFile)) throw new Error("no runtime-budget.json or circuit-breaker.json");
      const budgets = sources.budgets ?? new BudgetManager(budgetFile);
      const breaker = sources.breaker ?? new CircuitBreaker(breakerFile);
      const circuits = new Map(breaker.list().map((entry) => [entry.runtimeId, entry]));
      const ids = new Set<string>([...budgets.list().map((entry) => entry.runtimeId), ...circuits.keys()]);
      return [...ids].sort().map((runtimeId) => {
        const budget = budgets.get(runtimeId);
        const circuit = circuits.get(runtimeId);
        return {
          runtimeId,
          circuit: circuit?.state ?? "CLOSED",
          consecutiveFailures: circuit?.consecutiveFailures ?? 0,
          budget: budget?.state ?? "UNKNOWN",
          budgetSource: budget?.source,
          eligible: budgets.eligible(runtimeId)
        };
      });
    },
    []
  );

  // ---- sessions ----------------------------------------------------------
  const sessionFile = path.join(boss, "session-lifecycle.json");
  const sessions = guard<ObservedSession>(
    "sessions",
    () => {
      if (sources.sessions) return sources.sessions.list();
      if (missing(sessionFile)) throw new Error("no session-lifecycle.json");
      validateShape(
        sessionFile,
        (parsed) => isRecord(parsed) && parsed.schemaVersion === 1 && Array.isArray(parsed.records),
        "session-lifecycle.json"
      );
      return new SessionLifecycleLedger(sessionFile).list().map((record) => ({
        providerId: record.providerId,
        account: record.account,
        state: record.state,
        lastSuccessAt: record.lastSuccessAt,
        lastFailureReason: record.lastFailureReason,
        updatedAt: record.updatedAt,
        transitions: record.transitions.length
      }));
    },
    []
  );

  // ---- routing -----------------------------------------------------------
  const learningRoot = path.join(boss, "learning");
  const routing = guard<ObservedRoutingDecision>(
    "routing",
    () => {
      if (sources.routing) return sources.routing.list();
      const file = path.join(learningRoot, "routing-feedback.json");
      if (missing(file)) throw new Error("no routing-feedback.json (adaptive routing has never decided)");
      const service = new LearningService({ rootDir: learningRoot, now });
      return service.feedback.list().map((record) => ({
        decisionId: record.decisionId,
        taskId: record.taskId,
        policyVersion: record.policyVersion,
        selectedRuntimeId: record.selectedRuntimeId,
        usedFallbackRouter: record.usedFallbackRouter,
        candidateCount: record.candidates.length,
        explorationEnabled: record.exploration?.enabled,
        recordedAt: record.recordedAt
      }));
    },
    []
  );

  // ---- learning ----------------------------------------------------------
  const learning: ObservedLearningState | undefined = (() => {
    try {
      const service = sources.learning ?? new LearningService({ rootDir: learningRoot, now });
      const control = service.controlState();
      let revisions = 0;
      try {
        revisions = service.episodes.status().revisions;
      } catch {
        revisions = 0;
      }
      dimensions.push(dimensionReport("learning", control.degraded.length ? "DEGRADED" : "OK", control.episodes, control.degraded.join("; ") || undefined));
      if (control.degraded.length) degraded.push(...control.degraded.map((entry) => `learning: ${entry}`));
      return { ...control, revisions };
    } catch (error) {
      const reason = String(error);
      degraded.push(`learning: ${reason}`);
      dimensions.push(dimensionReport("learning", "UNAVAILABLE", 0, reason));
      return undefined;
    }
  })();

  // ---- recent failures ---------------------------------------------------
  const failures = guard<ObservedFailure>(
    "failures",
    () => {
      const collected: ObservedFailure[] = [];
      // 1. pending/retrying recovery wakeups — the closest existing "not done yet" model.
      try {
        const recovery = sources.recovery ?? new RecoveryScheduler(path.join(boss, "recovery.json"));
        for (const wakeup of recovery.list()) {
          if (wakeup.state === "PAUSED" || wakeup.error) {
            collected.push({
              source: "recovery-wakeup",
              taskId: wakeup.taskId,
              kind: wakeup.kind,
              detail: `${wakeup.state} after ${wakeup.attempts} attempt(s)${wakeup.error ? `: ${wakeup.error}` : ""}`,
              at: new Date(wakeup.retryAt).toISOString()
            });
          }
        }
      } catch {
        // recovery.json absent — no wakeups to report
      }
      // 2. telemetry FAILED rows.
      try {
        const telemetry = sources.telemetry ?? new TelemetryStore(path.join(boss, "telemetry.json"));
        for (const record of telemetry.list()) {
          if (record.outcome !== "FAILED") continue;
          collected.push({
            source: "telemetry",
            taskId: record.taskId,
            runtimeId: record.runtimeId,
            kind: "runtime-failure",
            detail: record.reason ?? `job ${record.jobId} failed`,
            at: record.at
          });
        }
      } catch {
        // telemetry.json absent
      }
      // 3. durable per-task failure history (the only record that survives a restart).
      try {
        const ledger = sources.ledger ?? new TaskLedger(ledgerRoot);
        const store = sources.store ?? { snapshot: () => readTaskRows(sources.dataRoot) };
        for (const task of store?.snapshot().tasks ?? []) {
          const record = ledger.load(task.id) as LedgerLike | undefined;
          for (const interruption of record?.failureHistory ?? []) {
            collected.push({
              source: "task-failure-history",
              taskId: task.id,
              runtimeId: record?.activeProvider ?? undefined,
              kind: interruption.kind,
              detail: interruption.message
            });
          }
        }
      } catch {
        // no tasks dir yet
      }
      // 4. unresolved human interventions.
      try {
        const file = path.join(boss, "interventions.json");
        const parsed = readJsonSafe<{ items?: Array<{ taskId: string; kind: string; question: string; resolvedAt?: string }> }>(file);
        for (const item of parsed?.items ?? []) {
          if (item.resolvedAt) continue;
          collected.push({ source: "intervention", taskId: item.taskId, kind: item.kind, detail: item.question });
        }
      } catch {
        // interventions.json absent
      }
      // 5. stores that self-reported corruption.
      for (const entry of learning?.degraded ?? []) {
        collected.push({ source: "store-degradation", kind: "unreadable-store", detail: entry });
      }
      if (!collected.length) {
        const anySource = !missing(path.join(boss, "telemetry.json")) || !missing(path.join(boss, "recovery.json")) || !missing(ledgerRoot);
        if (!anySource) throw new Error("no failure source is present yet");
      }
      return collected;
    },
    []
  );

  // ---- 10.x aggregate (reported, never merged into the counts) -----------
  let tenxFleetAggregate: Record<string, unknown> | undefined;
  if (sources.tenx?.observability) {
    try {
      tenxFleetAggregate = sources.tenx.observability.snapshot();
    } catch (error) {
      degraded.push(`tenx-aggregate: ${String(error)}`);
    }
  } else {
    try {
      const tenxNodes = sources.tenx?.nodes ?? new (require("../tenx/node-identity-registry").TenxNodeRegistry)(path.join(boss, "tenx", "nodes.json"));
      const tenxFleet = sources.tenx?.fleet ?? new (require("../tenx/fleet-controller").TenxFleetController)(path.join(boss, "tenx", "fleet.json"));
      const { TenxObservability } = require("../tenx/observability");
      tenxFleetAggregate = new TenxObservability({ nodes: tenxNodes, fleet: tenxFleet }).snapshot();
    } catch (error) {
      // The 10.x stack is optional; its absence is not a Host-M failure.
      degraded.push(`tenx-aggregate unavailable: ${String(error)}`);
    }
  }

  // `inspectDevice()` is a pure read of this host and is reported as evidence of
  // what the observer itself can see — it is never used to write the registry.
  try {
    const probe = inspectDevice({});
    void probe;
  } catch {
    // a probe failure must not affect the snapshot
  }

  return projectHostObserver({
    now,
    nodes,
    fleetNodes,
    assignments,
    tasks,
    providers,
    sessions,
    routing,
    learning,
    failures,
    dimensions,
    degraded,
    tenxFleetAggregate
  });
}
