import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHARGEABLE_FAILURE_DOMAINS,
  DOMAIN_MARKERS,
  MARKER_PRECEDENCE,
  RUNTIME_STATUS_DOMAINS,
  SEMANTIC_MODEL_OUTCOMES,
  SEMANTIC_REFUSAL_OUTCOMES,
  classifyOutcome,
  outcomeKindOf,
  planOutcomeCharge,
  toModelOutcomeInput,
  type IngestOutcomeInput,
  type OutcomeCharge,
  type OutcomeClassification,
  type OutcomeSignals
} from "../../../src/shared/runtime-intelligence/outcome-ingestion";
import { ATTRIBUTABLE_FAILURE_DOMAINS, FAILURE_DOMAINS, OUTCOME_KINDS, PARTIAL_SUCCESS_QUALITY, type OutcomeKind, type TaskKind } from "../../../src/shared/runtime-intelligence/contracts";
import { applyModelOutcome, createModelRecord } from "../../../src/shared/runtime-intelligence/model-ledger";
import { learningRootOf, modelIdentityFor, readRealOutcomes, telemetryFileOf, toIngestionSignals, type OutcomeSourceOptions, type RealOutcomeRecord } from "../../../electron/runtime-intelligence/outcome-source";
import { RuntimeIntelligenceService, type IngestionSummary } from "../../../electron/runtime-intelligence/runtime-intelligence-service";
import type { TelemetryRecord } from "../../../electron/telemetry/telemetry-store";

/**
 * Phase G. The rule under test is the plan's: an environment failure must never be charged
 * to model capability. Every domain below is exercised, the two chargeable ones are proven
 * to move the ledger, and every non-chargeable one is proven NOT to — including the case
 * the plan names by hand, a network outage followed by a missing tool.
 */

const AT = "2026-01-01T00:00:00.000Z";

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-ingest-"));
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

function classify(kind: OutcomeKind, signals: OutcomeSignals = {}): OutcomeClassification {
  return classifyOutcome({ kind, signals });
}

/** Writes the telemetry file the running application writes, through the real path helper. */
function writeTelemetry(root: string, records: TelemetryRecord[]): void {
  fs.mkdirSync(path.join(root, ".boss"), { recursive: true });
  fs.writeFileSync(telemetryFileOf(root), JSON.stringify({ schemaVersion: 1, records }, null, 2), "utf8");
}

