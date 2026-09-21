/**
 * Self Diagnosis — from a reading to a named symptom, and from symptoms to ranked candidates.
 *
 * The two things this module refuses to do are the two the brief calls out:
 *
 *   - **one symptom does not produce one root cause.** `rankHypotheses` returns candidates with
 *     confidences that sum to no particular number and are never normalised into a verdict, and the
 *     report says `MULTIPLE_HYPOTHESES` when more than one is credible.
 *   - **a downstream effect is not a second root cause.** `assignRoles` uses the anatomy's own
 *     dependency graph: when two suspected components are connected, the upstream one is the
 *     candidate root cause and the downstream one is a symptom of it. A provider timeout, a slow
 *     task and a scheduler fallback are one problem and two consequences, not three problems.
 */

import { affectedBy } from "../self-cognition/describe";
import type { BossSelfModel } from "../self-cognition/contracts";
import type { HealthObservation } from "./observations";

export const SYMPTOM_SCHEMA_VERSION = 1;

/** The symptom vocabulary. A signal that matches none of these is `UNCLASSIFIED`, not ignored. */
export const SYMPTOM_KINDS = [
  "TASK_LEDGER_WRITE_FAILURE",
  "PROVIDER_TIMEOUT_SPIKE",
  "PROVIDER_FAILURE_SPIKE",
  "EVENT_BUS_DELIVERY_GAP",
  "CAPTURE_LOG_CORRUPTION",
  "MODEL_REFUSAL_SURGE",
  "CACHE_STALE",
  "STATE_SCHEMA_MISMATCH",
  "RECOVERY_STORM",
  "COMPONENT_UNREACHABLE",
  "SOURCE_UNREADABLE",
  "UNCLASSIFIED"
] as const;
export type SymptomKind = (typeof SYMPTOM_KINDS)[number];

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface DiagnosticSymptom {
  schemaVersion: number;
  id: string;
  kind: SymptomKind;
  componentId: string;
  signalId: string;
  severity: Severity;
  /** The reading verbatim, so a reader can check the classification rather than trust it. */
  observation: HealthObservation;
  evidence: string[];
  confidence: number;
}

/** How a signal name maps onto the symptom vocabulary, most specific first. */
const SYMPTOM_PATTERNS: ReadonlyArray<{ pattern: RegExp; kind: SymptomKind }> = [
  { pattern: /ledger.*(write|fail)|checkpoint.*(write|fail)/i, kind: "TASK_LEDGER_WRITE_FAILURE" },
  { pattern: /timeout|timed out|providerWait/i, kind: "PROVIDER_TIMEOUT_SPIKE" },
  { pattern: /refus|declined/i, kind: "MODEL_REFUSAL_SURGE" },
  { pattern: /bus.*(deliver|failure|gap)|handlerFailures/i, kind: "EVENT_BUS_DELIVERY_GAP" },
  { pattern: /capture.*(corrupt|torn|unreadable)|prospective/i, kind: "CAPTURE_LOG_CORRUPTION" },
  { pattern: /schema|migration/i, kind: "STATE_SCHEMA_MISMATCH" },
  { pattern: /cache|stale/i, kind: "CACHE_STALE" },
  { pattern: /recovery|retry|park/i, kind: "RECOVERY_STORM" },
  { pattern: /unreadable|missing|absent/i, kind: "SOURCE_UNREADABLE" },
  { pattern: /unreachable|offline|refused|econn|down/i, kind: "COMPONENT_UNREACHABLE" },
  { pattern: /provider.*fail|worker.*fail|failure/i, kind: "PROVIDER_FAILURE_SPIKE" }
];

/** The symptom kind a signal name indicates, or `UNCLASSIFIED` — never a silent drop. */
export function classifySignal(signalId: string): SymptomKind {
  for (const entry of SYMPTOM_PATTERNS) if (entry.pattern.test(signalId)) return entry.kind;
  return "UNCLASSIFIED";
}

function severityOf(observation: HealthObservation): Severity {
  if (observation.status === "UNHEALTHY") return "HIGH";
  if (observation.status === "DEGRADED") return "MEDIUM";
  return "LOW";
}

/** Turns one unhealthy reading into a named symptom. A healthy or absent reading is not a symptom. */
export function symptomOf(observation: HealthObservation): DiagnosticSymptom | undefined {
  if (observation.status !== "DEGRADED" && observation.status !== "UNHEALTHY") return undefined;
  const kind = classifySignal(observation.signalId);
  return {
    schemaVersion: SYMPTOM_SCHEMA_VERSION,
    id: `symptom:${observation.componentId}:${observation.signalId}`,
    kind,
    componentId: observation.componentId,
    signalId: observation.signalId,
    severity: severityOf(observation),
    observation,
    evidence: [`${observation.source} reported ${observation.signalId} as ${observation.status}: ${observation.detail}`],
    confidence: observation.confidence
  };
}

