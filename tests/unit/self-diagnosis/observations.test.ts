import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSelfModel, type SelfFacts } from "../../../src/shared/self-cognition/anatomy";
import {
  HEALTH_OBSERVATION_SCHEMA_VERSION,
  HEALTH_STATUSES,
  collectObservations,
  isAttributable,
  measuredObservation,
  statedObservation,
  unhealthyObservations,
  unknownObservation,
  type ExpectedRange,
  type HealthObservation,
  type HealthStatus,
  type SelfObservationSource
} from "../../../src/shared/self-diagnosis/observations";
import {
  SYMPTOM_KINDS,
  SYMPTOM_SCHEMA_VERSION,
  classifySignal,
  symptomOf,
  symptomsOf,
  unreadableSymptom,
  type SymptomKind
} from "../../../src/shared/self-diagnosis/hypotheses";
import {
  RECOVERY_COUNT_LIMIT,
  RUNTIME_FAILURE_SHARE_LIMIT,
  hostObservationSources,
  recoverySource,
  taskOutcomeSource,
  telemetrySource,
  type SourceOptions
} from "../../../electron/self-diagnosis/sources";

/**
 * Observations and symptoms.
 *
 * The two failures this file guards against are the ones that make a diagnosis untrustworthy: an
 * absent measurement read as healthy, and a source that cannot be read read as nothing wrong.
 */

const AT = "2026-09-20T10:00:00.000Z";
const dirs: string[] = [];
function makeDataRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-self-diagnosis-"));
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

const MODEL = buildSelfModel({
  capturedAt: AT,
  repositoryRoot: "C:/repo",
  capabilities: [
    { id: "providers", kind: "kernel", provides: ["provider.runtime@1"], requires: [], optional: [], state: [], modules: [], bootModules: [], surface: [], critical: true },
    { id: "tasks", kind: "feature", provides: ["task.lifecycle@1"], requires: [{ ref: "provider.runtime@1" }], optional: [], state: [], modules: [], bootModules: [], surface: [], critical: false }
  ],
  ownership: { capabilities: { providers: ["electron/runtimes"], tasks: ["electron/commander"] }, exempt: {} },
  bootWiring: [],
  scripts: [],
  authority: [
    { path: "electron/runtimes", surface: "PRODUCT_SURFACE", ownerReview: "ALLOW", detail: "PRODUCT_SURFACE" },
    { path: "electron/commander", surface: "PRODUCT_SURFACE", ownerReview: "ALLOW", detail: "PRODUCT_SURFACE" }
  ],
  unreadable: []
} satisfies SelfFacts);