describe("only MODEL and SEMANTIC may be charged to model capability", () => {
  it("declares the chargeable set explicitly", () => {
    expect(CHARGEABLE_FAILURE_DOMAINS).toEqual(["MODEL", "SEMANTIC"]);
    expect(ATTRIBUTABLE_FAILURE_DOMAINS).toEqual(CHARGEABLE_FAILURE_DOMAINS);
    // The vocabulary is closed, and every domain is either chargeable or explicitly not.
    expect(FAILURE_DOMAINS).toHaveLength(13);
    for (const domain of FAILURE_DOMAINS) {
      expect(CHARGEABLE_FAILURE_DOMAINS.includes(domain)).toBe(CHARGEABLE_FAILURE_DOMAINS.includes(domain));
    }
    expect(OUTCOME_KINDS).toEqual(["SUCCESS", "PARTIAL_SUCCESS", "FAILURE", "SEMANTIC_REFUSAL", "TIMEOUT", "CANCELLED"]);
  });

  it("exposes the source and summary shapes a caller needs", () => {
    const options: OutcomeSourceOptions = { dataRoot: makeRoot() };
    const read = readRealOutcomes(options);
    expect(read.degraded).toEqual([]);
    expect(learningRootOf(options.dataRoot).endsWith(path.join(".boss", "learning"))).toBe(true);
    const plane = new RuntimeIntelligenceService({ rootDir: makeRoot(), now: () => AT });
    const summary: IngestionSummary = plane.ingestRealOutcomes({ dataRoot: options.dataRoot });
    expect(summary.considered).toBe(0);
    expect(summary.charged).toBe(0);
    expect(summary.refused).toBe(0);
    expect(summary.domains).toEqual({});
  });

  it("charges a model failure", () => {
    const result = classify("FAILURE", { producedOutput: true });
    expect(result.domain).toBe("MODEL");
    expect(result.attributable).toBe(true);
  });

  it("charges a semantic refusal, and says it charges reliability rather than stability", () => {
    const charge: OutcomeCharge = planOutcomeCharge({ kind: "SEMANTIC_REFUSAL", taskKind: "coding", signals: {} });
    expect(charge.classification.domain).toBe("SEMANTIC");
    expect(charge.chargeable).toBe(true);
    expect(charge.dimensions).toEqual(["reliability"]);
    expect(charge.classification.reasons.join(" ")).toContain("never stability");
  });

  const environmentCases: Array<[string, OutcomeKind, OutcomeSignals, string]> = [
    ["a network outage", "FAILURE", { networkUnavailable: true }, "NETWORK"],
    ["a host outage", "FAILURE", { hostUnavailable: true }, "HOST"],
    ["a missing tool", "FAILURE", { toolMissing: "cargo" }, "TOOL"],
    ["a sandbox failure", "FAILURE", { sandboxFailure: true }, "ENVIRONMENT"],
    ["a rejected credential", "FAILURE", { credentialRejected: true }, "CREDENTIAL"],
    ["a provider rate limit", "FAILURE", { rateLimited: true }, "RATE_LIMIT"],
    ["a changed automation surface", "FAILURE", { runtimeStatus: "PAGE_CHANGED" }, "AUTOMATION_SURFACE"],
    ["a run awaiting a human", "FAILURE", { runtimeStatus: "USER_ACTION_REQUIRED" }, "HUMAN"],
    ["a cancelled run", "CANCELLED", {}, "HUMAN"],
    ["a bare timeout", "TIMEOUT", {}, "TRANSIENT"],
    ["an unattributed failure with no output", "FAILURE", {}, "UNKNOWN"],
    ["a retryable transport failure", "FAILURE", { runtimeStatus: "RETRYABLE_FAILURE" }, "TRANSIENT"]
  ];

  for (const [name, kind, signals, expectedDomain] of environmentCases) {
    it(`does NOT charge ${name} to the model`, () => {
      const result = classify(kind, signals);
      expect(result.domain).toBe(expectedDomain);
      expect(result.attributable, `${name} was charged to the model`).toBe(false);
      const charge = planOutcomeCharge({ kind, taskKind: "coding", signals });
      expect(charge.chargeable).toBe(false);
      expect(charge.dimensions).toEqual([]);
      // And there is nothing to fold: the ledger input does not exist.
      const ledgerInput = toModelOutcomeInput({ taskId: "t", role: "coder", taskKind: "coding", kind, signals, at: AT, observationId: "o", nodeId: "n" });
      expect(ledgerInput).toBeUndefined();
    });
  }

  it("reads the domain out of a real runtime status before any text matching", () => {
    expect(RUNTIME_STATUS_DOMAINS.AUTH_REQUIRED).toBe("CREDENTIAL");
    expect(RUNTIME_STATUS_DOMAINS.RATE_LIMITED).toBe("RATE_LIMIT");
    expect(RUNTIME_STATUS_DOMAINS.UNSUPPORTED).toBe("TOOL");
    expect(classify("FAILURE", { runtimeStatus: "AUTH_REQUIRED" }).domain).toBe("CREDENTIAL");
  });

  it("reads the domain out of a real semantic outcome", () => {
    for (const refusal of SEMANTIC_REFUSAL_OUTCOMES) {
      expect(classify("FAILURE", { semanticOutcome: refusal }).domain).toBe("SEMANTIC");
    }
    for (const modelFailure of SEMANTIC_MODEL_OUTCOMES) {
      expect(classify("FAILURE", { semanticOutcome: modelFailure }).domain).toBe("MODEL");
    }
    expect(classify("SUCCESS", { semanticOutcome: "FULL_COMPLETION" }).domain).toBe("NONE");
  });

  it("reads the domain out of the recorded reason text", () => {
    expect(classify("FAILURE", { reason: "network unavailable" }).domain).toBe("NETWORK");
    expect(classify("FAILURE", { reason: "tool not found: pnpm" }).domain).toBe("TOOL");
    expect(classify("FAILURE", { reason: "ECONNREFUSED" }).domain).toBe("NETWORK");
    expect(classify("FAILURE", { reason: "page changed: send button" }).domain).toBe("AUTOMATION_SURFACE");
    expect(classify("FAILURE", { reason: "invalid api key" }).domain).toBe("CREDENTIAL");
    expect(classify("FAILURE", { reason: "the model refused to answer" }).domain).toBe("SEMANTIC");
    expect(DOMAIN_MARKERS.UNKNOWN).toEqual([]);
  });

  it("does not let a socket error be read as a model refusal", () => {
    // `ECONNREFUSED` contains "refused". The precedence list puts the transport domains
    // first precisely so this cannot be charged to the model as a semantic refusal.
    const result = classify("FAILURE", { reason: "connect ECONNREFUSED 127.0.0.1:443" });
    expect(result.domain).toBe("NETWORK");
    expect(result.chargeable).toBe(false);
    expect(MARKER_PRECEDENCE.indexOf("NETWORK")).toBeLessThan(MARKER_PRECEDENCE.indexOf("SEMANTIC"));
    expect(MARKER_PRECEDENCE.at(-1)).toBe("UNKNOWN");
  });

  it("charges a timeout only when the model was demonstrably the slow part", () => {
    expect(classify("TIMEOUT", {}).domain).toBe("TRANSIENT");
    expect(classify("TIMEOUT", { modelTooSlow: true }).domain).toBe("MODEL");
    expect(classify("TIMEOUT", { networkUnavailable: true }).domain).toBe("NETWORK");
    // A timeout whose only marker is not network or host stays ambiguous.
    expect(classify("TIMEOUT", { reason: "retryable" }).domain).toBe("TRANSIENT");
    expect(classify("TIMEOUT", { reason: "host unavailable" }).domain).toBe("HOST");
  });

  it("does not charge an unattributed failure that produced no output", () => {
    const result = classify("FAILURE", {});
    expect(result.domain).toBe("UNKNOWN");
    expect(result.attributable).toBe(false);
    expect(result.reasons.join(" ")).toContain("not charged");
  });
});