/** Turns an unreadable source into a symptom of its own, so a blind spot is visible. */
export function unreadableSymptom(input: { source: string; reason: string; componentId: string; at: string }): DiagnosticSymptom {
  const observation: HealthObservation = {
    schemaVersion: 1,
    componentId: input.componentId,
    signalId: `${input.source}.unreadable`,
    status: "UNKNOWN",
    capturedAt: input.at,
    source: input.source,
    confidence: 0,
    detail: input.reason
  };
  return {
    schemaVersion: SYMPTOM_SCHEMA_VERSION,
    id: `symptom:${input.componentId}:${input.source}.unreadable`,
    kind: "SOURCE_UNREADABLE",
    componentId: input.componentId,
    signalId: observation.signalId,
    // A blind spot is not a fault, but it is a reason not to be confident.
    severity: "LOW",
    observation,
    evidence: [`${input.source} could not be read: ${input.reason}`],
    confidence: 0
  };
}

export function symptomsOf(observations: readonly HealthObservation[]): DiagnosticSymptom[] {
  return observations.flatMap((observation) => {
    const symptom = symptomOf(observation);
    return symptom === undefined ? [] : [symptom];
  });
}

/* ------------------------------------------------------------ hypotheses */

export const DIAGNOSIS_ROLES = ["ROOT_CAUSE", "CONTRIBUTING_FACTOR", "DOWNSTREAM_SYMPTOM", "UNRELATED", "UNKNOWN"] as const;
export type DiagnosisRole = (typeof DIAGNOSIS_ROLES)[number];

export interface DiagnosisHypothesis {
  schemaVersion: number;
  hypothesisId: string;
  suspectedComponent: string;
  failureMode: string;
  role: DiagnosisRole;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  /** 0..1, and deliberately not normalised across candidates. */
  confidence: number;
  affectedComponents: string[];
  affectedCapabilities: string[];
  blastRadius: number;
  /** The other candidates, named so a reader sees the choice that was made. */
  alternativeHypotheses: string[];
  missingEvidence: string[];
  source: string;
}

/** A prior from the case record: evidence about the past, never a verdict about the present. */
export interface PriorEvidence {
  caseId: string;
  componentId: string;
  failureMode: string;
  closedAt: string;
  finalDisposition: string;
}

export const PRIOR_CONFIDENCE_WEIGHT = 0.1;

/**
 * Builds one hypothesis per suspected component, before roles or confidence are decided.
 *
 * The confidence starts from the evidence the current observations carry and is then adjusted
 * within a bounded weight by priors from closed cases. A prior can raise or lower a candidate; it
 * can never make an unhealthy observation healthy, because it is not evidence about now.
 */
export function hypothesesOf(input: { model: BossSelfModel; symptoms: readonly DiagnosticSymptom[]; at: string; priors?: readonly PriorEvidence[] }): DiagnosisHypothesis[] {
  const byComponent = new Map<string, DiagnosticSymptom[]>();
  for (const symptom of input.symptoms) {
    byComponent.set(symptom.componentId, [...(byComponent.get(symptom.componentId) ?? []), symptom]);
  }
  const priors = input.priors ?? [];
  const hypotheses: DiagnosisHypothesis[] = [];
  for (const [componentId, symptoms] of byComponent) {
    const evidence = symptoms.flatMap((symptom) => symptom.evidence);
    const strongest = Math.max(...symptoms.map((symptom) => symptom.confidence));
    const severityWeight = symptoms.some((symptom) => symptom.severity === "HIGH") ? 0.3 : symptoms.some((symptom) => symptom.severity === "MEDIUM") ? 0.15 : 0;
    const matchingPriors = priors.filter((prior) => prior.componentId === componentId);
    const priorAdjustment = Math.min(PRIOR_CONFIDENCE_WEIGHT * matchingPriors.length, 0.2);
    const confidence = Math.max(0, Math.min(1, Math.round((strongest * 0.5 + severityWeight + 0.1 + priorAdjustment) * 100) / 100));
    const affected = affectedBy(input.model, componentId);
    const failureMode = dominantFailureMode(symptoms);
    hypotheses.push({
      schemaVersion: 1,
      hypothesisId: `hypothesis:${componentId}:${failureMode}`,
      suspectedComponent: componentId,
      failureMode,
      role: "UNKNOWN",
      supportingEvidence: [
        ...evidence,
        ...matchingPriors.map((prior) => `prior case ${prior.caseId} closed ${prior.closedAt} with ${prior.finalDisposition} and the same component, which is evidence about the past and not about now`)
      ],
      contradictingEvidence: [],
      confidence,
      affectedComponents: affected.status === "AVAILABLE" ? affected.value?.dependents ?? [] : [],
      affectedCapabilities: affected.status === "AVAILABLE" ? affected.value?.capabilitiesAffected ?? [] : [],
      blastRadius: affected.status === "AVAILABLE" ? (affected.value?.blastRadius ?? []).length : 0,
      alternativeHypotheses: [],
      missingEvidence: affected.status === "AVAILABLE" ? [] : ["the anatomy does not describe this component, so its blast radius is unknown"],
      source: symptoms.map((symptom) => symptom.observation.source).join(", ")
    });
  }
  return hypotheses;
}

