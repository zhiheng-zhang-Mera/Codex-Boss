/**
 * Self Diagnosis — treatment proposals.
 *
 * Every proposal carries `executable: false` as a literal, and anything whose target is Root Trust,
 * the evolution engine, owner-owned or qualification surface is `OWNER_ONLY` whatever the evidence
 * says. That is the machine form of `CAN_DIAGNOSE != CAN_TREAT`: this module is on the left of the
 * inequality, and it can describe the right-hand side without being able to reach it.
 */

import type { AuthorityClass, BossSelfModel } from "../self-cognition/contracts";
import type { DiagnosisHypothesis } from "./hypotheses";

export const TREATMENT_KINDS = ["RETRY", "CLEAR_CACHE", "RESTART_COMPONENT", "REBUILD_DERIVED_STATE", "DISABLE_OPTIONAL_FEATURE", "SWITCH_PROVIDER", "ROLLBACK_CANDIDATE", "REQUEST_OWNER_REVIEW"] as const;
export type TreatmentKind = (typeof TREATMENT_KINDS)[number];

export const TREATMENT_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "OWNER_ONLY"] as const;
export type TreatmentRisk = (typeof TREATMENT_RISK_LEVELS)[number];

export interface TreatmentProposal {
  schemaVersion: number;
  kind: "TREATMENT_PROPOSAL";
  proposalId: string;
  treatment: TreatmentKind;
  targetComponent: string;
  hypothesisId: string;
  risk: TreatmentRisk;
  expectedBenefit: string;
  riskDetail: string;
  blastRadius: number;
  reversible: boolean;
  requiredAuthority: "AUTONOMOUS_CANDIDATE" | "OWNER";
  /** Literal: this module suggests. Executing is not something it can express. */
  executable: false;
  reason: string;
}

/** The authority tiers where an owner must decide, whatever the evidence says. */
export const OWNER_ONLY_AUTHORITIES: readonly AuthorityClass[] = ["ROOT_TRUST_SURFACE", "EVOLUTION_ENGINE"];

interface ChosenTreatment {
  treatment: TreatmentKind;
  benefit: string;
  risk: string;
  reversible: boolean;
}

/** The treatment that fits a failure mode, and the honest answer when none does. */
function treatmentFor(failureMode: string): ChosenTreatment {
  switch (failureMode) {
    case "PROVIDER_TIMEOUT_SPIKE":
    case "PROVIDER_FAILURE_SPIKE":
    case "COMPONENT_UNREACHABLE":
      return { treatment: "RETRY", benefit: "a transient failure that has already passed costs one more attempt", risk: "a persistent failure would be retried into the same wall", reversible: true };
    case "CACHE_STALE":
      return { treatment: "CLEAR_CACHE", benefit: "the cache is disposable by construction and is rebuilt from real state", risk: "the next reads are slower until it refills", reversible: true };
    case "STATE_SCHEMA_MISMATCH":
    case "TASK_LEDGER_WRITE_FAILURE":
      return { treatment: "REBUILD_DERIVED_STATE", benefit: "derived state is rebuildable from observed runs", risk: "if the source of truth is the damaged part, rebuilding propagates the damage", reversible: false };
    case "EVENT_BUS_DELIVERY_GAP":
    case "CAPTURE_LOG_CORRUPTION":
      return { treatment: "RESTART_COMPONENT", benefit: "an in-process subscriber or writer that lost its effect is recreated", risk: "restarting loses in-memory state and any observation taken during the restart", reversible: false };
    case "RECOVERY_STORM":
      return { treatment: "DISABLE_OPTIONAL_FEATURE", benefit: "stops an optional path that is failing repeatedly", risk: "the feature is unavailable until it is re-enabled", reversible: true };
    case "MODEL_REFUSAL_SURGE":
      return { treatment: "SWITCH_PROVIDER", benefit: "a different provider may accept work this one is refusing", risk: "quality and cost differ per provider, and the switch is a routing decision", reversible: true };
    default:
      return { treatment: "REQUEST_OWNER_REVIEW", benefit: "an owner can decide with context this diagnosis does not have", risk: "the case stays open until an owner looks at it", reversible: true };
  }
}

/**
 * Proposes treatments for the candidates, most credible first.
 *
 * The proposal is a suggestion with a risk level, a blast radius and a required authority — the four
 * fields D10 asks for — and no field that could carry an instruction to act.
 */
export function proposeTreatments(input: { model: BossSelfModel; hypotheses: readonly DiagnosisHypothesis[] }): TreatmentProposal[] {
  return input.hypotheses.map((hypothesis) => {
    const component = input.model.components.find((entry) => entry.id === hypothesis.suspectedComponent || entry.name === hypothesis.suspectedComponent);
    const authority = component?.authority ?? "UNKNOWN";
    const ownerBoundary = OWNER_ONLY_AUTHORITIES.includes(authority) || component?.ownerReview === "REQUIRE_OWNER";
    const chosen = treatmentFor(hypothesis.failureMode);
    const risk: TreatmentRisk = ownerBoundary ? "OWNER_ONLY" : hypothesis.role === "DOWNSTREAM_SYMPTOM" ? "HIGH" : chosen.treatment === "RETRY" || chosen.treatment === "CLEAR_CACHE" ? "LOW" : "MEDIUM";
    return {
      schemaVersion: 1,
      kind: "TREATMENT_PROPOSAL",
      proposalId: `treatment:${hypothesis.hypothesisId}`,
      treatment: ownerBoundary ? "REQUEST_OWNER_REVIEW" : chosen.treatment,
      targetComponent: hypothesis.suspectedComponent,
      hypothesisId: hypothesis.hypothesisId,
      risk,
      expectedBenefit: ownerBoundary
        ? `an owner decides what to do about ${hypothesis.suspectedComponent}; this plane may describe the boundary but may not act across it`
        : chosen.benefit,
      riskDetail: ownerBoundary
        ? `${hypothesis.suspectedComponent} is ${authority === "UNKNOWN" ? "a component whose authority is unknown" : authority}${component?.ownerReview === "REQUIRE_OWNER" ? " and an owner must review changes to it" : ""}, so no automated treatment is proposed`
        : chosen.risk,
      blastRadius: hypothesis.blastRadius,
      reversible: ownerBoundary ? true : chosen.reversible,
      requiredAuthority: ownerBoundary ? "OWNER" : "AUTONOMOUS_CANDIDATE",
      executable: false,
      reason: ownerBoundary
        ? "Root Trust, the evolution engine, owner-owned paths and qualification surface are never treated by this module"
        : `the evidence supports ${hypothesis.failureMode} at confidence ${hypothesis.confidence}; this is a suggestion and nothing here executes it`
    };
  });
}