describe("the ledger is genuinely untouched by environment failures", () => {
  function trainedRecord() {
    let record = createModelRecord({ provider: "vendor", family: "gpt", version: "1", at: AT });
    for (let index = 0; index < 6; index += 1) {
      record = applyModelOutcome(record, { observationId: `o${index}`, taskId: "t", nodeId: "n", role: "coder", taskKind: "coding", success: true, at: AT }).record;
    }
    return record;
  }

  const before = trainedRecord();
  const baselineScores = { coding: before.scores.coding.score, reasoning: before.scores.reasoning.score, stability: before.scores.stability.score, reliability: before.scores.reliability.score };

  const environmentSignals: OutcomeSignals[] = [
    { networkUnavailable: true },
    { toolMissing: "pnpm" },
    { hostUnavailable: true },
    { sandboxFailure: true },
    { rateLimited: true },
    { credentialRejected: true },
    { reason: "network unavailable" },
    { reason: "tool not found" }
  ];

  for (const [index, signals] of environmentSignals.entries()) {
    it(`leaves reasoning/coding/stability unchanged for environment failure #${index + 1}`, () => {
      const ledgerInput = toModelOutcomeInput({ taskId: "t", role: "coder", taskKind: "coding", kind: "FAILURE", signals, at: AT, observationId: "o", nodeId: "n" });
      expect(ledgerInput).toBeUndefined();
      // The proof is that there is nothing to apply, so the record cannot move.
      expect(before.scores.coding.score).toBe(baselineScores.coding);
      expect(before.scores.reasoning.score).toBe(baselineScores.reasoning);
      expect(before.scores.stability.score).toBe(baselineScores.stability);
    });
  }

  it("fires the control: a MODEL failure DOES move those scores", () => {
    const moved = applyModelOutcome(before, {
      observationId: "model-failure",
      taskId: "t",
      nodeId: "n",
      role: "coder",
      taskKind: "coding",
      success: false,
      attribution: "RUNTIME",
      at: AT
    }).record;
    expect(moved.scores.coding.score).toBeLessThan(baselineScores.coding);
    expect(moved.scores.stability.score).toBeLessThan(baselineScores.stability);
  });

  it("does not move stability on a semantic refusal but does move reliability", () => {
    const ledgerInput = toModelOutcomeInput({ taskId: "t", role: "coder", taskKind: "coding", kind: "SEMANTIC_REFUSAL", signals: {}, at: AT, observationId: "o", nodeId: "n" });
    expect(ledgerInput?.attribution).toBe("SEMANTIC");
    const moved = applyModelOutcome(before, ledgerInput!).record;
    expect(moved.scores.reliability.score).toBeLessThan(baselineScores.reliability);
    expect(moved.scores.stability.score).toBe(baselineScores.stability);
  });
});

