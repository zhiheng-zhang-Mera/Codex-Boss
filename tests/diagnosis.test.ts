import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clusterFailures, normalizeReason, buildRfc } from "../src/shared/self-diagnosis";
import { TelemetryStore } from "../electron/telemetry/telemetry-store";
import { diagnoseTelemetry } from "../electron/self-engineering/diagnosis";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-diagnose-")); dirs.push(dir); return dir; }

describe("self diagnosis failure clustering", () => {
  it("normalizes reasons into stable groups", () => {
    expect(normalizeReason("request timed out after 60s")).toBe("timeout");
    expect(normalizeReason("quota exceeded")).toBe("quota");
    expect(normalizeReason("rate limit hit (429)")).toBe("rate-limit");
    expect(normalizeReason("network unreachable")).toBe("network");
    expect(normalizeReason("random failure")).toBe("unknown");
  });

  it("clusters FAILED records by runtime and reason, ranked by count", () => {
    const clusters = clusterFailures([
      { taskId: "t1", runtimeId: "api:x", outcome: "FAILED", reason: "timed out", at: "2026-01-01T00:00:00.000Z" },
      { taskId: "t2", runtimeId: "api:x", outcome: "FAILED", reason: "request timeout", at: "2026-01-02T00:00:00.000Z" },
      { taskId: "t3", runtimeId: "api:y", outcome: "FAILED", reason: "quota exceeded", at: "2026-01-03T00:00:00.000Z" },
      { taskId: "t4", runtimeId: "api:x", outcome: "SUCCESS", reason: undefined, at: "2026-01-04T00:00:00.000Z" }
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ runtimeId: "api:x", reason: "timeout", count: 2 });
    expect(clusters[0].sampleTaskIds).toEqual(["t1", "t2"]);
  });

  it("builds an RFC draft with the plan's section structure", () => {
    const cluster = { runtimeId: "codex:cli", reason: "quota", count: 3, lastAt: "2026-01-01T00:00:00.000Z", sampleTaskIds: ["t1"] };
    const rfc = buildRfc(cluster);
    expect(rfc.problem).toContain("codex:cli");
    expect(rfc.evidence).toBe(cluster);
    expect(rfc.rollback).toContain("revert");
    for (const field of ["problem", "evidence", "hypothesis", "candidateFix", "expectedBenefit", "risk", "benchmark", "rollback", "compatibilityImpact"]) expect(field in rfc).toBe(true);
  });
});

describe("telemetry diagnosis", () => {
  it("analyzes the performance DB and returns the top RFC or empty", () => {
    const file = path.join(root(), "telemetry.json");
    const store = new TelemetryStore(file);
    expect(diagnoseTelemetry(store).clusters).toEqual([]);
    store.record({ taskId: "t1", jobId: "j1", runtimeId: "api:x", role: "worker", outcome: "FAILED", reason: "timed out", modelCalls: 1, estimatedTokens: 10, latencyMs: 10, retries: 1, at: "2026-01-01T00:00:00.000Z" });
    const diagnosis = diagnoseTelemetry(store);
    expect(diagnosis.clusters[0]).toMatchObject({ runtimeId: "api:x", reason: "timeout", count: 1 });
    expect(diagnosis.topRfc?.problem).toContain("api:x");
  });
});
