/**
 * Runtime Intelligence Plane — real outcome ingestion and failure attribution.
 *
 * This module exists for one rule, stated by the plan and enforced here structurally:
 *
 *     an environment failure must never be charged to model capability.
 *
 * A network outage, a missing tool, an unavailable host, a refused credential, a provider
 * rate limit and a changed automation surface all produce a failed run, and none of them is
 * evidence about a model's `reasoning`, `coding` or `stability`. So the classifier returns a
 * domain for every outcome, and only `MODEL` and `SEMANTIC` are chargeable. Everything else
 * is recorded as an observation with its domain and leaves the ledger untouched — with the
 * reason written down, so "we chose not to charge this" is visible instead of looking like
 * a missing update.
 *
 * Fail-closed is the default in both directions:
 *
 *   - an unrecognised failure with no output to judge is `UNKNOWN`, which is not chargeable;
 *   - a bare timeout is `TRANSIENT`, also not chargeable, because a timeout cannot be told
 *     apart from a slow host or a slow network from the evidence alone. Only an explicit
 *     marker (`modelTooSlow`, or a timeout carrying a network/host marker) resolves it.
 *
 * The vocabularies live in `contracts.ts`; the classification and the ledger admission live
 * here. Everything is pure.
 */

import {
  ATTRIBUTABLE_FAILURE_DOMAINS,
  PARTIAL_SUCCESS_QUALITY,
  type FailureDomain,
  type ModelCapabilityDimension,
  type OutcomeDomain,
  type OutcomeKind,
  type TaskKind
} from "./contracts";
import { TASK_KIND_DIMENSIONS, type ModelOutcomeInput, type OutcomeAttribution } from "./model-ledger";

/**
 * Signals Boss already produces. None of these is invented here, and every one is optional:
 * a caller passes what it actually knows, and the classifier says what it could not decide.
 */
export interface OutcomeSignals {
  /** A `RuntimeResult.status` value: SUCCESS, RETRYABLE_FAILURE, AUTH_REQUIRED, RATE_LIMITED, PAGE_CHANGED, FORMAT_INVALID, USER_ACTION_REQUIRED, UNSUPPORTED, PERMANENT_FAILURE. */
  runtimeStatus?: string;
  /** A runtime failure code, matched case-insensitively against the marker table. */
  runtimeFailureCode?: string;
  /** A `SemanticOutcome` value from `src/shared/provider-outcome.ts`. */
  semanticOutcome?: string;
  /** The reason text the telemetry or task ledger recorded. Only marker phrases are read. */
  reason?: string;
  /** Explicit flags, for a caller that knows more than the recorded text says. */
  networkUnavailable?: boolean;
  hostUnavailable?: boolean;
  toolMissing?: string;
  sandboxFailure?: boolean;
  credentialRejected?: boolean;
  rateLimited?: boolean;
  /** True when the model was demonstrably the slow part, which makes a timeout its own. */
  modelTooSlow?: boolean;
  /** True when the run produced an output that could be judged. */
  producedOutput?: boolean;
}

/** Marker phrases, matched case-insensitively against the reason, code and failure code text. */
export const DOMAIN_MARKERS: Readonly<Record<FailureDomain, readonly string[]>> = {
  MODEL: ["model refused to continue", "malformed model output", "bad quality"],
  SEMANTIC: ["model refusal", "hard refusal", "partial refusal", "refused to answer", "sanitiz", "soft restriction", "content policy", "goal drift"],
  TOOL: ["tool not found", "tool missing", "enoent", "command not found", "executable missing", "unsupported runtime"],
  ENVIRONMENT: ["sandbox", "appcontainer", "out of memory", "enospc", "disk full", "permission denied"],
  NETWORK: ["network", "enotfound", "econnrefused", "econnreset", "etimedout", "offline", "dns", "socket hang up"],
  HOST: ["host unavailable", "host offline", "machine unavailable", "no such host"],
  CREDENTIAL: ["unauthoriz", "unauthenticated", "invalid api key", "credential", "401", "login expired", "auth_required"],
  RATE_LIMIT: ["rate limit", "rate_limit", "quota", "429", "too many requests"],
  AUTOMATION_SURFACE: ["page changed", "selector", "page_changed", "dom"],
  TASK: ["ambiguous task", "task definition", "no such task"],
  HUMAN: ["user action required", "user_action_required", "cancelled by user", "awaiting human"],
  TRANSIENT: ["retryable", "transient", "temporarily unavailable"],
  UNKNOWN: []
};

