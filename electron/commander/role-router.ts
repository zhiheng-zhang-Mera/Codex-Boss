import type { ResourceController } from "./resource-controller";
import type { RuntimeCapability, RuntimeId } from "../runtimes/runtime";
import { isRuntimeAvailable } from "../runtimes/runtime";
import type { RuntimeRegistry } from "./runtime-registry";
import type { BudgetManager } from "./budget-manager";
import { resolveCapabilityGraph, type CapabilityResolution } from "../../src/shared/capability-graph";
import { resolveCapabilityToKind } from "../../src/shared/cheapest-execution";
import type { AdaptiveReranker, AdaptiveRoutingDecision } from "../../src/shared/adaptive-routing";

export type RoleId = "planner" | "researcher" | "reviewer" | "synthesizer" | "coder" | "validator" | "critic";
export const ROLE_CAPABILITY: Record<RoleId, RuntimeCapability> = { planner: "planning", researcher: "research", reviewer: "review", synthesizer: "synthesis", coder: "coding", validator: "validation", critic: "critique" };

export interface RoleRoutingRequest {
  role: RoleId;
  requiredCapabilities?: RuntimeCapability[];
  /** Free-text plan capabilities (AP06): resolved against the capability graph before routing. */
  capabilityTokens?: string[];
  preferredRuntimes?: RuntimeId[];
  excludedRuntimes?: RuntimeId[];
  pinnedRuntime?: RuntimeId;
  allowFallback?: boolean;
}

export interface RuntimeCandidate { runtimeId: RuntimeId; rank: number; reason: string; }

/** Optional context the adaptive scorer (Engine Phase 6) may use for soft ranking. */
export interface RoleRoutingAdaptiveContext {
  taskId?: string;
  modelSnapshotKey?: string;
  behaviourEpochId?: string;
  fingerprint?: { structuralHash?: string; concepts?: Array<{ conceptId: string }>; specificity?: number };
}

/** Last adaptive decision produced by a route() call (for the feedback ledger/UI). */
export interface RoleRoutingOutcome {
  candidates: RuntimeCandidate[];
  adaptive?: AdaptiveRoutingDecision;
}

/** Cost kind each runtime brand maps to (cheapest-sufficient ordering, AP06/§13.2). */
const BRAND_KIND: Record<string, "deterministic" | "api" | "web" | "codex"> = {
  "local:native": "deterministic",
  "local:": "api",
  "api:": "api",
  "web:": "web",
  "codex:cli": "codex",
  codex: "codex"
};
function brandKind(runtimeId: string): "deterministic" | "api" | "web" | "codex" | undefined {
  for (const [prefix, kind] of Object.entries(BRAND_KIND)) {
    if (runtimeId.startsWith(prefix)) return kind;
  }
  return undefined;
}
function kindRank(kind: "deterministic" | "api" | "web" | "codex"): number {
  return { deterministic: 0, api: 1, web: 2, codex: 3 }[kind];
}

export class RoleRouter {
  private lastOutcome?: RoleRoutingOutcome;

  constructor(
    private readonly registry: RuntimeRegistry,
    private readonly budgets: BudgetManager,
    private readonly resources?: ResourceController,
    /**
     * Engine Phase 6 seam: an OPTIONAL adaptive reranker. It may only reorder
     * candidates this router already approved; a missing implementation, a
     * thrown error, or a disabled flag leaves the deterministic order untouched.
     */
    private readonly adaptive?: AdaptiveReranker,
    private readonly adaptiveContext?: () => RoleRoutingAdaptiveContext
  ) {}

  /** Resolves plan capability tokens (AP06) into router-enforceable AI roles. */
  resolveCapabilityTokens(tokens: string[] | undefined): CapabilityResolution {
    return resolveCapabilityGraph(tokens ?? []);
  }