describe("an observation is a measurement or an honest absence", () => {
  it("turns a number into a status against its own stated range", () => {
    const healthy = measuredObservation({ componentId: "providers", signalId: "timeout.rate", measurement: 0.1, expectedRange: { max: 0.3 }, at: AT, source: "test" });
    expect(healthy.status).toBe("HEALTHY");
    expect(healthy.schemaVersion).toBe(HEALTH_OBSERVATION_SCHEMA_VERSION);
    const degraded = measuredObservation({ componentId: "providers", signalId: "timeout.rate", measurement: 0.4, expectedRange: { max: 0.3 }, at: AT, source: "test" });
    expect(degraded.status).toBe("DEGRADED");
    expect(degraded.detail).toContain("outside the expected at most 0.3");
    const unhealthy = measuredObservation({ componentId: "providers", signalId: "timeout.rate", measurement: 0.9, expectedRange: { max: 0.3 }, at: AT, source: "test" });
    expect(unhealthy.status).toBe("UNHEALTHY");
    const below = measuredObservation({ componentId: "providers", signalId: "available.nodes", measurement: 0, expectedRange: { min: 1 }, at: AT, source: "test" });
    expect(below.status).toBe("UNHEALTHY");
    // A measured reading always says where it came from.
    expect(healthy.source).toBe("test");
    expect(healthy.measurement).toBe(0.1);
  });

  it("keeps UNKNOWN and NOT_MEASURED out of the healthy bucket", () => {
    expect(HEALTH_STATUSES).toEqual(["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN", "NOT_MEASURED"]);
    const unknown = unknownObservation({ componentId: "providers", signalId: "timeout.rate", at: AT, source: "telemetry.json", reason: "no entry exists" });
    const status: HealthStatus = unknown.status;
    expect(status).toBe("UNKNOWN");
    expect(unknown.measurement).toBeUndefined();
    expect(unknown.confidence).toBe(0);
    expect(unhealthyObservations([unknown])).toEqual([]);
    // ...and it is not reported as healthy either: only HEALTHY is healthy.
    expect(unknown.status).not.toBe("HEALTHY");
    const stated = statedObservation({ componentId: "providers", signalId: "x", status: "NOT_MEASURED", at: AT, source: "s", detail: "nothing observed it" });
    expect(stated.status).toBe("NOT_MEASURED");
  });

  it("attributes a reading to a component the anatomy holds, and says when it cannot", () => {
    const known = measuredObservation({ componentId: "providers", signalId: "x", measurement: 1, at: AT, source: "s" });
    const unknown = measuredObservation({ componentId: "runtime:web:chatgpt", signalId: "x", measurement: 1, at: AT, source: "s" });
    expect(isAttributable(MODEL, known)).toBe(true);
    expect(isAttributable(MODEL, unknown)).toBe(false);
  });

  it("isolates a source that throws, and keeps the readings of the others", () => {
    const throwing: SelfObservationSource = { id: "broken.json", observe: () => { throw new Error("the file is a directory"); } };
    const working: SelfObservationSource = { id: "good.json", observe: () => ({ observations: [statedObservation({ componentId: "providers", signalId: "x", status: "HEALTHY", at: AT, source: "good.json", detail: "fine" })], unreadable: [{ source: "other.json", reason: "missing" }] }) };
    const collected = collectObservations({ model: MODEL, at: AT, sources: [throwing, working] });
    expect(collected.observations).toHaveLength(1);
    expect(collected.sourceFailures).toEqual([{ source: "broken.json", reason: "the file is a directory" }]);
    expect(collected.unreadable).toEqual([{ source: "other.json", reason: "missing" }]);
  });
});

describe("a symptom names what was seen", () => {
  it("classifies a signal into the vocabulary, and never drops one it does not know", () => {
    expect(classifySignal("web:chatgpt.providerFailureShare")).toBe("PROVIDER_FAILURE_SPIKE");
    expect(classifySignal("provider.timeout.rate")).toBe("PROVIDER_TIMEOUT_SPIKE");
    expect(classifySignal("taskLedger.writeFailure")).toBe("TASK_LEDGER_WRITE_FAILURE");
    expect(classifySignal("eventBus.handlerFailures")).toBe("EVENT_BUS_DELIVERY_GAP");
    expect(classifySignal("prospective.window.unreadable")).toBe("CAPTURE_LOG_CORRUPTION");
    expect(classifySignal("state.schemaMismatch")).toBe("STATE_SCHEMA_MISMATCH");
    expect(classifySignal("cache.staleAge")).toBe("CACHE_STALE");
    expect(classifySignal("recovery.count")).toBe("RECOVERY_STORM");
    expect(classifySignal("something.nobody.named")).toBe("UNCLASSIFIED");
    expect(SYMPTOM_KINDS).toContain("UNCLASSIFIED");
    const kind: SymptomKind = classifySignal("whatever");
    expect(kind).toBe("UNCLASSIFIED");
  });

  it("turns only the unhealthy readings into symptoms", () => {
    const healthy = measuredObservation({ componentId: "providers", signalId: "timeout.rate", measurement: 0.1, expectedRange: { max: 0.3 }, at: AT, source: "s" });
    const degraded = measuredObservation({ componentId: "providers", signalId: "timeout.rate", measurement: 0.5, expectedRange: { max: 0.3 }, at: AT, source: "s" });
    const symptoms = symptomsOf([healthy, degraded]);
    expect(symptoms).toHaveLength(1);
    expect(symptoms[0].kind).toBe("PROVIDER_TIMEOUT_SPIKE");
    expect(symptoms[0].severity).toBe("MEDIUM");
    expect(symptoms[0].id).toBe("symptom:providers:timeout.rate");
    expect(symptoms[0].evidence[0]).toContain("reported timeout.rate as DEGRADED");
    // The reading is kept verbatim, so a reader can check the classification.
    expect(symptoms[0].observation).toEqual(degraded);
  });

  it("makes a blind spot its own symptom rather than a silence", () => {
    const symptom = unreadableSymptom({ source: "telemetry.json", reason: "ENOENT", componentId: "source:telemetry.json", at: AT });
    expect(symptom.kind).toBe("SOURCE_UNREADABLE");
    expect(symptom.severity).toBe("LOW");
    expect(symptom.confidence).toBe(0);
    expect(symptom.evidence[0]).toContain("could not be read: ENOENT");
  });
});

