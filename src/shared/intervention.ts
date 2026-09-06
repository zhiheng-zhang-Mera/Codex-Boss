/**
 * Human guidance gate (plan 9-6 Phase 4). Pure and shareable.
 *
 * Long tasks auto-continue; the controller only pauses for decisions a user
 * must make (research direction, login/CAPTCHA, credentials, paid resources,
 * irreversible external actions, scope/goal changes, publishing). This module
 * provides the HumanInterventionRequest model and a deterministic classifier
 * mapping failure/state reasons to AUTO_RECOVER or REQUIRES_USER.
 */

export type InterventionKind = "DIRECTION" | "AUTHORIZATION" | "LOGIN" | "CAPTCHA" | "BUDGET" | "RESEARCH_SCOPE" | "EXTERNAL_ACTION";

export type InterventionDecision = "AUTO_RECOVER" | "REQUIRES_USER";

export interface HumanInterventionRequest {
  id: string;
  taskId: string;
  kind: InterventionKind;
  question: string;
  options?: string[];
  blockingStepId: string;
  contextSummary: string;
  createdAt: string;
  /** Resolved answer, set when the user responds. */
  answer?: string;
  resolvedAt?: string;
}

export function validateInterventionRequest(request: HumanInterventionRequest): void {
  if (!request || typeof request.id !== "string" || !request.id.trim()) throw new Error("Intervention requires an id");
  if (typeof request.taskId !== "string" || !request.taskId.trim()) throw new Error("Intervention requires a taskId");
  if (!["DIRECTION", "AUTHORIZATION", "LOGIN", "CAPTCHA", "BUDGET", "RESEARCH_SCOPE", "EXTERNAL_ACTION"].includes(request.kind)) throw new Error("Invalid intervention kind");
  if (typeof request.question !== "string" || !request.question.trim() || request.question.length > 2000) throw new Error("Intervention question invalid");
  if (typeof request.blockingStepId !== "string" || !request.blockingStepId) throw new Error("Intervention requires a blocking step");
  if (request.options && (request.options.length > 10 || request.options.some((option) => typeof option !== "string" || !option.trim() || option.length > 200))) throw new Error("Invalid intervention options");
}

/** Reasons that auto-recover without a user (plan §4.1). */
const AUTO_RECOVER_REASONS = new Set<string>([
  "provider timeout", "rate limit", "browser reload", "experiment crash", "test failure", "dependency failure", "ai disagreement", "hypothesis disproven"
]);

/** Reasons/kinds that must pause for the user (plan §4.2). */
const USER_REQUIRED_KINDS = new Set<InterventionKind>(["DIRECTION", "LOGIN", "CAPTCHA", "BUDGET", "RESEARCH_SCOPE", "EXTERNAL_ACTION", "AUTHORIZATION"]);

/**
 * Decides whether a step failure auto-recovers or must pause. Auto-recover wins
 * only when the failure is a known recoverable reason; anything else (or a
 * user-decision kind) pauses. Deterministic and fail-closed toward a human.
 */
export function decideIntervention(input: { kind?: InterventionKind; reason: string; isPaidResource?: boolean; isIrreversible?: boolean }): InterventionDecision {
  if (input.kind && USER_REQUIRED_KINDS.has(input.kind)) return "REQUIRES_USER";
  const normalized = input.reason.toLocaleLowerCase();
  if (input.isIrreversible || input.isPaidResource) return "REQUIRES_USER";
  for (const reason of AUTO_RECOVER_REASONS) {
    if (normalized.includes(reason)) return "AUTO_RECOVER";
  }
  return "REQUIRES_USER";
}

/** Persistable shape: an active intervention per task (one at a time). */
export function interventionKey(request: Pick<HumanInterventionRequest, "taskId" | "kind">): string {
  return `${request.taskId}:${request.kind}`;
}
