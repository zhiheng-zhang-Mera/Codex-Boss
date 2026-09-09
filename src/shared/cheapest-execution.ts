/** Cheapest sufficient execution (plan AP06 / §13.2 fast-slow path). Pure and shareable. */

export type ExecutionCostKind = "deterministic" | "api" | "web" | "codex";

/** Relative cost per execution class (higher = more expensive). */
export const COST_ORDER: Record<ExecutionCostKind, number> = { deterministic: 0, api: 1, web: 2, codex: 3 };

export interface CandidateExecution {
  runtimeId: string;
  kind: ExecutionCostKind;
  /** Observed pass rate in (0..1]; unknown observations default to 1. */
  passRate?: number;
  supported: boolean;
}

export interface SufficiencyInput {
  /** Free-text capability the plan needs, e.g. "web", "read files", "computer". */
  capability: string;
  candidates: CandidateExecution[];
  deterministicSufficient?: boolean;
}

export interface CheapestChoice {
  runtimeId: string | null;
  reason: string;
}

/**
 * Picks the cheapest candidate that can satisfy a capability. Exact/native
 * capabilities prefer the deterministic executor; otherwise candidates are
 * ordered by (cost, pass-rate). "Cheapest sufficient" never guesses: a
 * candidate must declare `supported` for the requested capability.
 */
export function chooseCheapestSufficient(input: SufficiencyInput): CheapestChoice {
  const supported = input.candidates.filter((candidate) => candidate.supported);
  if (!supported.length) return { runtimeId: null, reason: `no supported executor for "${input.capability}"` };
  const nativeCapabilities = /^(native|read file|read files|list files|git status)(?:\s|$)|^computer:/i;
  if (input.deterministicSufficient || nativeCapabilities.test(input.capability)) {
    const deterministic = supported.find((candidate) => candidate.kind === "deterministic");
    if (deterministic) return { runtimeId: deterministic.runtimeId, reason: "deterministic executor suffices" };
  }
  const ranked = [...supported].sort((a, b) => COST_ORDER[a.kind] - COST_ORDER[b.kind] || (b.passRate ?? 1) - (a.passRate ?? 1));
  return { runtimeId: ranked[0].runtimeId, reason: `cheapest sufficient executor (${ranked[0].kind})` };
}

export function resolveCapabilityToKind(capability: string): ExecutionCostKind | "unknown" {
  if (/^(native|computer|read file|read files|list files|git status)/i.test(capability)) return "deterministic";
  if (/web|browser|page/i.test(capability)) return "web";
  if (/codex/i.test(capability)) return "codex";
  if (/api|model|reason/i.test(capability)) return "api";
  return "unknown";
}
