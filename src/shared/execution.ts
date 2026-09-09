export type ReviewMode = "STRICT" | "BALANCED" | "AUTONOMOUS";
export type ExecutionPhase = "IDLE" | "DISPATCHING" | "WAITING_FOR_RESPONSE" | "RESPONSE_RECEIVED" | "REVIEW_GATE" | "NEXT_STEP" | "WAITING_FOR_USER" | "RETRY" | "FAILED" | "COMPLETED";
export interface OutputContract {
  format: "text" | "json";
  marker?: string;
  requiredFields?: string[];
  fieldTypes?: Record<string, "string" | "number" | "boolean" | "object" | "array">;
}
export interface ReviewPolicy {
  mode: ReviewMode;
  approvalRequired?: boolean;
  externalAction?: boolean;
  highImpact?: boolean;
  output?: OutputContract;
  maxRetries: number;
}
export interface WorkerResponse {
  taskId: string;
  workerId: string;
  responseId: string;
  content: string;
  outcome: "SUCCESS" | "RETRYABLE_FAILURE" | "AUTH_REQUIRED" | "RATE_LIMITED" | "FAILED";
}
export interface ReviewResult {
  status: "PASS" | "RETRY" | "HUMAN_REQUIRED" | "FAILED";
  task_id: string;
  worker_id: string;
  response_id: string;
  requirements_met: string[];
  requirements_missing: string[];
  retry_reason: string | null;
  human_review_reason: string | null;
  next_action: "CONTINUE" | "REDISPATCH" | "WAIT_FOR_USER" | "STOP";
}
export const defaultReviewPolicy: ReviewPolicy = { mode: "BALANCED", maxRetries: 2 };

// This gate validates delivery and shape, never truth or permission to execute output.
export function reviewResponse(response: WorkerResponse, policy: ReviewPolicy = defaultReviewPolicy, attempt = 0): ReviewResult {
  const result: ReviewResult = { status: "PASS", task_id: response.taskId, worker_id: response.workerId, response_id: response.responseId, requirements_met: [], requirements_missing: [], retry_reason: null, human_review_reason: null, next_action: "CONTINUE" };
  const human = (reason: string): ReviewResult => ({ ...result, status: "HUMAN_REQUIRED", human_review_reason: reason, next_action: "WAIT_FOR_USER" });
  if (!["STRICT", "BALANCED", "AUTONOMOUS"].includes(policy.mode) || !Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 3) return human("Invalid review policy");
  if (policy.approvalRequired || policy.highImpact || (policy.mode === "STRICT" && policy.externalAction)) return human("Configured approval policy requires a decision");
  if (response.outcome === "AUTH_REQUIRED") return human("Authentication required");
  if (response.outcome !== "SUCCESS") result.requirements_missing.push(response.outcome);
  const content = response.content.trim();
  if (!content) result.requirements_missing.push("non-empty response");
  // Only classify whole short messages. Explanations about quotas/login are valid answers.
  if (/^(?:please (?:log|sign) in(?: to continue)?|quota exceeded|rate limit exceeded|too many requests|service unavailable|internal server error)[.!\s]*$/i.test(content)) result.requirements_missing.push("provider error response");
  const output = policy.output;
  if (output?.marker && !content.includes(output.marker)) result.requirements_missing.push("expected marker");
  if (output?.format === "json") {
    try {
      const parsed: unknown = JSON.parse(content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected object");
      const value = parsed as Record<string, unknown>;
      for (const key of output.requiredFields ?? []) if (!Object.hasOwn(value, key)) result.requirements_missing.push(`field:${key}`);
      for (const [key, type] of Object.entries(output.fieldTypes ?? {})) {
        const actual = Array.isArray(value[key]) ? "array" : value[key] === null ? "null" : typeof value[key];
        if (actual !== type) result.requirements_missing.push(`type:${key}`);
      }
    } catch { result.requirements_missing.push("valid JSON object"); }
  }
  if (result.requirements_missing.length) {
    const retry = response.outcome !== "FAILED" && attempt < policy.maxRetries;
    return { ...result, status: retry ? "RETRY" : "FAILED", next_action: retry ? "REDISPATCH" : "STOP", retry_reason: result.requirements_missing.join(", ") };
  }
  result.requirements_met = ["response captured", "output contract satisfied"];
  return result;
}

export function executionLabel(phase: ExecutionPhase): string {
  return ({ IDLE: "待执行", DISPATCHING: "执行中", WAITING_FOR_RESPONSE: "等待 AI", RESPONSE_RECEIVED: "已收到回复", REVIEW_GATE: "审查中", NEXT_STEP: "继续执行", WAITING_FOR_USER: "等待用户", RETRY: "准备重试", FAILED: "失败", COMPLETED: "已完成" })[phase];
}
