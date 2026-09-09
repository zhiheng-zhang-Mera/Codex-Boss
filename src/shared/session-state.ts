/** Session lifecycle contract (plan AP07 / §1.3). */

export const SESSION_LIFECYCLE_KINDS = ["NEW", "CONTINUE", "FORK", "REVIEW", "ARCHIVED"] as const;
export type SessionLifecycleKind = typeof SESSION_LIFECYCLE_KINDS[number];

/** Allowed transitions between lifecycle kinds. */
export const SESSION_TRANSITIONS: Record<SessionLifecycleKind, SessionLifecycleKind[]> = {
  NEW: ["CONTINUE", "FORK", "REVIEW", "ARCHIVED"],
  CONTINUE: ["FORK", "REVIEW", "ARCHIVED"],
  FORK: ["CONTINUE", "REVIEW", "ARCHIVED"],
  REVIEW: ["CONTINUE", "ARCHIVED"],
  ARCHIVED: []
};

/** True when a session in this kind may still carry out new work. */
export function sessionKindActive(kind: SessionLifecycleKind): boolean {
  return kind !== "ARCHIVED";
}

export function sessionKindLabel(kind: SessionLifecycleKind): string {
  return ({ NEW: "新建", CONTINUE: "延续", FORK: "分叉", REVIEW: "审查", ARCHIVED: "已归档" })[kind];
}

export function sessionKindForResumeStrategy(resumeStrategy: "RECONSTRUCT" | "EXPLICIT_SESSION" | "RESTORE_URL"): SessionLifecycleKind {
  return resumeStrategy === "RESTORE_URL" || resumeStrategy === "EXPLICIT_SESSION" ? "CONTINUE" : "NEW";
}

/** Validate and apply a lifecycle transition; returns the new kind or throws. */
export function transitionSessionKind(current: SessionLifecycleKind, next: SessionLifecycleKind): SessionLifecycleKind {
  if (current === next) return next;
  if (!SESSION_TRANSITIONS[current].includes(next)) throw new Error(`Invalid session transition: ${current} -> ${next}`);
  return next;
}

export function isSessionLifecycleKind(value: unknown): value is SessionLifecycleKind {
  return typeof value === "string" && (SESSION_LIFECYCLE_KINDS as readonly string[]).includes(value);
}