/**
 * The order the marker table is consulted in.
 *
 * Technical transport and platform domains come FIRST, and the prose-like ones last. The
 * ordering is not cosmetic: `ECONNREFUSED` contains the word "refused", so a semantic marker
 * checked first would classify a socket error as a model refusal — and then charge it to the
 * model. A socket error code is unambiguous; prose is not, so the unambiguous evidence wins.
 */
export const MARKER_PRECEDENCE: readonly FailureDomain[] = [
  "NETWORK",
  "HOST",
  "CREDENTIAL",
  "RATE_LIMIT",
  "ENVIRONMENT",
  "TOOL",
  "AUTOMATION_SURFACE",
  "TASK",
  "HUMAN",
  "TRANSIENT",
  "SEMANTIC",
  "MODEL",
  "UNKNOWN"
];

/** `RuntimeResult.status` values that name their own domain, so no text matching is needed. */
export const RUNTIME_STATUS_DOMAINS: Readonly<Record<string, FailureDomain>> = {
  AUTH_REQUIRED: "CREDENTIAL",
  RATE_LIMITED: "RATE_LIMIT",
  PAGE_CHANGED: "AUTOMATION_SURFACE",
  USER_ACTION_REQUIRED: "HUMAN",
  UNSUPPORTED: "TOOL",
  RETRYABLE_FAILURE: "TRANSIENT"
};

/** `SemanticOutcome` values that are a refusal rather than a quality failure. */
export const SEMANTIC_REFUSAL_OUTCOMES: readonly string[] = ["HARD_REFUSAL", "PARTIAL_REFUSAL", "SOFT_RESTRICTION", "HEAVY_SANITIZATION"];

/** `SemanticOutcome` values that are a capability failure of the model itself. */
export const SEMANTIC_MODEL_OUTCOMES: readonly string[] = ["GOAL_DRIFT", "BAD_QUALITY", "FORMAT_FAILURE", "VERIFICATION_FAILURE", "PARTIAL_COMPLETION"];

export interface OutcomeClassification {
  kind: OutcomeKind;
  domain: OutcomeDomain;
  /**
   * True when the ledger may be updated for this outcome.
   *
   * A success and a partial success are chargeable (they are evidence the model did the
   * work); a model or semantic failure is chargeable; an environment, tool, network, host,
   * credential, rate-limit, automation, human, transient or unknown failure is NOT.
   */
  chargeable: boolean;
  /** True when this is a failure the MODEL is responsible for. Always a subset of `chargeable`. */
  attributable: boolean;
  /** The failure class recorded on a ledger entry ("" for a non-failure). */
  failureClass: string;
  reasons: string[];
}

function markerText(signals: OutcomeSignals): string {
  return [signals.reason, signals.runtimeFailureCode, signals.runtimeStatus].filter((part): part is string => typeof part === "string").join(" ").toLowerCase();
}

function domainFromMarkers(text: string): FailureDomain | undefined {
  if (text.trim() === "") return undefined;
  // The precedence list, not object key order, decides which domain an ambiguous text
  // belongs to, so the classification cannot change because a key was added.
  for (const domain of MARKER_PRECEDENCE) {
    if (DOMAIN_MARKERS[domain].some((marker) => text.includes(marker))) return domain;
  }
  return undefined;
}

function domainFromExplicitFlags(signals: OutcomeSignals): { domain: FailureDomain; reason: string } | undefined {
  if (signals.credentialRejected) return { domain: "CREDENTIAL", reason: "the caller reported the credential was rejected" };
  if (signals.rateLimited) return { domain: "RATE_LIMIT", reason: "the caller reported a rate limit" };
  if (signals.networkUnavailable) return { domain: "NETWORK", reason: "the caller reported the network was unavailable" };
  if (signals.hostUnavailable) return { domain: "HOST", reason: "the caller reported the host was unavailable" };
  if (signals.sandboxFailure) return { domain: "ENVIRONMENT", reason: "the caller reported a sandbox failure" };
  if (signals.toolMissing !== undefined) return { domain: "TOOL", reason: `the caller reported a missing tool: ${signals.toolMissing}` };
  return undefined;
}

