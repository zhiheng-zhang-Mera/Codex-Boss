/**
 * Result validator (Update-Plan/Owner-Result.md Rev.2 §20–§22). Pure + shareable.
 *
 * MODEL_DONE ≠ COMPLETED. A worker/external model reporting "I'm done" only
 * enters VERIFYING; the task ends PASS only when the verification gates for its
 * risk level actually pass, otherwise it is REWORK with the missing evidence
 * listed. Engineering gates (§21) and research gates (§22) are enumerated here
 * so executors can build a verification plan by risk instead of by habit.
 */

export type VerificationPhase = "MODEL_DONE" | "VERIFYING" | "PASS" | "REWORK";

export type ResultDomain = "engineering" | "research" | "generic";

export const ENGINEERING_GATES: readonly string[] = [
  "typecheck", "build", "unit", "integration", "acceptance", "runtime-smoke"
] as const;

export const RESEARCH_GATES: readonly string[] = [
  "protocol", "execution-evidence", "replication", "statistics", "claim-graph",
  "citation", "review", "manuscript", "final-audit"
] as const;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface VerificationPlan {
  domain: ResultDomain;
  risk: RiskLevel;
  gates: readonly string[];
}

/** Mapping "how confident must we be" to the gate set actually run. */
const ENGINEERING_PLAN: Record<RiskLevel, readonly string[]> = {
  low: ["typecheck", "unit"],
  medium: ["typecheck", "build", "unit"],
  high: ["typecheck", "build", "unit", "integration"],
  critical: ENGINEERING_GATES
};

const RESEARCH_PLAN: Record<RiskLevel, readonly string[]> = {
  low: ["protocol", "execution-evidence"],
  medium: ["protocol", "execution-evidence", "replication", "statistics"],
  high: ["protocol", "execution-evidence", "replication", "statistics", "claim-graph", "citation", "review"],
  critical: RESEARCH_GATES
};

const GENERIC_PLAN: Record<RiskLevel, readonly string[]> = {
  low: ["unit"],
  medium: ["build", "unit"],
  high: ["typecheck", "build", "unit", "acceptance"],
  critical: ENGINEERING_GATES
};

export function verificationPlanFor(domain: ResultDomain, risk: RiskLevel): VerificationPlan {
  const table = domain === "engineering" ? ENGINEERING_PLAN : domain === "research" ? RESEARCH_PLAN : GENERIC_PLAN;
  return { domain, risk, gates: table[risk] };
}

export interface GateResult {
  gate: string;
  /** Passed evidence summary (e.g. “vitest 116/116 PASS”). */
  evidence?: string;
  /** Failure/missing detail. */
  error?: string;
}

export interface VerifyInput {
  /** The domain of the claimed completion. */
  domain: ResultDomain;
  risk: RiskLevel;
  /** Gates that actually ran, in any order. */
  results: GateResult[];
  /** True when the executor only got a model “done” message and nothing else yet. */
  modelDoneOnly?: boolean;
}

export interface VerifyVerdict {
  phase: VerificationPhase;
  /** PASS only when every gate in the plan passed with evidence. */
  verdict: "PASS" | "REWORK";
  ran: readonly string[];
  plan: readonly string[];
  /** Gates the plan requires but that did not pass (fail-closed). */
  missing: readonly string[];
  passed: readonly string[];
}

export function verifyResult(input: VerifyInput): VerifyVerdict {
  const plan = verificationPlanFor(input.domain, input.risk);
  if (input.modelDoneOnly) {
    return {
      phase: "VERIFYING",
      verdict: "REWORK",
      ran: [],
      plan: plan.gates,
      missing: plan.gates,
      passed: []
    };
  }
  const passedMap = new Map(input.results.filter((result) => !result.error).map((result) => [result.gate, result]));
  const missing = plan.gates.filter((gate) => {
    const result = passedMap.get(gate);
    return !result || !result.evidence || result.evidence.trim().length === 0;
  });
  const passed = plan.gates.filter((gate) => !missing.includes(gate));
  const allPass = missing.length === 0 && plan.gates.length > 0;
  return {
    phase: allPass ? "PASS" : "REWORK",
    verdict: allPass ? "PASS" : "REWORK",
    ran: input.results.map((result) => result.gate),
    plan: plan.gates,
    missing,
    passed
  };
}

/**
 * §20 terminal-state rule: MODEL_DONE must pass through VERIFYING before a task
 * may be marked COMPLETED. Returns the phase a task with the given declared
 * state should move to next.
 */
export function nextPhaseAfterModelDone(input: Omit<VerifyInput, "modelDoneOnly">): VerifyVerdict {
  return verifyResult({ ...input, modelDoneOnly: input.results.length === 0 });
}
