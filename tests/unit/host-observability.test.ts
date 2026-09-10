import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HOST_OBSERVER_DIMENSIONS,
  dimensionReport,
  mostRecent,
  projectHostObserver,
  summarizeHostSnapshot,
  type ObservedTask
} from "../../src/shared/host-observer";
import {
  DEFAULT_HOST_FLAGS,
  HOST_FLAG_IDS,
  enabledHostFlags,
  hostCapabilityEnabled,
  hostFlagsAllOff,
  isHostFlagId,
  resolveHostFlags
} from "../../src/shared/host-maturity-flags";
import { collectHostSnapshot } from "../../electron/host/host-observer-collector";

const AT = "2026-09-10T00:00:00.000Z";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-observer-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function observedTask(overrides: Partial<ObservedTask> = {}): ObservedTask {
  return {
    taskId: "t-1",
    status: "running",
    hasLedger: true,
    pendingSteps: 0,
    completedSteps: 0,
    failedJobs: 0,
    waitingJobs: 0,
    runningJobs: 0,
    retries: 0,
    modelCalls: 0,
    ...overrides
  };
}

describe("Host-M feature flags", () => {
  it("keeps every Host-M capability off by default", () => {
    expect(DEFAULT_HOST_FLAGS).toEqual(Object.fromEntries(HOST_FLAG_IDS.map((id) => [id, false])));
    expect(hostFlagsAllOff(resolveHostFlags({}))).toBe(true);
    expect(enabledHostFlags(resolveHostFlags({}))).toEqual([]);
  });

  it("is fail-closed: only an explicit boolean true enables a capability", () => {
    for (const value of ["true", 1, "yes", {}, [], null, undefined]) {
      expect(resolveHostFlags({ hostObservability: value }).hostObservability).toBe(false);
    }
    expect(resolveHostFlags({ hostObservability: true }).hostObservability).toBe(true);
  });

  it("never lets an unknown id turn anything on", () => {
    expect(resolveHostFlags({ somethingElse: true } as never)).toEqual(DEFAULT_HOST_FLAGS);
    expect(isHostFlagId("hostDoctor")).toBe(true);
    expect(isHostFlagId("hostNope")).toBe(false);
    expect(isHostFlagId(7)).toBe(false);
  });

  it("reports exactly which capabilities are enabled", () => {
    const flags = resolveHostFlags({ hostDoctor: true, hostSoakHarness: true });
    expect(enabledHostFlags(flags)).toEqual(["hostSoakHarness", "hostDoctor"]);
    expect(hostCapabilityEnabled("hostDoctor", flags)).toBe(true);
    expect(hostCapabilityEnabled("hostFaultLab", flags)).toBe(false);
  });

  it("keeps the Host-M flag registry separate from the Engine flag contract", () => {
    // A Host-M flag id must never collide with an adaptive (Engine) flag id, or
    // removing Host-M could break the Engine's own contract.
    const adaptiveIds = ["adaptiveProviderLearning", "semanticOutcomeEvaluation", "modelIdentityObservation", "adaptiveRouting", "behaviourEpochDetection"];
    for (const id of HOST_FLAG_IDS) expect(adaptiveIds).not.toContain(id);
  });
});

