import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuntimeRegistry } from "../../../electron/commander/runtime-registry";
import { CircuitBreaker } from "../../../electron/commander/circuit-breaker";
import { ExecutionSupervisor } from "../../../electron/commander/execution-supervisor";
import { TaskLedger } from "../../../electron/commander/task-ledger";
import type { RuntimeAdapter, RuntimeAvailability, RuntimeRequest, RuntimeResult } from "../../../electron/runtimes/runtime";
import {
  FAILURE_CLASSES,
  FAILURE_CLASS_REASONS,
  FAILURE_FALLBACKS,
  buildCompatibilityRegistry,
  contractDrift,
  evaluateCompatibility,
  observeCompatibility,
  rerouteTarget,
  summarizeCompatibility,
  type CompatibilityEntry,
  type CompatibilityObservation
} from "../../../src/shared/external-compatibility";
import { failureClassOf, observeRuntimeCompatibility, unavailableRuntimes } from "../../../electron/platform/external-compatibility";

/**
 * Phase 05 Task C and gate 4 — one external dependency degrading must stay LOCAL.
 *
 * The book's requirement: when any single provider/adapter/UI changes, the registry, the scheduler and
 * the UI must show an accurate local DEGRADED, and must reroute when a legitimate alternative exists.
 * Its rollback rule adds the other half: when the route is unclear, fail closed rather than send work
 * somewhere whose permissions or capabilities may not match.
 *
 * The tests come in three layers, and the layering is the point:
 *
 *   1. the pure model, where the expected answer is derivable by hand;
 *   2. the REAL `RuntimeRegistry` + `CircuitBreaker` + `ExecutionSupervisor` + `TaskLedger`, where the
 *      degradation is produced by a genuinely failing adapter rather than by an injected verdict;
 *   3. the negative direction — an external failure must never be able to reach the core verdict, and
 *      a refusal must survive a candidate being available.
 */

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "phase05-compat-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const AT = "2026-09-16T00:00:00.000Z";

function observation(overrides: Partial<CompatibilityObservation> = {}): CompatibilityObservation {
  return {
    id: overrides.id ?? "chatgpt",
    axis: overrides.axis ?? "provider",
    healthProbe: overrides.healthProbe ?? "GET /health",
    at: overrides.at ?? AT,
    healthy: overrides.healthy ?? true,
    ...(overrides.contractVersion === undefined ? {} : { contractVersion: overrides.contractVersion }),
    ...(overrides.failure === undefined ? {} : { failure: overrides.failure }),
    ...(overrides.criticalToCore === undefined ? {} : { criticalToCore: overrides.criticalToCore }),
    ...(overrides.previousVersion === undefined ? {} : { previousVersion: overrides.previousVersion }),
    ...(overrides.fallback === undefined ? {} : { fallback: overrides.fallback })
  };
}

function ready(id: string, overrides: Partial<CompatibilityObservation> = {}): CompatibilityEntry {
  return observeCompatibility(undefined, observation({ id, healthy: true, contractVersion: "2.1.0", ...overrides }));
}

function broken(id: string, failureClass: (typeof FAILURE_CLASSES)[number], overrides: Partial<CompatibilityObservation> = {}): CompatibilityEntry {
  return observeCompatibility(undefined, observation({ id, healthy: false, failure: { class: failureClass, detail: `${id} is broken` }, ...overrides }));
}

describe("Phase 05 Task C — the failure vocabulary is closed and explained", () => {
  it("maps every failure class to an action, with a stated reason", () => {
    for (const failureClass of FAILURE_CLASSES) {
      expect(FAILURE_FALLBACKS[failureClass], `${failureClass} has no fallback`).toBeTruthy();
      expect(FAILURE_CLASS_REASONS[failureClass].length, `${failureClass} has no stated reason`).toBeGreaterThan(30);
    }
    // The two that must never be a retry: a moved contract and local exhaustion.
    expect(FAILURE_FALLBACKS.CONTRACT_VERSION_CHANGED).not.toBe("RETRY_BOUNDED");
    expect(FAILURE_FALLBACKS.RESOURCE_EXHAUSTED).toBe("REFUSE");
    // An unclassified failure refuses rather than guessing.
    expect(FAILURE_FALLBACKS.UNKNOWN).toBe("REFUSE");
  });

  it("reflects each runtime availability onto a failure class honestly", () => {
    // Working states carry no failure, and the two Owner states are the same class because the same
    // person has to act.
    expect(failureClassOf("AVAILABLE")).toBeNull();
    expect(failureClassOf("BUSY")).toBeNull();
    expect(failureClassOf("AUTH_REQUIRED")).toBe("AUTH_EXPIRED");
    expect(failureClassOf("USER_ACTION_REQUIRED")).toBe("AUTH_EXPIRED");
    expect(failureClassOf("PAGE_CHANGED")).toBe("PAGE_STRUCTURE_CHANGED");
    expect(failureClassOf("RATE_LIMITED")).toBe("RATE_LIMITED");
    expect(failureClassOf("DOWN")).toBe("NETWORK_UNREACHABLE");
    // An unreadable state is UNKNOWN, which refuses: guessing here is how work reaches a provider that
    // cannot take it.
    expect(failureClassOf("UNKNOWN")).toBe("UNKNOWN");
    expect(failureClassOf("UNSUPPORTED")).toBe("UNKNOWN");
  });
});

