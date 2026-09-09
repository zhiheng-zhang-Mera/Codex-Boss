import { describe, expect, it } from "vitest";
import type { DomPageSurface } from "../../electron/computer/backends/dom-page";
import { createPageRepairExecutor } from "../../electron/computer/provider-page-repair";
import { buildRepairPlan } from "../../src/shared/computer-recovery";

/** Fake page that makes every element exist; records every executed script. */
function fakeSurface(records: string[]): DomPageSurface {
  return {
    evaluate: async <T>(script: string): Promise<T> => {
      records.push(script);
      const outcome = { ok: true };
      return outcome as T;
    }
  };
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
    const executor = createPageRepairExecutor({ surface: fakeSurface(scripts), resolveTarget: resolver(resolutions) });
    const outcome = await executor.execute(plan, { text: "hello" });
    expect(outcome.status).toBe("REPAIRED");
    expect(outcome.executed.map((item) => item.action)).toEqual(["read_page", "click_control", "verify_state"]);
    expect(scripts.length).toBe(3);
    expect(scripts.some((script) => script.includes("#send-btn"))).toBe(true);
  });

  it("never mutates blindly: an unresolved mutation target stops with UNSUPPORTED before any click", async () => {
    const scripts: string[] = [];
    // The page lets us read but exposes no selector for the send icon.
    const iconless = (target: { kind: string }): string | null => {
      if (target.kind === "ROLE") return "#output";
      if (target.kind === "TEXT") return "#composer";
      return null; // ICON → unresolved
    };
    const plan = buildRepairPlan("SEND_AFFORDANCE_MISSING", 1000, new Set(["read_page", "click_control", "verify_state"]));
    const executor = createPageRepairExecutor({ surface: fakeSurface(scripts), resolveTarget: iconless });
    const outcome = await executor.execute(plan, { text: "hello" });
    expect(outcome.status).toBe("UNSUPPORTED");
    // Only read_page ran; the click never happened (§25 no blind mutation).
    expect(outcome.executed.map((item) => item.action)).toEqual(["read_page"]);
    expect(scripts.length).toBe(1);
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
