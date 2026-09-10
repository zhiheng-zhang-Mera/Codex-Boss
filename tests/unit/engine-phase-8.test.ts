/**
 * Engine Phase 8 evidence test — behaviour epoch.
 * Acceptance: A19 (sustained change ⇒ new epoch), A20 (single anomaly ⇒ no new
 * epoch), A30 (detector/ledger broken ⇒ tasks unaffected), A33 (child epoch
 * inherits the parent link for a decayed prior), A34 (old epochs stay queryable),
 * plus OBSERVED_MODEL_CHANGE separation and durable restart.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { epochScopeKey, type EpochScope } from "../../src/shared/behaviour-epoch";
import { detectChangePoint, type BehaviourSample } from "../../electron/learning/providers/change-point-detector";
import { BehaviourEpochLedger } from "../../electron/learning/providers/behaviour-epoch";

const at = "2026-09-10T00:00:00.000Z";
const scope: EpochScope = { provider: "chatgpt", surface: "web", selectedModel: "gpt-5", observedModelId: "gpt-5-2026-08" };

function sample(id: string, index: number, completion: number, overrides: Partial<BehaviourSample> = {}): BehaviourSample {
  return {
    episodeId: id,
    timestamp: `2026-09-10T00:${String(index).padStart(2, "0")}:00.000Z`,
    completion,
    goalFidelity: completion,
    restrictionImpact: 1 - completion,
    quality: completion,
    latencyMs: 500,
    formatCompliance: 1,
    ...overrides
  };
}

/** 8 samples at ~0.5 then 8 at ~0.95 (model A epoch1 / epoch2 scenario). */
function sustainedShift(): BehaviourSample[] {
  const before = Array.from({ length: 8 }, (_unused, index) => sample(`b${index}`, index, 0.5));
  const after = Array.from({ length: 8 }, (_unused, index) => sample(`a${index}`, index + 8, 0.95));
  return [...before, ...after];
}

describe("Phase 8 — change-point detector", () => {
  it("A19: detects a sustained shift across a window", () => {
    const detection = detectChangePoint(sustainedShift(), { minSamplesPerSide: 4, confidenceThreshold: 0.5 });
    expect(detection.changed).toBe(true);
    expect(detection.confidence).toBeGreaterThanOrEqual(0.5);
    expect(detection.shifts.completion).toBeCloseTo(0.45, 2);
    expect(detection.beforeIds).toContain("b0");
    expect(detection.afterIds).toContain("a7");
  });

  it("A20: a single anomaly in an otherwise stable window does not count as a change", () => {
    const stable = Array.from({ length: 11 }, (_unused, index) => sample(`s${index}`, index, 0.5));
    const withAnomaly = [...stable.slice(0, 5), sample("outlier", 5, 0.0), ...stable.slice(6).map((item, index) => sample(item.episodeId, index + 6, 0.5))];
    const detection = detectChangePoint(withAnomaly, { minSamplesPerSide: 4 });
    expect(detection.changed).toBe(false);
  });

  it("returns no change for too little data", () => {
    const detection = detectChangePoint([sample("x", 0, 0.1), sample("y", 1, 0.9)], { minSamplesPerSide: 4 });
    expect(detection.changed).toBe(false);
    expect(detection.reasons.join(" ")).toContain("insufficient");
  });

  it("normalises latency so a slow day alone cannot look like a behaviour change", () => {
    const before = Array.from({ length: 6 }, (_unused, index) => sample(`b${index}`, index, 0.9, { latencyMs: 100 }));
    const after = Array.from({ length: 6 }, (_unused, index) => sample(`a${index}`, index + 6, 0.9, { latencyMs: 200 })); // small shift only
    const detection = detectChangePoint([...before, ...after], { minSamplesPerSide: 4, metrics: ["latency"], minShiftScore: 0.25 });
    expect(detection.changed).toBe(false); // 100ms → 200ms is not a behaviour change
  });

  it("detects a format-compliance collapse independently of completion", () => {
    const before = Array.from({ length: 6 }, (_unused, index) => sample(`b${index}`, index, 0.9, { formatCompliance: 1 }));
    const after = Array.from({ length: 6 }, (_unused, index) => sample(`a${index}`, index + 6, 0.9, { formatCompliance: 0 }));
    const detection = detectChangePoint([...before, ...after], { minSamplesPerSide: 4, metrics: ["formatCompliance"] });
    expect(detection.changed).toBe(true);
    expect(detection.shifts.formatCompliance).toBeCloseTo(-1, 2);
  });
});