describe("the observation vocabulary is exactly what it claims to be", () => {
  it("names its schema version, its range shape and its symptom classifier", () => {
    expect(HEALTH_OBSERVATION_SCHEMA_VERSION).toBe(1);
    const range: ExpectedRange = { min: 0, max: 1 };
    const observation = measuredObservation({ componentId: "providers", signalId: "x", measurement: 0.5, expectedRange: range, at: AT, source: "test" });
    expect(observation.schemaVersion).toBe(HEALTH_OBSERVATION_SCHEMA_VERSION);
    expect(observation.expectedRange).toEqual(range);
    // A healthy reading is not a symptom, and the classifier says so by returning nothing.
    expect(symptomOf(observation)).toBeUndefined();
    const unhealthy = measuredObservation({ componentId: "providers", signalId: "x.timeout", measurement: 0.9, expectedRange: { max: 0.3 }, at: AT, source: "test" });
    expect(symptomOf(unhealthy)?.schemaVersion).toBe(SYMPTOM_SCHEMA_VERSION);
    expect(SYMPTOM_SCHEMA_VERSION).toBe(1);
  });
});

describe("the host sources read what the application already recorded", () => {
  it("accepts a source options bundle, which is what the CLI builds", () => {
    const options: SourceOptions = { dataRoot: makeDataRoot() };
    expect(hostObservationSources(options)).toHaveLength(3);
    expect(telemetrySource(options).id).toBe("telemetry.json");
  });

  it("reads task and run outcomes from the state document", () => {
    const dataRoot = makeDataRoot();
    fs.writeFileSync(path.join(dataRoot, "state.json"), JSON.stringify({
      tasks: [{ id: "a", status: "completed" }, { id: "b", status: "failed" }, { id: "c", status: "running" }],
      runs: [{ id: "r1", outcome: "SUCCESS" }, { id: "r2", outcome: "FAILED" }, { id: "r3", outcome: "FAILED" }]
    }), "utf8");
    const result = taskOutcomeSource({ dataRoot }).observe({ model: MODEL, at: AT });
    expect(result.unreadable).toEqual([]);
    const failureShare = result.observations.find((observation) => observation.signalId === "tasks.taskFailureShare");
    expect(failureShare?.measurement).toBe(0.5);
    // 0.5 is at the limit, not above it: the range is stated in the reading.
    expect(failureShare?.status).toBe("HEALTHY");
    const runs = result.observations.find((observation) => observation.signalId === "runs.failedRunCount");
    expect(runs?.measurement).toBe(2);
    expect(runs?.status).toBe("HEALTHY");
  });

  it("reports a missing data root as unreadable, not as nothing wrong", () => {
    const missing = path.join(makeDataRoot(), "absent");
    for (const source of hostObservationSources({ dataRoot: missing })) {
      const result = source.observe({ model: MODEL, at: AT });
      expect(result.observations).toEqual([]);
      expect(result.unreadable).toHaveLength(1);
      expect(result.unreadable[0].reason.length).toBeGreaterThan(0);
    }
  });

  it("reads a telemetry failure share and a recovery count", () => {
    const dataRoot = makeDataRoot();
    fs.mkdirSync(path.join(dataRoot, ".boss"), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, ".boss", "telemetry.json"), JSON.stringify({
      entries: [
        { runtimeId: "web:chatgpt", outcome: "FAILED", reason: "timeout after 30s" },
        { runtimeId: "web:chatgpt", outcome: "FAILED", reason: "timeout after 30s" },
        { runtimeId: "web:chatgpt", outcome: "SUCCESS" },
        { runtimeId: "web:qwen", outcome: "SUCCESS" },
        { runtimeId: "web:qwen", outcome: "FAILED", reason: "quota" },
        { runtimeId: "web:qwen", outcome: "SUCCESS" },
        { runtimeId: "web:qwen", outcome: "SUCCESS" },
        { runtimeId: "web:qwen", outcome: "SUCCESS" }
      ]
    }), "utf8");
    fs.writeFileSync(path.join(dataRoot, ".boss", "recovery.json"), JSON.stringify({ records: [{ runtimeId: "web:chatgpt" }, { runtimeId: "web:chatgpt" }, { runtimeId: "web:chatgpt" }, { runtimeId: "web:chatgpt" }, { runtimeId: "web:chatgpt" }, { runtimeId: "web:chatgpt" }] }), "utf8");
    const telemetry = telemetrySource({ dataRoot }).observe({ model: MODEL, at: AT });
    const share = telemetry.observations.find((observation) => observation.signalId === "web:chatgpt.providerFailureShare");
    expect(share?.measurement).toBeCloseTo(0.667, 2);
    // More than double the limit is UNHEALTHY; between the limit and double is DEGRADED.
    expect(share?.status).toBe("UNHEALTHY");
    expect(share?.detail).toContain("the last reason was timeout after 30s");
    expect(share?.source).toBe("telemetry.json entries[].outcome");
    const mild = telemetry.observations.find((observation) => observation.signalId === "web:qwen.providerFailureShare");
    expect(mild?.measurement).toBe(0.2);
    expect(mild?.status).toBe("HEALTHY");
    expect(RUNTIME_FAILURE_SHARE_LIMIT).toBe(0.3);
    const recovery = recoverySource({ dataRoot }).observe({ model: MODEL, at: AT });
    expect(recovery.observations[0].measurement).toBe(6);
    // Just over the limit is a degradation, not a catastrophe: the severity rule is stated in
    // measuredObservation and the reading follows it rather than the mood of the caller.
    expect(recovery.observations[0].status).toBe("DEGRADED");
    expect(RECOVERY_COUNT_LIMIT).toBe(5);
  });

  it("says UNKNOWN when a file it could read holds no entry at all", () => {
    const dataRoot = makeDataRoot();
    fs.mkdirSync(path.join(dataRoot, ".boss"), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, ".boss", "telemetry.json"), JSON.stringify({ entries: [] }), "utf8");
    const result = telemetrySource({ dataRoot }).observe({ model: MODEL, at: AT });
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].status).toBe("UNKNOWN");
    expect(result.observations[0].detail).toContain("holds no runtime entry");
    const observations: HealthObservation[] = result.observations;
    expect(observations[0].confidence).toBe(0);
  });

  it("refuses a state document that is not an object", () => {
    const dataRoot = makeDataRoot();
    fs.writeFileSync(path.join(dataRoot, "state.json"), "[1,2,3]", "utf8");
    const result = taskOutcomeSource({ dataRoot }).observe({ model: MODEL, at: AT });
    expect(result.observations).toEqual([]);
    expect(result.unreadable[0].reason).toContain("did not parse to an object");
  });
});
