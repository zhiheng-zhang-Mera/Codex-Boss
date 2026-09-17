import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExperienceStore } from "../../electron/experience/experience-store";
import { attachExperienceRecorder } from "../../electron/experience/experience-recorder";
import { DomainEventBus } from "../../electron/commander/event-bus";
import { contributionStats, decidePromotion } from "../../src/shared/experience";
import type { ExperienceEntry, ExperienceLevel, ExperienceObservation } from "../../src/shared/experience";

/**
 * Authoritative suite for the `experience` capability (PF-DEBT-001).
 *
 * Phase 05 §11 recorded that this capability was owned but untested: `electron/experience/` and
 * `src/shared/experience.ts` existed with no authoritative obligation. "Owned but untested" is worse
 * than unowned, because the ownership report implies coverage that does not exist.
 *
 * What this suite is authoritative FOR, stated precisely so the claim is not larger than the evidence:
 *
 *   - the promotion hierarchy and its thresholds (`decidePromotion`) — the capability's central rule;
 *   - the contribution statistics (`contributionStats`);
 *   - the durable store's behaviour: claim-keyed entries, observation bounding, restart durability,
 *     and fail-closed reads;
 *   - the bus→store bridge (`attachExperienceRecorder`): which events become observations, with what
 *     source and contribution, and that detaching really detaches.
 *
 * What it does NOT cover, named rather than implied: the planner/Commander's USE of a promoted claim.
 * Nothing in the platform reads `ExperienceStore` back to alter a decision — the store is written by
 * the recorder and read by `list()`, and wiring promotion into routing is a product change this phase
 * is forbidden from making (Phase 06 book §4, "no new business features"). That is recorded as its own
 * observation rather than dressed up as coverage.
 */

const AT = "2026-09-16T00:00:00.000Z";
let dir: string;
let file: string;
let clock: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-experience-"));
  file = path.join(dir, ".boss", "experience.json");
  clock = Date.parse(AT);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const now = (): number => (clock += 1000);

function entry(level: ExperienceLevel, sources: string[], extra: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    id: "claim-1",
    claim: "runtime api:deepseek serves its role",
    domain: "worker-routing",
    level,
    observations: sources.map((source, index): ExperienceObservation => ({ level: "task", source, at: new Date(clock + index).toISOString() })),
    createdAt: AT,
    updatedAt: AT,
    ...extra
  };
}

describe("Phase 06 — experience: the promotion hierarchy is the capability's central contract", () => {
  it("promotes task → workspace only on repeated evidence in one workspace", () => {
    expect(decidePromotion(entry("task", ["ws-1"]))).toEqual({ nextLevel: null, reasons: [] });
    const promoted = decidePromotion(entry("task", ["ws-1", "ws-1"]));
    expect(promoted.nextLevel).toBe("workspace");
    expect(promoted.reasons.join(" ")).toContain("2x");
  });

  it("promotes workspace → domain only on observations from distinct workspaces", () => {
    // Two observations in ONE workspace is not two workspaces. This is the distinction that keeps a
    // single project's habit from becoming a domain rule.
    expect(decidePromotion(entry("workspace", ["ws-1", "ws-1"])).nextLevel).toBeNull();
    expect(decidePromotion(entry("workspace", ["ws-1", "ws-2"])).nextLevel).toBe("domain");
  });

  it("promotes domain → global only on a broad workspace baseline", () => {
    expect(decidePromotion(entry("domain", ["ws-1", "ws-2"])).nextLevel).toBeNull();
    expect(decidePromotion(entry("domain", ["ws-1", "ws-2", "ws-3"])).nextLevel).toBe("global");
  });

  it("never promotes beyond global, and never demotes", () => {
    expect(decidePromotion(entry("global", ["ws-1", "ws-2", "ws-3", "ws-4"])).nextLevel).toBeNull();
  });

  it("honours the thresholds it is given rather than hardcoding them", () => {
    // The thresholds are a parameter, so a caller can tighten them; a suite that only tested the
    // defaults would not notice if the parameter were ignored.
    const strict = { workspaceObservations: 5, domainWorkspaces: 4, globalWorkspaces: 6 };
    expect(decidePromotion(entry("task", ["ws-1", "ws-1"]), strict).nextLevel).toBeNull();
    expect(decidePromotion(entry("task", ["ws-1", "ws-1", "ws-1", "ws-1", "ws-1"]), strict).nextLevel).toBe("workspace");
    expect(decidePromotion(entry("workspace", ["ws-1", "ws-2"]), strict).nextLevel).toBeNull();
    expect(decidePromotion(entry("domain", ["a", "b", "c", "d", "e", "f"]), strict).nextLevel).toBe("global");
  });

  it("counts distinct workspaces, not observations, at every level above task", () => {
    // A claim seen fifty times in one workspace is still one workspace.
    expect(decidePromotion(entry("workspace", Array.from({ length: 50 }, () => "ws-1"))).nextLevel).toBeNull();
  });
});

