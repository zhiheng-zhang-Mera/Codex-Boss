/**
 * 10N/10O session lifecycle vNext + login health (pure skeleton).
 *
 * Session kinds on top of existing policy; login health is observational and
 * human-gated for MFA/CAPTCHA (never bypassed).
 */

export type SessionKind = "TEMPORARY" | "REUSABLE" | "PERSISTENT" | "AUTO_DELETE";

export const DEFAULT_AUTONOMOUS_SESSION_KIND: SessionKind = "TEMPORARY";

export interface SessionPolicyDecision {
  kind: SessionKind;
  reason: string;
}

/** Default for long autonomous tasks is TEMPORARY unless the task opts into long-lived context. */
export function decideSessionKind(opts: { longLivedContextRequired?: boolean; taskKind: "autonomous" | "interactive" | "research" }): SessionPolicyDecision {
  if (opts.longLivedContextRequired) return { kind: "PERSISTENT", reason: "task explicitly requires long-lived context" };
  if (opts.taskKind === "interactive") return { kind: "REUSABLE", reason: "interactive session may be reused" };
  return { kind: DEFAULT_AUTONOMOUS_SESSION_KIND, reason: "default for long autonomous work" };
}

export interface LoginHealthReport {
  provider: string;
  account?: string;
  sessionPresent: boolean;
  authenticated: boolean;
  requiresLogin: boolean;
  requiresMFA: boolean;
  requiresCaptcha: boolean;
  expired: boolean;
  unknown: boolean;
  humanGated: boolean; // true when MFA/CAPTCHA/human-verification blocks automation
  scannedAt: string;
}

/** A report that needs human action is human-gated; it must never crash Boss. */
export function isHumanGated(report: LoginHealthReport): boolean {
  return report.requiresMFA || report.requiresCaptcha || report.expired || report.requiresLogin;
}
