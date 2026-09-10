/**
 * Engine Phase 0 evidence test — baseline / compatibility.
 *
 * Records the CURRENT deterministic behaviour of RuntimeResult, RoleRouter and
 * TaskIR as a regression oracle, and proves the five Engine feature flags are
 * independently switchable with an all-OFF default. With every flag off, the
 * stable MainCommander → RoleRouter → Runtime → RuntimeResult chain must behave
 * exactly as before (A01).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RoleRouter } from "../../electron/commander/role-router";
import { RuntimeRegistry } from "../../electron/commander/runtime-registry";
import { BudgetManager } from "../../electron/commander/budget-manager";
import { compileIntent } from "../../src/shared/task-ir";
import {
  ADAPTIVE_FLAG_IDS,
  DEFAULT_ADAPTIVE_FLAGS,
  adaptiveCapabilityEnabled,
  adaptiveFlagsAllOff,
  enabledAdaptiveFlags,
  resolveAdaptiveFlags
} from "../../src/shared/adaptive-flags";
import { AdaptiveFlagStore } from "../../electron/learning/adaptive-flag-store";
import type { RuntimeAdapter, RuntimeResult } from "../../electron/runtimes/runtime";

function runtime(id: string, roles: RuntimeAdapter["capabilities"]["roles"]): RuntimeAdapter {
  return {
    id,
    kind: "web",
    capabilities: { roles, supportsCancellation: true, supportsStreaming: false },
    async healthCheck() {
      return { runtimeId: id, availability: "AVAILABLE", message: "ready", checkedAt: "2026-09-10T00:00:00.000Z" };
    },
    async execute(request): Promise<RuntimeResult> {
      return { runtimeId: id, jobId: request.jobId, status: "SUCCESS", content: "ok" };
    }
  };
}

function router(runtimes: RuntimeAdapter[]): RoleRouter {
  const registry = new RuntimeRegistry();
  for (const item of runtimes) registry.register(item);
  const budgets = new BudgetManager();
  void registry.refreshHealth();
  return new RoleRouter(registry, budgets);
}

describe("Phase 0 — RoleRouter deterministic baseline oracle", () => {
  it("preserves registry order when no preference/capability token applies (stable sort oracle)", async () => {
    const roleRouter = router([runtime("web:a", ["planning", "research"]), runtime("api:b", ["planning"]), runtime("local:native", ["planning"])]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const routed = roleRouter.route({ role: "planner" });
    // Oracle: without capability tokens all candidates score equally, so the
    // stable sort keeps registry (insertion) order — this must not change.
    expect(routed.map((candidate) => candidate.runtimeId)).toEqual(["web:a", "api:b", "local:native"]);
    expect(routed.map((candidate) => candidate.rank)).toEqual([0, 1, 2]);
  });

  it("cheapest-sufficient ordering applies only when capability tokens drive routing", async () => {
    const roleRouter = router([runtime("web:a", ["planning", "research"]), runtime("api:b", ["planning"]), runtime("local:native", ["planning"])]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const routed = roleRouter.route({ role: "planner", capabilityTokens: ["general_reasoning"] });
    const ids = routed.map((candidate) => candidate.runtimeId);
    // Oracle: brand-kind ranking (deterministic < api < web) applies here.
    expect(ids.indexOf("local:native")).toBeLessThan(ids.indexOf("api:b"));
    expect(ids.indexOf("api:b")).toBeLessThan(ids.indexOf("web:a"));
  });

  it("pin wins outright; hard exclusions are never returned", async () => {
    const roleRouter = router([runtime("web:a", ["planning"]), runtime("api:b", ["planning"])]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pinned = roleRouter.route({ role: "planner", pinnedRuntime: "web:a" });
    expect(pinned[0].runtimeId).toBe("web:a");
    expect(pinned[0].reason).toBe("explicit pin");
    const excluded = roleRouter.route({ role: "planner", excludedRuntimes: ["api:b"] });
    expect(excluded.map((candidate) => candidate.runtimeId)).toEqual(["web:a"]);
  });

  it("capability filtering baseline: a runtime missing the role capability is dropped", async () => {
    const roleRouter = router([runtime("web:a", ["planning"]), runtime("web:b", ["research"])]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const routed = roleRouter.route({ role: "planner" });
    expect(routed.map((candidate) => candidate.runtimeId)).toEqual(["web:a"]);
  });
});

describe("Phase 0 — RuntimeResult / TaskIR baseline oracle", () => {
  it("RuntimeResult status vocabulary is unchanged (adapters need no migration)", () => {
    const statuses: RuntimeResult["status"][] = ["SUCCESS", "RETRYABLE_FAILURE", "PERMANENT_FAILURE", "CANCELLED"];
    expect(statuses).toHaveLength(4);
    const result: RuntimeResult = { runtimeId: "web:a", jobId: "j1", status: "SUCCESS", content: "x" };
    // Optional fields stay optional: a legacy adapter result needs no model identity.
    expect(result.artifact).toBeUndefined();
    expect("modelSnapshotId" in result).toBe(false);
  });

  it("TaskIR compilation is deterministic for the same request", () => {
    const first = compileIntent("implement caching in the loader");
    const second = compileIntent("implement caching in the loader");
    expect(first).toEqual(second);
    expect(first.riskLevel).toBe("medium"); // unchanged risk semantics
    expect(first.estimatedComplexity).toBe("L1");
  });
});

describe("Phase 0 — feature flags default OFF and independently switchable", () => {
  it("all five flags default to false", () => {
    expect(DEFAULT_ADAPTIVE_FLAGS).toEqual({
      adaptiveProviderLearning: false,
      semanticOutcomeEvaluation: false,
      modelIdentityObservation: false,
      adaptiveRouting: false,
      behaviourEpochDetection: false
    });
    expect(ADAPTIVE_FLAG_IDS).toHaveLength(5);
    expect(adaptiveFlagsAllOff(DEFAULT_ADAPTIVE_FLAGS)).toBe(true);
    expect(enabledAdaptiveFlags(DEFAULT_ADAPTIVE_FLAGS)).toEqual([]);
  });

  it("resolution only enables on an explicit boolean true (fail-closed to off)", () => {
    expect(resolveAdaptiveFlags({ adaptiveRouting: true }).adaptiveRouting).toBe(true);
    expect(resolveAdaptiveFlags({ adaptiveRouting: "true" as unknown as boolean }).adaptiveRouting).toBe(false);
    expect(resolveAdaptiveFlags({ adaptiveRouting: 1 as unknown as boolean }).adaptiveRouting).toBe(false);
    expect(resolveAdaptiveFlags({}).adaptiveRouting).toBe(false);
  });

  it("child capabilities require the umbrella learning flag", () => {
    const onlyRouting = resolveAdaptiveFlags({ adaptiveRouting: true });
    expect(adaptiveCapabilityEnabled("adaptiveRouting", onlyRouting)).toBe(false); // umbrella off
    const umbrella = resolveAdaptiveFlags({ adaptiveProviderLearning: true, adaptiveRouting: true });
    expect(adaptiveCapabilityEnabled("adaptiveRouting", umbrella)).toBe(true);
    expect(adaptiveCapabilityEnabled("semanticOutcomeEvaluation", umbrella)).toBe(false);
  });

  it("durable store persists switches and fails open to OFF when corrupted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-phase0-"));
    const file = path.join(dir, "adaptive-flags.json");
    try {
      const store = new AdaptiveFlagStore(file, () => "2026-09-10T00:00:00.000Z");
      expect(store.allOff()).toBe(true);
      store.set("semanticOutcomeEvaluation", true);
      store.set("modelIdentityObservation", true);
      expect(new AdaptiveFlagStore(file).enabled()).toEqual(["semanticOutcomeEvaluation", "modelIdentityObservation"]);

      fs.writeFileSync(file, "{ not json", "utf8");
      const degraded = new AdaptiveFlagStore(file);
      expect(degraded.allOff()).toBe(true); // corrupted flags never enable learning
      expect(degraded.status().degradedReason).toContain("unreadable");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("setAll(false) turns everything off (single kill switch)", () => {
    const store = new AdaptiveFlagStore(undefined, () => "2026-09-10T00:00:00.000Z");
    store.setAll(true);
    expect(store.enabled()).toHaveLength(5);
    store.setAll(false);
    expect(store.allOff()).toBe(true);
  });
});