describe("Phase 06 — experience: contribution statistics", () => {
  it("reports success, failure and a rate over the observations that carry a contribution", () => {
    const withContributions: ExperienceEntry = {
      ...entry("task", ["ws-1"]),
      observations: [
        { level: "task", source: "ws-1", at: AT, contribution: { outcome: "success" } },
        { level: "task", source: "ws-1", at: AT, contribution: { outcome: "success" } },
        { level: "task", source: "ws-1", at: AT, contribution: { outcome: "failure" } }
      ]
    };
    expect(contributionStats(withContributions)).toEqual({ success: 2, failure: 1, rate: 2 / 3 });
  });

  it("reports a null rate rather than zero when nothing was contributed", () => {
    // A missing rate and a zero rate are different claims, and a zero would make an unrated runtime
    // look like a failing one.
    expect(contributionStats(entry("task", ["ws-1", "ws-2"]))).toEqual({ success: 0, failure: 0, rate: null });
  });
});

describe("Phase 06 — experience: the durable store", () => {
  it("keys one entry per claim and accumulates observations", () => {
    const store = new ExperienceStore(file);
    store.observe("claim-a", "worker-routing", { source: "ws-1" }, now);
    store.observe("claim-a", "worker-routing", { source: "ws-1" }, now);
    store.observe("claim-b", "runtime-health", { source: "ws-1" }, now);

    const entries = store.list();
    expect(entries.map((item) => item.id).sort()).toEqual(["claim-a", "claim-b"]);
    expect(entries.find((item) => item.id === "claim-a")?.observations).toHaveLength(2);
  });

  it("promotes through the store and reports which promotion happened", () => {
    const store = new ExperienceStore(file);
    expect(store.observe("claim-a", "worker-routing", { source: "ws-1" }, now).promotion).toBeNull();
    const second = store.observe("claim-a", "worker-routing", { source: "ws-1" }, now);
    expect(second.promotion).toBe("workspace");
    expect(second.entry.level).toBe("workspace");
    // Promoted-from records where it came from, and the first origin is kept rather than rewritten.
    expect(second.entry.promotedFrom).toBe("task");
  });

  it("survives a restart, so a promotion is not lost to a process exit", () => {
    const first = new ExperienceStore(file);
    first.observe("claim-a", "worker-routing", { source: "ws-1" }, now);
    first.observe("claim-a", "worker-routing", { source: "ws-1" }, now);

    const reopened = new ExperienceStore(file);
    const entryAfterRestart = reopened.list().find((item) => item.id === "claim-a");
    expect(entryAfterRestart?.level).toBe("workspace");
    expect(entryAfterRestart?.observations).toHaveLength(2);
  });

  it("bounds observations per entry instead of growing without limit", () => {
    // A long-running task family must not make one claim's document unbounded.
    const store = new ExperienceStore(file);
    for (let index = 0; index < 250; index++) store.observe("claim-a", "worker-routing", { source: `ws-${index}` }, now);
    expect(store.list()[0]!.observations).toHaveLength(200);
  });

  it("fails closed on a corrupt store rather than reporting an empty one", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, entries: "not an array" }), "utf8");
    expect(() => new ExperienceStore(file).list()).toThrow(/Invalid experience store/);
  });

  it("treats a missing store as empty, which is the one case where empty is true", () => {
    expect(fs.existsSync(file)).toBe(false);
    expect(new ExperienceStore(file).list()).toEqual([]);
  });

  it("records the observation level and contribution it was given", () => {
    const store = new ExperienceStore(file);
    store.observe("claim-a", "worker-routing", { source: "ws-1", level: "global", contribution: { outcome: "failure", weight: 0.5 } }, now);
    const observation = store.list()[0]!.observations[0]!;
    expect(observation.level).toBe("global");
    expect(observation.contribution).toEqual({ outcome: "failure", weight: 0.5 });
  });
});