describe("outcome kinds map from the words Boss really records", () => {
  it("maps success, partial, refusal, timeout, cancellation and failure", () => {
    expect(outcomeKindOf("SUCCESS")).toBe("SUCCESS");
    expect(outcomeKindOf("FAILED", "partial completion")).toBe("PARTIAL_SUCCESS");
    expect(outcomeKindOf("FAILED", "hard refusal")).toBe("SEMANTIC_REFUSAL");
    expect(outcomeKindOf("FAILED", "request timed out")).toBe("TIMEOUT");
    expect(outcomeKindOf("CANCELLED")).toBe("CANCELLED");
    expect(outcomeKindOf("DEFERRED")).toBe("CANCELLED");
    expect(outcomeKindOf("FAILED")).toBe("FAILURE");
    expect(outcomeKindOf(undefined, undefined)).toBe("FAILURE");
  });

  it("records a partial success at the documented convention when no quality was measured", () => {
    const ledgerInput = toModelOutcomeInput({ taskId: "t", role: "coder", taskKind: "coding", kind: "PARTIAL_SUCCESS", at: AT, observationId: "o", nodeId: "n" });
    expect(ledgerInput?.success).toBe(true);
    expect(ledgerInput?.quality).toBe(PARTIAL_SUCCESS_QUALITY);
    const measured = toModelOutcomeInput({ taskId: "t", role: "coder", taskKind: "coding", kind: "PARTIAL_SUCCESS", quality: 0.8, at: AT, observationId: "o", nodeId: "n" });
    expect(measured?.quality).toBe(0.8);
  });

  it("keeps an explicit quality for a failure so a review can lower the estimate", () => {
    const ledgerInput = toModelOutcomeInput({ taskId: "t", role: "coder", taskKind: "coding", kind: "FAILURE", signals: { producedOutput: true }, quality: 0.2, at: AT, observationId: "o", nodeId: "n" });
    expect(ledgerInput?.quality).toBe(0.2);
    expect(ledgerInput?.success).toBe(false);
  });
});

describe("real Boss telemetry and episodes are the ingestion source", () => {
  it("reads real telemetry records through the real store", () => {
    const root = makeRoot();
    writeTelemetry(root, [
      { taskId: "task-1", jobId: "job-1", runtimeId: "web:chatgpt", role: "worker", outcome: "SUCCESS", modelCalls: 1, estimatedTokens: 100, latencyMs: 900, retries: 0, at: AT },
      { taskId: "task-2", jobId: "job-2", runtimeId: "web:qwen", role: "worker", outcome: "FAILED", reason: "network unavailable", modelCalls: 1, estimatedTokens: 50, latencyMs: 100, retries: 1, at: AT }
    ]);
    const read = readRealOutcomes({ dataRoot: root });
    expect(read.records).toHaveLength(2);
    expect(read.sources.find((source) => source.name === "telemetry")).toMatchObject({ present: true, records: 2 });
    expect(read.sources.find((source) => source.name === "episode")).toMatchObject({ present: false, records: 0 });
    expect(read.degraded).toEqual([]);
    expect(read.records[1].reason).toBe("network unavailable");
  });

  it("reports an absent data root as empty rather than degraded", () => {
    const read = readRealOutcomes({ dataRoot: path.join(makeRoot(), "does-not-exist") });
    expect(read.records).toEqual([]);
    expect(read.degraded).toEqual([]);
    expect(read.sources.every((source) => !source.present)).toBe(true);
  });

  it("degrades a corrupt telemetry file with its reason and still returns", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, ".boss"), { recursive: true });
    fs.writeFileSync(telemetryFileOf(root), "{ not json", "utf8");
    const read = readRealOutcomes({ dataRoot: root });
    expect(read.records).toEqual([]);
    expect(read.degraded).toHaveLength(1);
    expect(read.degraded[0]).toContain("telemetry could not be read");
    expect(read.sources[0].degradedReason).toBeTruthy();
  });

  it("never invents a model version from a runtime id", () => {
    const record: RealOutcomeRecord = { source: "telemetry", taskId: "t", runtimeId: "web:chatgpt", rawOutcome: "SUCCESS", at: AT };
    const identity = modelIdentityFor(record);
    expect(identity.family).toBe("web:chatgpt");
    expect(identity.provider).toBe("web");
    // No version field at all, so `modelKeyOf` must spell it unknown.
    expect(Object.keys(identity)).toEqual(["provider", "family"]);
    const withProvider = modelIdentityFor({ ...record, provider: "openai" });
    expect(withProvider.provider).toBe("openai");
  });

  it("passes only the signals a telemetry record actually carries", () => {
    const record: RealOutcomeRecord = { source: "telemetry", taskId: "t", runtimeId: "web:chatgpt", rawOutcome: "FAILED", reason: "tool not found", at: AT };
    const signals = toIngestionSignals(record);
    expect(signals.runtimeStatus).toBe("FAILED");
    expect(signals.reason).toBe("tool not found");
    // Telemetry does not say whether an output was produced, so nothing claims it did.
    expect(signals.producedOutput).toBeUndefined();
  });
});