/**
 * Classifies one outcome into a kind and a failure domain.
 *
 * Order is the decision. Explicit caller flags outrank a recorded status, which outranks the
 * semantic outcome, which outranks the marker text, and only then does the absence of any
 * evidence decide — and it decides `UNKNOWN`, not `MODEL`.
 */
export function classifyOutcome(input: { kind: OutcomeKind; signals?: OutcomeSignals }): OutcomeClassification {
  const signals = input.signals ?? {};
  const text = markerText(signals);
  const reasons: string[] = [];

  const finish = (domain: OutcomeDomain, reason: string, options: { chargeable?: boolean; failureClass?: string } = {}): OutcomeClassification => {
    reasons.push(reason);
    const attributable = domain !== "NONE" && ATTRIBUTABLE_FAILURE_DOMAINS.includes(domain);
    const chargeable = options.chargeable ?? attributable;
    if (domain !== "NONE" && !attributable) {
      reasons.push(`${domain} is not attributable to model capability, so the ledger is not charged; the outcome is recorded instead`);
    }
    return {
      kind: input.kind,
      domain,
      chargeable,
      attributable,
      failureClass: options.failureClass ?? (domain === "NONE" ? "" : `${domain}${signals.runtimeFailureCode === undefined ? "" : `:${signals.runtimeFailureCode}`}`),
      reasons
    };
  };

  if (input.kind === "SUCCESS") return finish("NONE", "the run succeeded", { chargeable: true });
  if (input.kind === "PARTIAL_SUCCESS") {
    return finish("NONE", "the run partially succeeded, which is positive evidence recorded at the partial-success quality", { chargeable: true });
  }
  if (input.kind === "CANCELLED") return finish("HUMAN", "the run was cancelled, which is not a capability failure");

  const explicit = domainFromExplicitFlags(signals);
  if (explicit) return finish(explicit.domain, explicit.reason);

  if (signals.runtimeStatus !== undefined && RUNTIME_STATUS_DOMAINS[signals.runtimeStatus] !== undefined) {
    const domain = RUNTIME_STATUS_DOMAINS[signals.runtimeStatus];
    return finish(domain, `runtime status ${signals.runtimeStatus} names the domain ${domain} directly`);
  }

  if (signals.semanticOutcome !== undefined) {
    if (SEMANTIC_REFUSAL_OUTCOMES.includes(signals.semanticOutcome)) {
      return finish("SEMANTIC", `semantic outcome ${signals.semanticOutcome} is a refusal: it charges reliability but never stability`);
    }
    if (SEMANTIC_MODEL_OUTCOMES.includes(signals.semanticOutcome)) {
      return finish("MODEL", `semantic outcome ${signals.semanticOutcome} is a model capability failure`);
    }
    if (signals.semanticOutcome === "FULL_COMPLETION") return finish("NONE", "the semantic outcome reports full completion", { chargeable: true });
  }

  if (signals.modelTooSlow) return finish("MODEL", "the caller reported the model itself was the slow part of the timeout");

  const marker = domainFromMarkers(text);
  if (marker && input.kind === "TIMEOUT" && marker !== "NETWORK" && marker !== "HOST") {
    // A timeout whose only marker is not network or host is still a timeout first: the
    // marker may describe the consequence rather than the cause.
    return finish("TRANSIENT", `a timeout carrying the marker "${text.trim()}" is still ambiguous, so it is not charged to the model`);
  }
  if (marker) return finish(marker, `the recorded text names ${marker}: "${text.trim()}"`);

  if (input.kind === "TIMEOUT") {
    return finish("TRANSIENT", "a timeout with no network, host or model marker cannot be attributed, so it is not charged to the model");
  }
  if (input.kind === "SEMANTIC_REFUSAL") {
    return finish("SEMANTIC", "a semantic refusal charges reliability but never stability");
  }

  if (signals.producedOutput === true) {
    return finish("MODEL", "the run produced an output that could be judged, and no environment marker was present");
  }
  return finish("UNKNOWN", "no evidence names whose failure this was, so the ledger is not charged");
}

export interface OutcomeCharge {
  classification: OutcomeClassification;
  /** False when the ledger must not be charged for this outcome. */
  chargeable: boolean;
  /** The dimensions the ledger may move. Empty when not chargeable. */
  dimensions: readonly ModelCapabilityDimension[];
}