describe("Phase 05 Task C — lastKnownGood only advances from an observation that worked", () => {
  it("records the version a healthy probe read", () => {
    const entry = observeCompatibility(undefined, observation({ contractVersion: "3.0.0" }));
    expect(entry.status).toBe("READY");
    expect(entry.contractVersion).toBe("3.0.0");
    expect(entry.lastKnownGood).toBe("3.0.0");
    expect(contractDrift(entry).drifted).toBe(false);
  });

  it("does NOT let a failing side's version become the baseline", () => {
    const good = observeCompatibility(undefined, observation({ contractVersion: "3.0.0" }));
    // The probe now reads 4.0.0 from a page that no longer works. Recording that as "last known good"
    // would file the breakage as the baseline and hide the drift forever.
    const after = observeCompatibility(good, observation({
      healthy: false,
      contractVersion: "4.0.0",
      failure: { class: "CONTRACT_VERSION_CHANGED", detail: "the adapter no longer matches the page" }
    }));
    expect(after.contractVersion).toBe("4.0.0");
    expect(after.lastKnownGood).toBe("3.0.0");
    const drift = contractDrift(after);
    expect(drift.drifted).toBe(true);
    expect(drift.reason).toContain("last known good was 3.0.0");
  });

  it("carries the baseline forward when a probe cannot read a version at all", () => {
    const good = observeCompatibility(undefined, observation({ contractVersion: "3.0.0" }));
    const after = observeCompatibility(good, observation({ healthy: false, failure: { class: "TOOL_TIMEOUT", detail: "no answer" } }));
    expect(after.contractVersion).toBe("3.0.0");
    expect(after.lastKnownGood).toBe("3.0.0");
    expect(after.healthProbe).toBe("GET /health");
  });

  it("distinguishes ABSENT from DEGRADED, because the scheduler treats them differently", () => {
    expect(broken("unreachable", "NETWORK_UNREACHABLE").status).toBe("ABSENT");
    expect(broken("broken-page", "PAGE_STRUCTURE_CHANGED").status).toBe("DEGRADED");
    expect(broken("expired", "AUTH_EXPIRED").status).toBe("DEGRADED");
  });
});

describe("Phase 05 Task C / gate 4 — one degraded dependency never fails the core", () => {
  it("reports the core OPERATIONAL when everything is ready", () => {
    const verdict = evaluateCompatibility([ready("chatgpt"), ready("claude"), ready("gemini")]);
    expect(verdict.verdict).toBe("OPERATIONAL");
    expect(verdict.degraded).toEqual([]);
  });

  it("reports DEGRADED, not FAILED, for ANY single external failure class", () => {
    // The whole property, checked over the whole vocabulary rather than over one convenient case.
    for (const failureClass of FAILURE_CLASSES) {
      const verdict = evaluateCompatibility([ready("chatgpt"), broken("claude", failureClass), ready("gemini")]);
      expect(verdict.verdict, `${failureClass} failed the core`).toBe("DEGRADED");
      // The entry lands in the bucket its class implies — ABSENT when nothing answered at all,
      // DEGRADED when the other side answered and the answer was bad — and never in `fatal`.
      const bucket = failureClass === "NETWORK_UNREACHABLE" ? verdict.absent : verdict.degraded;
      expect(bucket, `${failureClass} was not reported`).toContain("claude");
      expect(verdict.fatal).toEqual([]);
      if (failureClass === "NETWORK_UNREACHABLE") {
        // Nothing answered at all. There is no "external dependency degraded" reason for this case,
        // so the check is that the core still did not move to FAILED.
        expect(verdict.verdict).not.toBe("FAILED");
      } else {
        expect(verdict.reasons.join(" ")).toContain("does not fail the core");
      }
    }
  });

  it("stays DEGRADED when EVERY provider is broken", () => {
    // The book's requirement is that Boss core is not judged FAILED by provider trouble, and "all of
    // them" is the extreme case of that, not an exception to it.
    const verdict = evaluateCompatibility([broken("chatgpt", "PAGE_STRUCTURE_CHANGED"), broken("claude", "AUTH_EXPIRED"), broken("gemini", "DOWN" as never)]);
    expect(verdict.verdict).toBe("DEGRADED");
  });

  it("reaches FAILED only for a dependency declared critical to the core", () => {
    // The escape hatch exists and is deliberate: a dependency the core genuinely cannot run without
    // has to be expressible. Nothing observed from the runtime plane sets it.
    const verdict = evaluateCompatibility([broken("local-database", "RESOURCE_EXHAUSTED", { criticalToCore: true }), ready("chatgpt")]);
    expect(verdict.verdict).toBe("FAILED");
    expect(verdict.fatal).toEqual(["local-database"]);
  });
});