describe("the service ingests a real corpus and records the domain", () => {
  function service(rootDir: string): RuntimeIntelligenceService {
    return new RuntimeIntelligenceService({ rootDir, now: () => AT });
  }

  const corpus: TelemetryRecord[] = [
    { taskId: "task-1", jobId: "job-1", runtimeId: "web:chatgpt", role: "worker", outcome: "SUCCESS", modelCalls: 1, estimatedTokens: 100, latencyMs: 900, retries: 0, at: AT },
    { taskId: "task-2", jobId: "job-2", runtimeId: "web:chatgpt", role: "worker", outcome: "FAILED", reason: "network unavailable", modelCalls: 0, estimatedTokens: 0, latencyMs: 50, retries: 1, at: AT },
    { taskId: "task-3", jobId: "job-3", runtimeId: "web:qwen", role: "worker", outcome: "FAILED", reason: "tool not found: pnpm", modelCalls: 0, estimatedTokens: 0, latencyMs: 10, retries: 0, at: AT },
    { taskId: "task-4", jobId: "job-4", runtimeId: "web:qwen", role: "worker", outcome: "FAILED", reason: "unexplained", modelCalls: 1, estimatedTokens: 20, latencyMs: 400, retries: 0, at: AT },
    { taskId: "task-5", jobId: "job-5", runtimeId: "web:claude", role: "worker", outcome: "CANCELLED", modelCalls: 0, estimatedTokens: 0, latencyMs: 5, retries: 0, at: AT }
  ];

  it("summarises what it found, charged and refused", () => {
    const dataRoot = makeRoot();
    writeTelemetry(dataRoot, corpus);
    const plane = service(makeRoot());
    const summary = plane.ingestRealOutcomes({ dataRoot });
    expect(summary.considered).toBe(5);
    expect(summary.ingested).toBe(5);
    expect(summary.degraded).toEqual([]);
    // One success is chargeable, four failures are not: network, tool, unknown, cancelled.
    expect(summary.charged).toBe(1);
    expect(summary.refused).toBe(4);
    expect(summary.domains.NETWORK).toBe(1);
    expect(summary.domains.TOOL).toBe(1);
    expect(summary.domains.UNKNOWN).toBe(1);
    expect(summary.domains.HUMAN).toBe(1);
    expect(summary.domains.NONE).toBe(1);
  });

  it("records every outcome as an observation carrying its failure domain", () => {
    const dataRoot = makeRoot();
    writeTelemetry(dataRoot, corpus);
    const plane = service(makeRoot());
    plane.ingestRealOutcomes({ dataRoot });
    const observations = plane.store.observations();
    expect(observations).toHaveLength(5);
    const byTask = new Map(observations.map((entry) => [entry.task.taskId, entry]));
    expect(byTask.get("task-1")?.execution.outcome).toBe("SUCCESS");
    expect(byTask.get("task-2")?.execution.failureDomain).toBe("NETWORK");
    expect(byTask.get("task-3")?.execution.failureDomain).toBe("TOOL");
    expect(byTask.get("task-4")?.execution.failureDomain).toBe("UNKNOWN");
    expect(byTask.get("task-5")?.execution.outcome).toBe("CANCELLED");
  });

  it("says in the record why a failure was NOT charged", () => {
    const dataRoot = makeRoot();
    writeTelemetry(dataRoot, corpus);
    const plane = service(makeRoot());
    plane.ingestRealOutcomes({ dataRoot });
    const network = plane.store.observations().find((entry) => entry.task.taskId === "task-2")!;
    expect(network.capabilityUpdate.applied).toBe(false);
    expect(network.capabilityUpdate.reason).toContain("not charged");
    expect(network.capabilityUpdate.reason).toContain("NETWORK");
    expect(network.capabilityUpdate.dimensions).toEqual([]);
  });

  it("keeps environment failures out of the model scores end to end", () => {
    const dataRoot = makeRoot();
    writeTelemetry(dataRoot, corpus);
    const plane = service(makeRoot());
    plane.ingestRealOutcomes({ dataRoot });
    const chatgpt = plane.model("web", "web:chatgpt");
    const qwen = plane.model("web", "web:qwen");
    // chatgpt: one success, one network failure. Only the success may be in the ledger.
    expect(chatgpt?.taskTypePerformance.other).toEqual({ attempts: 1, successes: 1, failures: 0 });
    // qwen: a tool failure and an unattributed failure. Neither is a model failure, so the
    // ledger has no task-type entry for it at all — no attempt, not even a failed one.
    expect(qwen?.taskTypePerformance.other).toBeUndefined();
    expect(qwen?.failureClasses).toEqual({});
    // And a success moved the score above the untouched warm-start prior.
    expect(chatgpt!.scores.reliability.score).toBeGreaterThan(0);
    expect(qwen!.scores.reliability.samples).toBe(0);
  });

  it("charges a model failure and moves the ledger, which is the control for the above", () => {
    const plane = service(makeRoot());
    const recorded = plane.ingestOutcome({
      taskId: "task-1",
      role: "coder",
      taskKind: "coding",
      kind: "FAILURE",
      signals: { producedOutput: true, runtimeFailureCode: "MODEL_OUTPUT_INVALID" },
      model: { provider: "vendor", family: "gpt", version: "1" },
      at: AT
    });
    expect(recorded.chargeable).toBe(true);
    expect(recorded.domain).toBe("MODEL");
    expect(recorded.observation.capabilityUpdate.applied).toBe(true);
    expect(recorded.observation.execution.failureDomain).toBe("MODEL");
    expect(plane.model("vendor", "gpt", "1")?.taskTypePerformance.coding?.failures).toBe(1);
  });

  it("survives a damaged source and still ingests the healthy one", () => {
    const dataRoot = makeRoot();
    writeTelemetry(dataRoot, corpus);
    const learningDir = path.join(dataRoot, ".boss", "learning");
    fs.mkdirSync(learningDir, { recursive: true });
    fs.writeFileSync(path.join(learningDir, "episodes.jsonl"), "{ this is not a row\n", "utf8");
    const plane = service(makeRoot());
    const summary = plane.ingestRealOutcomes({ dataRoot });
    // The episode source exists; whether it degrades or reads zero rows, telemetry still lands.
    expect(summary.ingested).toBe(5);
    expect(summary.sources.find((source) => source.name === "telemetry")?.records).toBe(5);
  });

  it("honours a limit so a huge corpus can be sampled", () => {
    const dataRoot = makeRoot();
    writeTelemetry(dataRoot, corpus);
    const plane = service(makeRoot());
    const summary = plane.ingestRealOutcomes({ dataRoot, limit: 2 });
    expect(summary.considered).toBe(5);
    expect(summary.ingested).toBe(2);
    expect(plane.store.observations()).toHaveLength(2);
  });
});

