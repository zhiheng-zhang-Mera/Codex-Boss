/**
 * Human corrections (plan §26 input to RFC generation). Pure and shareable.
 *
 * An RFC draft is auto-generated from telemetry/evaluation/failure clusters;
 * a human may correct individual text fields (problem, hypothesis, fix, risk,
 * …). Corrections are durable, keyed by the failure cluster they amend, and
 * re-applied on top of the generated draft so later rounds (self-modification
 * review) see the human-adjusted version — never a silently overwritten one.
 */
import type { RfcDraft } from "./self-diagnosis";

/** RFC text fields a human may correct (structured `evidence` is excluded). */
export type CorrectableRfcField =
  | "problem"
  | "hypothesis"
  | "candidateFix"
  | "expectedBenefit"
  | "risk"
  | "benchmark"
  | "rollback"
  | "compatibilityImpact";

export const CORRECTABLE_RFC_FIELDS: CorrectableRfcField[] = [
  "problem", "hypothesis", "candidateFix", "expectedBenefit",
  "risk", "benchmark", "rollback", "compatibilityImpact"
];

export interface RfcCorrection {
  id: string;
  /** Failure-cluster key being amended, e.g. `${runtimeId}|${reason}`. */
  clusterKey: string;
  field: CorrectableRfcField;
  correctedValue: string;
  note?: string;
  correctedAt: string;
}

export function isCorrectableField(value: unknown): value is CorrectableRfcField {
  return typeof value === "string" && (CORRECTABLE_RFC_FIELDS as string[]).includes(value);
}

/**
 * Applies the latest correction per field (ordered by correctedAt) onto a
 * copy of the RFC draft. Corrections whose field is not correctable or whose
 * correctedValue is blank are ignored. The original draft is never mutated.
 */
export function applyCorrections(draft: RfcDraft, corrections: RfcCorrection[]): RfcDraft {
  const latestByField = new Map<CorrectableRfcField, RfcCorrection>();
  for (const correction of corrections) {
    const field = correction.field;
    if (!CORRECTABLE_RFC_FIELDS.includes(field)) continue;
    if (!correction.correctedValue.trim()) continue;
    const existing = latestByField.get(field);
    if (!existing || correction.correctedAt >= existing.correctedAt) latestByField.set(field, correction);
  }
  if (latestByField.size === 0) return draft;
  return {
    ...draft,
    problem: latestByField.get("problem")?.correctedValue ?? draft.problem,
    hypothesis: latestByField.get("hypothesis")?.correctedValue ?? draft.hypothesis,
    candidateFix: latestByField.get("candidateFix")?.correctedValue ?? draft.candidateFix,
    expectedBenefit: latestByField.get("expectedBenefit")?.correctedValue ?? draft.expectedBenefit,
    risk: latestByField.get("risk")?.correctedValue ?? draft.risk,
    benchmark: latestByField.get("benchmark")?.correctedValue ?? draft.benchmark,
    rollback: latestByField.get("rollback")?.correctedValue ?? draft.rollback,
    compatibilityImpact: latestByField.get("compatibilityImpact")?.correctedValue ?? draft.compatibilityImpact
  };
}
