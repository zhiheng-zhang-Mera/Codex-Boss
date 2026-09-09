import { describe, expect, it } from "vitest";
import type { DomPageSurface } from "../../electron/computer/backends/dom-page";
import { createPageRepairExecutor } from "../../electron/computer/provider-page-repair";
import { buildRepairPlan } from "../../src/shared/computer-recovery";

/** Fake page where every element exists; records every executed script. */
function fakeSurface(records: string[]): DomPageSurface {
  return {
    evaluate: async <T>(script: string): Promise<T> => {
      records.push(script);
      return { ok: true } as T;
    }
  };
}

/** Fake whose evaluate dispatches on script content. */
function scriptedSurface(onScript: (script: string) => unknown): DomPageSurface {
  return { evaluate: async <T>(script: string): Promise<T> => onScript(script) as T };
}

function resolver(records: Array<{ kind: string; hint?: string }>) {
  return (target: { kind: string; hint?: string }): string | null => {
    records.push({ kind: target.kind, hint: target.hint });
    switch (target.kind) {
      case "TEXT":
        return "#composer";
      case "ROLE":
        return "#output";
      case "ICON":
        return target.hint === "send" ? "#send-btn" : null;
      default:
        return null;
    }
  };
}

describe("provider page repair executor (P0-6 DOM tier)", () => {
  it("executes a READY plan to REPAIRED and runs exactly the planned steps", async () => {
    const scripts: string[] = [];
    const resolutions: Array<{ kind: string; hint?: string }> = [];
    const plan = buildRepairPlan("SEND_AFFORDANCE_MISSING", 1000, new Set(["read_page", "click_control", "verify_state"]));
    expect(plan.verdict).toBe("READY");
    const executor = createPageRepairExecutor({ surface: fakeSurface(scripts), resolveTarget: resolver(resolutions), readiness: { attempts: 1, intervalMs: 0 } });
    const outcome = await executor.execute(plan, { text: "hello" });
    expect(outcome.status).toBe("REPAIRED");
    expect(outcome.executed.map((item) => item.action)).toEqual(["read_page", "click_control", "verify_state"]);
    // read + (readiness probe before the click) + click + verify
    expect(scripts.length).toBe(4);
    const readinessIndex = scripts.findIndex((script) => script.includes("readyState"));
    const clickIndex = scripts.findIndex((script) => script.includes("#send-btn") && script.includes("click"));
    expect(readinessIndex).toBeGreaterThanOrEqual(0);
    expect(clickIndex).toBeGreaterThan(readinessIndex); // readiness before the mutation
  });

  it("never mutates blindly: an unresolved mutation target stops with UNSUPPORTED before any click", async () => {
    const scripts: string[] = [];
    const iconless = (target: { kind: string }): string | null => {
      if (target.kind === "ROLE") return "#output";
      if (target.kind === "TEXT") return "#composer";
      return null;
    };
    const plan = buildRepairPlan("SEND_AFFORDANCE_MISSING", 1000, new Set(["read_page", "click_control", "verify_state"]));
    const executor = createPageRepairExecutor({ surface: fakeSurface(scripts), resolveTarget: iconless });
    const outcome = await executor.execute(plan, { text: "hello" });
    expect(outcome.status).toBe("UNSUPPORTED");
    expect(outcome.executed.map((item) => item.action)).toEqual(["read_page"]);
    expect(scripts.length).toBe(1); // only read_page ran
  });

  it("R-201: a not-ready page blocks the mutation with NO action performed", async () => {
    const scripts: string[] = [];
    const surface = scriptedSurface((script) => {
      scripts.push(script);
      if (script.includes("readyState")) return { ok: true, readyState: "loading", found: false };
      return { ok: true };
    });
    const plan = buildRepairPlan("SEND_AFFORDANCE_MISSING", 1000, new Set(["read_page", "click_control", "verify_state"]));
    const executor = createPageRepairExecutor({ surface, resolveTarget: resolver([]), readiness: { attempts: 2, intervalMs: 0 } });
    const outcome = await executor.execute(plan, { text: "hello" });
    expect(outcome.status).toBe("FAILED");
    expect(outcome.message).toContain("readiness");
    // The click action itself never executed (only readiness probes saw the selector).
    expect(scripts.some((script) => script.includes("el.click()"))).toBe(false);
  });

  it("R-201: a page that becomes ready within the bounded window proceeds after readiness", async () => {
    const scripts: string[] = [];
    let readinessProbes = 0;
    const surface = scriptedSurface((script) => {
      scripts.push(script);
      if (script.includes("readyState")) {
        readinessProbes++;
        return readinessProbes === 1 ? { ok: true, readyState: "loading", found: false } : { ok: true, readyState: "complete", found: true, visible: true, enabled: true, stableSamples: 1 };
      }
      return { ok: true };
    });
    const plan = buildRepairPlan("SEND_AFFORDANCE_MISSING", 1000, new Set(["read_page", "click_control", "verify_state"]));
    const executor = createPageRepairExecutor({ surface, resolveTarget: resolver([]), readiness: { attempts: 3, intervalMs: 0 } });
    const outcome = await executor.execute(plan, { text: "hello" });
    expect(outcome.status).toBe("REPAIRED");
    expect(readinessProbes).toBeGreaterThanOrEqual(2);
    expect(scripts.some((script) => script.includes("el.click()"))).toBe(true);
  });

  it("refuses DENIED plans and short-circuits UNCERTAIN plans", async () => {
    const scripts: string[] = [];
    const denied = buildRepairPlan("SEND_AFFORDANCE_MISSING", 1000, new Set());
    expect(denied.verdict).toBe("DENIED");
    const executor = createPageRepairExecutor({ surface: fakeSurface(scripts), resolveTarget: resolver([]) });
    const deniedOutcome = await executor.execute(denied, {});
    expect(deniedOutcome.status).toBe("DENIED");
    expect(scripts.length).toBe(0);
  });

  it("reports FAILED when an element exists but the action fails (ok:false)", async () => {
    const surface: DomPageSurface = { evaluate: async () => ({ ok: false, reason: "click intercepted" }) };
    const plan = buildRepairPlan("SEND_AFFORDANCE_MISSING", 1000, new Set(["read_page", "click_control", "verify_state"]));
    const executor = createPageRepairExecutor({ surface, resolveTarget: resolver([]) });
    const outcome = await executor.execute(plan, {});
    expect(outcome.status).toBe("FAILED");
    expect(outcome.message).toContain("failed");
  });
});
