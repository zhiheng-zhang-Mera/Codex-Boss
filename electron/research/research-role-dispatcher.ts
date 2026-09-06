/**
 * Research role dispatcher (milestone §8). Deterministic routing of a research
 * semantic stage to the workers that own its role, with the milestone's
 * escalation policy:
 *
 *   1 worker → host validation → PASS: continue
 *   unresolved (invalid/unparseable answer) → second reviewer
 *   still unresolved → escalate/adjudicate (bounded; never fabricate)
 *
 * The dispatcher reuses the shared research-role vocabulary
 * (`src/shared/research-roles.ts`) and exposes a `ResearchSemanticProvider`
 * (the conductor's semantic interface) whose ask() is routed to a role-capable
 * worker pool with automatic fallback. In the GUI session the worker pool is
 * backed by RuntimeRegistry/RoleRouter/ProviderAutomation adapters (live seam,
 * documented in the phase handoff); in the deterministic CI path it is a
 * fixture/unit pool. A stage whose workers all fail throws — fail closed, the
 * conductor turns that into a FAILED run, never a fabricated answer.
 */

import type { ResearchState } from "../../src/shared/research-ir";
import { roleForStage, type ResearchRole } from "../../src/shared/research-roles";
import { extractJsonEntity } from "./semantic-json";
import type { ResearchSemanticProvider } from "./research-conductor";

/** A semantic worker: owns research roles it can answer. */
export interface ResearchRoleWorker {
  id: string;
  roles: ResearchRole[];
  ask(input: { researchId: string; stage: ResearchState; question: string }): Promise<string>;
}

export interface DispatchAttempt {
  workerId: string;
  stage: ResearchState;
  role: ResearchRole;
  ok: boolean;
  reason?: string;
}

/** Pure selection: workers whose role list includes `role`, in registry order. */
export function workersForRole(workers: readonly ResearchRoleWorker[], role: ResearchRole): ResearchRoleWorker[] {
  return workers.filter((worker) => worker.roles.includes(role));
}

/**
 * Deterministic role dispatcher. `providerFor()` returns a
 * ResearchSemanticProvider that routes every ask to the owning role's workers:
 * primary worker first; host validation (parseable JSON) decides PASS; on an
 * unresolved answer the next role-capable worker is tried (bounded — never
 * more than one attempt per worker, so a single stage cannot fan out into an
 * infinite reviewer chain). When every worker fails the ask throws.
 */
export class ResearchRoleDispatcher {
  private readonly attempts: DispatchAttempt[] = [];
  private readonly lastWorkerByStage = new Map<string, string>();

  constructor(private readonly workers: readonly ResearchRoleWorker[]) {}

  providerFor(): ResearchSemanticProvider {
    return { ask: async (input) => this.dispatch(input) };
  }

  /** Tries the role-capable workers in registry order until one answers valid JSON. */
  private async dispatch(input: { researchId: string; stage: ResearchState; question: string }): Promise<string> {
    const role = roleForStage(input.stage);
    const candidates = workersForRole(this.workers, role);
    if (candidates.length === 0) {
      this.attempts.push({ workerId: "", stage: input.stage, role, ok: false, reason: `no worker owns role ${role}` });
      throw new Error(`No research worker owns role ${role} for stage ${input.stage}`);
    }
    const failures: string[] = [];
    for (const worker of candidates) {
      const text = await worker.ask({ researchId: input.researchId, stage: input.stage, question: input.question });
      if (isValidJsonText(text)) {
        this.attempts.push({ workerId: worker.id, stage: input.stage, role, ok: true });
        this.lastWorkerByStage.set(input.stage, worker.id);
        return text;
      }
      failures.push(`${worker.id} returned unparseable content`);
      this.attempts.push({ workerId: worker.id, stage: input.stage, role, ok: false, reason: "unparseable content" });
    }
    // Escalate: every role-capable worker failed — fail closed, never fabricate.
    this.attempts.push({ workerId: "", stage: input.stage, role, ok: false, reason: failures.join("; ") || "all workers failed" });
    throw new Error(`All role-capable workers failed for stage ${input.stage} (${role}): ${failures.join("; ")}`);
  }

  /** Worker that answered each stage (for logs — model choice explainable). */
  lastWorkerFor(stage: ResearchState): string | undefined {
    return this.lastWorkerByStage.get(stage);
  }

  attemptLog(): readonly DispatchAttempt[] {
    return this.attempts;
  }
}

/** Host validation: the semantic worker's answer must contain valid JSON (no prose-only). */
export function isValidJsonText(text: string): boolean {
  return extractJsonEntity(text) !== null;
}