function dominantFailureMode(symptoms: readonly DiagnosticSymptom[]): string {
  const counts = new Map<string, number>();
  for (const symptom of symptoms) counts.set(symptom.kind, (counts.get(symptom.kind) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))[0][0];
}

/**
 * Decides which candidate is a root cause and which is a symptom of another.
 *
 * The rule is the anatomy's: if candidate A is upstream of candidate B in the dependency graph,
 * then B is downstream of A. Both remain candidates, with their roles stated, because a diagnosis
 * that hid the downstream one would hide the blast radius.
 */
export function assignRoles(input: { model: BossSelfModel; hypotheses: readonly DiagnosisHypothesis[] }): DiagnosisHypothesis[] {
  const ids = input.hypotheses.map((hypothesis) => hypothesis.suspectedComponent);
  return input.hypotheses.map((hypothesis) => {
    const upstream = ids.filter((other) => other !== hypothesis.suspectedComponent && reaches(input.model, other, hypothesis.suspectedComponent));
    if (upstream.length > 0) {
      return {
        ...hypothesis,
        role: "DOWNSTREAM_SYMPTOM" as DiagnosisRole,
        supportingEvidence: [...hypothesis.supportingEvidence, `${upstream.join(", ")} is upstream of ${hypothesis.suspectedComponent} in the anatomy, so this is more likely an effect than a second cause`]
      };
    }
    const downstream = ids.filter((other) => reaches(input.model, hypothesis.suspectedComponent, other));
    if (downstream.length > 0) {
      return {
        ...hypothesis,
        role: "ROOT_CAUSE" as DiagnosisRole,
        supportingEvidence: [...hypothesis.supportingEvidence, `the anatomy puts ${downstream.join(", ")} downstream of this component, so one cause explains more than one symptom`]
      };
    }
    // Nothing in the anatomy connects the candidates: each is its own candidate, and saying so is
    // more honest than choosing one.
    return { ...hypothesis, role: input.hypotheses.length === 1 ? ("ROOT_CAUSE" as DiagnosisRole) : ("CONTRIBUTING_FACTOR" as DiagnosisRole) };
  });
}

/** Whether `from` reaches `to` through declared dependencies, using the anatomy's own graph. */
function reaches(model: BossSelfModel, from: string, to: string): boolean {
  const dependents = affectedBy(model, from);
  if (dependents.status !== "AVAILABLE") return false;
  return (dependents.value?.dependents ?? []).includes(to);
}

/** Candidates, most credible first. Ties are broken by id so two runs agree. */
export function rankHypotheses(hypotheses: readonly DiagnosisHypothesis[]): DiagnosisHypothesis[] {
  const ranked = [...hypotheses].sort((left, right) => right.confidence - left.confidence || (left.hypothesisId < right.hypothesisId ? -1 : 1));
  return ranked.map((hypothesis) => ({ ...hypothesis, alternativeHypotheses: ranked.filter((other) => other.hypothesisId !== hypothesis.hypothesisId).map((other) => other.hypothesisId) }));
}

export type HypothesisSpread = "SINGLE_HYPOTHESIS" | "MULTIPLE_HYPOTHESES" | "NO_HYPOTHESIS";

/** How many candidates the evidence supports, so a report cannot imply one answer where there are several. */
export function spreadOf(hypotheses: readonly DiagnosisHypothesis[]): HypothesisSpread {
  if (hypotheses.length === 0) return "NO_HYPOTHESIS";
  const credible = hypotheses.filter((hypothesis) => hypothesis.confidence >= 0.3);
  return credible.length > 1 ? "MULTIPLE_HYPOTHESES" : "SINGLE_HYPOTHESIS";
}
