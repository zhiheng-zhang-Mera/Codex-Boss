import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAutomationModule } from "../../electron/bootstrap/automation";
import { createPersistenceModule } from "../../electron/bootstrap/persistence";
import { ExperienceStore } from "../../electron/experience/experience-store";
import { durableFileFor } from "../../electron/workspace/durable-roots";
import { DEFAULT_WORKSPACE_ID } from "../../src/shared/workspace";

/**
 * Phase F — the event bus, its recorders and the runtime-resilience services are
 * one boot module.
 *
 * The three things worth asserting are the three that can silently be wrong:
 * every durable trail is actually attached to the bus, an event whose handler
 * threw is reported as a LOST effect instead of an empty catch, and the one
 * service in this set that owns a timer really releases it on disposal.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-automation-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function build(dataRoot: string) {
  const persistence = createPersistenceModule({
    dataRoot,
    historyRoot: path.join(dataRoot, "history"),
    cacheRoot: path.join(dataRoot, "cache"),
    appPath: process.cwd(),
    crypto: { encrypt: (value) => `enc:${value}`, decrypt: (value) => value.replace(/^enc:/, "") }
  });
  const published: number[] = [];
  const module = createAutomationModule({
    dataRoot,
    store: persistence.service.store,
    // The `experience` store is built by the composition root now, not handed back by `persistence`
    // (ledger CC-068): this test builds it the way main.ts does, against the same workspace-scoped path,
    // so it exercises the real store rather than a stub.
    experiences: new ExperienceStore(durableFileFor(dataRoot, DEFAULT_WORKSPACE_ID, path.join(".boss", "experience.json"))),
    publish: () => { published.push(Date.now()); }
  });
  return { module, published };
}

/** Polls until `check` holds, so a real asynchronous effect is awaited rather than slept at. */
async function until(check: () => boolean, timeoutMs = 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return check();
}

describe("Phase F — the automation boot module", () => {
  it("attaches every durable trail by name", () => {
    const { module } = build(makeRoot());
    expect(module.service.recorders).toEqual(["progress", "telemetry", "experience"]);
    expect(module.service.events).toBeDefined();
    expect(module.service.progress).toBeDefined();
    expect(module.service.recovery).toBeDefined();
    expect(module.service.circuitBreaker).toBeDefined();
    expect(module.service.softwareLeases).toBeDefined();
    expect(module.health().module).toBe("automation");
    expect(module.health().status).toBe("READY");
    expect(module.health().detail).toContain("3 recorder(s) on the bus (progress, telemetry, experience)");
  });

  it("reports an event whose effect was lost instead of an empty catch", () => {
    // This is the reason the health line exists: "no reaction" and "the reaction
    // threw" are different answers, and the bus records the difference.
    const { module } = build(makeRoot());
    module.service.events.subscribe("WORKER_COMPLETED", () => { throw new Error("recorder exploded"); });
    module.service.events.publish({ type: "WORKER_COMPLETED", taskId: "t1" });
    expect(module.health().status).toBe("DEGRADED");
    expect(module.health().detail).toContain("1 lost event effect(s)");
  });

  it("runs a registered recovery when its deadline is due", async () => {
    const { module } = build(makeRoot());
    const ran: string[] = [];
    module.service.recovery.register("test-kind", async (record) => { ran.push(record.id); return { done: true }; });
    module.service.recovery.start();
    module.service.recovery.schedule({ id: "due-now", taskId: "t1", kind: "test-kind", retryAt: Date.now() - 1, payload: null });
    expect(await until(() => ran.length > 0)).toBe(true);
    // A completed recovery is removed rather than left behind.
    expect(module.service.recovery.list()).toEqual([]);
  });

  it("keeps a pending deadline across a rebuild, which is what makes it durable", () => {
    const dataRoot = makeRoot();
    const first = build(dataRoot);
    first.module.service.recovery.schedule({ id: "later", taskId: "t1", kind: "test-kind", retryAt: Date.now() + 3_600_000, payload: { note: "kept" } });
    const second = build(dataRoot);
    const records = second.module.service.recovery.list();
    expect(records.map((record) => record.id)).toEqual(["later"]);
    expect(records[0].payload).toEqual({ note: "kept" });
    expect(records[0].state).toBe("WAITING");
    expect(second.module.health().detail).toContain("1 recovery record(s)");
  });

  it("disposes the scheduler's timer and not merely a flag", async () => {
    // Read the class rather than assuming: `dispose()` stops the TIMER, and the
    // event-driven path (a deadline already due publishes DEPENDENCY_READY) goes
    // straight to `runDue`, which does not consult the same flag. So the honest
    // assertion is the timer: a deadline that is not yet due must not fire after
    // disposal, and the same setup without disposal must fire.
    const { module } = build(makeRoot());
    const ran: string[] = [];
    module.service.recovery.register("timer-kind", async (record) => { ran.push(record.id); return { done: true }; });
    module.service.recovery.start();
    module.service.recovery.schedule({ id: "soon", taskId: "t1", kind: "timer-kind", retryAt: Date.now() + 60, payload: null });
    expect(await until(() => ran.includes("soon"))).toBe(true);

    module.dispose();
    expect(module.dispose()).toBeUndefined();
    module.service.recovery.schedule({ id: "after-dispose", taskId: "t2", kind: "timer-kind", retryAt: Date.now() + 60, payload: null });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ran).toEqual(["soon"]);
    expect(module.health().detail).toContain("disposed");
  });

  it("reports a circuit that is no longer closed", () => {
    const { module } = build(makeRoot());
    for (let attempt = 0; attempt < 3; attempt++) module.service.circuitBreaker.observeFailure("web:deepseek");
    expect(module.service.circuitBreaker.list().some((entry) => entry.state !== "CLOSED")).toBe(true);
    expect(module.health().detail).toContain("1 circuit(s) not closed");
    // …and a healthy one stays out of the count.
    expect(module.health().status).toBe("READY");
  });
});
