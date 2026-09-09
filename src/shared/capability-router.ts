/**
 * R43 Phase C (R-303): capability-aware routing (pure + shareable).
 *
 * A scheduler must never assign work to a node/module that lacks the capability
 * or whose state cannot accept work. Given candidate runtimes and their observed
 * module states, routing:
 *   - excludes FAILED / DISABLED / RECOVERING candidates (and those lacking a
 *     required capability) — with the reason recorded;
 *   - includes READY and DEGRADED candidates (DEGRADED is usable under explicit
 *     risk conditions; the breaker/budget layers still apply downstream);
 *   - never treats an unobserved/assumed capability as present.
 */

export type ModuleState = "UNINITIALIZED" | "CHECKING" | "READY" | "DEGRADED" | "FAILED" | "DISABLED" | "RECOVERING" | "UNKNOWN";

export interface RouterCandidate {
  id: string;
  /** Capability ids this candidate actually supports (observed). */
  capabilities: string[];
}

export interface RoutedResult {
  selected: string[];
  excluded: Array<{ id: string; reason: string }>;
  /** DEGRADED candidates admitted under explicit risk — tracked, never silent. */
  degraded: string[];
  blocked: string[];
}

export function eligibleCandidates(candidates: RouterCandidate[], states: Record<string, ModuleState>, requiredCapabilities: string[]): RoutedResult {
  const selected: string[] = [];
  const excluded: RoutedResult["excluded"] = [];
  const degraded: string[] = [];
  for (const candidate of candidates) {
    const state = states[candidate.id] ?? "UNKNOWN";
    if (state === "FAILED" || state === "DISABLED" || state === "RECOVERING") {
      excluded.push({ id: candidate.id, reason: `state ${state} cannot accept work` });
      continue;
    }
    const missing = requiredCapabilities.filter((capability) => !candidate.capabilities.includes(capability));
    if (missing.length) {
      excluded.push({ id: candidate.id, reason: `missing capability: ${missing.join(",")}` });
      continue;
    }
    if (state === "DEGRADED") degraded.push(candidate.id);
    selected.push(candidate.id);
  }
  return { selected, excluded, degraded, blocked: excluded.filter((item) => item.reason.startsWith("state ")).map((item) => item.id) };
}
