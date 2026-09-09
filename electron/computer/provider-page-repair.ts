import type { ComputerActionName, RepairPlan, ComputerTarget } from "../../src/shared/computer-recovery";
import { COMPUTER_READ_ACTIONS } from "../../src/shared/computer-recovery";
import { DOM_TARGET_PREFIX, DomPageBackend, type DomPageSurface } from "./backends/dom-page";
import type { SemanticAction } from "./semantic-runtime";

/**
 * P0-6 Computer-Use provider-page repair executor (DOM tier, §24 T0–T2).
 *
 * Executes a §26 repair plan produced by the shared planner over a real DOM
 * page surface (production: a provider WebContentsView; tests: a fake
 * evaluator). Each step is resolved onto a DOM selector by the injected
 * resolver; geometry kinds (ICON/POINT/REGION) may only run when the resolver
 * maps them onto a concrete element — otherwise the executor stops with
 * UNSUPPORTED and performs NO blind mutation (§25). The final verdict is
 * REPAIRED only when every planned step, including verify_state, succeeded;
 * anything less is UNCERTAIN/FAILED — never claimed as repaired.
 */

export interface PageRepairOptions {
  surface: DomPageSurface;
  /** Maps a planner target (kind + hint) onto a DOM selector; null = cannot target. */
  resolveTarget?: (target: ComputerTarget) => string | null;
  /**
   * R-201 (§5.1): pre-action readiness gate for every mutation the repair chain
   * executes (default ON). Set to false only in deterministic mocks that model
   * the page as already ready; `{ attempts, intervalMs }` tunes the bounded probe.
   */
  readiness?: false | { attempts?: number; intervalMs?: number };
}

export interface PageRepairOutcome {
  status: "REPAIRED" | "UNCERTAIN" | "DENIED" | "UNSUPPORTED" | "FAILED";
  message: string;
  executed: Array<{ step: number; action: ComputerActionName; selector: string }>;
}

export function createPageRepairExecutor(options: PageRepairOptions) {
  const surface = options.surface;
  const resolver = options.resolveTarget ?? (() => null);
  const readiness = options.readiness;
  const readinessOpts: { preflightReadiness?: boolean; readinessAttempts?: number; readinessIntervalMs?: number } = readiness === false
    ? { preflightReadiness: false }
    : { preflightReadiness: true, readinessAttempts: readiness?.attempts, readinessIntervalMs: readiness?.intervalMs };
  const backend = new DomPageBackend(surface, readinessOpts);
  const executeStep = async (action: SemanticAction): Promise<{ ok: boolean; message?: string }> => {
    const result = await backend.execute(action, new AbortController().signal);
    return { ok: result.status === "SUCCESS", message: result.status === "SUCCESS" ? undefined : (result as { message?: string }).message };
  };

  const execute = async (plan: RepairPlan, context: { text?: string } = {}): Promise<PageRepairOutcome> => {
    const executed: PageRepairOutcome["executed"] = [];
    if (plan.verdict === "DENIED") return { status: "DENIED", message: plan.reason ?? "plan denied", executed };
    if (plan.verdict === "UNCERTAIN") return { status: "UNCERTAIN", message: plan.reason ?? "plan uncertain", executed };
    for (let index = 0; index < plan.steps.length; index += 1) {
      const step = plan.steps[index];
      const selector = resolver(step.target);
      if (!selector) {
        return {
          status: "UNSUPPORTED",
          message: `step ${index} (${step.action}) cannot be targeted on this page (no selector for ${step.target.kind}/${step.target.hint ?? "?"}) — no blind action`,
          executed
        };
      }
      const action: SemanticAction = {
        name: step.action,
        target: `${DOM_TARGET_PREFIX}${JSON.stringify({ selector })}`,
        ...(step.action === "enter_text" ? { value: context.text ?? "" } : {})
      };
      const outcome = await executeStep(action);
      executed.push({ step: index, action: step.action, selector });
      if (!outcome.ok) {
        const detail = outcome.message ? `: ${outcome.message}` : "";
        return { status: "FAILED", message: `step ${index} (${step.action} on ${selector}) failed${detail}`, executed };
      }
    }
    const last = plan.steps[plan.steps.length - 1];
    const verified = last.action === "verify_state" || (COMPUTER_READ_ACTIONS.includes(last.action) as boolean);
    return verified
      ? { status: "REPAIRED", message: `repair chain executed (${executed.length} steps) and post-condition verified`, executed }
      : { status: "UNCERTAIN", message: "chain executed but the final step was not a verifiable read — post-condition unconfirmed (§25)", executed };
  };

  return { execute, kind: "dom" as const };
}

export type PageRepairExecutor = ReturnType<typeof createPageRepairExecutor>;