describe("unified observability projection (P4)", () => {
  it("declares the full domain set the plan names", () => {
    expect([...HOST_OBSERVER_DIMENSIONS]).toEqual(["nodes", "fleet", "tasks", "providers", "sessions", "routing", "learning", "failures"]);
  });

  it("counts each domain without inventing facts", () => {
    const snapshot = projectHostObserver({
      now: () => AT,
      nodes: [
        { nodeId: "a", state: "READY", reason: "" },
        { nodeId: "b", state: "DEGRADED", reason: "gpu" }
      ],
      fleetNodes: [
        { nodeId: "a", state: "READY", derivedState: "READY", lastHeartbeatAt: 1, heartbeatAgeMs: 10, capabilities: [] },
        { nodeId: "b", state: "READY", derivedState: "OFFLINE", lastHeartbeatAt: 1, heartbeatAgeMs: 90_000, capabilities: [] }
      ],
      tasks: [
        observedTask({ taskId: "t-1", status: "running" }),
        observedTask({ taskId: "t-2", status: "waiting", hasLedger: false }),
        observedTask({ taskId: "t-3", status: "failed", degradationMode: "LIGHTWEIGHT" })
      ],
      providers: [
        { runtimeId: "web:a", circuit: "CLOSED", consecutiveFailures: 0, budget: "OK", eligible: true },
        { runtimeId: "web:b", circuit: "OPEN", consecutiveFailures: 5, budget: "EXHAUSTED", eligible: false }
      ],
      sessions: [
        { providerId: "chatgpt", account: "default", state: "LOGGED_IN", updatedAt: AT, transitions: 2 },
        { providerId: "gemini", account: "default", state: "EXPIRED", updatedAt: AT, transitions: 1 }
      ],
      routing: [
        { decisionId: "d1", taskId: "t-1", policyVersion: "v1", usedFallbackRouter: false, candidateCount: 2, recordedAt: AT },
        { decisionId: "d2", taskId: "t-2", policyVersion: "v1", usedFallbackRouter: true, candidateCount: 1, recordedAt: AT }
      ],
      learning: {
        flags: { adaptiveRouting: true, adaptiveProviderLearning: true },
        episodes: 12,
        revisions: 1,
        profiles: 3,
        concepts: 4,
        epochs: 2,
        snapshots: 5,
        decisions: 2,
        stablePolicyVersion: "stable-1.0.0",
        profileStale: false,
        degraded: []
      },
      failures: [
        { source: "telemetry", taskId: "t-3", kind: "runtime-failure", detail: "timeout", at: AT },
        { source: "intervention", taskId: "t-2", kind: "approval", detail: "waiting" }
      ],
      dimensions: HOST_OBSERVER_DIMENSIONS.map((dimension) => dimensionReport(dimension, "OK", 1))
    });

    expect(snapshot.mode).toBe("READ_ONLY");
    expect(snapshot.counts.nodes).toEqual({ total: 2, ready: 1, degraded: 1, offline: 0, failed: 0 });
    expect(snapshot.counts.fleet).toEqual({ total: 2, ready: 1, degraded: 0, offline: 1, failed: 0 });
    expect(snapshot.counts.tasks.running).toBe(1);
    expect(snapshot.counts.tasks.waiting).toBe(1);
    expect(snapshot.counts.tasks.failed).toBe(1);
    expect(snapshot.counts.tasks.withoutLedger).toBe(1);
    expect(snapshot.counts.tasks.degraded).toBe(1);
    expect(snapshot.counts.providers).toEqual({ total: 2, eligible: 1, circuitOpen: 1, budgetLow: 0, budgetExhausted: 1 });
    expect(snapshot.counts.sessions.loggedIn).toBe(1);
    expect(snapshot.counts.sessions.expired).toBe(1);
    expect(snapshot.counts.routing).toEqual({ decisions: 2, fallbackDecisions: 1, explorationDecisions: 0 });
    expect(snapshot.counts.learning).toEqual({ flagsOn: 2, degradedStores: 0 });
    expect(snapshot.counts.failures.total).toBe(2);
    expect(snapshot.counts.failures.bySource).toEqual({ telemetry: 1, intervention: 1 });
  });

  it("keeps an empty snapshot empty instead of guessing", () => {
    const snapshot = projectHostObserver({ now: () => AT });
    expect(snapshot.counts.tasks.total).toBe(0);
    expect(snapshot.counts.failures.total).toBe(0);
    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.degraded).toEqual([]);
  });

  it("carries recent failures newest-first and bounded", () => {
    const failures = Array.from({ length: 30 }, (_, index) => ({
      source: "telemetry" as const,
      kind: "runtime-failure",
      detail: `failure ${index}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
    }));
    const snapshot = projectHostObserver({ now: () => AT, failures }, { recentLimit: 5 });
    expect(snapshot.recentFailures).toHaveLength(5);
    expect(snapshot.recentFailures[0].detail).toBe("failure 29");
    expect(snapshot.counts.failures.total).toBe(30);
  });

  it("orders equally-timestamped records stably", () => {
    const values = [
      { id: "first", at: AT },
      { id: "second", at: AT }
    ];
    expect(mostRecent(values, (value) => value.at, 2).map((value) => value.id)).toEqual(["first", "second"]);
  });

  it("surfaces unavailable dimensions in the one-line summary", () => {
    const snapshot = projectHostObserver({
      now: () => AT,
      dimensions: [
        dimensionReport("tasks", "OK", 3),
        dimensionReport("nodes", "UNAVAILABLE", 0, "no node registry"),
        dimensionReport("learning", "DEGRADED", 2, "provider-profiles.json unreadable")
      ]
    });
    const text = summarizeHostSnapshot(snapshot);
    expect(text).toContain("unavailable dimensions: nodes");
    expect(text).toContain("degraded dimensions: learning");
  });
});

describe("unified observability collector (P4)", () => {
  it("reports a dimension whose store is absent as UNAVAILABLE, not as a healthy zero", async () => {
    const snapshot = await collectHostSnapshot({ dataRoot: dir, now: () => AT });
    const byDimension = new Map(snapshot.dimensions.map((entry) => [entry.dimension, entry]));
    expect(byDimension.get("nodes")!.status).toBe("UNAVAILABLE");
    expect(byDimension.get("nodes")!.reason).toMatch(/no node registry/);
    expect(byDimension.get("tasks")!.status).toBe("UNAVAILABLE");
    expect(snapshot.counts.tasks.total).toBe(0);
  });

  it("degrades only the failing dimension and never throws", async () => {
    fs.mkdirSync(path.join(dir, ".boss"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({ schemaVersion: 2, tasks: [{ id: "t-1", title: "x", objective: "y", status: "running", providerIds: ["chatgpt"], mode: "direct", appMode: "work", createdAt: AT, updatedAt: AT }] }),
      "utf8"
    );
    const snapshot = await collectHostSnapshot({
      dataRoot: dir,
      now: () => AT,
      // A source that exists but explodes when read.
      nodeRegistry: {
        list: () => {
          throw new Error("registry corrupt");
        }
      },
      ledger: { load: () => ({ mode: "NORMAL", pendingSteps: ["a"], completedSteps: [], jobs: {}, usage: { retries: 1, modelCalls: 4 } }) },
      sessions: { list: () => [{ providerId: "chatgpt", account: "default", state: "LOGGED_IN", updatedAt: AT, transitions: 0 }] }
    });
    const byDimension = new Map(snapshot.dimensions.map((entry) => [entry.dimension, entry]));
    expect(byDimension.get("nodes")!.status).toBe("UNAVAILABLE");
    expect(byDimension.get("nodes")!.reason).toMatch(/registry corrupt/);
    // The healthy dimensions are still populated.
    expect(byDimension.get("sessions")!.status).toBe("OK");
    expect(byDimension.get("tasks")!.status).toBe("OK");
    expect(snapshot.counts.tasks.total).toBe(1);
    expect(snapshot.counts.tasks.running).toBe(1);
    expect(snapshot.tasks[0].modelCalls).toBe(4);
    expect(snapshot.degraded.join(" ")).toContain("registry corrupt");
  });

  it("reads the real durable stores without modifying what it reads", async () => {
    const boss = path.join(dir, ".boss");
    fs.mkdirSync(boss, { recursive: true });
    const stateFile = path.join(dir, "state.json");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ schemaVersion: 2, tasks: [{ id: "t-live", title: "x", objective: "y", status: "queued", providerIds: ["chatgpt"], mode: "direct", appMode: "work", createdAt: AT, updatedAt: AT }] }),
      "utf8"
    );
    const stateBefore = fs.readFileSync(stateFile, "utf8");
    const snapshot = await collectHostSnapshot({ dataRoot: dir, now: () => AT });
    // Byte-for-byte: constructing a StateStore here would have started a
    // startup session and rewritten this file, which is why the observer reads
    // the task rows itself (see readTaskRows).
    expect(fs.readFileSync(stateFile, "utf8")).toBe(stateBefore);
    const tasks = snapshot.dimensions.find((entry) => entry.dimension === "tasks")!;
    expect(tasks.status).toBe("OK");
    expect(snapshot.counts.tasks.queued).toBe(1);
    // It must never fabricate another store while observing.
    expect(fs.existsSync(path.join(boss, "node-registry.json"))).toBe(false);
    expect(fs.existsSync(path.join(boss, "fleet.json"))).toBe(false);
    expect(fs.existsSync(path.join(boss, "session-lifecycle.json"))).toBe(false);
    expect(fs.existsSync(path.join(boss, "learning"))).toBe(false);
  });

  it("tolerates a corrupt store file and reports it instead of throwing", async () => {
    const boss = path.join(dir, ".boss");
    fs.mkdirSync(boss, { recursive: true });
    // A NodeCapabilityRegistry silently drops a malformed file on restore, which
    // would read as a healthy empty registry; the observer must not accept that.
    fs.writeFileSync(path.join(boss, "node-registry.json"), "{ not json", "utf8");
    const snapshot = await collectHostSnapshot({ dataRoot: dir, now: () => AT });
    const nodes = snapshot.dimensions.find((entry) => entry.dimension === "nodes")!;
    expect(nodes.status).toBe("UNAVAILABLE");
    expect(nodes.reason).toMatch(/unreadable/);
  });

  it("rejects a well-formed but wrong-schema store file", async () => {
    const boss = path.join(dir, ".boss");
    fs.mkdirSync(boss, { recursive: true });
    fs.writeFileSync(path.join(boss, "node-registry.json"), JSON.stringify({ schemaVersion: 1, records: "nope" }), "utf8");
    const snapshot = await collectHostSnapshot({ dataRoot: dir, now: () => AT });
    const nodes = snapshot.dimensions.find((entry) => entry.dimension === "nodes")!;
    expect(nodes.status).toBe("UNAVAILABLE");
    expect(nodes.reason).toMatch(/schema check/);
  });

  it("never lets one hostile source take down the whole snapshot", async () => {
    await expect(
      collectHostSnapshot({
        dataRoot: dir,
        now: () => AT,
        nodeRegistry: { list: () => { throw new Error("boom"); } },
        fleet: { listNodes: () => { throw new Error("boom"); }, listAssignments: () => { throw new Error("boom"); } },
        sessions: { list: () => { throw new Error("boom"); } },
        routing: { list: () => { throw new Error("boom"); } }
      })
    ).resolves.toBeDefined();
  });
});
