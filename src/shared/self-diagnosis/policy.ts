/**
 * Self Diagnosis — the engine's identity.
 *
 * A diagnosis is only comparable with another if both say which rules produced it. The engine's
 * version names the implementation, and `diagnosisPolicyHash` fingerprints the thresholds and
 * classifications that actually shape a verdict: what counts as a symptom, how severe it is, what
 * counts as a credible candidate, how much a closed case may move a confidence, and where the line
 * sits between a measured claim and a confident one.
 *
 * A case record stores both, so a later reader can tell which diagnosis rules judged a case rather
 * than assuming they were today's. Nothing here changes a diagnosis: the hash is derived FROM the
 * rules, so it can only move when the rules move.
 */

import { sha256Hex } from "../hash";
import { HEALTH_STATUSES } from "./observations";
import { DIAGNOSIS_ROLES, PRIOR_CONFIDENCE_WEIGHT, SYMPTOM_KINDS } from "./hypotheses";
import { TREATMENT_KINDS, TREATMENT_RISK_LEVELS } from "./treatment";

export const SELF_DIAGNOSIS_ENGINE_VERSION = "self-diagnosis-engine-v1";

/**
 * The confidence at or above which a diagnosis is making a CLAIM rather than offering a candidate.
 *
 * It is the line the dogfood metric `FALSE_HIGH_CONFIDENCE_DIAGNOSES` is counted against: a
 * diagnosis that said "the cause is X" at this confidence and was later refuted is a worse error
 * than one that said "the evidence is not enough".
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/** The confidence at or above which a candidate counts as credible when counting the spread. */
export const CREDIBLE_CANDIDATE_THRESHOLD = 0.3;

/** How far outside its stated range a reading must be to be UNHEALTHY rather than DEGRADED. */
export const SEVERE_OUTSIDE_FACTOR = 2;

/** The signal-to-symptom classifications, as text, so the hash covers them without executing them. */
export const SYMPTOM_PATTERN_SOURCES: readonly string[] = [
  "ledger.*(write|fail)|checkpoint.*(write|fail)->TASK_LEDGER_WRITE_FAILURE",
  "timeout|timed out|providerWait->PROVIDER_TIMEOUT_SPIKE",
  "refus|declined->MODEL_REFUSAL_SURGE",
  "bus.*(deliver|failure|gap)|handlerFailures->EVENT_BUS_DELIVERY_GAP",
  "capture.*(corrupt|torn|unreadable)|prospective->CAPTURE_LOG_CORRUPTION",
  "schema|migration->STATE_SCHEMA_MISMATCH",
  "cache|stale->CACHE_STALE",
  "recovery|retry|park->RECOVERY_STORM",
  "unreadable|missing|absent->SOURCE_UNREADABLE",
  "unreachable|offline|refused|econn|down->COMPONENT_UNREACHABLE",
  "provider.*fail|worker.*fail|failure->PROVIDER_FAILURE_SPIKE"
];

/** The policy the hash is taken over, so a reader can see what a hash change would mean. */
export function diagnosisPolicy(): Record<string, string | number> {
  return {
    engineVersion: SELF_DIAGNOSIS_ENGINE_VERSION,
    highConfidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
    credibleCandidateThreshold: CREDIBLE_CANDIDATE_THRESHOLD,
    severeOutsideFactor: SEVERE_OUTSIDE_FACTOR,
    priorConfidenceWeight: PRIOR_CONFIDENCE_WEIGHT,
    healthStatuses: HEALTH_STATUSES.length,
    symptomKinds: SYMPTOM_KINDS.length,
    diagnosisRoles: DIAGNOSIS_ROLES.length,
    treatmentKinds: TREATMENT_KINDS.length,
    treatmentRiskLevels: TREATMENT_RISK_LEVELS.length,
    symptomPatterns: SYMPTOM_PATTERN_SOURCES.length
  };
}

/** A stable fingerprint of the rules that shape a diagnosis. */
export function diagnosisPolicyHash(): string {
  const policy = diagnosisPolicy();
  return sha256Hex(
    [
      `engine:${SELF_DIAGNOSIS_ENGINE_VERSION}`,
      ...Object.entries(policy).filter(([key]) => key !== "engineVersion").map(([key, value]) => `${key}=${String(value)}`),
      ...SYMPTOM_PATTERN_SOURCES,
      ...HEALTH_STATUSES,
      ...SYMPTOM_KINDS,
      ...DIAGNOSIS_ROLES,
      ...TREATMENT_KINDS,
      ...TREATMENT_RISK_LEVELS
    ].join("\n")
  );
}
