import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeIntelligenceService, runtimeIntelligenceRoot, type RecordFileInput, type RecordedOutcome, type RecordOutcomeInput, type RuntimeIntelligenceServiceOptions } from "../../../electron/runtime-intelligence/runtime-intelligence-service";
import { NODE_SNAPSHOT_HISTORY_LIMIT, OBSERVATION_READ_LIMIT, RuntimeIntelligenceStore, type RuntimeIntelligenceStoreOptions } from "../../../electron/runtime-intelligence/intelligence-store";
import { isAdvisoryOnly } from "../../../src/shared/runtime-intelligence/scheduling-advisor";
import type { ContextRecord, SkillUsageTelemetry, TaskProfile } from "../../../src/shared/runtime-intelligence/contracts";

/**
 * Integration: the whole plane against a real temporary root.
 *
 * This is the round's "real data loop" check. The service profiles the real machine,
 * files real outcomes, updates the real ledger, advises from what it stored and explains
 * a stored task - and every artefact it writes is read back from disk rather than trusted
 * from memory. It also proves the plane degrades rather than throws on a corrupt file.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-ri-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

const AT = "2026-01-01T00:00:00.000Z";

function service(rootDir: string): RuntimeIntelligenceService {
  return new RuntimeIntelligenceService({
    rootDir,
    now: () => AT,
    nodeProfiler: { repoRoot: process.cwd(), trustClass: "TRUSTED_HOST", probes: { cpu: () => ({ logicalCores: 8, model: "cpu" }), memory: () => ({ totalMb: 16384, freeMb: 8192 }), currentTasks: () => 0 } }
  });
}

function task(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    taskId: "task-1",
    role: "coder",
    taskKind: "coding",
    requiredCapabilities: [],
    contextScale: "small",
    externalEffect: false,
    risk: "low",
    createdAt: AT,
    ...overrides
  };
}

describe("the plane runs a real loop against a real root", () => {
  it("exposes the option and record shapes a caller needs", () => {
    const storeOptions: RuntimeIntelligenceStoreOptions = { rootDir: makeRoot() };
    const store = new RuntimeIntelligenceStore(storeOptions);
    expect(OBSERVATION_READ_LIMIT).toBeGreaterThan(0);
    expect(store.observations(OBSERVATION_READ_LIMIT)).toEqual([]);

    const file: RecordFileInput = { provider: "vendor", family: "gpt", version: "1" };
    const options: RuntimeIntelligenceServiceOptions = { rootDir: makeRoot(), now: () => AT };
    const plane = new RuntimeIntelligenceService(options);
    const input: RecordOutcomeInput = { task: task(), model: file, success: true };
    const recorded: RecordedOutcome = plane.recordOutcome(input);
    expect(recorded.observation.execution.outcome).toBe("SUCCESS");
    expect(recorded.record.taskTypePerformance.coding?.attempts).toBe(1);
    expect(recorded.application.updated.length).toBeGreaterThan(0);
  });

  it("profiles this machine, writes the snapshot and reads it back", () => {
    const root = makeRoot();
    const plane = service(root);
    const snapshot = plane.profileNode();
    // Real machine facts, not fixtures: the cpu probe is overridden but the snapshot is real.
    expect(snapshot.nodeId).toBeTruthy();
    const stored = plane.nodes();
    expect(stored).toHaveLength(1);
    expect(stored[0].nodeId).toBe(snapshot.nodeId);
    expect(stored[0].kind).toBe("NODE_CAPABILITY_SNAPSHOT");
    expect(fs.existsSync(path.join(root, "nodes.json"))).toBe(true);
  });

  it("warm-starts a new model, then folds real outcomes into it and persists them", () => {
    const root = makeRoot();
    const plane = service(root);
    plane.profileNode();

    const first = plane.ensureModel({ provider: "vendor", family: "gpt", version: "1" });
    expect(first.warmStarted).toBe(true);
    expect(first.scores.coding.score).toBeGreaterThan(0);
    expect(first.scores.coding.samples).toBe(0);

    for (let index = 0; index < 6; index += 1) {
      plane.recordOutcome({ task: task(), model: { provider: "vendor", family: "gpt", version: "1" }, nodeId: first.modelKey ? plane.nodes()[0].nodeId : undefined, success: true, latencyMs: 900, expectedLatencyMs: 1000, costUsd: 0.01, expectedCostUsd: 0.02, reviewerAgreed: true });
    }

    const reloaded = service(root).model("vendor", "gpt", "1");
    expect(reloaded?.scores.coding.samples).toBe(6);
    expect(reloaded?.scores.coding.score).toBeGreaterThan(first.scores.coding.score);
    expect(reloaded?.taskTypePerformance.coding).toEqual({ attempts: 6, successes: 6, failures: 0 });
    expect(reloaded?.reviewAgreement).toEqual({ samples: 6, agreements: 6 });
    expect(fs.existsSync(path.join(root, "models.json"))).toBe(true);
  });

  it("records one unified observation per outcome, and reads it back from the log", () => {
    const root = makeRoot();
    const plane = service(root);
    const node = plane.profileNode();
    const { observation } = plane.recordOutcome({
      task: task(),
      model: { provider: "vendor", family: "gpt", version: "1" },
      nodeId: node.nodeId,
      success: true,
      latencyMs: 800,
      costUsd: 0.02,
      reviewerAgreed: true,
      skills: { recommended: ["a"], actual: ["a", "b"], used: ["a"] },
      context: { injected: ["c1"], candidate: ["c2"], archived: ["c3"] },
      recommendationId: "rec-1",
      modelReasonRefs: ["capability.coding"],
      nodeReasonRefs: ["node.capacity"]
    });

    expect(observation.kind).toBe("RUNTIME_OBSERVATION");
    expect(observation.traceId.startsWith("trace-")).toBe(true);
    expect(observation.task.taskId).toBe("task-1");
    expect(observation.model.modelKey).toBe("vendor:gpt:1");
    expect(observation.model.basis).toBe("RECOMMENDED");
    expect(observation.node.nodeId).toBe(node.nodeId);
    expect(observation.execution).toMatchObject({ outcome: "SUCCESS", latencyMs: 800, costUsd: 0.02 });
    expect(observation.review.agreement).toBe("AGREED");
    expect(observation.capabilityUpdate.applied).toBe(true);
    expect(observation.capabilityUpdate.dimensions.length).toBeGreaterThan(0);

    const reloaded = service(root).store.observations();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].observationId).toBe(observation.observationId);
    expect(fs.existsSync(path.join(root, "observations.jsonl"))).toBe(true);
  });

  it("explains a stored task from the record alone", () => {
    const root = makeRoot();
    const plane = service(root);
    const node = plane.profileNode();
    const { observation } = plane.recordOutcome({
      task: task(),
      model: { provider: "vendor", family: "gpt", version: "1" },
      nodeId: node.nodeId,
      success: false,
      failureClass: "TIMEOUT",
      skills: { recommended: ["a"], actual: ["a", "b"], used: ["a"] }
    });

    const explanation = plane.explain(observation.observationId);
    expect(explanation).toBeDefined();
    expect(explanation!.whyThisModel).toContain("no scheduling recommendation was recorded");
    expect(explanation!.whyThisNode).toContain(node.nodeId);
    expect(explanation!.whyNotOtherSkills).toContain("mounted but never invoked: b");
    expect(explanation!.decisionOutcome).toBe("CONTRADICTED_BY_OUTCOME");
    expect(plane.latestObservationFor("task-1")?.observationId).toBe(observation.observationId);
    expect(plane.explain("no-such-observation")).toBeUndefined();
    expect(plane.latestObservationFor("no-such-task")).toBeUndefined();
  });

  it("records a shadow continuation opinion without executing it", () => {
    const root = makeRoot();
    const plane = service(root);
    const node = plane.profileNode();
    const continuation = plane.evaluateContinuation({
      taskId: "task-1",
      modelKey: "vendor:gpt:1",
      progress: 0.4,
      outputNovelty: 0.05,
      unresolvedItems: 3,
      resolvedItems: 1,
      tokensConsumed: 5000,
      elapsedMs: 1000,
      repeatRate: 0.95,
      selfContradictions: 0,
      reviewerDisagreements: 0,
      reviewerReviews: 0,
      toolProgress: "PROGRESSING",
      stepsCompleted: 4
    });
    expect(continuation.mode).toBe("SHADOW_ONLY");
    expect(continuation.decision).toBe("SWITCH_MODEL");

    const { observation } = plane.recordOutcome({ task: task(), model: { provider: "vendor", family: "gpt", version: "1" }, nodeId: node.nodeId, success: true, continuation });
    expect(observation.continuation).toEqual({ assessmentId: continuation.assessmentId, decision: "SWITCH_MODEL", confidence: continuation.confidence, executed: false });
    const explanation = plane.explain(observation.observationId);
    expect(explanation!.continuationAdvice).toContain("SWITCH_MODEL");
    expect(explanation!.continuationAdvice).toContain("was not executed");
  });

  it("advises from what was persisted, and the advice stays advisory", () => {
    const root = makeRoot();
    const plane = service(root);
    const node = plane.profileNode();
    for (let index = 0; index < 8; index += 1) {
      plane.recordOutcome({ task: task(), model: { provider: "vendor", family: "gpt", version: "1" }, nodeId: node.nodeId, success: true, latencyMs: 900, expectedLatencyMs: 1000 });
    }
    plane.recordOutcome({ task: task(), model: { provider: "vendor", family: "qwen", version: "1" }, nodeId: node.nodeId, success: false, failureClass: "TIMEOUT" });

    const recommendation = service(root).adviseFor(task(), {});
    expect(recommendation.preferredModel?.modelKey).toBe("vendor:gpt:1");
    expect(recommendation.preferredNode?.nodeId).toBe(node.nodeId);
    expect(isAdvisoryOnly(recommendation)).toBe(true);
    expect(recommendation.productionRoutingAuthority).toBe(false);
    expect(recommendation.qualificationHostSelection).toBe(false);
    expect(recommendation.blocked).toEqual([]);
  });

  it("plans a context lifecycle and persists the records it was given", () => {
    const root = makeRoot();
    const plane = service(root);
    const records: ContextRecord[] = [
      { id: "hot", kind: "transcript", tokens: 500, lastUsedAt: AT, retrievalCount: 4, successContribution: 0.9, dependencyIds: [], confidence: 0.9 },
      { id: "archived", kind: "transcript", tokens: 9000, lastUsedAt: "2020-01-01T00:00:00.000Z", retrievalCount: 0, successContribution: 0, dependencyIds: [], confidence: 0.05 }
    ];
    const lifecycle = plane.planContext({ taskId: "task-1", records });
    expect(lifecycle.injectedIds).toEqual(["hot"]);
    expect(lifecycle.archivedIds).toEqual(["archived"]);
    expect(lifecycle.deletesNothing).toBe(true);
    expect(service(root).store.loadContextRecords()).toHaveLength(2);

    // Planning from what was persisted needs no second argument.
    const replanned = plane.planContext({ taskId: "task-1" });
    expect(replanned.placements).toHaveLength(2);
  });

  it("stores skill telemetry as an append-only log", () => {
    const root = makeRoot();
    const plane = service(root);
    const entries: SkillUsageTelemetry[] = [
      { skillId: "a", taskId: "task-1", observationId: "obs-1", selected: true, used: true, invocationCount: 1, contextTokens: 200, latencyMs: 10, success: true, conflictsWith: [], overlappingWith: [], at: AT },
      { skillId: "a", taskId: "task-2", observationId: "obs-2", selected: true, used: false, invocationCount: 0, contextTokens: 200, latencyMs: 10, success: true, conflictsWith: [], overlappingWith: [], at: AT }
    ];
    plane.recordSkillTelemetry(entries);
    const reloaded = service(root).skillTelemetry();
    expect(reloaded).toHaveLength(2);
    expect(reloaded[1].used).toBe(false);
  });

  it("bounds the node snapshot series per node", () => {
    const store = new RuntimeIntelligenceStore({ rootDir: makeRoot() });
    for (let index = 0; index < NODE_SNAPSHOT_HISTORY_LIMIT + 5; index += 1) {
      store.saveNodes([{ schemaVersion: 1, kind: "NODE_CAPABILITY_SNAPSHOT", nodeId: "node-a", hostId: { status: "UNKNOWN", reason: "x" }, capturedAt: new Date(Date.parse(AT) + index * 1000).toISOString(), identity: { deviceType: "unknown", os: "win32", arch: "x64", runtimeVersion: "v24" }, cpu: { logicalCores: { status: "MEASURED", value: 8, source: "t", observedAt: AT }, physicalCores: { status: "UNKNOWN", reason: "x" }, model: { status: "UNKNOWN", reason: "x" }, loadPercent: { status: "UNKNOWN", reason: "x" } }, memory: { totalMb: { status: "MEASURED", value: 100, source: "t", observedAt: AT }, freeMb: { status: "MEASURED", value: 50, source: "t", observedAt: AT } }, gpu: { devices: { status: "UNKNOWN", reason: "x" }, totalVramMb: { status: "UNKNOWN", reason: "x" } }, disk: { freeMb: { status: "UNKNOWN", reason: "x" }, totalMb: { status: "UNKNOWN", reason: "x" } }, network: { availability: { status: "UNKNOWN", reason: "x" }, latencyMs: { status: "UNKNOWN", reason: "x" }, quality: { status: "UNKNOWN", reason: "x" } }, load: { currentTasks: { status: "UNKNOWN", reason: "x" }, processPressure: { status: "UNKNOWN", reason: "x" } }, localModels: { status: "UNKNOWN", reason: "x" }, apis: { status: "UNKNOWN", reason: "x" }, tools: { status: "UNKNOWN", reason: "x" }, plugins: { status: "UNKNOWN", reason: "x" }, repo: { locality: { status: "UNKNOWN", reason: "x" }, warmCacheHints: { status: "UNKNOWN", reason: "x" } }, trust: { trustClass: "UNKNOWN_HOST", executionRestrictions: [] } }]);
    }
    expect(store.nodeHistory("node-a")).toHaveLength(NODE_SNAPSHOT_HISTORY_LIMIT);
    expect(store.latestNodeSnapshot("node-a")?.capturedAt).toBe(new Date(Date.parse(AT) + (NODE_SNAPSHOT_HISTORY_LIMIT + 4) * 1000).toISOString());
  });

  it("reports its status without claiming authority", () => {
    const root = makeRoot();
    const plane = service(root);
    const node = plane.profileNode();
    plane.recordOutcome({ task: task(), model: { provider: "vendor", family: "gpt", version: "1" }, nodeId: node.nodeId, success: true });
    const status = plane.status();
    expect(status.authority).toBe("ADVISORY_ONLY");
    expect(status.schemaVersion).toBe(1);
    expect(status.counts.observations).toBe(1);
    expect(status.counts.models).toBe(1);
    expect(status.counts.nodes).toBe(1);
    expect(status.rootDir).toBe(root);
    expect(status.degradedReason).toBeUndefined();
  });
});

describe("the plane degrades instead of throwing on damaged state", () => {
  it("returns an empty ledger and a degraded reason when a file is corrupt", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "models.json"), "{ not json", "utf8");
    fs.writeFileSync(path.join(root, "nodes.json"), JSON.stringify({ schemaVersion: 1, snapshots: "not-an-array" }), "utf8");
    fs.writeFileSync(path.join(root, "observations.jsonl"), `${JSON.stringify({ observationId: "kept" })}\n{"torn":\n`, "utf8");

    const store = new RuntimeIntelligenceStore({ rootDir: root });
    expect(store.loadModels()).toEqual([]);
    expect(store.loadNodes()).toEqual([]);
    // A torn line costs one row, not the log: the good row before it survives.
    const observations = store.observations();
    expect(observations).toHaveLength(1);
    expect((observations[0] as { observationId?: string }).observationId).toBe("kept");
    const status = store.status();
    expect(status.degradedReason).toContain("models.json");
    expect(status.degradedReason).toContain("nodes.json");
  });

  it("still records new work after a damaged read", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "models.json"), "not json at all", "utf8");
    const plane = service(root);
    const node = plane.profileNode();
    const { observation } = plane.recordOutcome({ task: task(), model: { provider: "vendor", family: "gpt", version: "1" }, nodeId: node.nodeId, success: true });
    expect(observation.execution.outcome).toBe("SUCCESS");
    expect(plane.store.observations()).toHaveLength(1);
    expect(plane.model("vendor", "gpt", "1")?.scores.coding.samples).toBe(1);
  });

  it("reports no model, node or context rather than throwing on an empty root", () => {
    const plane = service(makeRoot());
    expect(plane.models()).toEqual([]);
    expect(plane.nodes()).toEqual([]);
    expect(plane.model("nobody", "nothing")).toBeUndefined();
    expect(plane.latestNode("nobody")).toBeUndefined();
    expect(plane.adviseFor(task()).preferredModel).toBeUndefined();
    expect(plane.planContext({ taskId: "task-1" }).placements).toEqual([]);
  });
});

describe("the data root helper keeps the plane's files together", () => {
  it("places the plane under .boss in the given data root", () => {
    const root = runtimeIntelligenceRoot(path.join("C:", "data"));
    expect(root.endsWith(path.join(".boss", "runtime-intelligence"))).toBe(true);
  });
});
