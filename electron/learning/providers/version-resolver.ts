import {
  AUTO_MODEL_LABEL,
  MODEL_IDENTITY_SOURCE_CONFIDENCE,
  SELF_REPORTED_CONFIDENCE,
  isAutoSelection,
  isConcreteModelId,
  modelIdentityFingerprint,
  provenanceOf,
  sourceRank,
  type ModelExecutionIdentity,
  type ModelIdentitySource
} from "../../../src/shared/model-identity";

/**
 * Engine Phase 3 — model identity resolution (pure, deterministic).
 *
 * Given raw observations for ONE invocation, pick the most trustworthy identity.
 * Rules:
 *  - a source may only be used for what it actually reports (no guessing);
 *  - a model's own textual self-report is capped at SELF_REPORTED_CONFIDENCE and
 *    can never outrank a structured observation;
 *  - when nothing concrete was observed, observedModelId stays undefined and the
 *    source is UNKNOWN (never a fabricated version).
 */

export interface ModelObservationCandidate {
  source: ModelIdentitySource;
  model?: string;
  /** Set for a model's own textual claim; forces the capped confidence. */
  selfReported?: boolean;
}

export interface ModelObservationInput {
  provider: string;
  surface: string;
  observedAt?: string;
  mode?: string;
  behaviourEpochId?: string;
  candidates: ModelObservationCandidate[];
}

export interface ResolvedModelIdentity {
  identity: ModelExecutionIdentity;
  evidence: string[];
  /** True when a concrete backend model id was actually observed. */
  concrete: boolean;
}

function candidateConfidence(candidate: ModelObservationCandidate): number {
  if (!candidate.model) return 0;
  if (candidate.selfReported) return Math.min(SELF_REPORTED_CONFIDENCE, MODEL_IDENTITY_SOURCE_CONFIDENCE[candidate.source]);
  if (isAutoSelection(candidate.model)) return MODEL_IDENTITY_SOURCE_CONFIDENCE[candidate.source] * 0.5; // "Auto" is a mode, not an id
  return MODEL_IDENTITY_SOURCE_CONFIDENCE[candidate.source];
}

export function resolveModelIdentity(input: ModelObservationInput): ResolvedModelIdentity {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const usable = input.candidates
    .filter((candidate) => typeof candidate.model === "string" && candidate.model.trim().length > 0)
    .map((candidate) => ({ candidate, confidence: candidateConfidence(candidate), rank: sourceRank(candidate.source) }))
    .filter((entry) => entry.confidence > 0)
    .sort((a, b) => a.rank - b.rank || b.confidence - a.confidence || String(a.candidate.model).localeCompare(String(b.candidate.model)));

  const selected = input.candidates.find((candidate) => candidate.source === "UI_SELECTOR" && candidate.model);
  const declared = input.candidates.find((candidate) => candidate.source === "PROVIDER_DECLARED" && candidate.model);
  const structured = usable.find((entry) => entry.candidate.source === "NETWORK_METADATA" || entry.candidate.source === "PAGE_METADATA");

  if (!usable.length) {
    return {
      identity: {
        provider: input.provider,
        surface: input.surface,
        selectedModel: selected?.model ?? AUTO_MODEL_LABEL,
        declaredModel: declared?.model,
        observedModelId: undefined, // never fabricated
        mode: input.mode ?? (selected?.model ? "selected" : "auto"),
        versionSource: "UNKNOWN",
        confidence: 0,
        observedAt,
        behaviourEpochId: input.behaviourEpochId
      },
      evidence: ["no model identity observation available"],
      concrete: false
    };
  }

  const best = usable[0];
  const observedModelId = structured && isConcreteModelId(structured.candidate.model) ? structured.candidate.model : undefined;
  const identity: ModelExecutionIdentity = {
    provider: input.provider,
    surface: input.surface,
    selectedModel: selected?.model ?? (isAutoSelection(undefined) ? AUTO_MODEL_LABEL : undefined),
    declaredModel: declared?.model,
    observedModelId,
    mode: input.mode ?? (isAutoSelection(selected?.model) ? "auto" : "selected"),
    versionSource: best.candidate.source,
    confidence: Number(best.confidence.toFixed(3)),
    observedAt,
    behaviourEpochId: input.behaviourEpochId
  };
  const evidence = usable.map((entry) => `${entry.candidate.source}=${entry.candidate.model} (c=${entry.confidence.toFixed(2)})`);
  if (observedModelId) evidence.push(`observedModelId=${observedModelId}`);
  else evidence.push("observedModelId unavailable — left undefined (no fabrication)");
  return { identity, evidence, concrete: Boolean(observedModelId) || isConcreteModelId(identity.selectedModel) };
}

export function identityFingerprint(identity: ModelExecutionIdentity): string {
  return modelIdentityFingerprint(identity);
}

export { provenanceOf, isConcreteModelId, isAutoSelection, AUTO_MODEL_LABEL };