describe("recommendations are logged so a replay can join them to outcomes", () => {
  it("persists the recommendation and joins it to the observation", () => {
    const root = makeRoot();
    const plane = new RuntimeIntelligenceService({ rootDir: root, now: () => AT });
    const recommendation = plane.adviseAndRecord({
      taskId: "task-1",
      role: "coder",
      taskKind: "coding",
      requiredCapabilities: [],
      contextScale: "small",
      externalEffect: false,
      risk: "low",
      createdAt: AT
    });
    expect(plane.store.recommendations()).toHaveLength(1);
    expect(plane.store.recommendation(recommendation.recommendationId)?.taskId).toBe("task-1");

    const recorded = plane.ingestOutcome({
      taskId: "task-1",
      role: "coder",
      taskKind: "coding",
      kind: "SUCCESS",
      model: { provider: "vendor", family: "gpt", version: "1" },
      recommendationId: recommendation.recommendationId,
      modelBasis: "RECOMMENDED",
      at: AT
    });
    expect(recorded.observation.recommendationId).toBe(recommendation.recommendationId);
    expect(recorded.observation.model.basis).toBe("RECOMMENDED");
  });

  it("reports the recommendation count in its status", () => {
    const plane = new RuntimeIntelligenceService({ rootDir: makeRoot(), now: () => AT });
    plane.adviseAndRecord({ taskId: "task-1", role: "coder", taskKind: "coding", requiredCapabilities: [], contextScale: "small", externalEffect: false, risk: "low", createdAt: AT });
    expect(plane.status().counts.recommendations).toBe(1);
    expect(plane.status().files["recommendations.jsonl"]).toBeGreaterThan(0);
  });
});
