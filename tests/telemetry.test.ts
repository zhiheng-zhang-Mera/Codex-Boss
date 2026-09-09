import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TelemetryStore } from "../electron/telemetry/telemetry-store";
import { attachTelemetryRecorder } from "../electron/telemetry/telemetry-recorder";
import { DomainEventBus } from "../electron/commander/event-bus";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-telemetry-")); dirs.push(dir); return dir; }

describe("telemetry store", () => {
  it("records and aggregates by runtime with a bounded history", () => {
    const file = path.join(root(), "telemetry.json");
    const store = new TelemetryStore(file);
    store.record({ taskId: "t1", jobId: "j1", runtimeId: "api:x", role: "worker", outcome: "SUCCESS", modelCalls: 1, estimatedTokens: 100, latencyMs: 500, retries: 0, at: new Date(0).toISOString() });
    store.record({ taskId: "t1", jobId: "j2", runtimeId: "api:x", role: "worker", outcome: "FAILED", reason: "timeout", modelCalls: 2, estimatedTokens: 200, latencyMs: 800, retries: 1, at: new Date(0).toISOString() });
    const aggregates = store.byRuntime();
    expect(aggregates["api:x"]).toMatchObject({ runs: 2, success: 1, failures: 1, modelCalls: 3, estimatedTokens: 300, totalLatencyMs: 1300 });
    expect(store.byTask("t1")).toHaveLength(2);
    expect(new TelemetryStore(file).list()).toHaveLength(2); // persisted
  });

  it("fails closed on a corrupt file", () => {
    const file = path.join(root(), "telemetry.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2 }));
    expect(() => new TelemetryStore(file).list()).toThrow(/Invalid/);
  });
});

describe("event-driven telemetry recorder", () => {
  it("records worker outcomes from the domain bus and detaches cleanly", () => {
    const bus = new DomainEventBus();
    const store = new TelemetryStore(path.join(root(), "telemetry.json"));
    const detach = attachTelemetryRecorder(bus, store, (chars) => chars * 2);
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t1", jobId: "j1", runtimeId: "api:x", message: "ok", result: { runtimeId: "api:x", jobId: "j1", status: "SUCCESS", metrics: { startedAt: "0", completedAt: "0", durationMs: 50 } } });
    bus.publish({ type: "WORKER_FAILED", taskId: "t2", jobId: "j2", runtimeId: "api:bad", message: "boom" });
    let list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ taskId: "t1", outcome: "SUCCESS", latencyMs: 50, estimatedTokens: 4 });
    expect(list[1]).toMatchObject({ taskId: "t2", outcome: "FAILED", reason: "boom" });
    detach();
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t3", jobId: "j3", runtimeId: "api:x", message: "ignored" });
    list = store.list();
    expect(list).toHaveLength(2);
  });
});
