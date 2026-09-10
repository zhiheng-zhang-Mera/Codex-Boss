import type { ModelExecutionIdentity, ModelIdentitySource } from "../../../src/shared/model-identity";
import { resolveModelIdentity, type ModelObservationCandidate, type ResolvedModelIdentity } from "./version-resolver";

/**
 * Engine Phase 3 — model observer (adapter-facing seam).
 *
 * Collects ONLY fields a provider legitimately exposes to the page/app: structured
 * request or response metadata, page metadata, the UI model selector, the
 * provider's own declaration, and (weakest) behavioural inference. No bypass
 * mechanism is implemented or implied — anything the host cannot read simply
 * stays unobserved.
 *
 * The observer degrades instead of throwing: malformed metadata is ignored and
 * reported, so a broken provider surface can never break a task.
 */

export interface RawModelObservation {
  provider: string;
  surface: string;
  observedAt?: string;
  mode?: string;
  behaviourEpochId?: string;
  /** Structured request/response model identifier exposed by the provider. */
  networkModelId?: unknown;
  /** Structured page metadata (e.g. JSON embedded in the page). */
  pageMetadataModelId?: unknown;
  /** UI model selector / badge text. */
  uiSelectedModel?: unknown;
  /** Provider's own declared model label. */
  providerDeclaredModel?: unknown;
  /** The model's own textual claim — weakest, capped confidence. */
  selfReportedModel?: unknown;
  /** Model inferred from a sustained behaviour change. */
  inferredModel?: unknown;
}

export interface ModelObservationResult extends ResolvedModelIdentity {
  /** Metadata that had to be ignored (malformed/unusable), for observability. */
  ignored: string[];
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 200) : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export class ModelObserver {
  /** Observe one invocation's identity; never throws on malformed metadata. */
  observe(raw: RawModelObservation): ModelObservationResult {
    const ignored: string[] = [];
    const candidates: ModelObservationCandidate[] = [];

    const push = (source: ModelIdentitySource, value: unknown, label: string, selfReported = false): void => {
      if (value === undefined || value === null) return;
      const text = asText(value);
      if (!text) {
        ignored.push(`${label} present but unusable`);
        return;
      }
      candidates.push({ source, model: text, selfReported });
    };

    push("NETWORK_METADATA", raw.networkModelId, "networkModelId");
    push("PAGE_METADATA", raw.pageMetadataModelId, "pageMetadataModelId");
    push("UI_SELECTOR", raw.uiSelectedModel, "uiSelectedModel");
    push("PROVIDER_DECLARED", raw.providerDeclaredModel, "providerDeclaredModel");
    push("PROVIDER_DECLARED", raw.selfReportedModel, "selfReportedModel", true);
    push("INFERRED", raw.inferredModel, "inferredModel", true);

    const resolved = resolveModelIdentity({
      provider: raw.provider,
      surface: raw.surface,
      observedAt: raw.observedAt,
      mode: raw.mode,
      behaviourEpochId: raw.behaviourEpochId,
      candidates
    });
    return { ...resolved, ignored };
  }

  /** Identity for a legacy adapter that exposes no model information at all. */
  unobserved(provider: string, surface: string, observedAt?: string): ModelExecutionIdentity {
    return this.observe({ provider, surface, observedAt }).identity;
  }
}
