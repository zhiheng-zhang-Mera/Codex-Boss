import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CORRECTABLE_RFC_FIELDS,
  applyCorrections,
  isCorrectableField,
  type RfcCorrection,
} from "../src/shared/correction";
import { buildRfc, type FailureCluster } from "../src/shared/self-diagnosis";
import { CorrectionStore } from "../electron/self-engineering/correction-store";
import { diagnoseTelemetry } from "../electron/self-engineering/diagnosis";
import { TelemetryStore } from "../electron/telemetry/telemetry-store";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-correct-")); dirs.push(dir); return dir; }

const cluster: FailureCluster = {
  runtimeId: "codex:cli", reason: "quota", count: 3,
  lastAt: "2026-01-01T00:00:00.000Z", sampleTaskIds: ["t1"],
};

function correction(overrides: Partial<RfcCorrection> = {}): RfcCorrection {
  return {
    id: "c1", clusterKey: "codex:cli|quota", field: "hypothesis",
    correctedValue: "human says: account-level quota, not adapter flake",
    correctedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("correction model", () => {
  it("exposes the plan §26 correctable text fields and rejects evidence", () => {
    expect(CORRECTABLE_RFC_FIELDS).toEqual([
      "problem", "hypothesis", "candidateFix", "expectedBenefit",
      "risk", "benchmark", "rollback", "compatibilityImpact",
    ]);
    expect(CORRECTABLE_RFC_FIELDS).not.toContain("evidence");
    expect(isCorrectableField("hypothesis")).toBe(true);
    expect(isCorrectableField("evidence")).toBe(false);
    expect(isCorrectableField("nonsense")).toBe(false);
  });

  it("applies latest correction per field onto a copy, leaving the draft untouched", () => {
    const draft = buildRfc(cluster);
    const before = draft.hypothesis;
    const amended = applyCorrections(draft, [
      correction({ field: "hypothesis", correctedValue: "first guess", correctedAt: "2026-01-01T00:00:00.000Z" }),
      correction({ id: "c2", field: "hypothesis", correctedValue: "final guess", correctedAt: "2026-01-02T00:00:00.000Z" }),
      correction({ id: "c3", field: "risk", correctedValue: "high; touches billing", correctedAt: "2026-01-02T00:00:00.000Z" }),
    ]);
    expect(amended.hypothesis).toBe("final guess"); // latest wins
    expect(amended.risk).toBe("high; touches billing");
    expect(amended.problem).toBe(draft.problem); // uncorrected fields pass through
    expect(draft.hypothesis).toBe(before); // original untouched
  });

  it("ignores blank values and non-correctable fields", () => {
    const draft = buildRfc(cluster);
    const amended = applyCorrections(draft, [
      correction({ field: "hypothesis", correctedValue: "  " }),
      { ...correction({ id: "c4" }), field: "evidence" as never },
    ]);
    expect(amended).toEqual(draft);
  });
});

describe("correction store", () => {
  it("persists corrections and returns latest-per-field per cluster key", () => {
    const file = path.join(root(), "corrections.json");
    const store = new CorrectionStore(file);
    store.add(correction({ id: "c1", field: "hypothesis", correctedValue: "old", correctedAt: "2026-01-01T00:00:00.000Z" }));
    store.add(correction({ id: "c2", field: "hypothesis", correctedValue: "new", correctedAt: "2026-01-02T00:00:00.000Z" }));
    store.add(correction({ id: "c3", clusterKey: "other|timeout", field: "risk", correctedValue: "irrelevant" }));
    expect(store.list()).toHaveLength(3);
    const latest = store.latestFor("codex:cli|quota");
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ id: "c2", correctedValue: "new" });
    // durable reload
    const reloaded = new CorrectionStore(file);
    expect(reloaded.latestFor("codex:cli|quota")[0].id).toBe("c2");
  });

  it("rejects malformed corrections and fails closed on a corrupt file", () => {
    const file = path.join(root(), "corrections.json");
    const store = new CorrectionStore(file);
    expect(() => store.add(correction({ field: "evidence" as never }))).toThrow(/field/);
    expect(() => store.add(correction({ correctedValue: "" }))).toThrow(/correctedValue/);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9 }));
    expect(() => new CorrectionStore(file)).toThrow(/Invalid correction store/);
  });
});

describe("human corrections into diagnosis", () => {
  it("amends the top RFC when corrections match its cluster and stays empty without failures", () => {
    const telemetry = new TelemetryStore(path.join(root(), "telemetry.json"));
    telemetry.record({ taskId: "t1", jobId: "j1", runtimeId: "codex:cli", role: "worker", outcome: "FAILED", reason: "quota exceeded", modelCalls: 1, estimatedTokens: 10, latencyMs: 10, retries: 1, at: "2026-01-01T00:00:00.000Z" });
    const empty = diagnoseTelemetry(new TelemetryStore(path.join(root(), "empty.json")));
    expect(empty.topRfc).toBeUndefined();

    const diagnosis = diagnoseTelemetry(telemetry);
    expect(diagnosis.topRfc?.hypothesis).toContain("instability"); // generated default

    const corrected = diagnoseTelemetry(telemetry, [
      correction({ id: "c1", clusterKey: "codex:cli|quota", field: "hypothesis", correctedValue: "account-level quota exhaustion", correctedAt: "2026-01-02T00:00:00.000Z" }),
      correction({ id: "c2", clusterKey: "other|timeout", field: "risk", correctedValue: "does not match" }),
    ]);
    expect(corrected.topRfc?.hypothesis).toBe("account-level quota exhaustion");
  });
});