describe("Phase 06 — experience: the bus bridge", () => {
  function harness(): { bus: DomainEventBus; store: ExperienceStore; detach: () => void } {
    const bus = new DomainEventBus();
    const store = new ExperienceStore(file);
    const detach = attachExperienceRecorder(bus, store);
    return { bus, store, detach };
  }

  it("turns a completed worker into two success observations", () => {
    const { bus, store } = harness();
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t-1", jobId: "j-1", runtimeId: "api:deepseek", message: "ok" });

    const entries = store.list();
    // The routing claim and the health claim, which is the shape the recorder documents.
    expect(entries).toHaveLength(2);
    expect(entries.map((item) => item.domain).sort()).toEqual(["runtime-health", "worker-routing"]);
    for (const item of entries) {
      expect(item.observations[0]!.contribution?.outcome).toBe("success");
    }
  });

  it("turns a failed worker into failure observations, not success ones", () => {
    const { bus, store } = harness();
    bus.publish({ type: "WORKER_FAILED", taskId: "t-1", jobId: "j-1", runtimeId: "api:deepseek", message: "boom" });
    for (const item of store.list()) {
      expect(item.observations[0]!.contribution?.outcome).toBe("failure");
    }
  });

  it("uses the source the caller supplies, so a workspace claim is attributed to the workspace", () => {
    // The production wiring maps task → workspace; a suite that ignored it would pass while the
    // promotion rule above never fired in production.
    const bus = new DomainEventBus();
    const store = new ExperienceStore(file);
    attachExperienceRecorder(bus, store, { sourceFor: () => "ws-from-mapping" });
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t-1", jobId: "j-1", runtimeId: "api:deepseek", message: "ok" });
    expect(store.list()[0]!.observations[0]!.source).toBe("ws-from-mapping");
  });

  it("carries the caller's contribution weight", () => {
    const bus = new DomainEventBus();
    const store = new ExperienceStore(file);
    attachExperienceRecorder(bus, store, { weightFor: () => 0.25 });
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t-1", jobId: "j-1", runtimeId: "api:deepseek", message: "ok" });
    expect(store.list()[0]!.observations[0]!.contribution?.weight).toBe(0.25);
  });

  it("ignores an event with no task or no runtime rather than inventing an attribution", () => {
    const { bus, store } = harness();
    bus.publish({ type: "WORKER_COMPLETED", jobId: "j-1", message: "no ids" });
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t-1", message: "no runtime" });
    expect(store.list()).toEqual([]);
  });

  it("detaches, so the store stops receiving observations", () => {
    const { bus, store, detach } = harness();
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t-1", jobId: "j-1", runtimeId: "api:deepseek", message: "ok" });
    const before = store.list()[0]!.observations.length;
    detach();
    bus.publish({ type: "WORKER_COMPLETED", taskId: "t-1", jobId: "j-1", runtimeId: "api:deepseek", message: "ok" });
    expect(store.list()[0]!.observations).toHaveLength(before);
  });

  it("promotes a runtime's claim once it has served repeatedly in one workspace", () => {
    // The bridge and the promotion rule together, which is the behaviour the capability exists for.
    const { bus, store } = harness();
    const publish = () => bus.publish({ type: "WORKER_COMPLETED", taskId: "t-1", jobId: "j-1", runtimeId: "api:deepseek", message: "ok" });
    publish();
    publish();
    const routing = store.list().find((item) => item.domain === "worker-routing")!;
    expect(routing.level).toBe("workspace");
  });
});