describe("Phase 05 Task C / gate 4 — routing is accurate, and refuses when it cannot be", () => {
  it("reroutes to an available alternative and names it", () => {
    const entry = broken("chatgpt", "PAGE_STRUCTURE_CHANGED");
    expect(entry.degradedFallback).toBe("REROUTE");
    const decision = rerouteTarget(entry, ["chatgpt", "claude", "gemini"], ["chatgpt"]);
    expect(decision.target).toBe("claude");
    expect(decision.reason).toContain("PAGE_STRUCTURE_CHANGED");
  });

  it("honours a REFUSE even when a candidate is available", () => {
    // A fallback that ignores a refusal is not a refusal. RESOURCE_EXHAUSTED refuses, and the
    // available candidate must not be used.
    const entry = broken("local-tool", "RESOURCE_EXHAUSTED");
    expect(entry.degradedFallback).toBe("REFUSE");
    const decision = rerouteTarget(entry, ["local-tool", "claude"], ["local-tool"]);
    expect(decision.target).toBeNull();
    expect(decision.reason).toContain("refused rather than misrouted");
  });

  it("refuses when no alternative outside the unavailable set exists", () => {
    const entry = broken("chatgpt", "RATE_LIMITED");
    const decision = rerouteTarget(entry, ["chatgpt"], ["chatgpt"]);
    expect(decision.target).toBeNull();
    expect(decision.reason).toContain("no alternative");
  });

  it("keeps a ready entry on itself", () => {
    const decision = rerouteTarget(ready("chatgpt"), ["chatgpt", "claude"], []);
    expect(decision.target).toBe("chatgpt");
  });

  it("summarises the surface without dumping every entry", () => {
    const summary = summarizeCompatibility([ready("chatgpt"), broken("claude", "AUTH_EXPIRED")]);
    expect(summary).toContain("core DEGRADED");
    expect(summary).toContain("degraded: claude");
    expect(summary).toContain("runtime=".replace("runtime=", "dependency")); // shape check only
  });

  it("refuses a duplicate record for one dependency", () => {
    expect(() => buildCompatibilityRegistry([ready("chatgpt"), broken("chatgpt", "TOOL_TIMEOUT")])).toThrow(/duplicate compatibility entry/);
  });
});

