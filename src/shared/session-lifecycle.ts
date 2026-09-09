/**
 * R43 Phase B (R-203): account/session lifecycle model (pure + shareable).
 *
 * Provider → Profile → Account → Session → Conversation. An account's session
 * lifecycle is tracked per provider in six states:
 *
 *   UNKNOWN → CHECKING → LOGGED_IN ⇄ (EXPIRED / REAUTH_REQUIRED / FAILED)
 *
 * Invariants:
 *   - transitions are validated by an explicit edge table (no arbitrary hops);
 *   - one provider's EXPIRED / REAUTH_REQUIRED / FAILED never touches any other
 *     provider's lifecycle (isolation lives in the durable ledger, one record
 *     per provider/account);
 *   - FAILED records a reason and is never silently cleared without a new
 *     CHECKING/LOGGED_IN evidence (no fake "still logged in").
 */

export type SessionLifecycle = "UNKNOWN" | "CHECKING" | "LOGGED_IN" | "EXPIRED" | "REAUTH_REQUIRED" | "FAILED";

export const SESSION_LIFECYCLES: readonly SessionLifecycle[] = [
  "UNKNOWN", "CHECKING", "LOGGED_IN", "EXPIRED", "REAUTH_REQUIRED", "FAILED"
];

export const ALLOWED_TRANSITIONS: Readonly<Record<SessionLifecycle, readonly SessionLifecycle[]>> = {
  UNKNOWN: ["CHECKING", "LOGGED_IN", "REAUTH_REQUIRED", "FAILED"],
  CHECKING: ["LOGGED_IN", "EXPIRED", "REAUTH_REQUIRED", "FAILED", "UNKNOWN"],
  LOGGED_IN: ["CHECKING", "EXPIRED", "REAUTH_REQUIRED", "FAILED"],
  EXPIRED: ["CHECKING", "REAUTH_REQUIRED", "LOGGED_IN", "FAILED"],
  REAUTH_REQUIRED: ["CHECKING", "LOGGED_IN", "FAILED"],
  FAILED: ["CHECKING", "LOGGED_IN", "REAUTH_REQUIRED"]
};

export function canTransition(from: SessionLifecycle, to: SessionLifecycle): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/** Maps the existing provider account-mode vocabulary onto the lifecycle axis. */
export function lifecycleForAccountMode(mode: "UNKNOWN" | "GUEST_READY" | "AUTH_REQUIRED" | "READY"): SessionLifecycle {
  switch (mode) {
    case "READY":
    case "GUEST_READY":
      return "LOGGED_IN";
    case "AUTH_REQUIRED":
      return "REAUTH_REQUIRED";
    default:
      return "UNKNOWN";
  }
}

export interface SessionTransition {
  from: SessionLifecycle;
  to: SessionLifecycle;
  reason: string;
  at: string;
}

export interface SessionLifecycleRecord {
  schemaVersion: 1;
  providerId: string;
  account: string;
  state: SessionLifecycle;
  lastSuccessAt?: string;
  lastFailureReason?: string;
  transitions: SessionTransition[];
  updatedAt: string;
}
