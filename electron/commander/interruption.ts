export const interruptions = ["RATE_LIMIT", "QUOTA_EXHAUSTED", "CREDIT_EXHAUSTED", "SESSION_EXPIRED", "AUTH_EXPIRED", "NETWORK_FAILURE", "PROVIDER_5XX", "TOOL_TIMEOUT", "BROWSER_CRASH", "PROCESS_CRASH", "RESOURCE_EXHAUSTED", "DEPENDENCY_FAILURE", "HUMAN_APPROVAL_REQUIRED", "UNKNOWN_INTERRUPTION"] as const;
export type InterruptionKind = typeof interruptions[number];
export interface Interruption { kind: InterruptionKind; message: string; retryAt?: number; }
export type RecoveryAction = "RETRY" | "WAIT" | "RECONSTRUCT" | "VERIFY_SIDE_EFFECT" | "HUMAN_REQUIRED" | "DEFER";
export function classifyInterruption(code: string, message: string, retryAt?: number): Interruption {
  const aliases: Record<string, InterruptionKind> = { RATE_LIMITED: "RATE_LIMIT", BUDGET_EXHAUSTED: "QUOTA_EXHAUSTED", AUTH_REQUIRED: "AUTH_EXPIRED", USER_ACTION_REQUIRED: "HUMAN_APPROVAL_REQUIRED", TIMEOUT: "TOOL_TIMEOUT", DOWN: "PROCESS_CRASH", UNSUPPORTED: "DEPENDENCY_FAILURE" };
  let kind = interruptions.includes(code as InterruptionKind) ? code as InterruptionKind : aliases[code];
  if (!kind) {
    const patterns: [RegExp, InterruptionKind][] = [[/credit.*exhaust|insufficient credits/i, "CREDIT_EXHAUSTED"], [/quota|usage limit/i, "QUOTA_EXHAUSTED"], [/rate.?limit|429/i, "RATE_LIMIT"], [/session.*expir/i, "SESSION_EXPIRED"], [/auth|login/i, "AUTH_EXPIRED"], [/ECONN|ENOTFOUND|network/i, "NETWORK_FAILURE"], [/\b50[0-9]\b/i, "PROVIDER_5XX"], [/timeout/i, "TOOL_TIMEOUT"], [/browser.*crash/i, "BROWSER_CRASH"], [/ENOMEM|out of memory/i, "RESOURCE_EXHAUSTED"]];
    kind = patterns.find(([pattern]) => pattern.test(message))?.[1] ?? "UNKNOWN_INTERRUPTION";
  }
  return { kind, message: message.slice(0, 2000), ...(Number.isFinite(retryAt) ? { retryAt } : {}) };
}
export function recoveryFor(interruption: Interruption, attempts: number, sideEffectUncertain = false, now = Date.now()): { action: RecoveryAction; retryAt?: number } {
  if (sideEffectUncertain) return { action: "VERIFY_SIDE_EFFECT" };
  if (["AUTH_EXPIRED", "HUMAN_APPROVAL_REQUIRED"].includes(interruption.kind)) return { action: "HUMAN_REQUIRED" };
  if (attempts >= 3 || ["DEPENDENCY_FAILURE", "RESOURCE_EXHAUSTED"].includes(interruption.kind)) return { action: "DEFER" };
  if (["QUOTA_EXHAUSTED", "CREDIT_EXHAUSTED"].includes(interruption.kind)) return interruption.retryAt ? { action: "WAIT", retryAt: interruption.retryAt } : { action: "DEFER" };
  if (["SESSION_EXPIRED", "PROCESS_CRASH", "BROWSER_CRASH"].includes(interruption.kind)) return { action: "RECONSTRUCT" };
  return { action: interruption.retryAt && interruption.retryAt > now ? "WAIT" : "RETRY", retryAt: Math.max(interruption.retryAt ?? 0, now + Math.min(60000, 1000 * 2 ** attempts)) };
}