  route(request: RoleRoutingRequest): RuntimeCandidate[] {
    const graph = resolveCapabilityGraph(request.capabilityTokens ?? []);
    // Graph AI roles are additive to the role's own capability (plan §4.4:
    // route on the capability graph, not brand preference alone).
    const required = new Set([ROLE_CAPABILITY[request.role], ...(request.requiredCapabilities ?? []), ...graph.aiRoles]);
    const excluded = new Set(request.excludedRuntimes ?? []);
    const preferred = request.preferredRuntimes ?? [];
    const wantKinds = new Set(graph.kinds);
    const capabilityDriven = Boolean(request.capabilityTokens?.length);
    const candidates = this.registry.list().filter((runtime) => {
      if (excluded.has(runtime.id) || !this.budgets.eligible(runtime.id)) return false;
      if (![...required].every((capability) => runtime.capabilities.roles.includes(capability))) return false;
      return isRuntimeAvailable(this.registry.getHealth(runtime.id)?.availability ?? "DOWN");
    });
    candidates.sort((a, b) => {
      const scoreDelta = score(a.id, request.pinnedRuntime, preferred) - score(b.id, request.pinnedRuntime, preferred);
      if (scoreDelta !== 0) return scoreDelta;
      if (!capabilityDriven) return (this.resources?.score(a.id) ?? 1) - (this.resources?.score(b.id) ?? 1);
      // Cheapest sufficient: when the capability graph names explicit kinds,
      // prefer a runtime whose brand kind is cheapest among those that satisfy
      // the resolved kinds; otherwise prefer the cheapest brand overall.
      const aKind = brandKind(a.id); const bKind = brandKind(b.id);
      const aFit = aKind && wantKinds.size > 0 ? wantKinds.has(aKind) : aKind !== undefined;
      const bFit = bKind && wantKinds.size > 0 ? wantKinds.has(bKind) : bKind !== undefined;
      if (aFit !== bFit) return aFit ? -1 : 1;
      const aRank = aKind === undefined ? Number.MAX_SAFE_INTEGER : kindRank(aKind);
      const bRank = bKind === undefined ? Number.MAX_SAFE_INTEGER : kindRank(bKind);
      if (aRank !== bRank) return aRank - bRank;
      return (this.resources?.score(a.id) ?? 1) - (this.resources?.score(b.id) ?? 1);
    });
    const routed = candidates.map((runtime, rank) => ({ runtimeId: runtime.id, rank, reason: reasonFor(runtime.id, request.pinnedRuntime, preferred, graph) }));
    const limited = request.allowFallback === false ? routed.slice(0, 1) : routed;
    const finalCandidates = this.applyAdaptive(request, limited);
    return finalCandidates;
  }

  /**
   * Soft-ranking step. HARD eligibility already happened above: the reranker only
   * sees approved candidates, so it can never restore an excluded/capability-less
   * runtime (A24/A25) or displace an explicit pin (A26). Any failure ⇒ original
   * order (A27).
   */
  private applyAdaptive(request: RoleRoutingRequest, candidates: RuntimeCandidate[]): RuntimeCandidate[] {
    this.lastOutcome = { candidates };
    if (!this.adaptive || candidates.length < 2) return candidates;
    try {
      const context = this.adaptiveContext?.();
      const result = this.adaptive.rerank(
        {
          taskId: context?.taskId,
          role: request.role,
          pinnedRuntime: request.pinnedRuntime,
          excludedRuntimes: request.excludedRuntimes,
          requiredCapabilities: request.requiredCapabilities,
          capabilityTokens: request.capabilityTokens,
          preferredRuntimes: request.preferredRuntimes,
          fingerprint: context?.fingerprint,
          modelSnapshotKey: context?.modelSnapshotKey,
          behaviourEpochId: context?.behaviourEpochId
        },
        candidates
      );
      if (!result) return candidates;
      // Defensive: the reranker may not invent, drop, duplicate or re-derive
      // candidates — only reorder exactly the set it received.
      const incoming = candidates.map((candidate) => candidate.runtimeId).sort();
      const outgoing = result.ordered.map((candidate) => candidate.runtimeId).sort();
      if (incoming.length !== outgoing.length || incoming.some((id, index) => id !== outgoing[index])) return candidates;
      if (request.pinnedRuntime && candidates.some((candidate) => candidate.runtimeId === request.pinnedRuntime) && result.ordered[0]?.runtimeId !== request.pinnedRuntime) {
        return candidates; // a pin must keep explicit priority
      }
      const byId = new Map(candidates.map((candidate) => [candidate.runtimeId, candidate]));
      const reordered = result.ordered.map((candidate, rank) => ({ ...byId.get(candidate.runtimeId)!, rank }));
      this.lastOutcome = { candidates: reordered, adaptive: result.decision };
      return reordered;
    } catch {
      return candidates; // A27: adaptive failure falls back to the static route
    }
  }

  /** Last adaptive decision (undefined when the reranker is absent or inactive). */
  adaptiveOutcome(): RoleRoutingOutcome | undefined {
    return this.lastOutcome;
  }
}

function reasonFor(runtimeId: string, pinned: RuntimeId | undefined, preferred: RuntimeId[], graph: CapabilityResolution): string {
  if (runtimeId === pinned) return "explicit pin";
  if (preferred.includes(runtimeId)) return `preferred #${preferred.indexOf(runtimeId) + 1}`;
  if (graph.kinds.length) {
    const brand = brandKind(runtimeId);
    if (brand && graph.kinds.includes(brand)) return `cheapest sufficient (${brand})`;
    if (brand) return `compatible fallback (${brand})`;
  }
  const kind = resolveCapabilityToKind(runtimeId);
  return kind === "unknown" ? "compatible fallback" : `compatible fallback (${kind})`;
}

function score(runtimeId: RuntimeId, pinned: RuntimeId | undefined, preferred: RuntimeId[]): number {
  if (runtimeId === pinned) return -1000;
  const index = preferred.indexOf(runtimeId);
  return index < 0 ? 1000 : index;
}