/**
 * Plans what the ledger may be charged for.
 *
 * A model failure moves the dimensions the task kind exercises; a semantic refusal moves
 * `reliability` only, because a refusal is not instability; a success or partial success
 * moves the dimensions the task kind exercises (positive evidence); anything else moves
 * nothing.
 */
export function planOutcomeCharge(input: { kind: OutcomeKind; taskKind: TaskKind; signals?: OutcomeSignals }): OutcomeCharge {
  const classification = classifyOutcome({ kind: input.kind, signals: input.signals });
  if (!classification.chargeable) return { classification, chargeable: false, dimensions: [] };
  if (classification.domain === "SEMANTIC") return { classification, chargeable: true, dimensions: ["reliability"] };
  return { classification, chargeable: true, dimensions: TASK_KIND_DIMENSIONS[input.taskKind] ?? TASK_KIND_DIMENSIONS.other };
}

export interface IngestOutcomeInput {
  taskId: string;
  role: string;
  taskKind: TaskKind;
  nodeId?: string;
  observationId?: string;
  kind: OutcomeKind;
  signals?: OutcomeSignals;
  /** A measured quality 0..1. A partial success without one is recorded at PARTIAL_SUCCESS_QUALITY. */
  quality?: number;
  latencyMs?: number;
  expectedLatencyMs?: number;
  costUsd?: number;
  expectedCostUsd?: number;
  reviewerAgreed?: boolean;
  contextScale?: "small" | "medium" | "large";
  at: string;
}

/**
 * The ledger input for an outcome, or `undefined` when the outcome must not be charged.
 *
 * Returning `undefined` rather than a neutral outcome is the point: a caller cannot fold an
 * environment failure into the ledger by accident, because there is nothing to fold.
 */
export function toModelOutcomeInput(input: IngestOutcomeInput & { observationId: string; nodeId: string }): ModelOutcomeInput | undefined {
  const charge = planOutcomeCharge({ kind: input.kind, taskKind: input.taskKind, signals: input.signals });
  if (!charge.chargeable) return undefined;

  const success = input.kind === "SUCCESS" || input.kind === "PARTIAL_SUCCESS";
  const quality = input.kind === "PARTIAL_SUCCESS" ? input.quality ?? PARTIAL_SUCCESS_QUALITY : input.quality;
  const attribution: OutcomeAttribution = charge.classification.domain === "SEMANTIC" ? "SEMANTIC" : "RUNTIME";

  return {
    observationId: input.observationId,
    taskId: input.taskId,
    nodeId: input.nodeId,
    role: input.role,
    taskKind: input.taskKind,
    success,
    ...(quality === undefined ? {} : { quality }),
    ...(charge.classification.failureClass === "" ? {} : { failureClass: charge.classification.failureClass }),
    attribution,
    ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
    ...(input.expectedLatencyMs === undefined ? {} : { expectedLatencyMs: input.expectedLatencyMs }),
    ...(input.costUsd === undefined ? {} : { costUsd: input.costUsd }),
    ...(input.expectedCostUsd === undefined ? {} : { expectedCostUsd: input.expectedCostUsd }),
    ...(input.reviewerAgreed === undefined ? {} : { reviewerAgreed: input.reviewerAgreed }),
    ...(input.contextScale === undefined ? {} : { contextScale: input.contextScale }),
    at: input.at
  };
}

/**
 * How a real record's raw outcome word maps onto an `OutcomeKind`.
 *
 * `DEFERRED` maps to `CANCELLED` on purpose: both mean the run did not produce a judgeable
 * outcome, and neither is a capability failure, so both take the same non-chargeable path.
 */
export function outcomeKindOf(raw: string | undefined, reason?: string): OutcomeKind {
  const text = `${raw ?? ""} ${reason ?? ""}`.toLowerCase();
  if (text.includes("deferred")) return "CANCELLED";
  if (text.includes("cancel")) return "CANCELLED";
  if (text.includes("partial")) return "PARTIAL_SUCCESS";
  if (text.includes("refus")) return "SEMANTIC_REFUSAL";
  if (text.includes("timeout") || text.includes("timed out")) return "TIMEOUT";
  if (text.includes("success")) return "SUCCESS";
  return "FAILURE";
}

/** The domains the ledger may be charged for, re-exported so a report and the classifier agree. */
export const CHARGEABLE_FAILURE_DOMAINS: readonly FailureDomain[] = ATTRIBUTABLE_FAILURE_DOMAINS;
