import type { ResourceController } from "./resource-controller";
import type { RuntimeCapability, RuntimeId } from "../runtimes/runtime";
import { isRuntimeAvailable } from "../runtimes/runtime";
import type { RuntimeRegistry } from "./runtime-registry";
import type { BudgetManager } from "./budget-manager";

export type RoleId = "planner" | "researcher" | "reviewer" | "synthesizer" | "coder" | "validator" | "critic";
export const ROLE_CAPABILITY: Record<RoleId, RuntimeCapability> = { planner: "planning", researcher: "research", reviewer: "review", synthesizer: "synthesis", coder: "coding", validator: "validation", critic: "critique" };

export interface RoleRoutingRequest {
  role: RoleId;
  requiredCapabilities?: RuntimeCapability[];
  preferredRuntimes?: RuntimeId[];
  excludedRuntimes?: RuntimeId[];
  pinnedRuntime?: RuntimeId;
  allowFallback?: boolean;
}

export interface RuntimeCandidate { runtimeId: RuntimeId; rank: number; reason: string; }

export class RoleRouter {
  constructor(private readonly registry: RuntimeRegistry, private readonly budgets: BudgetManager, private readonly resources?: ResourceController) {}

  route(request: RoleRoutingRequest): RuntimeCandidate[] {
    const required = new Set([ROLE_CAPABILITY[request.role], ...(request.requiredCapabilities ?? [])]);
    const excluded = new Set(request.excludedRuntimes ?? []);
    const preferred = request.preferredRuntimes ?? [];
    const candidates = this.registry.list().filter((runtime) => {
      if (excluded.has(runtime.id) || !this.budgets.eligible(runtime.id)) return false;
      if (![...required].every((capability) => runtime.capabilities.roles.includes(capability))) return false;
      return isRuntimeAvailable(this.registry.getHealth(runtime.id)?.availability ?? "DOWN");
    });
    candidates.sort((a, b) => score(a.id, request.pinnedRuntime, preferred) - score(b.id, request.pinnedRuntime, preferred) || (this.resources?.score(a.id) ?? 1) - (this.resources?.score(b.id) ?? 1));
    const routed = candidates.map((runtime, rank) => ({ runtimeId: runtime.id, rank, reason: runtime.id === request.pinnedRuntime ? "explicit pin" : preferred.includes(runtime.id) ? `preferred #${preferred.indexOf(runtime.id) + 1}` : "compatible fallback" }));
    return request.allowFallback === false ? routed.slice(0, 1) : routed;
  }
}

function score(runtimeId: RuntimeId, pinned: RuntimeId | undefined, preferred: RuntimeId[]): number {
  if (runtimeId === pinned) return -1000;
  const index = preferred.indexOf(runtimeId);
  return index < 0 ? 1000 : index;
}