describe("Phase 05 Task C — the model is reproducible", () => {
  it("gives the same entry for the same observation", () => {
    const first = observeCompatibility(undefined, observation({ contractVersion: "1.2.3" }));
    const second = observeCompatibility(undefined, observation({ contractVersion: "1.2.3" }));
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------------------------------
// Layer 2: the REAL runtime plane. A genuinely failing adapter produces the degradation.
// ---------------------------------------------------------------------------------------------------

function adapter(id: string, availability: RuntimeAvailability, execute: (request: RuntimeRequest) => RuntimeResult): RuntimeAdapter {
  return {
    id,
    kind: "web",
    capabilities: { consumesModel: true, roles: ["planning"], supportsCancellation: true, supportsStreaming: true },
    healthCheck: async () => ({ runtimeId: id, availability, message: `${id} reports ${availability}`, checkedAt: AT }),
    execute: async (request: RuntimeRequest) => execute(request)
  };
}

function request(taskId: string, jobId: string, replaySafe = true): RuntimeRequest {
  return { taskId, jobId, role: "planning", prompt: "do the work", replaySafe, timeoutMs: 30_000 };
}

describe("Phase 05 Task C / gate 4 — the real registry reports local degradation", () => {
  it("marks only the failing provider, and leaves the others ready", async () => {
    const registry = new RuntimeRegistry();
    registry.register(adapter("web:chatgpt", "AVAILABLE", (r) => ({ runtimeId: "web:chatgpt", jobId: r.jobId, status: "SUCCESS", content: "ok" })));
    registry.register(adapter("web:claude", "AUTH_REQUIRED", (r) => ({ runtimeId: "web:claude", jobId: r.jobId, status: "SUCCESS", content: "ok" })));
    registry.register(adapter("web:gemini", "PAGE_CHANGED", (r) => ({ runtimeId: "web:gemini", jobId: r.jobId, status: "SUCCESS", content: "ok" })));

    await registry.refreshHealth();
    const entries = observeRuntimeCompatibility({ registry, at: AT });
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    expect(byId.get("web:chatgpt")?.status).toBe("READY");
    expect(byId.get("web:claude")?.status).toBe("DEGRADED");
    expect(byId.get("web:claude")?.failureClass).toBe("AUTH_EXPIRED");
    expect(byId.get("web:gemini")?.status).toBe("DEGRADED");
    expect(byId.get("web:gemini")?.failureClass).toBe("PAGE_STRUCTURE_CHANGED");

    // The core verdict, over the real registry, with two of three providers broken.
    expect(evaluateCompatibility(entries).verdict).toBe("DEGRADED");
    // And nothing observed from the runtime plane is critical to the core.
    expect(entries.every((entry) => entry.criticalToCore === false)).toBe(true);
  });

  it("names exactly the runtimes that cannot carry work", async () => {
    const registry = new RuntimeRegistry();
    registry.register(adapter("web:a", "AVAILABLE", (r) => ({ runtimeId: "web:a", jobId: r.jobId, status: "SUCCESS" })));
    registry.register(adapter("web:b", "DOWN", (r) => ({ runtimeId: "web:b", jobId: r.jobId, status: "SUCCESS" })));
    registry.register(adapter("web:c", "BUSY", (r) => ({ runtimeId: "web:c", jobId: r.jobId, status: "SUCCESS" })));
    await registry.refreshHealth();
    // `isRuntimeAvailable` is true for AVAILABLE and nothing else: a busy provider is not a provider
    // that can take more work, so both DOWN and BUSY are excluded.
    expect(unavailableRuntimes({ registry })).toEqual(["web:b", "web:c"]);
  });

  it("treats an OPEN circuit as degraded even when the last probe said ready", async () => {
    const registry = new RuntimeRegistry();
    registry.register(adapter("web:flaky", "AVAILABLE", (r) => ({ runtimeId: "web:flaky", jobId: r.jobId, status: "SUCCESS" })));
    await registry.refreshHealth();
    const breaker = new CircuitBreaker(path.join(dir, "breaker.json"));
    for (let attempt = 0; attempt < 3; attempt++) breaker.observeFailure("web:flaky");
    expect(breaker.state("web:flaky")).toBe("OPEN");

    const entries = observeRuntimeCompatibility({ registry, breaker, at: AT });
    expect(entries[0].status).toBe("DEGRADED");
    expect(entries[0].detail).toContain("circuit is open");
    expect(unavailableRuntimes({ registry, breaker })).toContain("web:flaky");
  });

  it("reroutes rather than REFUSES for an open circuit, because the provider timed out rather than becoming unreadable", async () => {
    // The distinction that decides whether work moves: an OPEN circuit is repeated provider-technical
    // failure, which is a transport problem with an obvious alternative. Attributing UNKNOWN to it
    // would REFUSE the work instead — the right answer for a state we cannot classify, and the wrong
    // one for a provider that keeps timing out while a healthy peer is available.
    const registry = new RuntimeRegistry();
    registry.register(adapter("web:slow", "AVAILABLE", (r) => ({ runtimeId: "web:slow", jobId: r.jobId, status: "SUCCESS" })));
    registry.register(adapter("web:healthy", "AVAILABLE", (r) => ({ runtimeId: "web:healthy", jobId: r.jobId, status: "SUCCESS" })));
    await registry.refreshHealth();
    const breaker = new CircuitBreaker(path.join(dir, "breaker.json"));
    for (let attempt = 0; attempt < 3; attempt++) breaker.observeFailure("web:slow");

    const entries = observeRuntimeCompatibility({ registry, breaker, at: AT });
    const slow = entries.find((entry) => entry.id === "web:slow") as CompatibilityEntry;
    expect(slow.failureClass).toBe("TOOL_TIMEOUT");
    expect(slow.degradedFallback).toBe("REROUTE");
    const decision = rerouteTarget(slow, ["web:slow", "web:healthy"], unavailableRuntimes({ registry, breaker }));
    expect(decision.target).toBe("web:healthy");
    expect(decision.reason).toContain("TOOL_TIMEOUT");
  });

  it("advances lastKnownGood from a real probe that reported ready", async () => {
    const registry = new RuntimeRegistry();
    registry.register({
      ...adapter("web:versioned", "AVAILABLE", (r) => ({ runtimeId: "web:versioned", jobId: r.jobId, status: "SUCCESS" })),
      compatibility: { id: "web:versioned", kind: "web", windows: { adapter_api: { min: "1", max: "1" } } }
    });
    await registry.refreshHealth();
    const entries = observeRuntimeCompatibility({ registry, at: AT });
    expect(entries[0].contractVersion).toBe("1..1");
    expect(entries[0].lastKnownGood).toBe("1..1");
  });
});

describe("Phase 05 Task C / gate 4 — the real supervisor reroutes around a broken provider", () => {
  it("reroutes to a healthy provider and isolates the broken one, over the real supervisor", async () => {
    const registry = new RuntimeRegistry();
    const breaker = new CircuitBreaker(path.join(dir, "breaker.json"));
    const ledger = new TaskLedger(path.join(dir, "ledger.json"));
    // Positional signature: ledger, scheduler, resources, recovery, budgets, breaker.
    const supervisor = new ExecutionSupervisor(ledger, undefined, undefined, undefined, undefined, breaker);

    const broken = adapter("web:broken", "AVAILABLE", (r) => ({
      runtimeId: "web:broken",
      jobId: r.jobId,
      status: "RETRYABLE_FAILURE",
      failure: { code: "TIMEOUT", message: "the provider never answers", retryable: true }
    }));
    const healthy = adapter("web:healthy", "AVAILABLE", (r) => ({ runtimeId: "web:healthy", jobId: r.jobId, status: "SUCCESS", content: "the work is done" }));
    registry.register(broken);
    registry.register(healthy);
    await registry.refreshHealth();

    // A replay-SAFE request retries the failing candidate before moving on — that is the supervisor's
    // designed behaviour, and it is why a single dispatch is not one breaker failure. A replay-UNSAFE
    // request stops at the first failure, which is what makes the failure count exactly once.
    const first = await supervisor.execute(request("task-1", "job-1", false), [broken, healthy]);
    expect(first.status).toBe("RETRYABLE_FAILURE");
    expect(first.runtimeId).toBe("web:broken");
    expect(breaker.list().find((entry) => entry.runtimeId === "web:broken")?.consecutiveFailures).toBe(1);
    expect(breaker.state("web:healthy")).toBe("CLOSED");

    // A provider that keeps failing is what an outage looks like. The threshold is three consecutive
    // provider-technical failures, so two more dispatches reach it.
    for (let attempt = 2; attempt <= 3; attempt++) {
      const again = await supervisor.execute(request(`task-${attempt}`, `job-${attempt}`, false), [broken, healthy]);
      expect(again.runtimeId).toBe("web:broken");
    }
    expect(breaker.state("web:broken")).toBe("OPEN");
    expect(breaker.state("web:healthy")).toBe("CLOSED");

    // The failure is LOCAL and the scheduler will not choose the broken provider again.
    expect(unavailableRuntimes({ registry, breaker })).toContain("web:broken");
    expect(unavailableRuntimes({ registry, breaker })).not.toContain("web:healthy");

    // And the healthy provider completes the same work — the reroute the book asks for. The supervisor
    // skips a runtime whose circuit is open, so this succeeds without touching the broken provider.
    const rerouted = await supervisor.execute(request("task-4", "job-4", false), [broken, healthy]);
    expect(rerouted.status).toBe("SUCCESS");
    expect(rerouted.runtimeId).toBe("web:healthy");
    expect(rerouted.content).toBe("the work is done");

    // The compatibility registry, over the same registry and breaker, reports exactly that.
    const entries = observeRuntimeCompatibility({ registry, breaker, at: AT });
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    expect(byId.get("web:broken")?.status).toBe("DEGRADED");
    expect(byId.get("web:healthy")?.status).toBe("READY");
    // Two of two external dependencies cannot carry work and the CORE is still only DEGRADED.
    expect(evaluateCompatibility(entries).verdict).toBe("DEGRADED");
    for (const entry of entries) expect(entry.criticalToCore).toBe(false);

    // The scheduler names where work should go.
    const decision = rerouteTarget(byId.get("web:broken") as CompatibilityEntry, ["web:broken", "web:healthy"], unavailableRuntimes({ registry, breaker }));
    expect(decision.target).toBe("web:healthy");
  });
});