describe("Phase 8 — epoch ledger", () => {
  it("A19/A33: sustained change opens a child epoch and closes the parent", () => {
    let clock = "2026-09-10T00:00:00.000Z";
    const ledger = new BehaviourEpochLedger(undefined, () => clock);
    const first = ledger.observe(scope, sustainedShift().slice(0, 8), { minSamplesPerSide: 4 });
    expect(first.opened).toBe(true);
    expect(first.epoch.parentEpochId).toBeUndefined();

    clock = "2026-09-11T00:00:00.000Z";
    const second = ledger.observe(scope, sustainedShift(), { minSamplesPerSide: 4 });
    expect(second.opened).toBe(true);
    expect(second.epoch.trigger).toBe("SUSTAINED_BEHAVIOUR_CHANGE");
    expect(second.epoch.parentEpochId).toBe(first.epoch.epochId); // decayed-prior link
    expect(ledger.get(first.epoch.epochId)?.endedAt).toBe(clock); // parent closed, not deleted
  });

  it("A20: a single anomaly keeps the current epoch", () => {
    const clock = "2026-09-10T00:00:00.000Z";
    const ledger = new BehaviourEpochLedger(undefined, () => clock);
    const stable = Array.from({ length: 8 }, (_unused, index) => sample(`s${index}`, index, 0.8));
    const first = ledger.observe(scope, stable, { minSamplesPerSide: 4 });
    const withAnomaly = [...stable.slice(0, 4), sample("boom", 4, 0), ...stable.slice(5).map((item, index) => sample(item.episodeId, index + 5, 0.8))];
    const second = ledger.observe(scope, withAnomaly, { minSamplesPerSide: 4 });
    expect(second.opened).toBe(false);
    expect(second.epoch.epochId).toBe(first.epoch.epochId);
    expect(ledger.count()).toBe(1);
  });

  it("an observed model-id change separates epochs immediately", () => {
    const clock = "2026-09-10T00:00:00.000Z";
    const ledger = new BehaviourEpochLedger(undefined, () => clock);
    const first = ledger.observe(scope, Array.from({ length: 8 }, (_unused, index) => sample(`s${index}`, index, 0.8)));
    const next = ledger.observe({ ...scope, observedModelId: "gpt-6-2026-12" }, [sample("n0", 0, 0.8), sample("n1", 1, 0.8), sample("n2", 2, 0.8), sample("n3", 3, 0.8)]);
    expect(next.opened).toBe(true);
    expect(next.epoch.trigger).toBe("OBSERVED_MODEL_CHANGE");
    expect(next.epoch.observedModelId).toBe("gpt-6-2026-12");
    expect(next.epoch.parentEpochId).toBe(first.epoch.epochId);
  });

  it("A34: old epochs remain separately queryable after a version change", () => {
    let clock = "2026-09-10T00:00:00.000Z";
    const ledger = new BehaviourEpochLedger(undefined, () => clock);
    ledger.observe(scope, Array.from({ length: 6 }, (_unused, index) => sample(`s${index}`, index, 0.5)));
    clock = "2026-09-12T00:00:00.000Z";
    ledger.observe({ ...scope, observedModelId: "gpt-6-2026-12" }, Array.from({ length: 6 }, (_unused, index) => sample(`n${index}`, index, 0.95)));
    const all = ledger.byProvider("chatgpt");
    expect(all).toHaveLength(2);
    expect(ledger.byProvider("chatgpt", "gpt-5-2026-08")).toHaveLength(1);
    expect(ledger.byProvider("chatgpt", "gpt-6-2026-12")).toHaveLength(1);
    expect(ledger.history(scope)[0].observedModelId).toBe("gpt-5-2026-08");
  });

  it("A30: a corrupt ledger degrades to no epoch info without throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p8-"));
    const file = path.join(dir, "epochs.json");
    try {
      fs.writeFileSync(file, "{ broken", "utf8");
      const ledger = new BehaviourEpochLedger(file);
      expect(ledger.count()).toBe(0);
      expect(ledger.status().degradedReason).toContain("unreadable");
      expect(ledger.current(scope)).toBeUndefined(); // callers treat it as epoch-less
      // still usable afterwards
      const opened = ledger.observe(scope, Array.from({ length: 6 }, (_unused, index) => sample(`s${index}`, index, 0.5)));
      expect(opened.epoch.epochId).toMatch(/^EP-[0-9a-f]{8}$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("durable restart keeps every epoch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-p8-restart-"));
    const file = path.join(dir, "epochs.json");
    try {
      let clock = "2026-09-10T00:00:00.000Z";
      const first = new BehaviourEpochLedger(file, () => clock);
      first.observe(scope, Array.from({ length: 6 }, (_unused, index) => sample(`s${index}`, index, 0.5)));
      clock = "2026-09-12T00:00:00.000Z";
      first.observe({ ...scope, observedModelId: "gpt-6" }, Array.from({ length: 6 }, (_unused, index) => sample(`n${index}`, index, 0.9)));
      const second = new BehaviourEpochLedger(file, () => clock);
      expect(second.count()).toBe(2);
      expect(second.current({ ...scope, observedModelId: "gpt-6" })?.observedModelId).toBe("gpt-6");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scope keys separate provider/surface/model identities", () => {
    expect(epochScopeKey({ provider: "a", surface: "web" })).toBe("a::web::auto::unknown");
    expect(epochScopeKey({ provider: "a", surface: "web", observedModelId: "m1" })).not.toBe(epochScopeKey({ provider: "a", surface: "web", observedModelId: "m2" }));
  });
});
