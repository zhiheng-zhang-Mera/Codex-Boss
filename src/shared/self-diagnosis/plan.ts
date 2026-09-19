/**
 * Self Diagnosis — the diagnostic plan: what to check next.
 *
 * A plan is what this module produces when the evidence is thin, and it is a complete answer rather
 * than a failure. It says what to look at and what the look would settle; it never says what to
 * change. "先建议检查什么，不要直接建议修什么" is a rule about ordering, and this module keeps the
 * two outputs in separate types so the order cannot be lost in a report.
 */

import type { DiagnosisHypothesis } from "./hypotheses";

export const DIAGNOSTIC_ACTIONS = ["COLLECT", "INSPECT", "COMPARE", "REPRODUCE"] as const;
export type DiagnosticAction = (typeof DIAGNOSTIC_ACTIONS)[number];

export interface DiagnosticPlanStep {
  id: string;
  action: DiagnosticAction;
  /** What to look at, named as a component and a signal. */
  target: string;
  description: string;
  why: string;
  priority: number;
  /** What the step would settle, so a reader can stop when it is settled. */
  wouldEstablish: string;
}

export interface DiagnosticPlan {
  schemaVersion: number;
  kind: "DIAGNOSTIC_PLAN";
  steps: DiagnosticPlanStep[];
  /** Why a step cannot be taken yet. */
  blockedBy: string[];
  note: string;
}

/**
 * Builds the next checks, from the candidates and what they are missing.
 *
 * The plan is ordered by what would most reduce the uncertainty: a missing measurement first, then
 * the candidates themselves, then a comparison against a healthy baseline.
 */
export function planDiagnosis(input: { hypotheses: readonly DiagnosisHypothesis[]; missingEvidence?: readonly string[]; at: string }): DiagnosticPlan {
  const steps: DiagnosticPlanStep[] = [];
  const missing = [...new Set([...(input.missingEvidence ?? []), ...input.hypotheses.flatMap((hypothesis) => hypothesis.missingEvidence)])];
  for (const [index, entry] of missing.entries()) {
    steps.push({
      id: `plan:collect:${index}`,
      action: "COLLECT",
      target: entry,
      description: `collect the missing evidence: ${entry}`,
      why: "a candidate cannot be confirmed or excluded while a reading it depends on was never taken",
      priority: 1,
      wouldEstablish: `whether ${entry} is a real gap or an artefact of nothing having observed it`
    });
  }
  for (const [index, hypothesis] of input.hypotheses.entries()) {
    steps.push({
      id: `plan:inspect:${index}`,
      action: "INSPECT",
      target: hypothesis.suspectedComponent,
      description: `inspect ${hypothesis.suspectedComponent} for ${hypothesis.failureMode}`,
      why: `${hypothesis.hypothesisId} is a candidate at confidence ${hypothesis.confidence}`,
      priority: hypothesis.role === "ROOT_CAUSE" ? 2 : 3,
      wouldEstablish: `whether ${hypothesis.suspectedComponent} is the cause or is downstream of another candidate`
    });
  }
  for (const [index, hypothesis] of input.hypotheses.entries()) {
    steps.push({
      id: `plan:compare:${index}`,
      action: "COMPARE",
      target: hypothesis.suspectedComponent,
      description: `compare ${hypothesis.suspectedComponent} against its own healthy baseline`,
      why: "a reading means little without the same reading from a period that was known good",
      priority: 4,
      wouldEstablish: "whether the reading is a change or has always been this way"
    });
  }
  return {
    schemaVersion: 1,
    kind: "DIAGNOSTIC_PLAN",
    steps,
    blockedBy: missing,
    note: steps.length === 0
      ? "there is nothing to check: no symptom was observed, which is not the same as the system being healthy"
      : "these are the checks that would settle the question; this plan changes nothing and proposes no repair"
  };
}
