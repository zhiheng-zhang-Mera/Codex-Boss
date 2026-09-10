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

/** 10N: a pooled session record tracked by the lifecycle manager. */
export interface SessionPoolRecord {
  sessionId: string;
  provider: string;
  kind: SessionKind;
  lastUsedAt: string; // ISO
  createdAt: string; // ISO
  active: boolean;
}

/** Default session-pool bound: bounded history growth for multi-device concurrency. */
export const DEFAULT_SESSION_POOL_LIMIT = 8;

/** Session kinds are AUTOMATICALLY reaped when stale (TEMPORARY/AUTO_DELETE) or kept (REUSABLE/PERSISTENT). */
export function reapableWhenStale(kind: SessionKind): boolean {
  return kind === "TEMPORARY" || kind === "AUTO_DELETE";
}

/** Deterministic stale session selection (oldest lastUsed first, reapable kinds only). */
export function staleSessions(records: SessionPoolRecord[], nowIso: string, maxAgeMs: number): SessionPoolRecord[] {
  const cutoff = Date.parse(nowIso) - maxAgeMs;
  return records
    .filter((record) => reapableWhenStale(record.kind) && !record.active && Date.parse(record.lastUsedAt) < cutoff)
    .sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt));
}

/** Deterministic GC suggestion: when at/over the pool bound, drop the oldest reapable session. */
export function suggestPoolGc(records: SessionPoolRecord[], limit = DEFAULT_SESSION_POOL_LIMIT): { overflow: number; suggestDropIds: string[] } {
  const overflow = Math.max(0, records.length - limit);
  if (!overflow) return { overflow: 0, suggestDropIds: [] };
  const reapable = records
    .filter((record) => reapableWhenStale(record.kind))
    .sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt));
  return { overflow, suggestDropIds: reapable.slice(0, overflow).map((record) => record.sessionId) };
}
