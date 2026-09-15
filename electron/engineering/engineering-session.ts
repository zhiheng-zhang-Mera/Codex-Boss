import { sha256Hex } from "../../src/shared/hash";

/**
 * Autonomous-engineering role sessions (Update-Plan/cleaning.md §10).
 *
 * A provider session is keyed by the synthetic task id the role turn is
 * dispatched under, so that id *is* the isolation boundary. Before this module
 * the id was a function of the goal and the role only (`eng-goal-<goal>` /
 * `eng-goal-<goal>-review`), which meant every finding of a goal shared one
 * coder session and one reviewer session: a retry of finding A inherited the
 * context of finding B, and the reviewer could be handed the coder's turn.
 *
 * The key now contains all three parts the plan names:
 *
 *   eng-${goalId}-${findingId}-${role}
 *
 * giving the properties the loop depends on:
 *
 *   same finding retry    → same session   (deterministic, retry-safe)
 *   different finding     → different session
 *   coder vs reviewer     → different session
 *
 * The id must also be a valid ledger identity (`[A-Za-z0-9][A-Za-z0-9_-]{0,127}`),
 * so each part is sanitized. When the sanitized form would exceed the ledger's
 * 128-character limit the id collapses to a digest of the *unsanitized* key
 * instead of being cut — truncation could make two findings share a session,
 * which is the exact failure this module exists to prevent.
 */

type EngineeringRoleName = "coder" | "reviewer";

export interface EngineeringSessionKey {
  /** The frozen goal the turn belongs to. */
  goalId: string;
  /** The finding the turn is about (from the audit, or a reviewer reflow). */
  findingId: string;
}

/** Longest id `durable-json.validId` accepts. */
const ENGINEERING_SESSION_ID_LIMIT = 128;

/** `[A-Za-z0-9_-]` only, collapsed and trimmed; never empty. */
function sanitizePart(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const cleaned = text.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  return cleaned;
}

/** Stable fingerprint of the exact key, used whenever the readable form is lossy. */
function keyDigest(goalId: unknown, findingId: unknown, role: EngineeringRoleName): string {
  return sha256Hex(`boss-engineering-session-1\n${String(goalId)}\n${String(findingId)}\n${role}`).slice(0, 12);
}

/**
 * The synthetic task id one role turn runs under. Simultaneously the provider
 * session key, the job fingerprint input and the ledger identity.
 */
export function engineeringSessionId(goalId: string, findingId: string, role: EngineeringRoleName): string {
  const goal = sanitizePart(goalId);
  const finding = sanitizePart(findingId);
  // Sanitizing is lossy (`a:b` and `a-b` both read as `a-b`), and two findings
  // that collapse onto one id would share a provider session — the exact failure
  // this module exists to prevent. A lossy key therefore carries a digest of the
  // ORIGINAL parts, so distinct findings always stay distinct.
  const lossless = goal === goalId && finding === findingId;
  const readable = `eng-${goal || "goal"}-${finding || "finding"}`;
  const suffix = lossless ? "" : `-${keyDigest(goalId, findingId, role)}`;
  const candidate = `${readable}${suffix}-${role}`;
  if (candidate.length <= ENGINEERING_SESSION_ID_LIMIT) return candidate;
  // Too long to spell out: identify it by a digest of the exact key instead of
  // truncating, so distinct findings can never collide onto one session.
  const digest = sha256Hex(`boss-engineering-session-1\n${String(goalId)}\n${String(findingId)}\n${role}`).slice(0, 40);
  return `eng-${digest}-${role}`;
}
